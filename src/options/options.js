import { testAiConnection } from '../core/ai-client.js';
import { PROVIDER_PRESETS } from '../core/constants.js';
import { clearSnapshot, getLastSnapshot } from '../core/snapshot.js';
import { loadSettings, saveSettings } from '../core/storage.js';

const el = (id) => document.getElementById(id);

function setStatus(msg) {
  el('statusMsg').textContent = msg;
}

function getOriginPattern(rawUrl) {
  try {
    const u = new URL(rawUrl);
    return `${u.origin}/*`;
  } catch {
    return null;
  }
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

async function init() {
  populateProviderOptions();
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
  el('deduplicateArchive').checked = Boolean(s.deduplicateArchive);
  el('removeEmptyFolders').checked = Boolean(s.removeEmptyFolders);
  el('stripQueryParams').checked = Boolean(s.stripQueryParams);
  el('customPromptHint').value = s.customPromptHint || '';
  updateProviderFieldVisibility(s.provider);
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

// Call chrome.permissions.request synchronously before any await to preserve user gesture
function requestOriginPermissionIfNeeded(form) {
  const preset = PROVIDER_PRESETS[form.provider];
  if (!preset?.needsUrl || !form.baseUrl) return Promise.resolve(true);
  const originPattern = getOriginPattern(form.baseUrl);
  if (!originPattern) return Promise.resolve(false);
  return chrome.permissions.request({ origins: [originPattern] });
}

el('btnSaveAi').addEventListener('click', async () => {
  const form = readAiForm();
  try {
    const granted = await requestOriginPermissionIfNeeded(form);
    if (!granted) {
      setStatus('未授予目标 API 域名网络权限，请检查 Base URL 格式并允许权限请求。');
      return;
    }
    await saveSettings(form);
    setStatus('AI 接口配置已保存。');
  } catch (err) {
    setStatus(`保存失败: ${err.message}`);
  }
});

el('btnTestAi').addEventListener('click', async () => {
  const form = readAiForm();
  try {
    const granted = await requestOriginPermissionIfNeeded(form);
    if (!granted) {
      setStatus('未授予目标 API 域名网络权限，无法测试。');
      return;
    }
    setStatus('正在测试 AI 连接...');
    const reply = await testAiConnection(form);
    setStatus(`连接成功！模型响应：${reply}`);
  } catch (err) {
    setStatus(`连接测试失败: ${err.message}`);
  }
});

el('btnSaveRules').addEventListener('click', async () => {
  await saveSettings({
    recentDays: Math.max(7, Number(el('recentDays').value) || 365),
    batchSize: Math.max(10, Number(el('batchSize').value) || 60),
    archiveFolderName: el('archiveFolderName').value.trim() || '历史归档',
    archiveLocation: el('archiveLocation').value,
    includeRootLoose: el('includeRootLoose').checked,
    deduplicateArchive: el('deduplicateArchive').checked,
    removeEmptyFolders: el('removeEmptyFolders').checked,
    stripQueryParams: el('stripQueryParams').checked,
    customPromptHint: el('customPromptHint').value.trim(),
  });
  setStatus('整理规则设置已保存。');
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
  setStatus('已清除本地快照。');
});

init();
