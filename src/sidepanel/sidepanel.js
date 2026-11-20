import { analyzeBookmarkTree } from '../core/analyzer.js';
import { applyOrganizationPlan } from '../core/applier.js';
import { PROVIDER_PRESETS, STORAGE_KEYS } from '../core/constants.js';
import { applyI18nToDocument, getLocalizedDefaults, resolveLanguage, t } from '../core/i18n.js';
import {
  buildManualPromptBundle,
  buildPlanFromAiResponse,
  generateAiOrganizationPlan,
} from '../core/planner.js';
import { getLastSnapshot, restoreLastSnapshot } from '../core/snapshot.js';
import { loadSettings, saveSettings } from '../core/storage.js';

let currentAnalysis = null;
let currentPlan = null;
let currentSettings = null;
let currentLang = 'en';

const el = (id) => document.getElementById(id);

function setStatus(msg, kind = 'info') {
  const node = el('statusText');
  node.textContent = msg;
  node.className = `status-banner ${kind}`;
}

async function refreshHeaderAndSnapshot() {
  currentSettings = await loadSettings();
  currentLang = resolveLanguage(currentSettings.uiLanguage);
  applyI18nToDocument(currentLang);

  const preset = PROVIDER_PRESETS[currentSettings.provider];
  const label = preset ? preset.label : currentSettings.provider;
  el('modelBadge').textContent = `${label} · ${currentSettings.model || t('modelUnset', {}, currentLang)}`;
  el('quickIncludeArchived').checked = Boolean(currentSettings.includeArchived);
  el('quickIgnoreDate').checked = Boolean(currentSettings.ignoreDateCutoff);
  el('quickExtractFrequent').checked = Boolean(currentSettings.extractFrequent);

  const snap = await getLastSnapshot();
  el('btnUndo').disabled = !snap;
}

async function scanBookmarks() {
  currentSettings = await loadSettings();
  currentLang = resolveLanguage(currentSettings.uiLanguage);
  const locDefaults = getLocalizedDefaults(currentLang);
  const tree = await chrome.bookmarks.getTree();
  currentAnalysis = analyzeBookmarkTree(tree, {
    recentDays: currentSettings.recentDays,
    includeRootLoose: currentSettings.includeRootLoose,
    includeArchived: Boolean(currentSettings.includeArchived),
    ignoreDateCutoff: Boolean(currentSettings.ignoreDateCutoff),
    extractFrequent: Boolean(currentSettings.extractFrequent),
    frequentDays: currentSettings.frequentDays || 90,
    frequentMaxCount: currentSettings.frequentMaxCount || 12,
    archiveFolderName: currentSettings.archiveFolderName || locDefaults.archiveFolderName,
  });

  const { stats } = currentAnalysis;
  el('statTotal').textContent = String(stats.totalUrls);
  el('statActive').textContent = String(stats.activeCount);
  el('statDup').textContent = String(stats.duplicateCount);
  el('statEmpty').textContent = String(stats.emptyFolderCount);
  const freqPart = stats.frequentCount > 0
    ? t('scanNoteFreq', {
        frequentFolder: currentSettings.frequentFolderName || locDefaults.frequentFolderName,
        frequentCount: stats.frequentCount,
      }, currentLang)
    : '';
  el('scanNote').textContent = t('scanNoteMain', {
    freqPart,
    activeCount: stats.activeCount,
    historicalCount: stats.historicalCount,
    archiveFolder: currentSettings.archiveFolderName || locDefaults.archiveFolderName,
  }, currentLang);
}

function renderPreview(plan) {
  currentPlan = plan;
  el('previewBox').classList.remove('hidden');
  el('btnApply').disabled = false;

  const activeTotal = plan.folders.reduce((s, f) => s + f.items.length, 0);
  el('previewSummary').textContent = t('previewSummary', {
    foldersCount: plan.folders.length,
    activeTotal,
    tempCount: plan.tempItems.length,
    dupCount: plan.duplicateRemovals.length,
  }, currentLang);

  const treeContainer = el('previewTree');
  treeContainer.replaceChildren();

  for (const folder of plan.folders) {
    const box = document.createElement('div');
    box.className = 'folder-group';

    const title = document.createElement('div');
    title.className = 'folder-title';
    title.textContent = `${folder.name} (${folder.items.length})`;
    box.appendChild(title);

    const ul = document.createElement('ul');
    ul.className = 'folder-items';
    for (const item of folder.items.slice(0, 8)) {
      const li = document.createElement('li');
      li.textContent = item.rename || item.title || item.url;
      ul.appendChild(li);
    }
    if (folder.items.length > 8) {
      const more = document.createElement('li');
      more.textContent = t('previewMore', { count: folder.items.length - 8 }, currentLang);
      ul.appendChild(more);
    }
    box.appendChild(ul);
    treeContainer.appendChild(box);
  }

  if (plan.tempItems.length > 0) {
    const locDefaults = getLocalizedDefaults(currentLang);
    const box = document.createElement('div');
    box.className = 'folder-group';
    const title = document.createElement('div');
    title.className = 'folder-title';
    title.textContent = `${t('tempFolderPath', {
      archiveFolder: plan.archiveFolderName,
      tempFolder: plan.tempFolderName || locDefaults.tempFolderName,
    }, currentLang)} (${plan.tempItems.length})`;
    box.appendChild(title);
    treeContainer.appendChild(box);
  }
}

el('btnOpenOptions').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

el('btnEditPrompt').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

async function handleScopeToggleChange() {
  await saveSettings({
    includeArchived: el('quickIncludeArchived').checked,
    ignoreDateCutoff: el('quickIgnoreDate').checked,
    extractFrequent: el('quickExtractFrequent').checked,
  });
  await scanBookmarks();
  const locDefaults = getLocalizedDefaults(currentLang);
  const freqPart = currentAnalysis.stats.frequentCount > 0
    ? t('scanNoteFreq', {
        frequentFolder: currentSettings.frequentFolderName || locDefaults.frequentFolderName,
        frequentCount: currentAnalysis.stats.frequentCount,
      }, currentLang)
    : '';
  setStatus(t('statusScopeUpdated', {
    freqPart,
    activeCount: currentAnalysis.stats.activeCount,
  }, currentLang), 'info');
}

el('quickIncludeArchived').addEventListener('change', handleScopeToggleChange);
el('quickIgnoreDate').addEventListener('change', handleScopeToggleChange);
el('quickExtractFrequent').addEventListener('change', handleScopeToggleChange);

el('btnScan').addEventListener('click', async () => {
  try {
    setStatus(t('statusScanning', {}, currentLang), 'loading');
    await scanBookmarks();
    setStatus(t('statusScanDone', {}, currentLang), 'ok');
  } catch (err) {
    setStatus(t('statusScanFail', { err: err.message }, currentLang), 'err');
  }
});

el('btnAiPlan').addEventListener('click', async () => {
  if (!currentAnalysis) await scanBookmarks();
  const preset = PROVIDER_PRESETS[currentSettings.provider];
  if (preset?.needsKey && !currentSettings.apiKey) {
    setStatus(t('statusMissingKey', {}, currentLang), 'err');
    return;
  }

  const btn = el('btnAiPlan');
  btn.disabled = true;
  btn.textContent = t('btnAiPlanning', {}, currentLang);
  setStatus(t('statusAiRunning', {}, currentLang), 'loading');
  try {
    const plan = await generateAiOrganizationPlan(
      currentAnalysis,
      currentSettings,
      (msg) => setStatus(msg, 'loading')
    );
    renderPreview(plan);
    setStatus(t('statusAiDone', {}, currentLang), 'ok');
  } catch (err) {
    setStatus(t('statusAiFail', { err: err.message }, currentLang), 'err');
  } finally {
    btn.disabled = false;
    btn.textContent = t('btnAiPlan', {}, currentLang);
  }
});

function switchPlanMode(mode) {
  const isManual = mode === 'manual';
  el('tabApiMode').classList.toggle('active', !isManual);
  el('tabApiMode').setAttribute('aria-selected', String(!isManual));
  el('tabManualMode').classList.toggle('active', isManual);
  el('tabManualMode').setAttribute('aria-selected', String(isManual));
  el('apiModePane').classList.toggle('hidden', isManual);
  el('manualBox').classList.toggle('hidden', !isManual);
}

el('tabApiMode').addEventListener('click', () => {
  switchPlanMode('api');
  setStatus(t('statusSwitchedApi', {}, currentLang), 'info');
});

el('tabManualMode').addEventListener('click', () => {
  switchPlanMode('manual');
  setStatus(t('statusSwitchedManual', {}, currentLang), 'info');
});

el('btnCopyPrompt').addEventListener('click', async () => {
  if (!currentAnalysis) await scanBookmarks();
  const promptText = buildManualPromptBundle(currentAnalysis, currentSettings);
  await navigator.clipboard.writeText(promptText);
  const btn = el('btnCopyPrompt');
  btn.textContent = t('btnCopied', {}, currentLang);
  setTimeout(() => { btn.textContent = t('btnCopyPrompt', {}, currentLang); }, 1500);
  setStatus(t('statusCopied', { count: currentAnalysis.activeItems.length }, currentLang), 'ok');
});

el('btnParseManual').addEventListener('click', async () => {
  if (!currentAnalysis) await scanBookmarks();
  try {
    const raw = el('manualJsonInput').value;
    const plan = buildPlanFromAiResponse(currentAnalysis, raw, currentSettings);
    renderPreview(plan);
    setStatus(t('statusJsonOk', {}, currentLang), 'ok');
  } catch (err) {
    setStatus(t('statusJsonFail', { err: err.message }, currentLang), 'err');
  }
});

el('btnApply').addEventListener('click', async () => {
  if (!currentPlan) return;
  const btn = el('btnApply');
  btn.disabled = true;
  btn.textContent = t('btnApplying', {}, currentLang);
  try {
    const result = await applyOrganizationPlan(currentPlan, (msg) => setStatus(msg, 'loading'));
    await scanBookmarks();
    await refreshHeaderAndSnapshot();
    setStatus(t('statusApplyDone', result, currentLang), 'ok');
  } catch (err) {
    setStatus(t('statusApplyFail', { err: err.message }, currentLang), 'err');
  } finally {
    btn.disabled = false;
    btn.textContent = t('btnApply', {}, currentLang);
  }
});

el('btnUndo').addEventListener('click', async () => {
  const btn = el('btnUndo');
  btn.disabled = true;
  btn.textContent = t('btnUndoing', {}, currentLang);
  try {
    setStatus(t('statusUndoing', {}, currentLang), 'loading');
    await restoreLastSnapshot();
    await scanBookmarks();
    setStatus(t('statusUndoDone', {}, currentLang), 'ok');
  } catch (err) {
    setStatus(t('statusUndoFail', { err: err.message }, currentLang), 'err');
  } finally {
    btn.textContent = t('btnUndo', {}, currentLang);
    await refreshHeaderAndSnapshot();
  }
});

chrome.storage.onChanged.addListener(async (changes, areaName) => {
  if (areaName === 'local' && (changes[STORAGE_KEYS.SETTINGS] || changes[STORAGE_KEYS.SNAPSHOT])) {
    await refreshHeaderAndSnapshot();
    if (changes[STORAGE_KEYS.SETTINGS]) {
      await scanBookmarks();
      if (currentPlan) renderPreview(currentPlan);
    }
  }
});

(async () => {
  await refreshHeaderAndSnapshot();
  setStatus(t('statusReady', {}, currentLang), 'info');
  await scanBookmarks();
})();
