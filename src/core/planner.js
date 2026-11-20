import { resolveScopeBehavior } from './analyzer.js';
import {
  buildClassificationUserPrompt,
  extractJsonObject,
  getEffectiveSystemPrompt,
  invokeAiText,
} from './ai-client.js';
import { getLocalizedDefaults, resolveLanguage, t } from './i18n.js';
import { buildAiPayloadItems } from './sanitizer.js';

export const TEMP_FOLDER_TOKEN = '__TEMP__';
export const FALLBACK_FOLDER_NAME = '近期待归类';

function scoreFallbackFrequent(item) {
  let score = 0;
  if (item.isLooseOnBar) score += 40;
  try {
    const u = new URL(item.url);
    const pathLen = u.pathname.replace(/\/+$/, '').length;
    if (pathLen === 0) score += 35; // Homepage / root domain portal
    else if (u.pathname.split('/').filter(Boolean).length <= 1) score += 15;
    if (!u.search) score += 10;
  } catch {}
  if (item.dateAdded) {
    const ageDays = Math.max(0, (Date.now() - item.dateAdded) / 86400_000);
    if (ageDays <= 365) score += Math.round(20 * (1 - ageDays / 365));
  }
  return score;
}

function pickFallbackFrequentIds(activeItems, excludedIds, maxPick) {
  return [...activeItems]
    .filter((it) => !excludedIds.has(it.id))
    .sort((a, b) => scoreFallbackFrequent(b) - scoreFallbackFrequent(a))
    .slice(0, maxPick)
    .map((it) => it.id);
}

/**
 * Normalize and validate AI classification output against known active items.
 */
export function buildPlanFromAiResponse(analysis, rawAiResult, settings = {}) {
  const lang = resolveLanguage(settings.uiLanguage);
  const locDefaults = getLocalizedDefaults(lang);
  const archiveFolderName = settings.archiveFolderName || locDefaults.archiveFolderName;
  const fallbackFolderName = settings.fallbackFolderName || locDefaults.fallbackFolderName;

  const parsed = typeof rawAiResult === 'string'
    ? extractJsonObject(rawAiResult, lang)
    : rawAiResult;

  if (!parsed || !Array.isArray(parsed.assignments)) {
    throw new Error(t('errMissingAssignments', {}, lang));
  }

  const activeMap = new Map(analysis.activeItems.map((it) => [String(it.id), it]));
  const assignedMap = new Map();
  const folderOrder = Array.isArray(parsed.folders)
    ? parsed.folders
        .filter((f) => typeof f === 'string' && f.trim() && f.trim() !== TEMP_FOLDER_TOKEN && f.trim() !== archiveFolderName)
        .map((f) => f.trim())
    : [];
  const folderSet = new Set(folderOrder);

  let matchedCount = 0;
  for (const entry of parsed.assignments) {
    if (!entry || entry.id === undefined || entry.id === null) continue;
    const entryId = String(entry.id).trim();
    if (!entryId) continue;
    const item = activeMap.get(entryId);
    if (!item || assignedMap.has(entryId)) continue;

    matchedCount++;
    const rawFolder = typeof entry.folder === 'string' ? entry.folder.trim() : '';
    const targetFolder = !rawFolder || rawFolder === archiveFolderName
      ? fallbackFolderName
      : rawFolder;

    if (targetFolder !== TEMP_FOLDER_TOKEN && !folderSet.has(targetFolder)) {
      folderSet.add(targetFolder);
      folderOrder.push(targetFolder);
    }

    const rename = typeof entry.rename === 'string' && entry.rename.trim()
      ? entry.rename.trim()
      : item.cleanTitle !== item.title
        ? item.cleanTitle
        : '';

    assignedMap.set(entryId, {
      id: item.id,
      title: item.title,
      url: item.url,
      folder: targetFolder,
      rename,
    });
  }

  // If active items exist and user/AI provided assignments, reject zero-match payloads loudly
  if (analysis.activeItems.length > 0 && matchedCount === 0) {
    throw new Error(t('errNoMatchingIds', {}, lang));
  }

  // Ensure every active item is accounted for (never drop any item)
  let unassignedCount = 0;
  for (const item of analysis.activeItems) {
    if (!assignedMap.has(String(item.id))) {
      unassignedCount++;
      if (!folderSet.has(fallbackFolderName)) {
        folderSet.add(fallbackFolderName);
        folderOrder.push(fallbackFolderName);
      }
      assignedMap.set(String(item.id), {
        id: item.id,
        title: item.title,
        url: item.url,
        folder: fallbackFolderName,
        rename: item.cleanTitle !== item.title ? item.cleanTitle : '',
      });
    }
  }

  const groups = new Map();
  for (const folderName of folderOrder) groups.set(folderName, []);
  const tempItems = [];

  for (const assignment of assignedMap.values()) {
    if (assignment.folder === TEMP_FOLDER_TOKEN) {
      tempItems.push(assignment);
    } else {
      if (!groups.has(assignment.folder)) groups.set(assignment.folder, []);
      groups.get(assignment.folder).push(assignment);
    }
  }

  const folders = [];
  const frequentName = settings.frequentFolderName || locDefaults.frequentFolderName;
  const frequentList = (analysis.frequentItems || []).map((item) => ({
    id: item.id,
    title: item.title,
    url: item.url,
    folder: frequentName,
    rename: item.cleanTitle !== item.title ? item.cleanTitle : '',
  }));
  if (frequentList.length > 0) {
    const aiSame = groups.get(frequentName) || [];
    groups.delete(frequentName);
    folders.push({ name: frequentName, items: [...frequentList, ...aiSame] });
  } else if (settings.extractFrequent) {
    const aiAliases = [frequentName, '常用置顶', 'Pinned Core', 'Frequent'];
    const maxFrequent = Math.max(3, Math.min(30, Number(settings.frequentMaxCount) || 12));
    let aiFreq = [];
    for (const alias of aiAliases) {
      if (groups.has(alias)) {
        aiFreq = aiFreq.concat(groups.get(alias) || []);
        groups.delete(alias);
      }
    }
    if (aiFreq.length > maxFrequent) {
      const scoredIds = aiFreq
        .toSorted((a, b) => scoreFallbackFrequent(activeMap.get(b.id) || b) - scoreFallbackFrequent(activeMap.get(a.id) || a))
        .slice(0, maxFrequent)
        .map((it) => it.id);
      const keepFreqSet = new Set(scoredIds);
      const keptFreq = [];
      const overflow = [];
      for (const it of aiFreq) {
        if (keepFreqSet.has(it.id)) keptFreq.push(it);
        else overflow.push({ ...it, folder: fallbackFolderName });
      }
      aiFreq = keptFreq;
      if (overflow.length > 0) {
        if (!groups.has(fallbackFolderName)) groups.set(fallbackFolderName, []);
        groups.get(fallbackFolderName).push(...overflow);
      }
    }
    if (aiFreq.length === 0 && analysis.activeItems.length > 0) {
      // Deterministic heuristic fallback if the LLM still omitted the Frequent folder
      const tempIds = new Set(tempItems.map((item) => item.id));
      const maxPick = Math.min(8, maxFrequent, analysis.activeItems.length);
      const pickedIds = new Set(pickFallbackFrequentIds(analysis.activeItems, tempIds, maxPick));
      for (const [gName, gItems] of groups.entries()) {
        const keep = [];
        for (const it of gItems) {
          if (pickedIds.has(it.id)) {
            aiFreq.push({ ...it, folder: frequentName });
          } else {
            keep.push(it);
          }
        }
        groups.set(gName, keep);
      }
    }
    if (aiFreq.length > 0) folders.push({ name: frequentName, items: aiFreq });
  }
  for (const [name, items] of groups.entries()) {
    if (items.length > 0) folders.push({ name, items });
  }

  return {
    folders,
    tempItems,
    unassignedCount,
    fallbackFolderName,
    historicalItems: (analysis.historicalItems || []).map((item) => ({
      id: item.id,
      title: item.title,
      url: item.url,
      rootType: item.rootType || 'bar',
      parentPath: item.parentPath || '',
    })),
    duplicateRemovals: settings.deduplicateArchive === false ? [] : analysis.duplicateRemovals,
    emptyFoldersCount: analysis.emptyFolders.length,
    includeOtherBookmarks: Boolean(
      settings.includeOtherBookmarks ?? analysis.includeOtherBookmarks
    ),
    archiveFolderName,
    tempFolderName: locDefaults.tempFolderName,
    uiLanguage: lang,
    archiveLocation: settings.archiveLocation || 'bar_end',
    archiveNonRecent: resolveScopeBehavior(settings).shouldArchiveNonRecent,
    removeEmptyFolders: settings.removeEmptyFolders !== false,
  };
}

function throwIfAborted(signal) {
  if (signal?.aborted) {
    const err = new Error('Operation aborted by user');
    err.name = 'AbortError';
    throw err;
  }
}

function isNonRetryableError(err) {
  if (!err) return false;
  if (err.name === 'AbortError') return true;
  if (err.httpStatus === 400 || err.httpStatus === 401 || err.httpStatus === 403 || err.httpStatus === 404) {
    return true;
  }
  return false;
}

function buildFrequentAiFallbackHint(analysis, settings, lang, maxCountOverride = null) {
  if (!settings.extractFrequent || (analysis.frequentItems && analysis.frequentItems.length > 0)) {
    return '';
  }
  const locDefaults = getLocalizedDefaults(lang);
  const folderName = settings.frequentFolderName || locDefaults.frequentFolderName;
  const maxCount = Math.max(1, Number(maxCountOverride ?? settings.frequentMaxCount) || 12);
  if (lang === 'en') {
    return `Important: The user enabled "${folderName}" extraction. Pick up to ${maxCount} core daily portals (main AI chats, notes, key tools/work portals; use lastUsedAt as an extra hint if present) into "${folderName}" and list "${folderName}" first in "folders".`;
  }
  return `重要要求：用户开启了「${folderName}」置顶文件夹，请由你综合判断并挑选最核心的日常高频入口（如主力 AI 对话、常用笔记、常用工具或工作入口，如有 lastUsedAt 可作参考，最多 ${maxCount} 条）归入「${folderName}」文件夹，并将「${folderName}」排在 folders 数组第一位。`;
}

/**
 * Run AI classification in batches and merge into one validated plan.
 */
export async function generateAiOrganizationPlan(
  analysis,
  settings,
  onProgress = () => {},
  { signal = null } = {}
) {
  throwIfAborted(signal);
  const configuredBatchSize = Math.max(10, Math.min(150, Number(settings.batchSize) || 60));
  // Chrome Built-in AI (Gemini Nano) has a tighter context window than cloud LLMs
  const batchSize = settings.provider === 'builtin'
    ? Math.min(configuredBatchSize, 20)
    : configuredBatchSize;

  const items = analysis.activeItems;
  if (items.length === 0) {
    return buildPlanFromAiResponse(analysis, { folders: [], assignments: [] }, settings);
  }

  const allFolders = [];
  const folderSeen = new Set();
  const allAssignments = [];

  const lang = resolveLanguage(settings.uiLanguage);
  const locDefaults = getLocalizedDefaults(lang);
  const frequentFolderName = settings.frequentFolderName || locDefaults.frequentFolderName;
  const frequentAliasSet = new Set([frequentFolderName, '常用置顶', 'Pinned Core', 'Frequent']);
  const maxFrequent = Math.max(3, Math.min(30, Number(settings.frequentMaxCount) || 12));
  const needAiFrequent = Boolean(settings.extractFrequent && (!analysis.frequentItems || analysis.frequentItems.length === 0));
  let pickedFrequentCount = 0;

  const totalBatches = Math.ceil(items.length / batchSize);
  for (let i = 0; i < totalBatches; i++) {
    throwIfAborted(signal);
    const slice = items.slice(i * batchSize, (i + 1) * batchSize);
    onProgress(t('progBatch', { cur: i + 1, total: totalBatches, count: slice.length }, lang));
    const payload = buildAiPayloadItems(slice, {
      stripQueryParams: settings.stripQueryParams !== false,
    });

    const remainingFrequent = needAiFrequent ? Math.max(0, maxFrequent - pickedFrequentCount) : 0;
    const batchNeedFrequent = needAiFrequent && remainingFrequent > 0;
    const frequentHint = batchNeedFrequent
      ? buildFrequentAiFallbackHint(analysis, settings, lang, remainingFrequent)
      : needAiFrequent
        ? (lang === 'en'
          ? `Important: "${frequentFolderName}" is already full (${maxFrequent} items). Do NOT assign bookmarks in this batch to "${frequentFolderName}"; classify them into topic folders.`
          : `重要限制：「${frequentFolderName}」已达 ${maxFrequent} 条上限，本批请勿再归入「${frequentFolderName}」，请全部归入具体主题文件夹。`)
        : '';

    const reuseFolders = batchNeedFrequent
      ? allFolders
      : allFolders.filter((f) => !frequentAliasSet.has(f));
    const reuseNote = lang === 'en'
      ? `Reuse existing folder names when appropriate: ${reuseFolders.join(', ')}`
      : `请优先复用已建立的文件夹名称：${reuseFolders.join('、')}`;
    const hintParts = [settings.customPromptHint, frequentHint, reuseFolders.length > 0 ? reuseNote : '']
      .filter((p) => p && p.trim());
    const hint = hintParts.join('\n');

    const userPrompt = buildClassificationUserPrompt(payload, hint, lang);
    const systemPrompt = getEffectiveSystemPrompt(settings, {
      needAiFrequent: batchNeedFrequent,
      frequentMaxCountOverride: batchNeedFrequent ? remainingFrequent : null,
    });

    let parsed = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const rawText = await invokeAiText(settings, systemPrompt, userPrompt, {
          signal,
          onProgress,
        });
        throwIfAborted(signal);
        parsed = extractJsonObject(rawText, lang);
        if (!Array.isArray(parsed.assignments)) {
          throw new Error(t('errMissingAssignments', {}, lang));
        }
        break;
      } catch (err) {
        if (attempt === 1 || isNonRetryableError(err)) {
          throw err;
        }
        onProgress(t('progBatchRetry', { cur: i + 1, total: totalBatches }, lang));
      }
    }

    for (const f of parsed.folders || []) {
      if (typeof f === 'string' && f.trim() && !folderSeen.has(f.trim())) {
        folderSeen.add(f.trim());
        allFolders.push(f.trim());
      }
    }
    for (const a of parsed.assignments || []) {
      if (a && typeof a.folder === 'string' && frequentAliasSet.has(a.folder.trim())) {
        pickedFrequentCount++;
      }
      allAssignments.push(a);
    }
  }

  return buildPlanFromAiResponse(
    analysis,
    { folders: allFolders, assignments: allAssignments },
    settings
  );
}

export function buildManualPromptBundle(analysis, settings) {
  const lang = resolveLanguage(settings.uiLanguage);
  const needAiFrequent = Boolean(settings.extractFrequent && (!analysis.frequentItems || analysis.frequentItems.length === 0));
  const payload = buildAiPayloadItems(analysis.activeItems, {
    stripQueryParams: settings.stripQueryParams !== false,
  });
  const frequentHint = buildFrequentAiFallbackHint(analysis, settings, lang);
  const hint = [settings.customPromptHint, frequentHint].filter((p) => p && p.trim()).join('\n');
  return `${getEffectiveSystemPrompt(settings, { needAiFrequent })}\n\n${buildClassificationUserPrompt(payload, hint, lang)}`;
}
