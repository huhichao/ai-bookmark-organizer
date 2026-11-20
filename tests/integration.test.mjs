import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeBookmarkTree } from '../src/core/analyzer.js';
import { buildPlanFromAiResponse } from '../src/core/planner.js';
import { applyOrganizationPlan } from '../src/core/applier.js';
import { getLastSnapshot, restoreLastSnapshot } from '../src/core/snapshot.js';

function createChromeMock(initialBarChildren, initialOtherChildren = []) {
  let nextId = 100;
  const storeData = {};

  const root = {
    id: '0',
    title: '',
    children: [
      { id: '1', parentId: '0', folderType: 'bookmarks-bar', title: '书签栏', children: [] },
      { id: '2', parentId: '0', folderType: 'other', title: '其他书签', children: [] },
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
            dateAdded: item.dateAdded || Date.now(),
            dateLastUsed: item.dateLastUsed || 0,
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
    { id: '10', title: '\u200c\ufeffClaude', url: 'https://claude.ai/new', dateAdded: recent },
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
  assert.equal(barUndo[2].title, '旧技术');
  assert.equal(barUndo[2].children.length, 3);
});
