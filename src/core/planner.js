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

/**
 * Normalize and validate AI classification output against known active items.
 */
export function buildPlanFromAiResponse(analysis, rawAiResult, settings = {}) {
  const parsed = typeof rawAiResult === 'string'
    ? extractJsonObject(rawAiResult)
    : rawAiResult;

  if (!parsed || !Array.isArray(parsed.assignments)) {
    throw new Error('AI 返回 JSON 缺少 assignments 数组');
  }

  const lang = resolveLanguage(settings.uiLanguage);
  const locDefaults = getLocalizedDefaults(lang);
  const fallbackFolderName = settings.fallbackFolderName || locDefaults.fallbackFolderName;

  const activeMap = new Map(analysis.activeItems.map((it) => [it.id, it]));
  const assignedMap = new Map();
  const folderOrder = Array.isArray(parsed.folders)
    ? parsed.folders.filter((f) => typeof f === 'string' && f.trim() && f !== TEMP_FOLDER_TOKEN)
    : [];
  const folderSet = new Set(folderOrder);

  for (const entry of parsed.assignments) {
    if (!entry || typeof entry.id !== 'string') continue;
    const item = activeMap.get(entry.id);
    if (!item || assignedMap.has(entry.id)) continue;

    const targetFolder = typeof entry.folder === 'string' && entry.folder.trim()
      ? entry.folder.trim()
      : fallbackFolderName;

    if (targetFolder !== TEMP_FOLDER_TOKEN && !folderSet.has(targetFolder)) {
      folderSet.add(targetFolder);
      folderOrder.push(targetFolder);
    }

    const rename = typeof entry.rename === 'string' && entry.rename.trim()
      ? entry.rename.trim()
      : item.cleanTitle !== item.title
        ? item.cleanTitle
        : '';

    assignedMap.set(entry.id, {
      id: item.id,
      title: item.title,
      url: item.url,
      folder: targetFolder,
      rename,
    });
  }

  // Ensure every active item is accounted for (never drop any item)
  for (const item of analysis.activeItems) {
    if (!assignedMap.has(item.id)) {
      if (!folderSet.has(fallbackFolderName)) {
        folderSet.add(fallbackFolderName);
        folderOrder.push(fallbackFolderName);
      }
      assignedMap.set(item.id, {
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
  }
  for (const [name, items] of groups.entries()) {
    if (items.length > 0) folders.push({ name, items });
  }

  return {
    folders,
    tempItems,
    duplicateRemovals: settings.deduplicateArchive === false ? [] : analysis.duplicateRemovals,
    emptyFoldersCount: analysis.emptyFolders.length,
    archiveFolderName: settings.archiveFolderName || locDefaults.archiveFolderName,
    tempFolderName: locDefaults.tempFolderName,
    uiLanguage: lang,
    archiveLocation: settings.archiveLocation || 'bar_end',
    removeEmptyFolders: settings.removeEmptyFolders !== false,
  };
}

/**
 * Run AI classification in batches and merge into one validated plan.
 */
export async function generateAiOrganizationPlan(analysis, settings, onProgress = () => {}) {
  const batchSize = Math.max(10, Number(settings.batchSize) || 60);
  const items = analysis.activeItems;
  if (items.length === 0) {
    return buildPlanFromAiResponse(analysis, { folders: [], assignments: [] }, settings);
  }

  const allFolders = [];
  const folderSeen = new Set();
  const allAssignments = [];

  const lang = resolveLanguage(settings.uiLanguage);
  const totalBatches = Math.ceil(items.length / batchSize);
  for (let i = 0; i < totalBatches; i++) {
    const slice = items.slice(i * batchSize, (i + 1) * batchSize);
    onProgress(t('progBatch', { cur: i + 1, total: totalBatches, count: slice.length }, lang));
    const payload = buildAiPayloadItems(slice, {
      stripQueryParams: settings.stripQueryParams !== false,
    });
    const reuseNote = lang === 'en'
      ? `Reuse existing folder names when appropriate: ${allFolders.join(', ')}`
      : `请优先复用已建立的文件夹名称：${allFolders.join('、')}`;
    const hint = allFolders.length > 0
      ? `${settings.customPromptHint || ''}\n${reuseNote}`
      : settings.customPromptHint;

    const userPrompt = buildClassificationUserPrompt(payload, hint, lang);
    const systemPrompt = getEffectiveSystemPrompt(settings);
    const rawText = await invokeAiText(settings, systemPrompt, userPrompt);
    const parsed = extractJsonObject(rawText);

    for (const f of parsed.folders || []) {
      if (typeof f === 'string' && f.trim() && !folderSeen.has(f.trim())) {
        folderSeen.add(f.trim());
        allFolders.push(f.trim());
      }
    }
    for (const a of parsed.assignments || []) {
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
  const payload = buildAiPayloadItems(analysis.activeItems, {
    stripQueryParams: settings.stripQueryParams !== false,
  });
  return `${getEffectiveSystemPrompt(settings)}\n\n${buildClassificationUserPrompt(payload, settings.customPromptHint, lang)}`;
}
