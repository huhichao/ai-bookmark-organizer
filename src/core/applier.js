import { findBookmarksBar, findOtherBookmarks } from './analyzer.js';
import { getLocalizedDefaults, resolveLanguage, t } from './i18n.js';
import { createAndSaveSnapshot } from './snapshot.js';

function hasAnyUrlDescendant(node) {
  if (!node) return false;
  if (node.url) return true;
  for (const ch of node.children || []) {
    if (hasAnyUrlDescendant(ch)) return true;
  }
  return false;
}

function countFolderNodes(node) {
  if (!node || node.url) return 0;
  let count = 1;
  for (const ch of node.children || []) {
    count += countFolderNodes(ch);
  }
  return count;
}

async function pruneEmptyFolders(folderId, keepRootId, skipFolderIds = new Set()) {
  const [node] = await chrome.bookmarks.getSubTree(folderId);
  if (!node || node.url) return 0;

  let removed = 0;
  for (const ch of [...(node.children || [])]) {
    if (!ch.url && !skipFolderIds.has(String(ch.id))) {
      removed += await pruneEmptyFolders(ch.id, keepRootId, skipFolderIds);
    }
  }
  const [updated] = await chrome.bookmarks.getSubTree(folderId);
  if (
    updated &&
    String(updated.id) !== String(keepRootId) &&
    !skipFolderIds.has(String(updated.id)) &&
    (!updated.children || updated.children.length === 0)
  ) {
    await chrome.bookmarks.remove(updated.id);
    removed += 1;
  }
  return removed;
}

async function mergeFolderIntoTarget(sourceFolderId, targetFolderId) {
  const [sourceSub] = await chrome.bookmarks.getSubTree(sourceFolderId);
  const [targetSub] = await chrome.bookmarks.getSubTree(targetFolderId);
  if (!sourceSub || !targetSub) return;

  const targetSubByTitle = new Map(
    (targetSub.children || []).filter((c) => !c.url).map((c) => [c.title, c.id])
  );

  for (const ch of [...(sourceSub.children || [])]) {
    if (ch.url) {
      await chrome.bookmarks.move(ch.id, { parentId: targetFolderId });
    } else if (targetSubByTitle.has(ch.title)) {
      await mergeFolderIntoTarget(ch.id, targetSubByTitle.get(ch.title));
    } else {
      await chrome.bookmarks.move(ch.id, { parentId: targetFolderId });
      targetSubByTitle.set(ch.title, ch.id);
    }
  }

  const [afterSource] = await chrome.bookmarks.getSubTree(sourceFolderId);
  if (afterSource && (!afterSource.children || afterSource.children.length === 0)) {
    await chrome.bookmarks.remove(sourceFolderId);
  }
}

export async function applyOrganizationPlan(plan, onProgress = () => {}) {
  const lang = resolveLanguage(plan.uiLanguage);
  const locDefaults = getLocalizedDefaults(lang);
  const tempFolderName = plan.tempFolderName || locDefaults.tempFolderName;

  onProgress(t('progSnapshot', {}, lang));
  await createAndSaveSnapshot();

  let removedDuplicates = 0;
  if (plan.duplicateRemovals?.length) {
    onProgress(t('progDedup', { count: plan.duplicateRemovals.length }, lang));
    for (const dup of plan.duplicateRemovals) {
      try {
        await chrome.bookmarks.remove(dup.removeId);
        removedDuplicates++;
      } catch {
        // Ignore if already deleted
      }
    }
  }

  const tree = await chrome.bookmarks.getTree();
  const root = tree[0];
  const bar = findBookmarksBar(root);
  const other = findOtherBookmarks(root);
  const barId = bar.id;
  const includeOther = Boolean(plan.includeOtherBookmarks && other && other.id !== barId);

  const originalBarChildren = [...(bar.children || [])];
  const originalOtherChildren = includeOther ? [...(other.children || [])] : [];
  const archiveName = plan.archiveFolderName || locDefaults.archiveFolderName;
  const shouldArchiveNonRecent = plan.archiveNonRecent !== false;

  // Reuse existing archive folder if present, otherwise create only when needed
  let archiveFolder = null;
  const archiveParentId = plan.archiveLocation === 'other' && other ? other.id : barId;
  const archiveParentChildren =
    archiveParentId === barId ? originalBarChildren : [...(other?.children || [])];
  const existingArchive = archiveParentChildren.find(
    (c) => !c.url && c.title === archiveName
  );

  const hasPotentialArchiveWork = Boolean(
    plan.tempItems?.length ||
    (shouldArchiveNonRecent && (plan.historicalItems?.length > 0))
  );

  if (existingArchive) {
    archiveFolder = existingArchive;
  } else if (hasPotentialArchiveWork) {
    archiveFolder = await chrome.bookmarks.create({
      parentId: archiveParentId,
      title: archiveName,
    });
  }

  let tempFolder = null;
  if (archiveFolder && plan.tempItems?.length) {
    const [archTree] = await chrome.bookmarks.getSubTree(archiveFolder.id);
    const existingTemp = (archTree.children || []).find(
      (c) => !c.url && c.title === tempFolderName
    );
    tempFolder = existingTemp || (await chrome.bookmarks.create({
      parentId: archiveFolder.id,
      title: tempFolderName,
    }));
  }

  onProgress(t('progCreateFolders', {}, lang));
  const createdFolderIds = new Set(archiveFolder ? [String(archiveFolder.id)] : []);
  const targetFolderIdByName = new Map();

  for (let i = 0; i < plan.folders.length; i++) {
    const folderSpec = plan.folders[i];
    if (!folderSpec?.name || folderSpec.name === archiveName) continue;
    const existing = originalBarChildren.find(
      (c) => !c.url && c.title === folderSpec.name && String(c.id) !== String(archiveFolder?.id)
    );
    let folderId;
    if (existing) {
      folderId = existing.id;
      await chrome.bookmarks.move(folderId, { parentId: barId, index: i });
    } else {
      const created = await chrome.bookmarks.create({
        parentId: barId,
        index: i,
        title: folderSpec.name,
      });
      folderId = created.id;
    }
    createdFolderIds.add(String(folderId));
    targetFolderIdByName.set(folderSpec.name, folderId);
  }

  onProgress(t('progMoveActive', {}, lang));
  let movedActive = 0;
  for (const folderSpec of plan.folders) {
    const targetId = targetFolderIdByName.get(folderSpec.name);
    if (!targetId) continue;
    for (const item of folderSpec.items) {
      try {
        if (item.rename && item.rename !== item.title) {
          await chrome.bookmarks.update(item.id, { title: item.rename });
        }
        await chrome.bookmarks.move(item.id, { parentId: targetId });
        movedActive++;
      } catch {
        // Ignore missing node
      }
    }
  }

  let movedTemp = 0;
  if (tempFolder && plan.tempItems?.length) {
    for (const item of plan.tempItems) {
      try {
        if (item.rename && item.rename !== item.title) {
          await chrome.bookmarks.update(item.id, { title: item.rename });
        }
        await chrome.bookmarks.move(item.id, { parentId: tempFolder.id });
        movedTemp++;
      } catch {
        // Ignore missing node
      }
    }
  }

  let archivedOldFolders = 0;
  let archivedHistorical = 0;
  let removedEmpty = 0;

  if (shouldArchiveNonRecent && archiveFolder) {
    onProgress(t('progArchiveOld', {}, lang));

    const [archInitSnap] = await chrome.bookmarks.getSubTree(archiveFolder.id);
    const archSubByTitle = new Map(
      (archInitSnap?.children || []).filter((c) => !c.url).map((c) => [c.title, c.id])
    );

    const archiveRootChildren = async (childrenList, expectedParentId) => {
      for (const ch of childrenList) {
        if (createdFolderIds.has(String(ch.id))) continue;
        try {
          const [cur] = await chrome.bookmarks.getSubTree(ch.id);
          if (!cur || String(cur.parentId) !== String(expectedParentId)) continue;
          if (cur.url) {
            await chrome.bookmarks.move(cur.id, { parentId: archiveFolder.id });
            archivedHistorical++;
          } else if (!hasAnyUrlDescendant(cur)) {
            if (plan.removeEmptyFolders) {
              const emptyCount = countFolderNodes(cur);
              await chrome.bookmarks.removeTree(cur.id);
              removedEmpty += emptyCount;
            }
          } else if (archSubByTitle.has(cur.title)) {
            await mergeFolderIntoTarget(cur.id, archSubByTitle.get(cur.title));
            archivedOldFolders++;
          } else {
            await chrome.bookmarks.move(cur.id, { parentId: archiveFolder.id });
            archSubByTitle.set(cur.title, cur.id);
            archivedOldFolders++;
          }
        } catch {
          // Already moved or removed
        }
      }
    };

    await archiveRootChildren(originalBarChildren, barId);
    if (includeOther) {
      await archiveRootChildren(originalOtherChildren, other.id);
    }

    if (plan.historicalItems?.length) {
      const freshTree = await chrome.bookmarks.getTree();
      const nodeMeta = new Map();
      const indexTree = (n, parentId = '') => {
        nodeMeta.set(String(n.id), { node: n, parentId: String(parentId || '') });
        for (const ch of n.children || []) {
          indexTree(ch, n.id);
        }
      };
      indexTree(freshTree[0]);

      const isDescendant = (nodeId, ancestorId) => {
        let cur = nodeMeta.get(String(nodeId));
        const target = String(ancestorId);
        while (cur && cur.parentId) {
          if (cur.parentId === target) return true;
          cur = nodeMeta.get(cur.parentId);
        }
        return false;
      };

      const [archSnap] = await chrome.bookmarks.getSubTree(archiveFolder.id);
      const freshArchSubByTitle = new Map(
        (archSnap?.children || []).filter((c) => !c.url).map((c) => [c.title, c.id])
      );

      for (const hItem of plan.historicalItems) {
        const meta = nodeMeta.get(String(hItem.id));
        if (!meta || !meta.node.url) continue;
        if (isDescendant(meta.node.id, archiveFolder.id)) continue;
        const inScope =
          isDescendant(meta.node.id, barId) ||
          (includeOther && isDescendant(meta.node.id, other.id));
        if (!inScope) continue;

        const parentMeta = nodeMeta.get(meta.parentId);
        const isRootParent =
          !parentMeta ||
          String(parentMeta.node.id) === String(barId) ||
          (other && String(parentMeta.node.id) === String(other.id));
        const subName = !isRootParent && parentMeta.node.title ? parentMeta.node.title : '';

        let destFolderId = archiveFolder.id;
        if (subName) {
          destFolderId = freshArchSubByTitle.get(subName);
          if (!destFolderId) {
            const createdSub = await chrome.bookmarks.create({
              parentId: archiveFolder.id,
              title: subName,
            });
            destFolderId = createdSub.id;
            freshArchSubByTitle.set(subName, destFolderId);
          }
        }
        try {
          await chrome.bookmarks.move(meta.node.id, { parentId: destFolderId });
          archivedHistorical++;
        } catch {
          // Ignore if node disappeared concurrently
        }
      }
    }
  }

  // Ensure archive folder sits at the end of bookmark_bar if configured as bar_end
  if (archiveFolder && archiveParentId === barId) {
    const [freshBar] = await chrome.bookmarks.getSubTree(barId);
    await chrome.bookmarks.move(archiveFolder.id, {
      parentId: barId,
      index: (freshBar.children || []).length,
    });
  }

  if (plan.removeEmptyFolders) {
    onProgress(t('progPruneEmpty', {}, lang));
    const skipIds = new Set(archiveFolder ? [String(archiveFolder.id)] : []);
    if (archiveFolder) {
      removedEmpty += await pruneEmptyFolders(archiveFolder.id, archiveFolder.id);
    }
    removedEmpty += await pruneEmptyFolders(barId, barId, skipIds);
    if (includeOther) {
      removedEmpty += await pruneEmptyFolders(other.id, other.id, skipIds);
    }
  }

  return {
    movedActive,
    movedTemp,
    archivedOldFolders,
    archivedHistorical,
    removedDuplicates,
    removedEmpty,
  };
}
