import { SCOPE_MODES } from './constants.js';
import { cleanBookmarkTitle } from './sanitizer.js';

export function resolveScopeBehavior({
  scopeMode,
  onlyRecent = false,
  archiveNonRecent = true,
} = {}) {
  let resolvedMode = scopeMode;
  if (
    resolvedMode !== SCOPE_MODES.RECENT_ARCHIVE &&
    resolvedMode !== SCOPE_MODES.ALL_AI &&
    resolvedMode !== SCOPE_MODES.RECENT_ONLY
  ) {
    if (onlyRecent) resolvedMode = SCOPE_MODES.RECENT_ONLY;
    else if (archiveNonRecent === false) resolvedMode = SCOPE_MODES.ALL_AI;
    else resolvedMode = SCOPE_MODES.RECENT_ARCHIVE;
  }

  if (resolvedMode === SCOPE_MODES.RECENT_ONLY) {
    return {
      scopeMode: SCOPE_MODES.RECENT_ONLY,
      onlyRecent: true,
      archiveNonRecent: false,
      ignoreDateCutoff: false,
      shouldArchiveNonRecent: false,
    };
  }
  if (resolvedMode === SCOPE_MODES.ALL_AI) {
    return {
      scopeMode: SCOPE_MODES.ALL_AI,
      onlyRecent: false,
      archiveNonRecent: false,
      ignoreDateCutoff: true,
      shouldArchiveNonRecent: false,
    };
  }
  return {
    scopeMode: SCOPE_MODES.RECENT_ARCHIVE,
    onlyRecent: false,
    archiveNonRecent: true,
    ignoreDateCutoff: false,
    shouldArchiveNonRecent: true,
  };
}

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

export function findMobileBookmarks(root) {
  const children = root.children || [];
  return children.find((c) => c.folderType === 'mobile' || c.id === '3') || null;
}

/**
 * Analyze a Chrome bookmark tree into stats, duplicates, active items, and historical items.
 */
export function analyzeBookmarkTree(tree, options = {}) {
  const {
    scopeMode,
    recentDays = 365,
    includeRootLoose = true,
    includeOtherBookmarks = false,
    includeArchived = false,
    onlyRecent = false,
    archiveNonRecent = true,
    nowMs = Date.now(),
    archiveFolderName = '历史归档',
  } = options;

  const behavior = resolveScopeBehavior({ scopeMode, onlyRecent, archiveNonRecent });
  const ignoreDateCutoff = options.ignoreDateCutoff !== undefined
    ? Boolean(options.ignoreDateCutoff)
    : behavior.ignoreDateCutoff;

  const root = Array.isArray(tree) ? tree[0] : tree;
  const bar = findBookmarksBar(root);
  const other = findOtherBookmarks(root);
  const cutoffMs = nowMs - recentDays * 24 * 60 * 60 * 1000;

  const allUrls = [];
  const emptyFolders = [];
  let folderCount = 0;

  // Determine roots in scope: always Bookmarks Bar; optionally Other Bookmarks.
  // Mobile Bookmarks (and any other special synced roots) are never altered.
  const rootsToWalk = [];
  if (bar) rootsToWalk.push({ node: bar, rootType: 'bar' });
  if (includeOtherBookmarks && other && other.id !== bar?.id) {
    rootsToWalk.push({ node: other, rootType: 'other' });
  }

  function walk(node, pathParts, rootType, isUnderBarRoot = false) {
    if (node.url) {
      const added = node.dateAdded || 0;
      const used = node.dateLastUsed || 0;
      const lastActive = Math.max(added, used);
      const isLooseOnBar = Boolean(isUnderBarRoot);
      const isRecent = lastActive >= cutoffMs;

      allUrls.push({
        id: String(node.id),
        parentId: String(node.parentId || ''),
        rootType,
        title: node.title || '',
        cleanTitle: cleanBookmarkTitle(node.title),
        url: node.url,
        dateAdded: added,
        dateLastUsed: used,
        lastActive,
        isLooseOnBar,
        isRecent,
        pathSegments: [...pathParts],
        parentPath: pathParts.join(' / '),
      });
      return;
    }

    const isRootContainer =
      node.id === root.id ||
      node.id === '0' ||
      Boolean(node.folderType) ||
      node.id === '1' ||
      node.id === '2' ||
      node.id === '3';

    if (!isRootContainer) {
      folderCount++;
    }
    const children = node.children || [];
    if (
      !isRootContainer &&
      node.title !== archiveFolderName &&
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
      walk(ch, nextPath, rootType, childIsLoose);
    }
  }

  for (const entry of rootsToWalk) {
    walk(entry.node, [], entry.rootType, false);
  }

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

  const isInsideArchive = (item) => item.pathSegments.includes(archiveFolderName);

  // "Frequent" selection is decided holistically by AI (using title, URL, folderHint, and optional lastUsedAt).
  const frequentItems = [];
  const activeItems = [];
  const historicalItems = [];
  for (const item of keptItems) {
    const inArchiveAlready = isInsideArchive(item);
    const passesArchiveFilter = includeArchived || !inArchiveAlready;
    // When user explicitly includes archived bookmarks, bring archived items into AI scope
    // even if their original timestamp is older than recentDays.
    const passesRecencyFilter =
      ignoreDateCutoff ||
      (includeArchived && inArchiveAlready) ||
      (includeRootLoose && item.isLooseOnBar) ||
      item.isRecent;
    if (passesArchiveFilter && passesRecencyFilter) {
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
      frequentCount: frequentItems.length,
      activeCount: activeItems.length,
      historicalCount: historicalItems.length,
      dirtyTitleCount,
    },
    includeOtherBookmarks: Boolean(includeOtherBookmarks),
    frequentItems,
    activeItems,
    historicalItems,
    duplicateRemovals,
    emptyFolders,
    keptItems,
  };
}
