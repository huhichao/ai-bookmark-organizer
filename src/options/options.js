import { testAiConnection } from '../core/ai-client.js';
import {
  PROMPT_TEMPLATES_BY_LANG,
  PROVIDER_PRESETS,
  getDefaultPrompt,
  getPromptTemplates,
} from '../core/constants.js';
import {
  applyI18nToDocument,
  getLocalizedDefaults,
  resolveLanguage,
  t,
} from '../core/i18n.js';
import { isUrlCoveredByPatterns, toOriginMatchPattern } from '../core/permissions.js';
import { clearSnapshot, getLastSnapshot } from '../core/snapshot.js';
import { loadSettings, saveSettings } from '../core/storage.js';

const el = (id) => document.getElementById(id);
let currentLang = 'en';

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
  if (el('statusMsg')) {
    el('statusMsg').textContent = msg;
  }
}

function getOriginPattern(rawUrl) {
  return toOriginMatchPattern(rawUrl);
}

function updateProviderFieldVisibility(providerId) {
  const preset = PROVIDER_PRESETS[providerId];
  el('baseUrlField').classList.toggle('hidden', !preset?.needsUrl);
  el('apiKeyField').classList.toggle('hidden', !preset?.needsKey);
  el('modelField').classList.toggle('hidden', providerId === 'builtin');
}

function populateProviderOptions() {
  const select = el('provider');
  const prev = select.value;
  select.replaceChildren();
  for (const preset of Object.values(PROVIDER_PRESETS)) {
    const opt = document.createElement('option');
    opt.value = preset.id;
    opt.textContent = preset.label;
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
  if (prev && templates[prev]) select.value = prev;
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

async function init() {
  populateProviderOptions();
  const s = await loadSettings();
  currentLang = resolveLanguage(s.uiLanguage);
  applyI18nToDocument(currentLang);
  populatePromptTemplates(currentLang);

  el('uiLanguage').value = s.uiLanguage || 'auto';
  el('provider').value = s.provider;
  el('baseUrl').value = s.baseUrl;
  el('model').value = s.model;
  el('apiKey').value = s.apiKey;
  el('recentDays').value = s.recentDays;
  el('batchSize').value = s.batchSize;
  el('archiveFolderName').value = s.archiveFolderName;
  el('archiveLocation').value = s.archiveLocation;
  el('includeRootLoose').checked = Boolean(s.includeRootLoose);
  el('includeArchived').checked = Boolean(s.includeArchived);
  el('ignoreDateCutoff').checked = Boolean(s.ignoreDateCutoff);
  el('extractFrequent').checked = Boolean(s.extractFrequent);
  el('frequentDays').value = s.frequentDays || 90;
  el('frequentMaxCount').value = s.frequentMaxCount || 12;
  el('frequentConfigRow').classList.toggle('hidden', !s.extractFrequent);
  el('deduplicateArchive').checked = Boolean(s.deduplicateArchive);
  el('removeEmptyFolders').checked = Boolean(s.removeEmptyFolders);
  el('stripQueryParams').checked = Boolean(s.stripQueryParams);

  const effectivePrompt = (s.customPrompt && s.customPrompt.trim())
    ? s.customPrompt
    : getDefaultPrompt(currentLang);
  el('customPrompt').value = effectivePrompt;
  const matchedTplId = isKnownDefaultPrompt(effectivePrompt);
  if (typeof matchedTplId === 'string') {
    el('promptTemplate').value = matchedTplId;
  }

  updateProviderFieldVisibility(s.provider);
  await refreshGrantedOrigins();
  await refreshSnapshotInfo();
}

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

  const currentPromptVal = el('customPrompt').value;
  const matchedTplId = isKnownDefaultPrompt(currentPromptVal);
  const nextPrompt = typeof matchedTplId === 'string'
    ? (getPromptTemplates(nextLang)[matchedTplId]?.prompt || getDefaultPrompt(nextLang))
    : currentPromptVal;

  applyI18nToDocument(nextLang);
  populatePromptTemplates(nextLang);
  el('archiveFolderName').value = nextArchiveName;
  el('customPrompt').value = nextPrompt;
  if (typeof matchedTplId === 'string') {
    el('promptTemplate').value = matchedTplId;
  }

  await saveSettings({
    uiLanguage: newUiLang,
    archiveFolderName: nextArchiveName,
    frequentFolderName: nextDefaults.frequentFolderName,
    customPrompt: nextPrompt,
  });
  await refreshSnapshotInfo();
  setInlineStatus('langStatusMsg', t('optLangSaved', {}, nextLang), 'ok');
});

el('provider').addEventListener('change', (e) => {
  const id = e.target.value;
  const preset = PROVIDER_PRESETS[id];
  if (preset) {
    el('baseUrl').value = preset.baseUrl;
    el('model').value = preset.model;
  }
  updateProviderFieldVisibility(id);
});

function readAiForm() {
  return {
    provider: el('provider').value,
    baseUrl: el('baseUrl').value.trim(),
    model: el('model').value.trim(),
    apiKey: el('apiKey').value.trim(),
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
    await saveSettings(form);
    setInlineStatus('aiStatusMsg', t('optSavedAi', {}, currentLang), 'ok');
  } catch (err) {
    setInlineStatus('aiStatusMsg', t('optSaveFail', { err: err.message }, currentLang), 'err');
  } finally {
    btn.disabled = false;
  }
});

el('btnTestAi').addEventListener('click', async () => {
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
    setInlineStatus('aiStatusMsg', t('optTestSending', {}, currentLang), 'info');
    const reply = await testAiConnection(form);
    setInlineStatus('aiStatusMsg', t('optTestOk', { reply }, currentLang), 'ok');
  } catch (err) {
    setInlineStatus('aiStatusMsg', t('optTestFail', { err: err.message }, currentLang), 'err');
  } finally {
    btn.disabled = false;
    btn.textContent = t('optBtnTestAi', {}, currentLang);
  }
});

el('extractFrequent').addEventListener('change', (e) => {
  el('frequentConfigRow').classList.toggle('hidden', !e.target.checked);
});

el('promptTemplate').addEventListener('change', (e) => {
  const tpl = getPromptTemplates(currentLang)[e.target.value];
  if (tpl) {
    el('customPrompt').value = tpl.prompt;
    setInlineStatus('rulesStatusMsg', t('optTplLoaded', { label: tpl.label }, currentLang), 'info');
  }
});

el('btnResetPrompt').addEventListener('click', () => {
  el('promptTemplate').value = 'balanced';
  el('customPrompt').value = getDefaultPrompt(currentLang);
  setInlineStatus('rulesStatusMsg', t('optPromptReset', {}, currentLang), 'info');
});

el('btnSaveRules').addEventListener('click', async () => {
  const locDefaults = getLocalizedDefaults(currentLang);
  await saveSettings({
    recentDays: Math.max(7, Number(el('recentDays').value) || 365),
    batchSize: Math.max(10, Number(el('batchSize').value) || 60),
    archiveFolderName: el('archiveFolderName').value.trim() || locDefaults.archiveFolderName,
    archiveLocation: el('archiveLocation').value,
    includeRootLoose: el('includeRootLoose').checked,
    includeArchived: el('includeArchived').checked,
    ignoreDateCutoff: el('ignoreDateCutoff').checked,
    extractFrequent: el('extractFrequent').checked,
    frequentDays: Math.max(7, Number(el('frequentDays').value) || 90),
    frequentMaxCount: Math.max(3, Math.min(30, Number(el('frequentMaxCount').value) || 12)),
    deduplicateArchive: el('deduplicateArchive').checked,
    removeEmptyFolders: el('removeEmptyFolders').checked,
    stripQueryParams: el('stripQueryParams').checked,
    customPrompt: el('customPrompt').value.trim() || getDefaultPrompt(currentLang),
  });
  setInlineStatus('rulesStatusMsg', t('optRulesSaved', {}, currentLang), 'ok');
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

el('btnClearSnapshot').addEventListener('click', async () => {
  await clearSnapshot();
  await refreshSnapshotInfo();
  setInlineStatus('snapshotStatusMsg', t('optSnapCleared', {}, currentLang), 'ok');
});

init();
