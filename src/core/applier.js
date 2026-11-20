import { findBookmarksBar, findOtherBookmarks } from './analyzer.js';
import { getLocalizedDefaults, resolveLanguage, t } from './i18n.js';
import { createAndSaveSnapshot } from './snapshot.js';

async function pruneEmptyFolders(folderId, keepRootId) {
  const [node] = await chrome.bookmarks.getSubTree(folderId);
  if (!node || node.url) return 0;

  let removed = 0;
  for (const ch of [...(node.children || [])]) {
    if (!ch.url) {
      removed += await pruneEmptyFolders(ch.id, keepRootId);
    }
  }
  const [updated] = await chrome.bookmarks.getSubTree(folderId);
  if (
    updated &&
    updated.id !== keepRootId &&
    (!updated.children || updated.children.length === 0)
  ) {
    await chrome.bookmarks.remove(updated.id);
    removed += 1;
  }
  return removed;
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

  const originalBarChildren = [...(bar.children || [])];
  const archiveName = plan.archiveFolderName || locDefaults.archiveFolderName;

  // Reuse existing archive folder if present, otherwise create it
  let archiveFolder = null;
  const archiveParentId = plan.archiveLocation === 'other' && other ? other.id : barId;
  const archiveParentChildren =
    archiveParentId === barId ? originalBarChildren : [...(other?.children || [])];
  const existingArchive = archiveParentChildren.find(
    (c) => !c.url && c.title === archiveName
  );
  if (existingArchive) {
    archiveFolder = existingArchive;
  } else {
    archiveFolder = await chrome.bookmarks.create({
      parentId: archiveParentId,
      title: archiveName,
    });
  }

  let tempFolder = null;
  if (plan.tempItems?.length) {
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
  const createdFolderIds = new Set([archiveFolder.id]);
  const targetFolderIdByName = new Map();

  for (let i = 0; i < plan.folders.length; i++) {
    const folderSpec = plan.folders[i];
    const existing = originalBarChildren.find(
      (c) => !c.url && c.title === folderSpec.name && c.id !== archiveFolder.id
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
    createdFolderIds.add(folderId);
    targetFolderIdByName.set(folderSpec.name, folderId);
  }

  onProgress(t('progMoveActive', {}, lang));
  let movedActive = 0;
  for (const folderSpec of plan.folders) {
    const targetId = targetFolderIdByName.get(folderSpec.name);
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

  onProgress(t('progArchiveOld', {}, lang));
  let archivedOldFolders = 0;
  for (const ch of originalBarChildren) {
    if (createdFolderIds.has(ch.id)) continue;
    try {
      const [cur] = await chrome.bookmarks.get(ch.id);
      if (!cur || cur.parentId !== barId) continue;
      if (cur.url) {
        if (!tempFolder) {
          tempFolder = await chrome.bookmarks.create({
            parentId: archiveFolder.id,
            title: tempFolderName,
          });
        }
        await chrome.bookmarks.move(cur.id, { parentId: tempFolder.id });
      } else {
        await chrome.bookmarks.move(cur.id, { parentId: archiveFolder.id });
        archivedOldFolders++;
      }
    } catch {
      // Already moved or removed
    }
  }

  // Ensure archive folder sits at the end of bookmark_bar if configured as bar_end
  if (archiveParentId === barId) {
    const [freshBar] = await chrome.bookmarks.getSubTree(barId);
    await chrome.bookmarks.move(archiveFolder.id, {
      parentId: barId,
      index: (freshBar.children || []).length,
    });
  }

  let removedEmpty = 0;
  if (plan.removeEmptyFolders) {
    onProgress(t('progPruneEmpty', {}, lang));
    removedEmpty = await pruneEmptyFolders(archiveFolder.id, archiveFolder.id);
  }

  return {
    movedActive,
    movedTemp,
    archivedOldFolders,
    removedDuplicates,
    removedEmpty,
  };
}
