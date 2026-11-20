import { DEFAULT_CLASSIFICATION_PROMPT, PROVIDER_PRESETS, getDefaultPrompt } from './constants.js';
import { getLocalizedDefaults, resolveLanguage, t } from './i18n.js';

export const JSON_SCHEMA_CONTRACT = `输出格式要求（不可更改）：
- 严格只输出合法 JSON，不要输出任何解释文字或 Markdown 以外的多余文本。
- 每个输入的 id 都必须在 assignments 中出现且保持原样（字符串形式）。
- 如需将一次性/临时/过期链接归入临时桶，将 folder 设为 "__TEMP__"；如需改名可附加可选字段 "rename"。

输出 JSON Schema：
{
  "folders": ["主题文件夹1", "主题文件夹2"],
  "assignments": [
    { "id": "1520", "folder": "主题文件夹1" },
    { "id": "1547", "folder": "__TEMP__" }
  ]
}`;

export const JSON_SCHEMA_CONTRACT_EN = `Output format requirements (must follow strictly):
- Output valid JSON only, with no extra explanation outside the JSON object.
- Every input id must appear in "assignments" unchanged (as a string).
- Assign temporary/expired/one-off links to folder "__TEMP__"; optionally include "rename" to clean a title.

Output JSON Schema:
{
  "folders": ["Folder 1", "Folder 2"],
  "assignments": [
    { "id": "1520", "folder": "Folder 1" },
    { "id": "1547", "folder": "__TEMP__" }
  ]
}`;

export const CLASSIFICATION_SYSTEM_PROMPT = `${DEFAULT_CLASSIFICATION_PROMPT}\n\n${JSON_SCHEMA_CONTRACT}`;

export function getEffectiveSystemPrompt(
  settings = {},
  { needAiFrequent = false, frequentMaxCountOverride = null } = {}
) {
  const lang = resolveLanguage(settings.uiLanguage);
  const locDefaults = getLocalizedDefaults(lang);
  const contract = lang === 'en' ? JSON_SCHEMA_CONTRACT_EN : JSON_SCHEMA_CONTRACT;
  const customRules = typeof settings.customPrompt === 'string' && settings.customPrompt.trim()
    ? settings.customPrompt.trim()
    : getDefaultPrompt(lang);

  let frequentDirective = '';
  if (needAiFrequent) {
    const folderName = settings.frequentFolderName || locDefaults.frequentFolderName;
    const rawMax = frequentMaxCountOverride ?? settings.frequentMaxCount;
    const maxCount = Math.max(1, Number(rawMax) || 12);
    frequentDirective = lang === 'en'
      ? `\n\nMANDATORY "${folderName}" FOLDER:\nYou MUST create a "${folderName}" folder as the FIRST item in "folders", and pick up to ${maxCount} core daily portals (main AI chats, notes, frequently used tools/work portals — considering title, root domain, folderHint, and lastUsedAt if present) into "${folderName}". Put all remaining bookmarks into topic folders.`
      : `\n\n强制要求——「${folderName}」文件夹：\n你必须在 "folders" 数组第 1 位创建「${folderName}」文件夹，并结合标题、主站入口特征、原目录位置及最近访问时间（如有 lastUsedAt），智能挑选最核心的日常高频入口（如主力 AI 对话、常用笔记、常用工具或工作入口，最多 ${maxCount} 条）归入「${folderName}」；其余书签再分入其他主题文件夹。`;
  }

  return `${customRules}${frequentDirective}\n\n${contract}`;
}

export function buildClassificationUserPrompt(payloadItems, customHint = '', lang = 'zh_CN') {
  if (lang === 'en') {
    const hintBlock = customHint?.trim()
      ? `\nAdditional preference:\n${customHint.trim()}\n`
      : '';
    return `Please categorize the following ${payloadItems.length} bookmarks:${hintBlock}
Bookmarks (JSON):
${JSON.stringify(payloadItems)}`;
  }
  const hintBlock = customHint?.trim()
    ? `\n用户补充偏好：\n${customHint.trim()}\n`
    : '';
  return `请将以下 ${payloadItems.length} 条书签进行分类：${hintBlock}
书签列表（JSON）：
${JSON.stringify(payloadItems)}`;
}

export function extractJsonObject(rawText, lang = resolveLanguage('auto')) {
  const text = String(rawText || '').trim();
  if (!text) throw new Error(t('errEmptyAiResponse', {}, lang));

  // 1. Try direct JSON parse
  try {
    const direct = JSON.parse(text);
    if (direct && typeof direct === 'object') return direct;
  } catch {
    // Continue to fence / brace extraction
  }

  // 2. Try every markdown fenced block (preferring one that has assignments)
  let fallbackParsed = null;
  for (const match of text.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)) {
    try {
      const candidate = JSON.parse(match[1].trim());
      if (candidate && typeof candidate === 'object') {
        if (Array.isArray(candidate.assignments)) return candidate;
        if (!fallbackParsed) fallbackParsed = candidate;
      }
    } catch {
      // Try next fence
    }
  }
  if (fallbackParsed) return fallbackParsed;

  // 3. Fallback to outermost { ... }
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    try {
      const sliced = JSON.parse(text.slice(firstBrace, lastBrace + 1));
      if (sliced && typeof sliced === 'object') return sliced;
    } catch {
      // Throw unified error below
    }
  }

  throw new Error(t('errInvalidJson', {}, lang));
}

function createAbortError() {
  const err = new Error('Operation aborted by user');
  err.name = 'AbortError';
  return err;
}

async function callBuiltInAi(systemPrompt, userPrompt, { signal = null, lang = 'zh_CN', onProgress = null } = {}) {
  if (signal?.aborted) throw createAbortError();
  if (!globalThis.LanguageModel) {
    throw new Error(t('errBuiltInUnsupported', {}, lang));
  }
  const availability = await LanguageModel.availability({
    expectedInputs: [{ type: 'text', languages: ['zh', 'en'] }],
    expectedOutputs: [{ type: 'text', languages: ['zh', 'en'] }],
  });
  if (availability === 'unavailable') {
    throw new Error(t('errBuiltInUnavailable', {}, lang));
  }

  if (signal?.aborted) throw createAbortError();
  const session = await LanguageModel.create({
    expectedInputs: [{ type: 'text', languages: ['zh', 'en'] }],
    expectedOutputs: [{ type: 'text', languages: ['zh', 'en'] }],
    initialPrompts: [{ role: 'system', content: systemPrompt }],
    monitor(m) {
      if (typeof onProgress !== 'function') return;
      m.addEventListener('downloadprogress', (e) => {
        const pct = e.total ? Math.floor((e.loaded / e.total) * 100) : Math.floor((e.loaded || 0) * 100);
        onProgress(t('progModelDownload', { pct }, lang));
      });
    },
  });
  try {
    return await session.prompt(userPrompt, signal ? { signal } : undefined);
  } finally {
    session.destroy();
  }
}

async function fetchWithTimeout(url, options, timeoutMs = 90000, externalSignal = null, lang = 'zh_CN') {
  if (externalSignal?.aborted) throw createAbortError();
  const controller = new AbortController();
  let timedOut = false;
  const onExternalAbort = () => controller.abort();
  if (externalSignal) {
    externalSignal.addEventListener('abort', onExternalAbort, { once: true });
  }
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } catch (err) {
    if (externalSignal?.aborted) {
      throw createAbortError();
    }
    if (timedOut || err?.name === 'TimeoutError') {
      throw new Error(t('errTimeout', { sec: Math.round(timeoutMs / 1000) }, lang), { cause: err });
    }
    throw new Error(t('errNetwork', { err: err?.message || String(err) }, lang), { cause: err });
  } finally {
    clearTimeout(timer);
    if (externalSignal) {
      externalSignal.removeEventListener('abort', onExternalAbort);
    }
  }
}

function extractOpenAiContent(data) {
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((part) => (typeof part === 'string' ? part : part?.text || '')).join('\n');
  }
  return '';
}

async function callOpenAiCompatible(
  { provider, baseUrl, apiKey, model },
  systemPrompt,
  userPrompt,
  { signal = null, timeoutMs = 90000, lang = 'zh_CN' } = {}
) {
  const endpoint = `${baseUrl.replace(/\/+$/, '')}/chat/completions`;
  const headers = { 'Content-Type': 'application/json' };
  const preset = PROVIDER_PRESETS[provider];
  if (apiKey && (preset?.needsKey !== false || provider === 'custom')) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  const res = await fetchWithTimeout(
    endpoint,
    {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model,
        temperature: 0.2,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      }),
    },
    timeoutMs,
    signal,
    lang
  );
  if (!res.ok) {
    let errText = '';
    try { errText = await res.text(); } catch {}
    const err = new Error(t('errApiStatus', { provider: 'API', status: res.status, detail: errText.slice(0, 200) }, lang));
    err.httpStatus = res.status;
    throw err;
  }
  const data = await res.json();
  if (data?.error) {
    const detail = typeof data.error === 'string' ? data.error : (data.error.message || JSON.stringify(data.error));
    throw new Error(t('errApiStatus', { provider: 'API', status: 200, detail: detail.slice(0, 200) }, lang));
  }
  return extractOpenAiContent(data);
}

async function callAnthropic(
  { baseUrl, apiKey, model },
  systemPrompt,
  userPrompt,
  { signal = null, timeoutMs = 90000, lang = 'zh_CN' } = {}
) {
  const endpoint = `${baseUrl.replace(/\/+$/, '')}/messages`;
  const res = await fetchWithTimeout(
    endpoint,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model,
        max_tokens: 8192,
        temperature: 0.2,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    },
    timeoutMs,
    signal,
    lang
  );
  if (!res.ok) {
    let errText = '';
    try { errText = await res.text(); } catch {}
    const err = new Error(t('errApiStatus', { provider: 'Claude API', status: res.status, detail: errText.slice(0, 200) }, lang));
    err.httpStatus = res.status;
    throw err;
  }
  const data = await res.json();
  return data.content?.map((c) => c.text || '').join('\n') || '';
}

async function callGemini(
  { baseUrl, apiKey, model },
  systemPrompt,
  userPrompt,
  { signal = null, timeoutMs = 90000, lang = 'zh_CN' } = {}
) {
  const cleanBase = baseUrl.replace(/\/+$/, '');
  const endpoint = `${cleanBase}/models/${encodeURIComponent(model)}:generateContent`;
  const headers = { 'Content-Type': 'application/json' };
  if (apiKey) headers['x-goog-api-key'] = apiKey;

  const res = await fetchWithTimeout(
    endpoint,
    {
      method: 'POST',
      headers,
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
        generationConfig: {
          temperature: 0.2,
          responseMimeType: 'application/json',
        },
      }),
    },
    timeoutMs,
    signal,
    lang
  );
  if (!res.ok) {
    let errText = '';
    try { errText = await res.text(); } catch {}
    const err = new Error(t('errApiStatus', { provider: 'Gemini API', status: res.status, detail: errText.slice(0, 200) }, lang));
    err.httpStatus = res.status;
    throw err;
  }
  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('\n') || '';
}

export async function invokeAiText(
  settings,
  systemPrompt,
  userPrompt,
  { signal = null, timeoutMs = 90000, onProgress = null } = {}
) {
  if (signal?.aborted) throw createAbortError();
  const lang = resolveLanguage(settings.uiLanguage);
  const { provider } = settings;
  if (provider === 'builtin') {
    return callBuiltInAi(systemPrompt, userPrompt, { signal, lang, onProgress });
  }
  if (provider === 'anthropic') {
    return callAnthropic(settings, systemPrompt, userPrompt, { signal, timeoutMs, lang });
  }
  if (provider === 'gemini') {
    return callGemini(settings, systemPrompt, userPrompt, { signal, timeoutMs, lang });
  }
  return callOpenAiCompatible(settings, systemPrompt, userPrompt, { signal, timeoutMs, lang });
}

export async function testAiConnection(settings, { onProgress = null } = {}) {
  const text = await invokeAiText(
    settings,
    'You are a connectivity test assistant. Reply with valid JSON: {"ok":true}',
    'Reply {"ok":true} only.',
    { timeoutMs: 25000, onProgress }
  );
  return text.slice(0, 120);
}
