import { analyzeBookmarkTree, resolveScopeBehavior } from '../core/analyzer.js';
import { applyOrganizationPlan } from '../core/applier.js';
import { PROVIDER_PRESETS, STORAGE_KEYS, getProviderLabel } from '../core/constants.js';
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
let lastStatusSpec = null;
let activePlanAbortController = null;
let isBusy = false;

const el = (id) => document.getElementById(id);

function setStatus(msg, kind = 'info') {
  lastStatusSpec = null;
  const node = el('statusText');
  node.textContent = msg;
  node.className = `status-banner ${kind}`;
}

function setStatusKey(key, vars = {}, kind = 'info') {
  lastStatusSpec = { key, vars, kind };
  const node = el('statusText');
  node.textContent = t(key, vars, currentLang);
  node.className = `status-banner ${kind}`;
}

function clearPreview() {
  currentPlan = null;
  el('previewBox').classList.add('hidden');
  el('previewTree').replaceChildren();
  el('previewSummary').textContent = '';
  el('previewNotes').classList.add('hidden');
  el('previewNotes').textContent = '';
  el('btnApply').disabled = true;
  el('btnTogglePreviewAll').setAttribute('aria-expanded', 'false');
}

function updateToggleAllButtonState() {
  const items = el('previewTree').querySelectorAll(':scope > details');
  const allOpen = items.length > 0 && Array.prototype.every.call(items, (d) => d.open);
  el('btnTogglePreviewAll').setAttribute('aria-expanded', String(allOpen));
}

function updateApiActionUi() {
  if (!currentSettings) return;
  const preset = PROVIDER_PRESETS[currentSettings.provider];
  const activeCount = currentAnalysis?.stats?.activeCount ?? 0;
  const needsKeyNow = Boolean(preset?.needsKey && !currentSettings.apiKey && activeCount > 0);
  el('apiKeyNotice').classList.toggle('hidden', !needsKeyNow);

  if (!isBusy) {
    el('btnAiPlan').textContent = activeCount === 0
      ? t('btnLocalPlan', {}, currentLang)
      : t('btnAiPlan', {}, currentLang);
  }

  const largeWarn = el('manualLargeWarn');
  if (activeCount > 100) {
    largeWarn.textContent = t('manualLargeWarn', { count: activeCount }, currentLang);
    largeWarn.classList.remove('hidden');
  } else {
    largeWarn.classList.add('hidden');
  }
}

async function refreshHeaderAndSnapshot() {
  currentSettings = await loadSettings();
  currentLang = resolveLanguage(currentSettings.uiLanguage);
  applyI18nToDocument(currentLang);

  const label = getProviderLabel(currentSettings.provider, currentLang);
  el('modelBadge').textContent = `${label} · ${currentSettings.model || t('modelUnset', {}, currentLang)}`;

  const behavior = resolveScopeBehavior(currentSettings);
  el('quickScopeMode').value = behavior.scopeMode;
  el('quickIncludeArchived').checked = Boolean(currentSettings.includeArchived);
  el('quickIncludeOther').checked = Boolean(currentSettings.includeOtherBookmarks);
  el('quickExtractFrequent').checked = Boolean(currentSettings.extractFrequent);

  const snap = await getLastSnapshot();
  el('btnUndo').disabled = !snap || isBusy;
  const undoMeta = el('undoMeta');
  if (snap) {
    const dt = new Date(snap.createdAt).toLocaleString();
    undoMeta.textContent = t('undoSnapMeta', { dt, count: snap.totalUrls }, currentLang);
    undoMeta.classList.remove('hidden');
  } else {
    undoMeta.classList.add('hidden');
  }
  updateApiActionUi();
}

async function scanBookmarks() {
  currentSettings = await loadSettings();
  currentLang = resolveLanguage(currentSettings.uiLanguage);
  const locDefaults = getLocalizedDefaults(currentLang);
  const behavior = resolveScopeBehavior(currentSettings);
  const tree = await chrome.bookmarks.getTree();
  currentAnalysis = analyzeBookmarkTree(tree, {
    scopeMode: behavior.scopeMode,
    recentDays: currentSettings.recentDays,
    includeRootLoose: currentSettings.includeRootLoose,
    includeOtherBookmarks: Boolean(currentSettings.includeOtherBookmarks),
    includeArchived: Boolean(currentSettings.includeArchived),
    archiveFolderName: currentSettings.archiveFolderName || locDefaults.archiveFolderName,
  });

  const { stats } = currentAnalysis;
  el('statTotal').textContent = String(stats.totalUrls);
  el('statActive').textContent = String(stats.activeCount);
  el('statDup').textContent = String(stats.duplicateCount);
  el('statEmpty').textContent = String(stats.emptyFolderCount);
  const freqFolderName = currentSettings.frequentFolderName || locDefaults.frequentFolderName;
  const freqPart = currentSettings.extractFrequent
    ? t('scanNoteFreqAi', {
        frequentFolder: freqFolderName,
        maxCount: currentSettings.frequentMaxCount || 12,
      }, currentLang)
    : '';
  const noteKey = behavior.onlyRecent
    ? 'scanNoteMainKeep'
    : behavior.shouldArchiveNonRecent
      ? 'scanNoteMain'
      : 'scanNoteAllToAi';
  el('scanNote').textContent = t(noteKey, {
    freqPart,
    activeCount: stats.activeCount,
    historicalCount: stats.historicalCount,
    archiveFolder: currentSettings.archiveFolderName || locDefaults.archiveFolderName,
  }, currentLang);

  updateApiActionUi();
}

function buildBookmarkListElement(items) {
  const ul = document.createElement('ul');
  ul.className = 'folder-items';
  for (const item of items) {
    const li = document.createElement('li');
    if (item.rename && item.rename !== item.title) {
      const oldSpan = document.createElement('span');
      oldSpan.className = 'rename-old';
      oldSpan.textContent = item.title || item.url;
      const arrow = document.createTextNode(' → ');
      const newSpan = document.createElement('span');
      newSpan.className = 'rename-new';
      newSpan.textContent = item.rename;
      li.append(oldSpan, arrow, newSpan);
    } else {
      li.textContent = item.title || item.url;
    }
    ul.appendChild(li);
  }
  return ul;
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

  const notes = [];
  if (plan.unassignedCount > 0) {
    notes.push(
      t('previewUnassignedNote', {
        count: plan.unassignedCount,
        folder: plan.fallbackFolderName,
      }, currentLang)
    );
  }
  if (plan.archiveNonRecent && plan.historicalItems?.length > 0) {
    notes.push(
      t('previewHistoricalNote', {
        count: plan.historicalItems.length,
        archiveFolder: plan.archiveFolderName,
      }, currentLang)
    );
  }
  const notesEl = el('previewNotes');
  if (notes.length > 0) {
    notesEl.textContent = notes.join(' ');
    notesEl.classList.remove('hidden');
  } else {
    notesEl.classList.add('hidden');
  }

  const treeContainer = el('previewTree');
  treeContainer.replaceChildren();

  plan.folders.forEach((folder, idx) => {
    const details = document.createElement('details');
    details.className = 'folder-group';
    if (idx < 2) details.open = true;

    const summary = document.createElement('summary');
    summary.className = 'folder-title';
    summary.textContent = `${folder.name} (${folder.items.length})`;
    details.appendChild(summary);
    details.appendChild(buildBookmarkListElement(folder.items));
    treeContainer.appendChild(details);
  });

  if (plan.tempItems.length > 0) {
    const locDefaults = getLocalizedDefaults(currentLang);
    const details = document.createElement('details');
    details.className = 'folder-group temp-group';
    details.open = true;

    const summary = document.createElement('summary');
    summary.className = 'folder-title';
    summary.textContent = `${t('tempFolderPath', {
      archiveFolder: plan.archiveFolderName,
      tempFolder: plan.tempFolderName || locDefaults.tempFolderName,
    }, currentLang)} (${plan.tempItems.length})`;
    details.appendChild(summary);
    details.appendChild(buildBookmarkListElement(plan.tempItems));
    treeContainer.appendChild(details);
  }

  if (plan.duplicateRemovals.length > 0) {
    const details = document.createElement('details');
    details.className = 'folder-group dup-group';

    const summary = document.createElement('summary');
    summary.className = 'folder-title';
    summary.textContent = `${t('previewDupTitle', {}, currentLang)} (${plan.duplicateRemovals.length})`;
    details.appendChild(summary);

    const ul = document.createElement('ul');
    ul.className = 'folder-items';
    for (const dup of plan.duplicateRemovals) {
      const li = document.createElement('li');
      const titleText = document.createTextNode(dup.title || dup.url);
      li.appendChild(titleText);
      if (dup.path) {
        const pathSpan = document.createElement('span');
        pathSpan.className = 'dup-path';
        pathSpan.textContent = ` (${dup.path})`;
        li.appendChild(pathSpan);
      }
      ul.appendChild(li);
    }
    details.appendChild(ul);
    treeContainer.appendChild(details);
  }

  updateToggleAllButtonState();
}

el('previewTree').addEventListener('toggle', (event) => {
  if (event.target instanceof HTMLDetailsElement) {
    updateToggleAllButtonState();
  }
}, { capture: true });

el('btnTogglePreviewAll').addEventListener('click', () => {
  const btn = el('btnTogglePreviewAll');
  const expand = btn.getAttribute('aria-expanded') !== 'true';
  for (const details of el('previewTree').querySelectorAll(':scope > details')) {
    details.open = expand;
  }
  updateToggleAllButtonState();
});

function openOptionsAt(hash = '') {
  if (!hash) {
    chrome.runtime.openOptionsPage();
    return;
  }
  const url = chrome.runtime.getURL(`src/options/options.html${hash}`);
  chrome.tabs?.create ? chrome.tabs.create({ url }) : window.open(url, '_blank');
}

el('btnOpenOptions').addEventListener('click', () => openOptionsAt());
el('btnNoticeSettings').addEventListener('click', () => openOptionsAt());
el('btnEditPrompt').addEventListener('click', () => openOptionsAt('#prompt-section'));

async function handleScopeChange() {
  clearPreview();
  await saveSettings({
    scopeMode: el('quickScopeMode').value,
    includeArchived: el('quickIncludeArchived').checked,
    includeOtherBookmarks: el('quickIncludeOther').checked,
    extractFrequent: el('quickExtractFrequent').checked,
  });
  await scanBookmarks();
  const locDefaults = getLocalizedDefaults(currentLang);
  const freqFolderName = currentSettings.frequentFolderName || locDefaults.frequentFolderName;
  const freqPart = currentSettings.extractFrequent
    ? t('scanNoteFreqAi', {
        frequentFolder: freqFolderName,
        maxCount: currentSettings.frequentMaxCount || 12,
      }, currentLang)
    : '';
  setStatusKey('statusScopeUpdated', {
    freqPart,
    activeCount: currentAnalysis.stats.activeCount,
  }, 'info');
}

el('quickScopeMode').addEventListener('change', handleScopeChange);
el('quickIncludeArchived').addEventListener('change', handleScopeChange);
el('quickIncludeOther').addEventListener('change', handleScopeChange);
el('quickExtractFrequent').addEventListener('change', handleScopeChange);

el('btnScan').addEventListener('click', async () => {
  try {
    clearPreview();
    setStatusKey('statusScanning', {}, 'loading');
    await scanBookmarks();
    setStatusKey('statusScanDone', {}, 'ok');
  } catch (err) {
    setStatusKey('statusScanFail', { err: err.message }, 'err');
  }
});

el('btnAiPlan').addEventListener('click', async () => {
  if (!currentAnalysis) await scanBookmarks();

  const behavior = resolveScopeBehavior(currentSettings);
  const hasLocalCleanupWork = Boolean(
    currentAnalysis.frequentItems.length > 0 ||
    (currentSettings.deduplicateArchive !== false && currentAnalysis.duplicateRemovals.length > 0) ||
    (currentSettings.removeEmptyFolders !== false && currentAnalysis.emptyFolders.length > 0) ||
    (behavior.shouldArchiveNonRecent && currentAnalysis.historicalItems.length > 0)
  );

  // If no bookmarks need AI classification, build local cleanup/archive plan directly without an API key
  if (currentAnalysis.activeItems.length === 0) {
    if (!hasLocalCleanupWork) {
      setStatusKey('statusNothingToOrganize', {}, 'info');
      return;
    }
    const localPlan = buildPlanFromAiResponse(
      currentAnalysis,
      { folders: [], assignments: [] },
      currentSettings
    );
    renderPreview(localPlan);
    setStatusKey('statusLocalPreviewDone', {}, 'ok');
    return;
  }

  const preset = PROVIDER_PRESETS[currentSettings.provider];
  if (preset?.needsKey && !currentSettings.apiKey) {
    setStatusKey('statusMissingKey', {}, 'err');
    return;
  }

  const btn = el('btnAiPlan');
  const stopBtn = el('btnStopAiPlan');
  activePlanAbortController = new AbortController();
  const { signal } = activePlanAbortController;

  isBusy = true;
  btn.disabled = true;
  btn.textContent = t('btnAiPlanning', {}, currentLang);
  stopBtn.classList.remove('hidden');
  stopBtn.disabled = false;
  stopBtn.textContent = t('btnStopAiPlan', {}, currentLang);
  setStatusKey('statusAiRunning', {}, 'loading');
  try {
    const plan = await generateAiOrganizationPlan(
      currentAnalysis,
      currentSettings,
      (msg) => setStatus(msg, 'loading'),
      { signal }
    );
    renderPreview(plan);
    setStatusKey('statusAiDone', {}, 'ok');
  } catch (err) {
    if (err?.name === 'AbortError' || signal.aborted) {
      setStatusKey('statusAiStopped', {}, 'info');
    } else {
      setStatusKey('statusAiFail', { err: err.message }, 'err');
    }
  } finally {
    isBusy = false;
    activePlanAbortController = null;
    stopBtn.classList.add('hidden');
    stopBtn.disabled = true;
    btn.disabled = false;
    updateApiActionUi();
  }
});

el('btnStopAiPlan').addEventListener('click', () => {
  if (!activePlanAbortController) return;
  const stopBtn = el('btnStopAiPlan');
  stopBtn.disabled = true;
  stopBtn.textContent = t('btnStopping', {}, currentLang);
  setStatusKey('statusAiStopping', {}, 'loading');
  activePlanAbortController.abort();
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
  setStatusKey('statusSwitchedApi', {}, 'info');
});

el('tabManualMode').addEventListener('click', () => {
  switchPlanMode('manual');
  setStatusKey('statusSwitchedManual', {}, 'info');
});

el('btnNoticeManual').addEventListener('click', () => {
  switchPlanMode('manual');
  setStatusKey('statusSwitchedManual', {}, 'info');
});

el('btnCopyPrompt').addEventListener('click', async () => {
  try {
    if (!currentAnalysis) await scanBookmarks();
    if (currentAnalysis.activeItems.length === 0) {
      setStatusKey('statusCopyEmpty', {}, 'info');
      return;
    }
    const promptText = buildManualPromptBundle(currentAnalysis, currentSettings);
    await navigator.clipboard.writeText(promptText);
    const btn = el('btnCopyPrompt');
    btn.textContent = t('btnCopied', {}, currentLang);
    setTimeout(() => { btn.textContent = t('btnCopyPrompt', {}, currentLang); }, 1500);
    setStatusKey('statusCopied', { count: currentAnalysis.activeItems.length }, 'ok');
  } catch (err) {
    setStatusKey('statusCopyFail', { err: err.message }, 'err');
  }
});

el('btnParseManual').addEventListener('click', async () => {
  if (!currentAnalysis) await scanBookmarks();
  try {
    const raw = el('manualJsonInput').value;
    const plan = buildPlanFromAiResponse(currentAnalysis, raw, currentSettings);
    renderPreview(plan);
    setStatusKey('statusJsonOk', {}, 'ok');
  } catch (err) {
    setStatusKey('statusJsonFail', { err: err.message }, 'err');
  }
});

el('btnApply').addEventListener('click', async () => {
  if (!currentPlan || isBusy) return;
  const planToApply = currentPlan;
  const btn = el('btnApply');
  isBusy = true;
  btn.disabled = true;
  el('btnUndo').disabled = true;
  btn.textContent = t('btnApplying', {}, currentLang);
  try {
    const result = await applyOrganizationPlan(planToApply, (msg) => setStatus(msg, 'loading'));
    // Invalidate applied plan so a second click can never overwrite the pre-apply snapshot
    clearPreview();
    await scanBookmarks();
    await refreshHeaderAndSnapshot();
    setStatusKey('statusApplyDone', result, 'ok');
  } catch (err) {
    btn.disabled = false;
    setStatusKey('statusApplyFail', { err: err.message }, 'err');
  } finally {
    isBusy = false;
    btn.textContent = t('btnApply', {}, currentLang);
    await refreshHeaderAndSnapshot();
  }
});

el('btnUndo').addEventListener('click', async () => {
  if (isBusy) return;
  const btn = el('btnUndo');
  isBusy = true;
  btn.disabled = true;
  el('btnApply').disabled = true;
  btn.textContent = t('btnUndoing', {}, currentLang);
  try {
    setStatusKey('statusUndoing', {}, 'loading');
    await restoreLastSnapshot(currentSettings?.uiLanguage);
    clearPreview();
    await scanBookmarks();
    setStatusKey('statusUndoDone', {}, 'ok');
  } catch (err) {
    setStatusKey('statusUndoFail', { err: err.message }, 'err');
  } finally {
    isBusy = false;
    btn.textContent = t('btnUndo', {}, currentLang);
    await refreshHeaderAndSnapshot();
  }
});

chrome.storage.onChanged.addListener(async (changes, areaName) => {
  if (areaName !== 'local') return;
  if (changes[STORAGE_KEYS.SETTINGS] || changes[STORAGE_KEYS.SNAPSHOT]) {
    const prevSettings = changes[STORAGE_KEYS.SETTINGS]?.oldValue;
    const nextSettings = changes[STORAGE_KEYS.SETTINGS]?.newValue;
    await refreshHeaderAndSnapshot();
    if (changes[STORAGE_KEYS.SETTINGS]) {
      const scopeChanged =
        prevSettings &&
        nextSettings &&
        (prevSettings.scopeMode !== nextSettings.scopeMode ||
          prevSettings.recentDays !== nextSettings.recentDays ||
          prevSettings.includeRootLoose !== nextSettings.includeRootLoose ||
          prevSettings.includeOtherBookmarks !== nextSettings.includeOtherBookmarks ||
          prevSettings.includeArchived !== nextSettings.includeArchived ||
          prevSettings.extractFrequent !== nextSettings.extractFrequent ||
          prevSettings.frequentDays !== nextSettings.frequentDays ||
          prevSettings.frequentMaxCount !== nextSettings.frequentMaxCount ||
          prevSettings.archiveFolderName !== nextSettings.archiveFolderName ||
          prevSettings.deduplicateArchive !== nextSettings.deduplicateArchive);
      await scanBookmarks();
      if (scopeChanged) {
        clearPreview();
      } else if (currentPlan) {
        renderPreview(currentPlan);
      }
      if (lastStatusSpec) {
        setStatusKey(lastStatusSpec.key, lastStatusSpec.vars, lastStatusSpec.kind);
      }
    }
  }
});

(async () => {
  await refreshHeaderAndSnapshot();
  setStatusKey('statusReady', {}, 'info');
  await scanBookmarks();
})();
