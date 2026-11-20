import { STORAGE_KEYS } from './constants.js';
import { findBookmarksBar, findOtherBookmarks } from './analyzer.js';

function simplifyNode(node) {
  if (node.url) {
    return { title: node.title || '', url: node.url };
  }
  return {
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
  const snapshot = {
    createdAt: Date.now(),
    totalUrls: countSnapshotUrls(root),
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

async function clearFolderChildren(folderId) {
  const [subtree] = await chrome.bookmarks.getSubTree(folderId);
  for (const ch of [...(subtree.children || [])]) {
    if (ch.url) {
      await chrome.bookmarks.remove(ch.id);
    } else {
      await chrome.bookmarks.removeTree(ch.id);
    }
  }
}

async function restoreChildren(parentId, nodes) {
  for (const node of nodes || []) {
    if (node.url) {
      await chrome.bookmarks.create({
        parentId,
        title: node.title,
        url: node.url,
      });
    } else {
      const created = await chrome.bookmarks.create({
        parentId,
        title: node.title,
      });
      await restoreChildren(created.id, node.children);
    }
  }
}

export async function restoreLastSnapshot() {
  const snapshot = await getLastSnapshot();
  if (!snapshot) {
    throw new Error('没有可用的本地快照');
  }
  const tree = await chrome.bookmarks.getTree();
  const root = tree[0];
  const bar = findBookmarksBar(root);
  const other = findOtherBookmarks(root);

  if (bar) {
    await clearFolderChildren(bar.id);
    await restoreChildren(bar.id, snapshot.barChildren);
  }
  if (other) {
    await clearFolderChildren(other.id);
    await restoreChildren(other.id, snapshot.otherChildren);
  }
  return snapshot;
}
