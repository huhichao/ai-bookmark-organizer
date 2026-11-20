import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAiPayloadItems, cleanBookmarkTitle, sanitizeUrlForAi } from '../src/core/sanitizer.js';
import { analyzeBookmarkTree, resolveScopeBehavior } from '../src/core/analyzer.js';
import { extractJsonObject, getEffectiveSystemPrompt, invokeAiText, JSON_SCHEMA_CONTRACT } from '../src/core/ai-client.js';
import {
  buildManualPromptBundle,
  buildPlanFromAiResponse,
  FALLBACK_FOLDER_NAME,
  generateAiOrganizationPlan,
} from '../src/core/planner.js';
import { isUrlCoveredByPatterns, toOriginMatchPattern } from '../src/core/permissions.js';
import { DEFAULT_CLASSIFICATION_PROMPT, DEFAULT_CLASSIFICATION_PROMPT_EN, PROMPT_TEMPLATES, SCOPE_MODES } from '../src/core/constants.js';
import { getLocalizedDefaults, resolveLanguage, t } from '../src/core/i18n.js';
import { getProviderConfig, loadSettings, saveSettings } from '../src/core/storage.js';

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

test('analyzeBookmarkTree keeps all recent items in activeItems and passes lastUsedAt hint to AI', () => {
  const now = new Date('2026-11-20T00:00:00Z').getTime();
  const veryRecentUse = now - 2 * 86400_000;
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
            { id: '12', title: 'NeverUsed', url: 'https://unused.example.com/', dateAdded: now - 5 * 86400_000, dateLastUsed: 0 },
          ],
        },
        { id: '2', folderType: 'other', title: '其他书签', children: [] },
      ],
    },
  ];

  const analysis = analyzeBookmarkTree(mockTree, { nowMs: now });
  assert.equal(analysis.frequentItems.length, 0);
  assert.equal(analysis.activeItems.length, 2);

  const payload = buildAiPayloadItems(analysis.activeItems);
  assert.equal(payload[0].lastUsedAt, '2026-11-18');
  assert.equal(payload[1].lastUsedAt, undefined);
});

test('i18n resolves languages, defaults, and English system prompts', () => {
  assert.equal(resolveLanguage('en'), 'en');
  assert.equal(resolveLanguage('zh_CN'), 'zh_CN');
  assert.equal(getLocalizedDefaults('en').archiveFolderName, 'Archive');
  assert.equal(getLocalizedDefaults('zh_CN').archiveFolderName, '历史归档');
  assert.equal(t('statTotal', {}, 'en'), 'In Scope');
  assert.equal(t('statTotal', {}, 'zh_CN'), '范围内书签');

  const enPrompt = getEffectiveSystemPrompt({ uiLanguage: 'en' });
  assert.ok(enPrompt.includes(DEFAULT_CLASSIFICATION_PROMPT_EN));
  assert.ok(enPrompt.includes('Output JSON Schema'));
});

test('extractFrequent falls back to AI selection when dateLastUsed is absent', () => {
  const analysis = {
    frequentItems: [],
    activeItems: [
      { id: '10', title: 'Claude', cleanTitle: 'Claude', url: 'https://claude.ai/', dateAdded: Date.now() },
      { id: '11', title: 'React Docs', cleanTitle: 'React Docs', url: 'https://react.dev/', dateAdded: Date.now() },
    ],
    duplicateRemovals: [],
    emptyFolders: [],
  };
  const settings = { uiLanguage: 'zh_CN', extractFrequent: true, frequentFolderName: '常用', frequentMaxCount: 8 };
  const promptBundle = buildManualPromptBundle(analysis, settings);
  assert.ok(promptBundle.includes('「常用」'));
  assert.ok(promptBundle.includes('最多 8 条'));

  const sysPromptWithFrequent = getEffectiveSystemPrompt(settings, { needAiFrequent: true });
  assert.ok(sysPromptWithFrequent.includes('「常用」'));

  const plan = buildPlanFromAiResponse(
    analysis,
    {
      folders: ['开发文档', '常用'],
      assignments: [
        { id: '11', folder: '开发文档' },
        { id: '10', folder: '常用' },
      ],
    },
    settings
  );
  // Even if AI returned '常用' second, planner pins it first
  assert.equal(plan.folders[0].name, '常用');
  assert.equal(plan.folders[0].items[0].id, '10');

  // Even if AI completely omits '常用', planner deterministically extracts fallback frequent items
  const omittedPlan = buildPlanFromAiResponse(
    analysis,
    {
      folders: ['开发文档'],
      assignments: [
        { id: '10', folder: '开发文档' },
        { id: '11', folder: '开发文档' },
      ],
    },
    settings
  );
  assert.equal(omittedPlan.folders[0].name, '常用');
  assert.ok(omittedPlan.folders[0].items.length > 0);
});

test('buildPlanFromAiResponse caps AI frequent items to frequentMaxCount without losing overflow', () => {
  const activeItems = Array.from({ length: 12 }, (_, idx) => ({
    id: String(100 + idx),
    title: `Site ${idx}`,
    cleanTitle: `Site ${idx}`,
    url: `https://site${idx}.example.com/`,
    dateAdded: Date.now() - idx * 86400_000,
    isLooseOnBar: idx < 4,
  }));
  const analysis = {
    frequentItems: [],
    activeItems,
    duplicateRemovals: [],
    emptyFolders: [],
  };
  const plan = buildPlanFromAiResponse(
    analysis,
    {
      folders: ['常用'],
      assignments: activeItems.map((it) => ({ id: it.id, folder: '常用' })),
    },
    { uiLanguage: 'zh_CN', extractFrequent: true, frequentFolderName: '常用', frequentMaxCount: 5 }
  );
  assert.equal(plan.folders[0].name, '常用');
  assert.equal(plan.folders[0].items.length, 5);
  const totalCount = plan.folders.reduce((s, f) => s + f.items.length, 0);
  assert.equal(totalCount, 12);
});

test('generateAiOrganizationPlan aborts immediately when signal is aborted', async () => {
  const controller = new AbortController();
  controller.abort();
  const analysis = {
    frequentItems: [],
    activeItems: [{ id: '1', title: 'A', cleanTitle: 'A', url: 'https://a.example.com/' }],
    duplicateRemovals: [],
    emptyFolders: [],
  };
  await assert.rejects(
    () => generateAiOrganizationPlan(analysis, { uiLanguage: 'zh_CN', provider: 'ollama', baseUrl: 'http://127.0.0.1:11434/v1', model: 'qwen' }, () => {}, { signal: controller.signal }),
    (err) => err?.name === 'AbortError'
  );
});

test('resolveScopeBehavior covers scopeMode and legacy onlyRecent/archiveNonRecent combinations', () => {
  // Default: process all -> recent to AI, non-recent straight to Archive
  assert.deepEqual(
    resolveScopeBehavior({ onlyRecent: false, archiveNonRecent: true }),
    {
      scopeMode: SCOPE_MODES.RECENT_ARCHIVE,
      onlyRecent: false,
      archiveNonRecent: true,
      ignoreDateCutoff: false,
      shouldArchiveNonRecent: true,
    }
  );
  // Process all without archiving -> all dates sent to AI together
  assert.deepEqual(
    resolveScopeBehavior({ onlyRecent: false, archiveNonRecent: false }),
    {
      scopeMode: SCOPE_MODES.ALL_AI,
      onlyRecent: false,
      archiveNonRecent: false,
      ignoreDateCutoff: true,
      shouldArchiveNonRecent: false,
    }
  );
  // Only recent -> recent to AI, non-recent untouched in place
  assert.deepEqual(
    resolveScopeBehavior({ onlyRecent: true, archiveNonRecent: true }),
    {
      scopeMode: SCOPE_MODES.RECENT_ONLY,
      onlyRecent: true,
      archiveNonRecent: false,
      ignoreDateCutoff: false,
      shouldArchiveNonRecent: false,
    }
  );
  // Explicit scopeMode takes precedence
  assert.equal(resolveScopeBehavior({ scopeMode: SCOPE_MODES.ALL_AI }).ignoreDateCutoff, true);
  assert.equal(resolveScopeBehavior({ scopeMode: SCOPE_MODES.RECENT_ONLY }).onlyRecent, true);
});

test('buildPlanFromAiResponse accepts numeric IDs, rejects zero-match JSON, and avoids archive name collision', () => {
  const analysis = {
    activeItems: [
      { id: '1520', title: 'Claude', cleanTitle: 'Claude', url: 'https://claude.ai/' },
      { id: '1521', title: 'Docs', cleanTitle: 'Docs', url: 'https://docs.example.com/' },
    ],
    duplicateRemovals: [],
    emptyFolders: [],
  };

  // Numeric IDs returned by LLM must match string bookmark IDs
  const plan = buildPlanFromAiResponse(
    analysis,
    {
      folders: ['AI', '历史归档'],
      assignments: [
        { id: 1520, folder: 'AI' },
        { id: 1521, folder: '历史归档' }, // collides with archiveFolderName -> remapped to fallback
      ],
    },
    { uiLanguage: 'zh_CN', archiveFolderName: '历史归档' }
  );
  assert.equal(plan.folders[0].name, 'AI');
  assert.equal(plan.folders[0].items[0].id, '1520');
  assert.equal(plan.folders[1].name, FALLBACK_FOLDER_NAME);
  assert.equal(plan.folders[1].items[0].id, '1521');
  assert.equal(plan.unassignedCount, 0);

  // Zero-match payload must throw loudly
  assert.throws(() => {
    buildPlanFromAiResponse(
      analysis,
      { folders: ['AI'], assignments: [{ id: '99999', folder: 'AI' }] },
      { uiLanguage: 'en' }
    );
  }, /None of the bookmark IDs/);
});

test('analyzeBookmarkTree uses exact segment match for archive folder and scopes Other/Mobile safely', () => {
  const now = new Date('2026-11-20T00:00:00Z').getTime();
  const recent = now - 5 * 86400_000;
  const old = new Date('2020-01-01T00:00:00Z').getTime();

  const mockTree = [
    {
      id: '0',
      title: '',
      children: [
        {
          id: '1',
          folderType: 'bookmarks-bar',
          title: 'Bookmarks Bar',
          children: [
            {
              id: '10',
              title: 'Web Archives', // substring contains "Archive" but is NOT the Archive folder
              children: [{ id: '11', title: 'Wayback', url: 'https://web.archive.org/', dateAdded: recent }],
            },
            {
              id: '20',
              title: 'Archive',
              children: [{ id: '21', title: 'Old Archived', url: 'https://old.example.com/', dateAdded: old }],
            },
          ],
        },
        {
          id: '2',
          folderType: 'other',
          title: 'Other Bookmarks',
          children: [{ id: '31', title: 'Other Link', url: 'https://other.example.com/', dateAdded: recent }],
        },
        {
          id: '3',
          folderType: 'mobile',
          title: 'Mobile Bookmarks',
          children: [{ id: '41', title: 'Phone Link', url: 'https://phone.example.com/', dateAdded: recent }],
        },
      ],
    },
  ];

  // Default: only Bookmarks Bar; "Web Archives" is NOT skipped; "Archive" IS skipped; Other & Mobile untouched
  const defaultRes = analyzeBookmarkTree(mockTree, {
    nowMs: now,
    archiveFolderName: 'Archive',
    includeArchived: false,
  });
  assert.equal(defaultRes.stats.totalUrls, 2);
  assert.equal(defaultRes.activeItems.map((i) => i.id).join(','), '11');

  // Checking includeArchived pulls old archived items into activeItems even in recent_archive mode
  const withArch = analyzeBookmarkTree(mockTree, {
    nowMs: now,
    archiveFolderName: 'Archive',
    includeArchived: true,
    scopeMode: SCOPE_MODES.RECENT_ARCHIVE,
  });
  assert.equal(withArch.activeItems.length, 2);

  // Checking includeOtherBookmarks includes Other Bookmarks while still leaving Mobile Bookmarks untouched
  const withOther = analyzeBookmarkTree(mockTree, {
    nowMs: now,
    archiveFolderName: 'Archive',
    includeOtherBookmarks: true,
  });
  assert.equal(withOther.stats.totalUrls, 3);
  assert.ok(withOther.activeItems.some((i) => i.id === '31'));
  assert.ok(!withOther.activeItems.some((i) => i.id === '41'));
});

test('extractJsonObject falls back past invalid code fences', () => {
  const raw = '```txt\nnot json\n```\nHere is result:\n```json\n{"folders":["Dev"],"assignments":[{"id":"1","folder":"Dev"}]}\n```';
  const obj = extractJsonObject(raw, 'en');
  assert.deepEqual(obj.folders, ['Dev']);
  assert.equal(obj.assignments[0].id, '1');
});

test('storage isolates API keys per provider and never leaks keys to Ollama', async () => {
  const mem = {};
  const prevChrome = globalThis.chrome;
  globalThis.chrome = {
    storage: {
      local: {
        async get(k) { return { [k]: mem[k] }; },
        async set(o) { Object.assign(mem, o); },
      },
    },
  };
  try {
    await saveSettings({ provider: 'deepseek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat', apiKey: 'sk-deepseek-secret' });
    const afterOllama = await saveSettings({ provider: 'ollama', baseUrl: 'http://localhost:11434/v1', model: 'qwen2.5:7b' });
    assert.equal(afterOllama.apiKey, '');

    const loaded = await loadSettings();
    assert.equal(loaded.provider, 'ollama');
    assert.equal(loaded.apiKey, '');
    assert.equal(getProviderConfig(loaded, 'deepseek').apiKey, 'sk-deepseek-secret');
  } finally {
    globalThis.chrome = prevChrome;
  }
});

test('invokeAiText uses provider-specific secure headers for Anthropic, Gemini, and Ollama', async () => {
  const calls = [];
  const origFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    calls.push({ url, headers: opts.headers, body: JSON.parse(opts.body) });
    if (String(url).includes('/messages')) {
      return { ok: true, async json() { return { content: [{ text: '{"ok":true}' }] }; } };
    }
    if (String(url).includes(':generateContent')) {
      return { ok: true, async json() { return { candidates: [{ content: { parts: [{ text: '{"ok":true}' }] } }] }; } };
    }
    return { ok: true, async json() { return { choices: [{ message: { content: '{"ok":true}' } }] }; } };
  };
  try {
    await invokeAiText(
      { provider: 'anthropic', baseUrl: 'https://api.anthropic.com/v1', apiKey: 'sk-ant', model: 'claude-3-5-haiku-latest' },
      'sys',
      'usr'
    );
    await invokeAiText(
      { provider: 'gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', apiKey: 'gem-key', model: 'gemini-2.5-flash' },
      'sys',
      'usr'
    );
    await invokeAiText(
      { provider: 'ollama', baseUrl: 'http://localhost:11434/v1', apiKey: 'should-not-send', model: 'qwen2.5:7b' },
      'sys',
      'usr'
    );

    assert.equal(calls[0].headers['anthropic-dangerous-direct-browser-access'], 'true');
    assert.equal(calls[0].body.max_tokens, 8192);
    assert.equal(calls[1].headers['x-goog-api-key'], 'gem-key');
    assert.ok(!calls[1].url.includes('gem-key'));
    assert.equal(calls[2].headers.Authorization, undefined);
  } finally {
    globalThis.fetch = origFetch;
  }
});
