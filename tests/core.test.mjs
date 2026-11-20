import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanBookmarkTitle, sanitizeUrlForAi } from '../src/core/sanitizer.js';
import { analyzeBookmarkTree } from '../src/core/analyzer.js';
import { extractJsonObject } from '../src/core/ai-client.js';
import { buildPlanFromAiResponse, FALLBACK_FOLDER_NAME } from '../src/core/planner.js';

test('cleanBookmarkTitle removes invisible zero-width characters', () => {
  const dirty = '\u200c\ufeff\u2060通往 AGI 之路';
  assert.equal(cleanBookmarkTitle(dirty), '通往 AGI 之路');
});

test('sanitizeUrlForAi strips query parameters by default', () => {
  const raw = 'https://example.com/admin?token=secret123&email=a@b.com#frag';
  assert.equal(sanitizeUrlForAi(raw, true), 'https://example.com/admin');
  assert.equal(sanitizeUrlForAi(raw, false), 'https://example.com/admin?token=secret123&email=a@b.com');
});

test('analyzeBookmarkTree separates active items, duplicates, and empty folders', () => {
  const now = new Date('2026-11-20T00:00:00Z').getTime();
  const oldMs = new Date('2022-01-01T00:00:00Z').getTime();
  const recentMs = new Date('2026-10-01T00:00:00Z').getTime();

  const mockTree = [
    {
      id: '0',
      title: '',
      children: [
        {
          id: '1',
          folderType: 'bookmarks-bar',
          title: '书签栏',
          children: [
            { id: '10', title: 'Claude', url: 'https://claude.ai/new', dateAdded: recentMs },
            { id: '11', title: 'Old Loose', url: 'https://old-loose.example.com/', dateAdded: oldMs },
            {
              id: '20',
              title: '技术',
              children: [
                { id: '21', title: 'Old Java', url: 'https://java.example.com/', dateAdded: oldMs },
                { id: '22', title: 'Old Java Dup', url: 'https://java.example.com/', dateAdded: oldMs - 1000 },
                { id: '23', title: '空子目录', children: [] },
              ],
            },
          ],
        },
        { id: '2', folderType: 'other', title: '其他书签', children: [] },
      ],
    },
  ];

  const res = analyzeBookmarkTree(mockTree, {
    recentDays: 365,
    includeRootLoose: true,
    nowMs: now,
  });

  assert.equal(res.stats.totalUrls, 4);
  assert.equal(res.stats.uniqueUrls, 3);
  assert.equal(res.stats.duplicateCount, 1);
  assert.equal(res.stats.emptyFolderCount, 1);
  assert.equal(res.stats.activeCount, 2); // id 10 (recent) + id 11 (loose on bar)
  assert.equal(res.stats.historicalCount, 1); // id 21
});

test('extractJsonObject parses fenced markdown JSON', () => {
  const text = '好的，这是结果：\n```json\n{"folders":["AI"],"assignments":[{"id":"10","folder":"AI"}]}\n```';
  const obj = extractJsonObject(text);
  assert.deepEqual(obj.folders, ['AI']);
  assert.equal(obj.assignments[0].id, '10');
});

test('buildPlanFromAiResponse preserves unassigned items in fallback folder', () => {
  const analysis = {
    activeItems: [
      { id: '10', title: 'Claude', cleanTitle: 'Claude', url: 'https://claude.ai/' },
      { id: '11', title: 'Promo', cleanTitle: 'Promo', url: 'https://promo.example.com/' },
      { id: '12', title: 'Missed', cleanTitle: 'Missed', url: 'https://missed.example.com/' },
    ],
    duplicateRemovals: [{ removeId: '99' }],
    emptyFolders: [],
  };

  const plan = buildPlanFromAiResponse(analysis, {
    folders: ['AI 工具'],
    assignments: [
      { id: '10', folder: 'AI 工具' },
      { id: '11', folder: '__TEMP__' },
      { id: '999', folder: 'AI 工具' }, // unknown ID should be ignored
    ],
  });

  assert.equal(plan.tempItems.length, 1);
  assert.equal(plan.tempItems[0].id, '11');
  assert.equal(plan.folders.length, 2);
  assert.equal(plan.folders[0].name, 'AI 工具');
  assert.equal(plan.folders[1].name, FALLBACK_FOLDER_NAME);
  assert.equal(plan.folders[1].items[0].id, '12');
});
