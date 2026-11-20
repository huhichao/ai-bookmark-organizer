import { cleanBookmarkTitle } from './sanitizer.js';

export function findBookmarksBar(root) {
  const children = root.children || [];
  return (
    children.find((c) => c.folderType === 'bookmarks-bar' || c.id === '1') ||
    children[0]
  );
}

export function findOtherBookmarks(root) {
  const children = root.children || [];
  return (
    children.find((c) => c.folderType === 'other' || c.id === '2') ||
    children[1]
  );
}

/**
 * Analyze a Chrome bookmark tree into stats, duplicates, active items, and historical items.
 */
export function analyzeBookmarkTree(tree, options = {}) {
  const {
    recentDays = 365,
    includeRootLoose = true,
    nowMs = Date.now(),
    archiveFolderName = '历史归档',
  } = options;

  const root = Array.isArray(tree) ? tree[0] : tree;
  const bar = findBookmarksBar(root);
  const cutoffMs = nowMs - recentDays * 24 * 60 * 60 * 1000;

  const allUrls = [];
  const emptyFolders = [];
  let folderCount = 0;

  function walk(node, pathParts, isUnderBarRoot = false) {
    if (node.url) {
      const added = node.dateAdded || 0;
      const used = node.dateLastUsed || 0;
      const lastActive = Math.max(added, used);
      const isLooseOnBar = Boolean(isUnderBarRoot);
      const isRecent = lastActive >= cutoffMs;

      allUrls.push({
        id: String(node.id),
        parentId: String(node.parentId || ''),
        title: node.title || '',
        cleanTitle: cleanBookmarkTitle(node.title),
        url: node.url,
        dateAdded: added,
        dateLastUsed: used,
        lastActive,
        isLooseOnBar,
        isRecent,
        parentPath: pathParts.join(' / '),
      });
      return;
    }

    if (node.id !== root.id && node.id !== '0') {
      folderCount++;
    }
    const children = node.children || [];
    if (
      node.id !== root.id &&
      node.id !== '0' &&
      !node.folderType &&
      node.id !== '1' &&
      node.id !== '2' &&
      node.id !== '3' &&
      children.length === 0
    ) {
      emptyFolders.push({
        id: String(node.id),
        title: node.title || '',
        path: pathParts.join(' / '),
      });
    }

    const nextPath = node.title ? [...pathParts, node.title] : pathParts;
    for (const ch of children) {
      const childIsLoose = bar && node.id === bar.id && Boolean(ch.url);
      walk(ch, nextPath, childIsLoose);
    }
  }

  walk(root, [], false);

  // Deduplicate exact URLs: prefer loose-on-bar, then latest activity
  const byUrl = new Map();
  for (const item of allUrls) {
    if (!byUrl.has(item.url)) byUrl.set(item.url, []);
    byUrl.get(item.url).push(item);
  }

  const keptItems = [];
  const duplicateRemovals = [];
  for (const list of byUrl.values()) {
    list.sort((a, b) => {
      if (a.isLooseOnBar !== b.isLooseOnBar) return a.isLooseOnBar ? -1 : 1;
      return b.lastActive - a.lastActive;
    });
    keptItems.push(list[0]);
    for (let i = 1; i < list.length; i++) {
      duplicateRemovals.push({
        keptId: list[0].id,
        removeId: list[i].id,
        url: list[i].url,
        title: list[i].title,
        path: list[i].parentPath,
      });
    }
  }

  const activeItems = [];
  const historicalItems = [];
  for (const item of keptItems) {
    const inArchiveAlready = item.parentPath.includes(archiveFolderName);
    const shouldOrganize =
      !inArchiveAlready &&
      ((includeRootLoose && item.isLooseOnBar) || item.isRecent);
    if (shouldOrganize) {
      activeItems.push(item);
    } else {
      historicalItems.push(item);
    }
  }

  const dirtyTitleCount = keptItems.filter(
    (it) => it.title !== it.cleanTitle
  ).length;

  return {
    stats: {
      totalUrls: allUrls.length,
      uniqueUrls: keptItems.length,
      duplicateCount: duplicateRemovals.length,
      folderCount,
      emptyFolderCount: emptyFolders.length,
      activeCount: activeItems.length,
      historicalCount: historicalItems.length,
      dirtyTitleCount,
    },
    activeItems,
    historicalItems,
    duplicateRemovals,
    emptyFolders,
    keptItems,
  };
}
