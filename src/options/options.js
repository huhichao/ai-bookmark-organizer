import { testAiConnection } from '../core/ai-client.js';
import {
  DEFAULT_CLASSIFICATION_PROMPT,
  PROMPT_TEMPLATES,
  PROVIDER_PRESETS,
} from '../core/constants.js';
import { isUrlCoveredByPatterns, toOriginMatchPattern } from '../core/permissions.js';
import { clearSnapshot, getLastSnapshot } from '../core/snapshot.js';
import { loadSettings, saveSettings } from '../core/storage.js';

const el = (id) => document.getElementById(id);
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

function setStatus(msg, kind = 'info') {
  setInlineStatus('aiStatusMsg', msg, kind);
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
  select.replaceChildren();
  for (const preset of Object.values(PROVIDER_PRESETS)) {
    const opt = document.createElement('option');
    opt.value = preset.id;
    opt.textContent = preset.label;
    select.appendChild(opt);
  }
}

async function refreshSnapshotInfo() {
  const snap = await getLastSnapshot();
  if (!snap) {
    el('snapshotInfo').textContent = '暂无本地快照。首次执行书签整理时会自动生成。';
    el('btnExportSnapshot').disabled = true;
    el('btnClearSnapshot').disabled = true;
    return;
  }
  const dt = new Date(snap.createdAt).toLocaleString();
  el('snapshotInfo').textContent = `最近快照时间：${dt}（含 ${snap.totalUrls} 条书签）`;
  el('btnExportSnapshot').disabled = false;
  el('btnClearSnapshot').disabled = false;
}

function populatePromptTemplates() {
  const select = el('promptTemplate');
  select.replaceChildren();
  for (const tpl of Object.values(PROMPT_TEMPLATES)) {
    const opt = document.createElement('option');
    opt.value = tpl.id;
    opt.textContent = tpl.label;
    select.appendChild(opt);
  }
}

async function init() {
  populateProviderOptions();
  populatePromptTemplates();
  const s = await loadSettings();
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
    : DEFAULT_CLASSIFICATION_PROMPT;
  el('customPrompt').value = effectivePrompt;
  const matchedTpl = Object.values(PROMPT_TEMPLATES).find((t) => t.prompt.trim() === effectivePrompt.trim());
  if (matchedTpl) el('promptTemplate').value = matchedTpl.id;
  updateProviderFieldVisibility(s.provider);
  await refreshGrantedOrigins();
  await refreshSnapshotInfo();
}

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
    if (!form.baseUrl) return '请先填写 API Base URL（需以 http:// 或 https:// 开头）。';
    if (!getOriginPattern(form.baseUrl)) return 'API Base URL 格式无效，请以 http:// 或 https:// 开头。';
  }
  if (form.provider !== 'builtin' && !form.model) {
    return '请先填写模型名称。';
  }
  if (preset?.needsKey && !form.apiKey) {
    return '请先填写 API Key。';
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
      setInlineStatus('aiStatusMsg', '未授予目标 API 域名网络权限，请检查 Base URL 格式并允许权限请求。', 'err');
      return;
    }
    await saveSettings(form);
    setInlineStatus('aiStatusMsg', 'AI 接口配置已保存。', 'ok');
  } catch (err) {
    setInlineStatus('aiStatusMsg', `保存失败: ${err.message}`, 'err');
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
  const origLabel = btn.textContent;
  btn.disabled = true;
  btn.textContent = '测试中...';
  setInlineStatus('aiStatusMsg', '正在请求接口权限并测试连接...', 'info');
  try {
    const granted = await requestOriginPermissionIfNeeded(form);
    if (!granted) {
      setInlineStatus('aiStatusMsg', '未授予目标 API 域名网络权限，无法测试。', 'err');
      return;
    }
    setInlineStatus('aiStatusMsg', '正在发送测试请求，请稍候...', 'info');
    const reply = await testAiConnection(form);
    setInlineStatus('aiStatusMsg', `连接成功！模型响应：${reply}`, 'ok');
  } catch (err) {
    setInlineStatus('aiStatusMsg', `连接测试失败: ${err.message}`, 'err');
  } finally {
    btn.disabled = false;
    btn.textContent = origLabel;
  }
});

el('extractFrequent').addEventListener('change', (e) => {
  el('frequentConfigRow').classList.toggle('hidden', !e.target.checked);
});

el('promptTemplate').addEventListener('change', (e) => {
  const tpl = PROMPT_TEMPLATES[e.target.value];
  if (tpl) {
    el('customPrompt').value = tpl.prompt;
    setInlineStatus('rulesStatusMsg', `已加载模板「${tpl.label}」，可微调后点击「保存规则设置」。`, 'info');
  }
});

el('btnResetPrompt').addEventListener('click', () => {
  el('promptTemplate').value = 'balanced';
  el('customPrompt').value = DEFAULT_CLASSIFICATION_PROMPT;
  setInlineStatus('rulesStatusMsg', '已恢复默认分类提示词（记得点击「保存规则设置」生效）。', 'info');
});

el('btnSaveRules').addEventListener('click', async () => {
  await saveSettings({
    recentDays: Math.max(7, Number(el('recentDays').value) || 365),
    batchSize: Math.max(10, Number(el('batchSize').value) || 60),
    archiveFolderName: el('archiveFolderName').value.trim() || '历史归档',
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
    customPrompt: el('customPrompt').value.trim() || DEFAULT_CLASSIFICATION_PROMPT,
  });
  setInlineStatus('rulesStatusMsg', '整理规则与提示词已保存。', 'ok');
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
  setInlineStatus('snapshotStatusMsg', '已清除本地快照。', 'ok');
});

init();
