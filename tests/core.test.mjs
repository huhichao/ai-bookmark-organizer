import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanBookmarkTitle, sanitizeUrlForAi } from '../src/core/sanitizer.js';
import { analyzeBookmarkTree } from '../src/core/analyzer.js';
import { extractJsonObject, getEffectiveSystemPrompt, JSON_SCHEMA_CONTRACT } from '../src/core/ai-client.js';
import { buildPlanFromAiResponse, FALLBACK_FOLDER_NAME } from '../src/core/planner.js';
import { isUrlCoveredByPatterns, toOriginMatchPattern } from '../src/core/permissions.js';
import { DEFAULT_CLASSIFICATION_PROMPT, DEFAULT_CLASSIFICATION_PROMPT_EN, PROMPT_TEMPLATES } from '../src/core/constants.js';
import { getLocalizedDefaults, resolveLanguage, t } from '../src/core/i18n.js';

test('toOriginMatchPattern and isUrlCoveredByPatterns strip ports and match hosts', () => {
  assert.equal(toOriginMatchPattern('http://127.0.0.1:11434/v1'), 'http://127.0.0.1/*');
  assert.equal(toOriginMatchPattern('not-a-url'), null);
  assert.equal(
    isUrlCoveredByPatterns('http://127.0.0.1:54321/v1', ['http://127.0.0.1/*']),
    true
  );
  assert.equal(
    isUrlCoveredByPatterns('https://api.deepseek.com/v1', ['https://api.deepseek.com/*']),
    true
  );
  assert.equal(
    isUrlCoveredByPatterns('https://relay.example.com/v1', ['https://api.deepseek.com/*']),
    false
  );
});

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

test('analyzeBookmarkTree respects includeArchived and ignoreDateCutoff toggles', () => {
  const now = new Date('2026-11-20T00:00:00Z').getTime();
  const oldMs = new Date('2020-01-01T00:00:00Z').getTime();
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
            {
              id: '10',
              title: '技术',
              children: [{ id: '11', title: 'Old Sub', url: 'https://sub.example.com/', dateAdded: oldMs }],
            },
            {
              id: '20',
              title: '历史归档',
              children: [{ id: '21', title: 'Archived', url: 'https://arch.example.com/', dateAdded: oldMs }],
            },
          ],
        },
        { id: '2', folderType: 'other', title: '其他书签', children: [] },
      ],
    },
  ];

  const defaultRes = analyzeBookmarkTree(mockTree, { nowMs: now });
  assert.equal(defaultRes.stats.activeCount, 0);

  const ignoreDateRes = analyzeBookmarkTree(mockTree, { nowMs: now, ignoreDateCutoff: true });
  assert.equal(ignoreDateRes.stats.activeCount, 1);

  const includeAllRes = analyzeBookmarkTree(mockTree, {
    nowMs: now,
    includeArchived: true,
    ignoreDateCutoff: true,
  });
  assert.equal(includeAllRes.stats.activeCount, 2);
});

test('getEffectiveSystemPrompt preserves JSON schema contract with custom rules', () => {
  const defaultPrompt = getEffectiveSystemPrompt({});
  assert.ok(defaultPrompt.includes(DEFAULT_CLASSIFICATION_PROMPT));
  assert.ok(defaultPrompt.includes(JSON_SCHEMA_CONTRACT));

  const customPrompt = getEffectiveSystemPrompt({ customPrompt: '按工作和生活两大类整理' });
  assert.ok(customPrompt.startsWith('按工作和生活两大类整理'));
  assert.ok(customPrompt.includes(JSON_SCHEMA_CONTRACT));
  assert.ok(Object.keys(PROMPT_TEMPLATES).length >= 4);
});

test('analyzeBookmarkTree extracts recently used bookmarks into frequentItems when enabled', () => {
  const now = new Date('2026-11-20T00:00:00Z').getTime();
  const veryRecentUse = now - 2 * 86400_000;
  const recentUse = now - 10 * 86400_000;
  const oldAdd = now - 500 * 86400_000;
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
            { id: '10', title: 'Claude', url: 'https://claude.ai/', dateAdded: oldAdd, dateLastUsed: veryRecentUse },
            { id: '11', title: 'DeepSeek', url: 'https://deepseek.com/', dateAdded: oldAdd, dateLastUsed: recentUse },
            { id: '12', title: 'NeverUsed', url: 'https://unused.example.com/', dateAdded: now - 5 * 86400_000, dateLastUsed: 0 },
          ],
        },
        { id: '2', folderType: 'other', title: '其他书签', children: [] },
      ],
    },
  ];

  const analysis = analyzeBookmarkTree(mockTree, {
    nowMs: now,
    extractFrequent: true,
    frequentDays: 90,
    frequentMaxCount: 5,
  });

  assert.equal(analysis.frequentItems.length, 2);
  assert.equal(analysis.frequentItems[0].id, '10'); // most recently used first
  assert.equal(analysis.activeItems.length, 1);
  assert.equal(analysis.activeItems[0].id, '12');

  const plan = buildPlanFromAiResponse(analysis, {
    folders: ['工具'],
    assignments: [{ id: '12', folder: '工具' }],
  });
  assert.equal(plan.folders[0].name, '常用');
  assert.equal(plan.folders[0].items.length, 2);
  assert.equal(plan.folders[1].name, '工具');
});

test('i18n resolves languages, defaults, and English system prompts', () => {
  assert.equal(resolveLanguage('en'), 'en');
  assert.equal(resolveLanguage('zh_CN'), 'zh_CN');
  assert.equal(getLocalizedDefaults('en').archiveFolderName, 'Archive');
  assert.equal(getLocalizedDefaults('zh_CN').archiveFolderName, '历史归档');
  assert.equal(t('statTotal', {}, 'en'), 'Total');
  assert.equal(t('statTotal', {}, 'zh_CN'), '总书签');

  const enPrompt = getEffectiveSystemPrompt({ uiLanguage: 'en' });
  assert.ok(enPrompt.includes(DEFAULT_CLASSIFICATION_PROMPT_EN));
  assert.ok(enPrompt.includes('Output JSON Schema'));
});
