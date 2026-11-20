import { testAiConnection } from '../core/ai-client.js';
import { resolveScopeBehavior } from '../core/analyzer.js';
import {
  PROMPT_TEMPLATES_BY_LANG,
  PROVIDER_PRESETS,
  getDefaultPrompt,
  getPromptTemplates,
  getProviderLabel,
} from '../core/constants.js';
import {
  applyI18nToDocument,
  getLocalizedDefaults,
  resolveLanguage,
  t,
} from '../core/i18n.js';
import { isUrlCoveredByPatterns, toOriginMatchPattern } from '../core/permissions.js';
import { clearSnapshot, getLastSnapshot } from '../core/snapshot.js';
import { getProviderConfig, loadSettings, saveSettings } from '../core/storage.js';

const el = (id) => document.getElementById(id);
let currentLang = 'en';
let cachedSettings = null;
let aiSaveTimer = null;
let rulesSaveTimer = null;

let grantedOriginPatterns = (() => {
  try {
    return chrome.runtime.getManifest()?.host_permissions || [];
  } catch {
    return [];
  }
})();

async function refreshGrantedOrigins() {
  try {
    const manifestHosts = chrome.runtime.getManifest()?.host_permissions || [];
    const perms = await chrome.permissions.getAll();
    grantedOriginPatterns = [...new Set([...manifestHosts, ...(perms.origins || [])])];
  } catch {
    grantedOriginPatterns = chrome.runtime.getManifest()?.host_permissions || [];
  }
}

function setInlineStatus(targetId, msg, kind = 'info') {
  const node = el(targetId);
  if (node) {
    node.textContent = msg;
    node.className = `status-inline ${kind}`;
  }
}

function getOriginPattern(rawUrl) {
  return toOriginMatchPattern(rawUrl);
}

function clampInt(val, min, max, fallback) {
  const n = Math.round(Number(val));
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function updateProviderFieldVisibility(providerId) {
  const preset = PROVIDER_PRESETS[providerId];
  el('baseUrlField').classList.toggle('hidden', !preset?.needsUrl);
  el('apiKeyField').classList.toggle('hidden', !preset?.needsKey);
  el('modelField').classList.toggle('hidden', providerId === 'builtin');
}

function updateFrequentPanelVisibility() {
  el('frequentOptions').classList.toggle('hidden', !el('extractFrequent').checked);
}

function populateProviderOptions(lang = currentLang) {
  const select = el('provider');
  const prev = select.value;
  select.replaceChildren();
  for (const preset of Object.values(PROVIDER_PRESETS)) {
    const opt = document.createElement('option');
    opt.value = preset.id;
    opt.textContent = getProviderLabel(preset.id, lang);
    select.appendChild(opt);
  }
  if (prev) select.value = prev;
}

function populatePromptTemplates(lang) {
  const select = el('promptTemplate');
  const prev = select.value;
  select.replaceChildren();
  const templates = getPromptTemplates(lang);
  for (const tpl of Object.values(templates)) {
    const opt = document.createElement('option');
    opt.value = tpl.id;
    opt.textContent = tpl.label;
    select.appendChild(opt);
  }
  const customOpt = document.createElement('option');
  customOpt.value = '__custom__';
  customOpt.textContent = t('optPromptCustom', {}, lang);
  customOpt.disabled = true;
  select.appendChild(customOpt);

  if (prev && (templates[prev] || prev === '__custom__')) {
    select.value = prev;
  }
}

async function refreshSnapshotInfo() {
  const snap = await getLastSnapshot();
  if (!snap) {
    el('snapshotInfo').textContent = t('optSnapshotNone', {}, currentLang);
    el('btnExportSnapshot').disabled = true;
    el('btnClearSnapshot').disabled = true;
    return;
  }
  const dt = new Date(snap.createdAt).toLocaleString();
  el('snapshotInfo').textContent = t('optSnapshotInfo', { dt, count: snap.totalUrls }, currentLang);
  el('btnExportSnapshot').disabled = false;
  el('btnClearSnapshot').disabled = false;
}

function isKnownDefaultPrompt(promptText) {
  const trimmed = String(promptText || '').trim();
  if (!trimmed) return true;
  for (const group of Object.values(PROMPT_TEMPLATES_BY_LANG)) {
    for (const tpl of Object.values(group)) {
      if (tpl.prompt.trim() === trimmed) return tpl.id;
    }
  }
  return false;
}

function syncPromptTemplateSelect(promptText) {
  const matchedTplId = isKnownDefaultPrompt(promptText);
  el('promptTemplate').value = typeof matchedTplId === 'string' ? matchedTplId : '__custom__';
}

function updateToggleKeyLabel() {
  const isVisible = el('apiKey').type === 'text';
  el('btnToggleKey').textContent = t(isVisible ? 'optHideKey' : 'optShowKey', {}, currentLang);
}

async function init() {
  const s = await loadSettings();
  cachedSettings = s;
  currentLang = resolveLanguage(s.uiLanguage);
  applyI18nToDocument(currentLang);
  populateProviderOptions(currentLang);
  populatePromptTemplates(currentLang);

  el('uiLanguage').value = s.uiLanguage || 'auto';
  el('provider').value = s.provider;
  const activeCfg = getProviderConfig(s, s.provider);
  el('baseUrl').value = activeCfg.baseUrl;
  el('model').value = activeCfg.model;
  el('apiKey').value = activeCfg.apiKey;

  const behavior = resolveScopeBehavior(s);
  el('scopeMode').value = behavior.scopeMode;
  el('recentDays').value = s.recentDays;
  el('batchSize').value = s.batchSize;
  el('archiveFolderName').value = s.archiveFolderName;
  el('archiveLocation').value = s.archiveLocation;
  el('includeRootLoose').checked = Boolean(s.includeRootLoose);
  el('includeOtherBookmarks').checked = Boolean(s.includeOtherBookmarks);
  el('includeArchived').checked = Boolean(s.includeArchived);
  el('extractFrequent').checked = Boolean(s.extractFrequent);
  el('frequentFolderName').value = s.frequentFolderName;
  el('frequentMaxCount').value = s.frequentMaxCount || 12;
  el('deduplicateArchive').checked = Boolean(s.deduplicateArchive);
  el('removeEmptyFolders').checked = Boolean(s.removeEmptyFolders);
  el('stripQueryParams').checked = Boolean(s.stripQueryParams);

  const effectivePrompt = (s.customPrompt && s.customPrompt.trim())
    ? s.customPrompt
    : getDefaultPrompt(currentLang);
  el('customPrompt').value = effectivePrompt;
  syncPromptTemplateSelect(effectivePrompt);

  updateProviderFieldVisibility(s.provider);
  updateFrequentPanelVisibility();
  updateToggleKeyLabel();
  await refreshGrantedOrigins();
  updateAiAuthButtonVisibility();
  await refreshSnapshotInfo();

  if (window.location.hash === '#prompt-section') {
    const promptSection = el('prompt-section');
    promptSection?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    el('customPrompt')?.focus();
  }
}

el('btnToggleKey').addEventListener('click', () => {
  const input = el('apiKey');
  input.type = input.type === 'password' ? 'text' : 'password';
  updateToggleKeyLabel();
});

el('uiLanguage').addEventListener('change', async (e) => {
  const newUiLang = e.target.value;
  const prevLang = currentLang;
  const nextLang = resolveLanguage(newUiLang);
  currentLang = nextLang;

  const prevDefaults = getLocalizedDefaults(prevLang);
  const nextDefaults = getLocalizedDefaults(nextLang);

  const currentArchiveName = el('archiveFolderName').value.trim();
  const nextArchiveName = (!currentArchiveName || currentArchiveName === prevDefaults.archiveFolderName)
    ? nextDefaults.archiveFolderName
    : currentArchiveName;

  const currentFreqName = el('frequentFolderName').value.trim();
  const nextFreqName = (!currentFreqName || currentFreqName === prevDefaults.frequentFolderName)
    ? nextDefaults.frequentFolderName
    : currentFreqName;

  const currentPromptVal = el('customPrompt').value;
  const matchedTplId = isKnownDefaultPrompt(currentPromptVal);
  const nextPrompt = typeof matchedTplId === 'string'
    ? (getPromptTemplates(nextLang)[matchedTplId]?.prompt || getDefaultPrompt(nextLang))
    : currentPromptVal;

  applyI18nToDocument(nextLang);
  populateProviderOptions(nextLang);
  populatePromptTemplates(nextLang);
  el('archiveFolderName').value = nextArchiveName;
  el('frequentFolderName').value = nextFreqName;
  el('customPrompt').value = nextPrompt;
  syncPromptTemplateSelect(nextPrompt);
  updateToggleKeyLabel();

  cachedSettings = await saveSettings({
    uiLanguage: newUiLang,
    archiveFolderName: nextArchiveName,
    frequentFolderName: nextFreqName,
    customPrompt: nextPrompt,
  });
  await refreshSnapshotInfo();
  setInlineStatus('langStatusMsg', t('optLangSaved', {}, nextLang), 'ok');
});

function updateAiAuthButtonVisibility() {
  const form = readAiForm();
  const preset = PROVIDER_PRESETS[form.provider];
  const needsManualAuth = Boolean(
    preset?.needsUrl &&
    form.baseUrl &&
    getOriginPattern(form.baseUrl) &&
    !isUrlCoveredByPatterns(form.baseUrl, grantedOriginPatterns)
  );
  el('btnSaveAi').classList.toggle('hidden', !needsManualAuth);
}

el('provider').addEventListener('change', async (e) => {
  clearTimeout(aiSaveTimer);
  const id = e.target.value;
  const cfg = getProviderConfig(cachedSettings, id);
  el('baseUrl').value = cfg.baseUrl;
  el('model').value = cfg.model;
  el('apiKey').value = cfg.apiKey;
  el('apiKey').type = 'password';
  updateToggleKeyLabel();
  updateProviderFieldVisibility(id);
  updateAiAuthButtonVisibility();

  const form = readAiForm();
  const preset = PROVIDER_PRESETS[id];
  if (!preset?.needsUrl || !form.baseUrl || isUrlCoveredByPatterns(form.baseUrl, grantedOriginPatterns)) {
    cachedSettings = await saveSettings(form);
    if (!validateAiForm(form)) {
      setInlineStatus('aiStatusMsg', t('optSavedAiAuto', {}, currentLang), 'ok');
    } else {
      setInlineStatus('aiStatusMsg', '', 'info');
    }
  } else {
    setInlineStatus('aiStatusMsg', t('optAiNeedsAuth', {}, currentLang), 'info');
  }
});

function scheduleAutoSaveAi() {
  updateAiAuthButtonVisibility();
  clearTimeout(aiSaveTimer);
  aiSaveTimer = setTimeout(() => {
    tryAutoSaveAi();
  }, 450);
}

async function tryAutoSaveAi() {
  updateAiAuthButtonVisibility();
  const form = readAiForm();
  if (validateAiForm(form)) return;
  const preset = PROVIDER_PRESETS[form.provider];
  if (preset?.needsUrl && !isUrlCoveredByPatterns(form.baseUrl, grantedOriginPatterns)) {
    setInlineStatus('aiStatusMsg', t('optAiNeedsAuth', {}, currentLang), 'info');
    return;
  }
  cachedSettings = await saveSettings(form);
  setInlineStatus('aiStatusMsg', t('optSavedAiAuto', {}, currentLang), 'ok');
}

for (const id of ['baseUrl', 'model', 'apiKey']) {
  el(id).addEventListener('input', scheduleAutoSaveAi);
  el(id).addEventListener('change', async () => {
    clearTimeout(aiSaveTimer);
    await tryAutoSaveAi();
  });
}

function readAiForm() {
  const provider = el('provider').value;
  const preset = PROVIDER_PRESETS[provider];
  return {
    provider,
    baseUrl: preset?.needsUrl ? el('baseUrl').value.trim() : '',
    model: provider === 'builtin' ? (preset?.model || 'gemini-nano') : el('model').value.trim(),
    apiKey: preset?.needsKey ? el('apiKey').value.trim() : '',
  };
}

function validateAiForm(form) {
  const preset = PROVIDER_PRESETS[form.provider];
  if (preset?.needsUrl) {
    if (!form.baseUrl) return t('optErrEmptyUrl', {}, currentLang);
    if (!getOriginPattern(form.baseUrl)) return t('optErrInvalidUrl', {}, currentLang);
  }
  if (form.provider !== 'builtin' && !form.model) {
    return t('optErrEmptyModel', {}, currentLang);
  }
  if (preset?.needsKey && !form.apiKey) {
    return t('optErrEmptyKey', {}, currentLang);
  }
  return null;
}

// Call chrome.permissions.request synchronously before any await ONLY when origin is not already granted
async function requestOriginPermissionIfNeeded(form) {
  const preset = PROVIDER_PRESETS[form.provider];
  if (!preset?.needsUrl || !form.baseUrl) return true;
  const originPattern = getOriginPattern(form.baseUrl);
  if (!originPattern) return false;
  if (isUrlCoveredByPatterns(form.baseUrl, grantedOriginPatterns)) {
    return true;
  }
  const granted = await chrome.permissions.request({ origins: [originPattern] });
  if (granted) await refreshGrantedOrigins();
  return granted;
}

el('btnSaveAi').addEventListener('click', async () => {
  clearTimeout(aiSaveTimer);
  const form = readAiForm();
  const validationErr = validateAiForm(form);
  if (validationErr) {
    setInlineStatus('aiStatusMsg', validationErr, 'err');
    return;
  }
  const btn = el('btnSaveAi');
  btn.disabled = true;
  try {
    const granted = await requestOriginPermissionIfNeeded(form);
    if (!granted) {
      setInlineStatus('aiStatusMsg', t('optErrPermDenied', {}, currentLang), 'err');
      return;
    }
    cachedSettings = await saveSettings(form);
    updateAiAuthButtonVisibility();
    setInlineStatus('aiStatusMsg', t('optSavedAi', {}, currentLang), 'ok');
  } catch (err) {
    setInlineStatus('aiStatusMsg', t('optSaveFail', { err: err.message }, currentLang), 'err');
  } finally {
    btn.disabled = false;
  }
});

el('btnTestAi').addEventListener('click', async () => {
  clearTimeout(aiSaveTimer);
  const form = readAiForm();
  const validationErr = validateAiForm(form);
  if (validationErr) {
    setInlineStatus('aiStatusMsg', validationErr, 'err');
    return;
  }
  const btn = el('btnTestAi');
  btn.disabled = true;
  btn.textContent = t('optTestingAi', {}, currentLang);
  setInlineStatus('aiStatusMsg', t('optTestReqPerm', {}, currentLang), 'info');
  try {
    const granted = await requestOriginPermissionIfNeeded(form);
    if (!granted) {
      setInlineStatus('aiStatusMsg', t('optErrTestPermDenied', {}, currentLang), 'err');
      return;
    }
    updateAiAuthButtonVisibility();
    setInlineStatus('aiStatusMsg', t('optTestSending', {}, currentLang), 'info');
    const reply = await testAiConnection(
      { ...form, uiLanguage: currentLang },
      { onProgress: (msg) => setInlineStatus('aiStatusMsg', msg, 'info') }
    );
    cachedSettings = await saveSettings(form);
    setInlineStatus('aiStatusMsg', t('optTestOk', { reply }, currentLang), 'ok');
  } catch (err) {
    setInlineStatus('aiStatusMsg', t('optTestFail', { err: err.message }, currentLang), 'err');
  } finally {
    btn.disabled = false;
    btn.textContent = t('optBtnTestAi', {}, currentLang);
  }
});

function readRulesForm() {
  const locDefaults = getLocalizedDefaults(currentLang);
  return {
    scopeMode: el('scopeMode').value,
    recentDays: clampInt(el('recentDays').value, 7, 3650, 365),
    batchSize: clampInt(el('batchSize').value, 10, 150, 60),
    archiveFolderName: el('archiveFolderName').value.trim() || locDefaults.archiveFolderName,
    archiveLocation: el('archiveLocation').value,
    includeRootLoose: el('includeRootLoose').checked,
    includeOtherBookmarks: el('includeOtherBookmarks').checked,
    includeArchived: el('includeArchived').checked,
    extractFrequent: el('extractFrequent').checked,
    frequentFolderName: el('frequentFolderName').value.trim() || locDefaults.frequentFolderName,
    frequentMaxCount: clampInt(el('frequentMaxCount').value, 3, 30, 12),
    deduplicateArchive: el('deduplicateArchive').checked,
    removeEmptyFolders: el('removeEmptyFolders').checked,
    stripQueryParams: el('stripQueryParams').checked,
    customPrompt: el('customPrompt').value.trim() || getDefaultPrompt(currentLang),
  };
}

async function saveCurrentRules({ statusKey = 'optRulesAutoSaved', vars = {} } = {}) {
  clearTimeout(rulesSaveTimer);
  updateFrequentPanelVisibility();
  const next = readRulesForm();
  syncPromptTemplateSelect(el('customPrompt').value);
  cachedSettings = await saveSettings(next);
  setInlineStatus('rulesStatusMsg', t(statusKey, vars, currentLang), 'ok');
}

function scheduleAutoSaveRules() {
  clearTimeout(rulesSaveTimer);
  syncPromptTemplateSelect(el('customPrompt').value);
  rulesSaveTimer = setTimeout(() => {
    saveCurrentRules({ statusKey: 'optRulesAutoSaved' });
  }, 450);
}

for (const id of [
  'scopeMode',
  'archiveLocation',
  'includeRootLoose',
  'includeOtherBookmarks',
  'includeArchived',
  'extractFrequent',
  'deduplicateArchive',
  'removeEmptyFolders',
  'stripQueryParams',
]) {
  el(id).addEventListener('change', () => saveCurrentRules());
}

for (const id of [
  'recentDays',
  'batchSize',
  'archiveFolderName',
  'frequentFolderName',
  'frequentMaxCount',
  'customPrompt',
]) {
  el(id).addEventListener('input', scheduleAutoSaveRules);
  el(id).addEventListener('change', () => saveCurrentRules());
}

el('promptTemplate').addEventListener('change', async (e) => {
  const tpl = getPromptTemplates(currentLang)[e.target.value];
  if (tpl) {
    el('customPrompt').value = tpl.prompt;
    await saveCurrentRules({ statusKey: 'optTplLoaded', vars: { label: tpl.label } });
  }
});

el('btnResetPrompt').addEventListener('click', async () => {
  el('promptTemplate').value = 'balanced';
  el('customPrompt').value = getDefaultPrompt(currentLang);
  await saveCurrentRules({ statusKey: 'optPromptReset' });
});

el('btnExportSnapshot').addEventListener('click', async () => {
  const snap = await getLastSnapshot();
  if (!snap) return;
  const blob = new Blob([JSON.stringify(snap, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `bookmarks-snapshot-${new Date(snap.createdAt).toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
});

const confirmClearDialog = el('confirmClearDialog');

// Light-dismiss fallback when <dialog closedby="any"> is unsupported
if (!('closedBy' in HTMLDialogElement.prototype) && confirmClearDialog) {
  const outside = (e, dialog) => {
    const r = dialog.getBoundingClientRect();
    return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
  };
  let pressedOutside = false;
  confirmClearDialog.addEventListener('pointerdown', (e) => {
    pressedOutside = outside(e, confirmClearDialog);
  });
  confirmClearDialog.addEventListener('pointerup', (e) => {
    if (pressedOutside && outside(e, confirmClearDialog)) confirmClearDialog.close();
  });
}

// Fallback for Chrome <135 where declarative command/commandfor is not yet supported
if (!('commandForElement' in HTMLButtonElement.prototype)) {
  el('btnClearSnapshot').addEventListener('click', () => {
    confirmClearDialog.showModal();
  });
}

confirmClearDialog.addEventListener('close', async () => {
  const choice = confirmClearDialog.returnValue;
  confirmClearDialog.returnValue = '';
  if (choice !== 'confirm') return;
  await clearSnapshot();
  await refreshSnapshotInfo();
  setInlineStatus('snapshotStatusMsg', t('optSnapCleared', {}, currentLang), 'ok');
});

init();
