import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeBookmarkTree } from '../src/core/analyzer.js';
import { buildPlanFromAiResponse } from '../src/core/planner.js';
import { applyOrganizationPlan } from '../src/core/applier.js';
import { getLastSnapshot, restoreLastSnapshot } from '../src/core/snapshot.js';

function createChromeMock(initialBarChildren, initialOtherChildren = [], initialMobileChildren = []) {
  let nextId = 100;
  const storeData = {};

  const root = {
    id: '0',
    title: '',
    children: [
      { id: '1', parentId: '0', folderType: 'bookmarks-bar', title: '书签栏', children: [] },
      { id: '2', parentId: '0', folderType: 'other', title: '其他书签', children: [] },
      { id: '3', parentId: '0', folderType: 'mobile', title: '移动设备书签', children: [] },
    ],
  };

  function indexNodes(node, map = new Map()) {
    map.set(node.id, node);
    for (const ch of node.children || []) {
      ch.parentId = node.id;
      indexNodes(ch, map);
    }
    return map;
  }

  function cloneSubtree(node) {
    if (node.url) {
      return {
        id: node.id,
        parentId: node.parentId,
        title: node.title,
        url: node.url,
        dateAdded: node.dateAdded,
        dateLastUsed: node.dateLastUsed,
      };
    }
    return {
      id: node.id,
      parentId: node.parentId,
      folderType: node.folderType,
      title: node.title,
      children: (node.children || []).map(cloneSubtree),
    };
  }

  function seedChildren(parent, items) {
    for (const item of items) {
      const node = item.url
        ? {
            id: item.id || String(++nextId),
            parentId: parent.id,
            title: item.title,
            url: item.url,
            dateAdded: item.dateAdded ?? Date.now(),
            dateLastUsed: item.dateLastUsed ?? 0,
          }
        : {
            id: item.id || String(++nextId),
            parentId: parent.id,
            title: item.title,
            children: [],
          };
      parent.children.push(node);
      if (!item.url && item.children) seedChildren(node, item.children);
    }
  }

  seedChildren(root.children[0], initialBarChildren);
  seedChildren(root.children[1], initialOtherChildren);
  seedChildren(root.children[2], initialMobileChildren);

  const chromeMock = {
    storage: {
      local: {
        async get(key) {
          if (typeof key === 'string') return { [key]: storeData[key] };
          return { ...storeData };
        },
        async set(obj) {
          Object.assign(storeData, obj);
        },
        async remove(key) {
          delete storeData[key];
        },
      },
    },
    bookmarks: {
      async getTree() {
        return [cloneSubtree(root)];
      },
      async get(id) {
        const map = indexNodes(root);
        const node = map.get(String(id));
        if (!node) throw new Error(`Bookmark not found: ${id}`);
        return [cloneSubtree(node)];
      },
      async getSubTree(id) {
        const map = indexNodes(root);
        const node = map.get(String(id));
        if (!node) throw new Error(`Bookmark not found: ${id}`);
        return [cloneSubtree(node)];
      },
      async create({ parentId, index, title, url }) {
        const map = indexNodes(root);
        const parent = map.get(String(parentId));
        if (!parent || parent.url) throw new Error(`Invalid parent: ${parentId}`);
        const node = url
          ? { id: String(++nextId), parentId: parent.id, title: title || '', url, dateAdded: Date.now() }
          : { id: String(++nextId), parentId: parent.id, title: title || '', children: [] };
        const idx = typeof index === 'number' ? Math.min(index, parent.children.length) : parent.children.length;
        parent.children.splice(idx, 0, node);
        return cloneSubtree(node);
      },
      async move(id, { parentId, index }) {
        const map = indexNodes(root);
        const node = map.get(String(id));
        const oldParent = map.get(String(node.parentId));
        const newParent = map.get(String(parentId));
        const oldIdx = oldParent.children.indexOf(node);
        oldParent.children.splice(oldIdx, 1);
        node.parentId = newParent.id;
        const idx = typeof index === 'number' ? Math.min(index, newParent.children.length) : newParent.children.length;
        newParent.children.splice(idx, 0, node);
        return cloneSubtree(node);
      },
      async update(id, { title, url }) {
        const map = indexNodes(root);
        const node = map.get(String(id));
        if (title !== undefined) node.title = title;
        if (url !== undefined) node.url = url;
        return cloneSubtree(node);
      },
      async remove(id) {
        const map = indexNodes(root);
        const node = map.get(String(id));
        if (!node) throw new Error(`Not found: ${id}`);
        const parent = map.get(String(node.parentId));
        parent.children = parent.children.filter((c) => c !== node);
      },
      async removeTree(id) {
        await chromeMock.bookmarks.remove(id);
      },
    },
  };

  return chromeMock;
}

test('applyOrganizationPlan + restoreLastSnapshot round-trip cleanly', async () => {
  const now = new Date('2026-11-20T00:00:00Z').getTime();
  const recent = now - 5 * 86400_000;
  const old = new Date('2021-06-01T00:00:00Z').getTime();

  globalThis.chrome = createChromeMock([
    { id: '10', title: '\u200c\ufeffClaude', url: 'https://claude.ai/new', dateAdded: recent, dateLastUsed: recent + 1000 },
    { id: '11', title: 'Spring Promo', url: 'https://promo.example.com/', dateAdded: recent },
    {
      id: '20',
      title: '旧技术',
      children: [
        { id: '21', title: 'Old Doc', url: 'https://doc.example.com/', dateAdded: old },
        { id: '22', title: 'Old Doc Dup', url: 'https://doc.example.com/', dateAdded: old - 1000 },
        { id: '23', title: '空目录', children: [] },
      ],
    },
  ]);

  const initialTree = await chrome.bookmarks.getTree();
  const analysis = analyzeBookmarkTree(initialTree, { recentDays: 365, nowMs: now });
  const plan = buildPlanFromAiResponse(analysis, {
    folders: ['AI 助手'],
    assignments: [
      { id: '10', folder: 'AI 助手', rename: 'Claude' },
      { id: '11', folder: '__TEMP__' },
    ],
  });

  const result = await applyOrganizationPlan(plan);
  assert.equal(result.movedActive, 1);
  assert.equal(result.movedTemp, 1);
  assert.equal(result.archivedOldFolders, 1);
  assert.equal(result.removedDuplicates, 1);
  assert.equal(result.removedEmpty, 1);

  const afterApply = await chrome.bookmarks.getTree();
  const barAfter = afterApply[0].children[0].children;
  assert.equal(barAfter.length, 2); // AI 助手 + 历史归档
  assert.equal(barAfter[0].title, 'AI 助手');
  assert.equal(barAfter[0].children[0].title, 'Claude');
  assert.equal(barAfter[1].title, '历史归档');

  // Verify snapshot exists and undo restores exact original counts & structure
  const snap = await getLastSnapshot();
  assert.equal(snap.totalUrls, 4);

  await restoreLastSnapshot();
  const afterUndo = await chrome.bookmarks.getTree();
  const barUndo = afterUndo[0].children[0].children;
  assert.equal(barUndo.length, 3);
  assert.equal(barUndo[0].title, '\u200c\ufeffClaude');
  assert.equal(barUndo[0].dateAdded, recent);
  assert.equal(barUndo[0].dateLastUsed, recent + 1000);
  assert.equal(barUndo[2].title, '旧技术');
  assert.equal(barUndo[2].children.length, 3);
  assert.equal(barUndo[2].children[0].dateAdded, old);
});

test('applyOrganizationPlan archives >365d items left inside reused folders', async () => {
  const now = new Date('2026-11-20T00:00:00Z').getTime();
  const recent = now - 5 * 86400_000;
  const old = new Date('2020-03-01T00:00:00Z').getTime();

  globalThis.chrome = createChromeMock([
    {
      id: '30',
      title: '开发与技术',
      children: [
        { id: '31', title: 'React 19', url: 'https://react.dev/', dateAdded: recent },
        { id: '32', title: 'Legacy jQuery Note', url: 'https://jquery-2020.example.com/', dateAdded: old },
      ],
    },
  ]);

  const initialTree = await chrome.bookmarks.getTree();
  const analysis = analyzeBookmarkTree(initialTree, { recentDays: 365, nowMs: now, ignoreDateCutoff: false });
  assert.equal(analysis.activeItems.length, 1);
  assert.equal(analysis.historicalItems.length, 1);

  const plan = buildPlanFromAiResponse(analysis, {
    folders: ['开发与技术'],
    assignments: [{ id: '31', folder: '开发与技术' }],
  });

  const result = await applyOrganizationPlan(plan);
  assert.equal(result.archivedHistorical, 1);

  const after = await chrome.bookmarks.getTree();
  const bar = after[0].children[0].children;
  assert.equal(bar[0].title, '开发与技术');
  assert.equal(bar[0].children.length, 1);
  assert.equal(bar[0].children[0].title, 'React 19');
  assert.equal(bar[1].title, '历史归档');
  assert.equal(bar[1].children[0].title, '开发与技术');
  assert.equal(bar[1].children[0].children[0].title, 'Legacy jQuery Note');
});

test('applyOrganizationPlan keeps old folders & items in place when archiveNonRecent is false', async () => {
  const now = new Date('2026-11-20T00:00:00Z').getTime();
  const recent = now - 5 * 86400_000;
  const old = new Date('2020-03-01T00:00:00Z').getTime();

  globalThis.chrome = createChromeMock([
    {
      id: '30',
      title: '开发与技术',
      children: [
        { id: '31', title: 'React 19', url: 'https://react.dev/', dateAdded: recent },
        { id: '32', title: 'Legacy jQuery Note', url: 'https://jquery-2020.example.com/', dateAdded: old },
      ],
    },
    {
      id: '40',
      title: '2019老收藏',
      children: [
        { id: '41', title: 'Old Blog', url: 'https://blog-2019.example.com/', dateAdded: old },
      ],
    },
  ]);

  const initialTree = await chrome.bookmarks.getTree();
  const analysis = analyzeBookmarkTree(initialTree, { recentDays: 365, nowMs: now, ignoreDateCutoff: false });
  const plan = buildPlanFromAiResponse(
    analysis,
    { folders: ['开发与技术'], assignments: [{ id: '31', folder: '开发与技术' }] },
    { onlyRecent: true, archiveNonRecent: true }
  );

  const result = await applyOrganizationPlan(plan);
  assert.equal(result.archivedOldFolders, 0);
  assert.equal(result.archivedHistorical, 0);

  const after = await chrome.bookmarks.getTree();
  const bar = after[0].children[0].children;
  assert.equal(bar.length, 2); // 开发与技术 + 2019老收藏 (no 历史归档 created)
  assert.equal(bar[0].title, '开发与技术');
  assert.equal(bar[0].children.length, 2); // Legacy jQuery Note stayed in place
  assert.equal(bar[1].title, '2019老收藏');
});

test('applyOrganizationPlan merges duplicate archive subfolders and skips counting emptied folders as archived', async () => {
  const now = new Date('2026-11-20T00:00:00Z').getTime();
  const recent = now - 2 * 86400_000;
  const old = new Date('2020-01-01T00:00:00Z').getTime();

  globalThis.chrome = createChromeMock(
    [
      {
        id: '10',
        title: '旧技术',
        children: [{ id: '11', title: 'Old B', url: 'https://old-b.example.com/', dateAdded: old }],
      },
      {
        id: '20',
        title: '将被抽空的目录',
        children: [{ id: '21', title: 'Recent Tool', url: 'https://recent.example.com/', dateAdded: recent }],
      },
      {
        id: '30',
        title: '历史归档',
        children: [
          {
            id: '31',
            title: '旧技术',
            children: [{ id: '32', title: 'Old A', url: 'https://old-a.example.com/', dateAdded: old }],
          },
        ],
      },
    ],
    [],
    [{ id: '90', title: 'Phone Bookmark', url: 'https://phone.example.com/', dateAdded: recent }]
  );

  const initialTree = await chrome.bookmarks.getTree();
  const analysis = analyzeBookmarkTree(initialTree, { recentDays: 365, nowMs: now });
  const plan = buildPlanFromAiResponse(analysis, {
    folders: ['效率工具'],
    assignments: [{ id: '21', folder: '效率工具' }],
  });

  const result = await applyOrganizationPlan(plan);
  // Only 旧技术 had historical content to archive (merged); 将被抽空的目录 was pruned as empty
  assert.equal(result.archivedOldFolders, 1);
  assert.equal(result.removedEmpty, 1);

  const after = await chrome.bookmarks.getTree();
  const bar = after[0].children[0].children;
  const archive = bar.find((c) => c.title === '历史归档');
  // No duplicate 旧技术 folders inside 历史归档 — merged into one containing both Old A and Old B
  const mergedFolders = archive.children.filter((c) => c.title === '旧技术');
  assert.equal(mergedFolders.length, 1);
  assert.equal(mergedFolders[0].children.length, 2);

  // Mobile bookmarks stayed untouched and were also snapshotted
  assert.equal(after[0].children[2].children.length, 1);
  const snap = await getLastSnapshot();
  assert.equal(snap.rootContainers.length, 3);
  assert.equal(snap.rootContainers[2].children[0].id, '90');

  // Even if mobile bookmark is removed externally before undo, restoreLastSnapshot brings it back
  await chrome.bookmarks.remove('90');
  await restoreLastSnapshot();
  const afterUndo = await chrome.bookmarks.getTree();
  assert.equal(afterUndo[0].children[2].children.length, 1);
  assert.equal(afterUndo[0].children[2].children[0].title, 'Phone Bookmark');
});

test('restoreLastSnapshot preserves dateAdded even when restoring a legacy snapshot without node IDs', async () => {
  const oldAdded = new Date('2021-05-01T00:00:00Z').getTime();
  globalThis.chrome = createChromeMock([
    {
      id: '50',
      title: 'AI 工具',
      children: [{ id: '51', title: 'Claude Renamed', url: 'https://claude.ai/', dateAdded: oldAdded }],
    },
  ]);

  // Simulate legacy v0.2.0 snapshot with no id fields
  await chrome.storage.local.set({
    abo_last_snapshot_v1: {
      createdAt: Date.now() - 1000,
      totalUrls: 1,
      barChildren: [{ title: 'Claude Original', url: 'https://claude.ai/' }],
      otherChildren: [],
    },
  });

  await restoreLastSnapshot();
  const afterUndo = await chrome.bookmarks.getTree();
  const bar = afterUndo[0].children[0].children;
  assert.equal(bar.length, 1);
  assert.equal(bar[0].id, '51'); // matched live node by URL instead of recreating
  assert.equal(bar[0].title, 'Claude Original');
  assert.equal(bar[0].dateAdded, oldAdded); // original creation timestamp preserved!
});
