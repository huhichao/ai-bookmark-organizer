import { STORAGE_KEYS } from './constants.js';
import { findBookmarksBar, findOtherBookmarks } from './analyzer.js';
import { resolveLanguage, t } from './i18n.js';

function simplifyNode(node) {
  if (node.url) {
    const simplified = {
      id: String(node.id),
      title: node.title || '',
      url: node.url,
    };
    if (node.dateAdded) simplified.dateAdded = node.dateAdded;
    if (node.dateLastUsed) simplified.dateLastUsed = node.dateLastUsed;
    return simplified;
  }
  return {
    id: String(node.id),
    title: node.title || '',
    folderType: node.folderType || '',
    children: (node.children || []).map(simplifyNode),
  };
}

function countSnapshotUrls(node) {
  if (node.url) return 1;
  let sum = 0;
  for (const ch of node.children || []) sum += countSnapshotUrls(ch);
  return sum;
}

export async function createAndSaveSnapshot() {
  const tree = await chrome.bookmarks.getTree();
  const root = tree[0];
  const bar = findBookmarksBar(root);
  const other = findOtherBookmarks(root);
  const rootContainers = (root.children || []).map((container) => ({
    id: String(container.id),
    folderType: container.folderType || '',
    title: container.title || '',
    children: (container.children || []).map(simplifyNode),
  }));

  const snapshot = {
    createdAt: Date.now(),
    totalUrls: countSnapshotUrls(root),
    rootContainers,
    // Keep barChildren & otherChildren for backwards compatibility with exported snapshots
    barChildren: (bar?.children || []).map(simplifyNode),
    otherChildren: (other?.children || []).map(simplifyNode),
  };
  await chrome.storage.local.set({ [STORAGE_KEYS.SNAPSHOT]: snapshot });
  return snapshot;
}

export async function getLastSnapshot() {
  const res = await chrome.storage.local.get(STORAGE_KEYS.SNAPSHOT);
  return res[STORAGE_KEYS.SNAPSHOT] || null;
}

export async function clearSnapshot() {
  await chrome.storage.local.remove(STORAGE_KEYS.SNAPSHOT);
}

function buildLiveIndexes(root) {
  const byId = new Map();
  const urlsByUrl = new Map();
  const foldersByTitle = new Map();

  function walk(node) {
    const id = String(node.id);
    byId.set(id, node);
    if (node.url) {
      if (!urlsByUrl.has(node.url)) urlsByUrl.set(node.url, []);
      urlsByUrl.get(node.url).push(node);
    } else if (node.id !== root.id && node.id !== '0' && !node.folderType) {
      const key = node.title || '';
      if (!foldersByTitle.has(key)) foldersByTitle.set(key, []);
      foldersByTitle.get(key).push(node);
    }
    for (const ch of node.children || []) {
      walk(ch);
    }
  }
  walk(root);
  return { byId, urlsByUrl, foldersByTitle };
}

function findLiveBookmarkMatch(node, liveIndexes, restoredIds) {
  // 1. Exact ID match (preserves original dateAdded / dateLastUsed)
  if (node.id) {
    const exact = liveIndexes.byId.get(String(node.id));
    if (exact && exact.url && !restoredIds.has(String(exact.id))) {
      return exact;
    }
  }
  // 2. Fallback by URL (handles legacy snapshots without IDs or Chrome Sync ID changes without wiping dateAdded)
  const candidates = (liveIndexes.urlsByUrl.get(node.url) || []).filter(
    (c) => !restoredIds.has(String(c.id))
  );
  if (candidates.length === 0) return null;
  const sameTitle = candidates.find((c) => (c.title || '') === (node.title || ''));
  return sameTitle || candidates[0];
}

function findLiveFolderMatch(node, liveIndexes, restoredIds) {
  if (node.id) {
    const exact = liveIndexes.byId.get(String(node.id));
    if (exact && !exact.url && !exact.folderType && !restoredIds.has(String(exact.id))) {
      return exact;
    }
  }
  const candidates = (liveIndexes.foldersByTitle.get(node.title || '') || []).filter(
    (c) => !restoredIds.has(String(c.id))
  );
  return candidates[0] || null;
}

async function restoreChildrenPreservingIds(parentId, nodes, liveIndexes, restoredIds) {
  for (let i = 0; i < (nodes || []).length; i++) {
    const node = nodes[i];

    if (node.url) {
      const live = findLiveBookmarkMatch(node, liveIndexes, restoredIds);
      if (live) {
        if (live.title !== node.title || live.url !== node.url) {
          await chrome.bookmarks.update(live.id, { title: node.title, url: node.url });
        }
        await chrome.bookmarks.move(live.id, { parentId, index: i });
        restoredIds.add(String(live.id));
      } else {
        const created = await chrome.bookmarks.create({
          parentId,
          index: i,
          title: node.title,
          url: node.url,
        });
        restoredIds.add(String(created.id));
      }
    } else {
      const live = findLiveFolderMatch(node, liveIndexes, restoredIds);
      let folderId;
      if (live) {
        if (live.title !== node.title) {
          await chrome.bookmarks.update(live.id, { title: node.title });
        }
        await chrome.bookmarks.move(live.id, { parentId, index: i });
        folderId = String(live.id);
      } else {
        const created = await chrome.bookmarks.create({
          parentId,
          index: i,
          title: node.title,
        });
        folderId = String(created.id);
      }
      restoredIds.add(folderId);
      await restoreChildrenPreservingIds(folderId, node.children, liveIndexes, restoredIds);
    }
  }
}

async function pruneNonRestoredEmptyFolders(folderId, rootFolderId, restoredIds) {
  const [subtree] = await chrome.bookmarks.getSubTree(folderId);
  if (!subtree || subtree.url) return;

  for (const ch of [...(subtree.children || [])]) {
    if (!ch.url) {
      await pruneNonRestoredEmptyFolders(ch.id, rootFolderId, restoredIds);
    }
  }

  const [updated] = await chrome.bookmarks.getSubTree(folderId);
  if (
    updated &&
    String(updated.id) !== String(rootFolderId) &&
    !restoredIds.has(String(updated.id)) &&
    (!updated.children || updated.children.length === 0)
  ) {
    await chrome.bookmarks.remove(updated.id);
  }
}

export async function restoreLastSnapshot(uiLanguage = 'auto') {
  const lang = resolveLanguage(uiLanguage);
  const snapshot = await getLastSnapshot();
  if (!snapshot) {
    throw new Error(t('errNoSnapshot', {}, lang));
  }
  const tree = await chrome.bookmarks.getTree();
  const root = tree[0];
  const liveIndexes = buildLiveIndexes(root);
  const restoredIds = new Set();
  const restoredRootIds = [];

  if (Array.isArray(snapshot.rootContainers) && snapshot.rootContainers.length > 0) {
    const liveRoots = root.children || [];
    for (const savedContainer of snapshot.rootContainers) {
      const liveContainer =
        (savedContainer.folderType &&
          liveRoots.find((c) => c.folderType === savedContainer.folderType)) ||
        liveRoots.find((c) => String(c.id) === String(savedContainer.id));
      if (!liveContainer) continue;
      restoredIds.add(String(liveContainer.id));
      restoredRootIds.push(liveContainer.id);
      await restoreChildrenPreservingIds(
        liveContainer.id,
        savedContainer.children,
        liveIndexes,
        restoredIds
      );
    }
  } else {
    // Legacy snapshot fallback (pre-v0.2.2)
    const bar = findBookmarksBar(root);
    const other = findOtherBookmarks(root);
    if (bar) {
      restoredIds.add(String(bar.id));
      restoredRootIds.push(bar.id);
      await restoreChildrenPreservingIds(bar.id, snapshot.barChildren, liveIndexes, restoredIds);
    }
    if (other) {
      restoredIds.add(String(other.id));
      restoredRootIds.push(other.id);
      await restoreChildrenPreservingIds(other.id, snapshot.otherChildren, liveIndexes, restoredIds);
    }
  }

  // Prune newly created empty folders only after all containers have moved their items back
  for (const rootId of restoredRootIds) {
    await pruneNonRestoredEmptyFolders(rootId, rootId, restoredIds);
  }
  return snapshot;
}
