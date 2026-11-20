import { analyzeBookmarkTree } from '../core/analyzer.js';
import { applyOrganizationPlan } from '../core/applier.js';
import { PROVIDER_PRESETS, STORAGE_KEYS } from '../core/constants.js';
import {
  buildManualPromptBundle,
  buildPlanFromAiResponse,
  generateAiOrganizationPlan,
} from '../core/planner.js';
import { getLastSnapshot, restoreLastSnapshot } from '../core/snapshot.js';
import { loadSettings } from '../core/storage.js';

let currentAnalysis = null;
let currentPlan = null;
let currentSettings = null;

const el = (id) => document.getElementById(id);

function setStatus(msg, kind = 'info') {
  const node = el('statusText');
  node.textContent = msg;
  node.className = `status-banner ${kind}`;
}

async function refreshHeaderAndSnapshot() {
  currentSettings = await loadSettings();
  const preset = PROVIDER_PRESETS[currentSettings.provider];
  const label = preset ? preset.label : currentSettings.provider;
  el('modelBadge').textContent = `${label} · ${currentSettings.model || '未指定模型'}`;

  const snap = await getLastSnapshot();
  el('btnUndo').disabled = !snap;
}

async function scanBookmarks() {
  currentSettings = await loadSettings();
  const tree = await chrome.bookmarks.getTree();
  currentAnalysis = analyzeBookmarkTree(tree, {
    recentDays: currentSettings.recentDays,
    includeRootLoose: currentSettings.includeRootLoose,
    archiveFolderName: currentSettings.archiveFolderName,
  });

  const { stats } = currentAnalysis;
  el('statTotal').textContent = String(stats.totalUrls);
  el('statActive').textContent = String(stats.activeCount);
  el('statDup').textContent = String(stats.duplicateCount);
  el('statEmpty').textContent = String(stats.emptyFolderCount);
  el('scanNote').textContent =
    `近期/书签栏待归类 ${stats.activeCount} 条，其余 ${stats.historicalCount} 条将保留在「${currentSettings.archiveFolderName}」。`;
}

function renderPreview(plan) {
  currentPlan = plan;
  el('previewBox').classList.remove('hidden');
  el('btnApply').disabled = false;

  const activeTotal = plan.folders.reduce((s, f) => s + f.items.length, 0);
  el('previewSummary').textContent =
    `新建/复用 ${plan.folders.length} 个主题文件夹（${activeTotal} 条），` +
    `临时链接 ${plan.tempItems.length} 条，去重 ${plan.duplicateRemovals.length} 条。`;

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
      more.textContent = `... 还有 ${folder.items.length - 8} 条`;
      ul.appendChild(more);
    }
    box.appendChild(ul);
    treeContainer.appendChild(box);
  }

  if (plan.tempItems.length > 0) {
    const box = document.createElement('div');
    box.className = 'folder-group';
    const title = document.createElement('div');
    title.className = 'folder-title';
    title.textContent = `${plan.archiveFolderName} / 临时与一次性链接 (${plan.tempItems.length})`;
    box.appendChild(title);
    treeContainer.appendChild(box);
  }
}

el('btnOpenOptions').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

el('btnScan').addEventListener('click', async () => {
  try {
    setStatus('正在扫描书签...', 'loading');
    await scanBookmarks();
    setStatus('扫描完成，可点击「AI 智能分类预览」或使用「免 Key 提示词模式」。', 'ok');
  } catch (err) {
    setStatus(`扫描失败: ${err.message}`, 'err');
  }
});

el('btnAiPlan').addEventListener('click', async () => {
  if (!currentAnalysis) await scanBookmarks();
  const preset = PROVIDER_PRESETS[currentSettings.provider];
  if (preset?.needsKey && !currentSettings.apiKey) {
    setStatus('未检测到 API Key：请点击右上角「设置」填写，或使用「免 Key 提示词模式」。', 'err');
    return;
  }

  const btn = el('btnAiPlan');
  const origText = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'AI 分类中...';
  setStatus('正在连接 AI 生成分类方案，请稍候...', 'loading');
  try {
    const plan = await generateAiOrganizationPlan(
      currentAnalysis,
      currentSettings,
      (msg) => setStatus(msg, 'loading')
    );
    renderPreview(plan);
    setStatus('AI 分类预览已生成！请在下方核对后点击「应用整理方案」。', 'ok');
  } catch (err) {
    setStatus(`AI 生成失败: ${err.message}`, 'err');
  } finally {
    btn.disabled = false;
    btn.textContent = origText;
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
  setStatus('已切换到 API 自动分类模式。', 'info');
});

el('tabManualMode').addEventListener('click', () => {
  switchPlanMode('manual');
  setStatus('已切换到免 Key 网页 AI 模式：按 1 → 2 → 3 步骤操作即可。', 'info');
});

el('btnCopyPrompt').addEventListener('click', async () => {
  if (!currentAnalysis) await scanBookmarks();
  const promptText = buildManualPromptBundle(currentAnalysis, currentSettings);
  await navigator.clipboard.writeText(promptText);
  const btn = el('btnCopyPrompt');
  const orig = btn.textContent;
  btn.textContent = '已复制 ✓';
  setTimeout(() => { btn.textContent = orig; }, 1500);
  setStatus(`已复制 ${currentAnalysis.activeItems.length} 条脱敏书签及提示词，请粘贴给网页版 AI。`, 'ok');
});

el('btnParseManual').addEventListener('click', async () => {
  if (!currentAnalysis) await scanBookmarks();
  try {
    const raw = el('manualJsonInput').value;
    const plan = buildPlanFromAiResponse(currentAnalysis, raw, currentSettings);
    renderPreview(plan);
    setStatus('JSON 解析成功！请在下方预览确认后点击「应用整理方案」。', 'ok');
  } catch (err) {
    setStatus(`JSON 解析失败: ${err.message}`, 'err');
  }
});

el('btnApply').addEventListener('click', async () => {
  if (!currentPlan) return;
  const btn = el('btnApply');
  const orig = btn.textContent;
  btn.disabled = true;
  btn.textContent = '正在整理...';
  try {
    const result = await applyOrganizationPlan(currentPlan, (msg) => setStatus(msg, 'loading'));
    await scanBookmarks();
    await refreshHeaderAndSnapshot();
    setStatus(
      `整理完成！已归类 ${result.movedActive} 条、临时链接 ${result.movedTemp} 条、` +
      `归档旧文件夹 ${result.archivedOldFolders} 个、去重 ${result.removedDuplicates} 条、清理空文件夹 ${result.removedEmpty} 个。`,
      'ok'
    );
  } catch (err) {
    setStatus(`应用失败: ${err.message}`, 'err');
  } finally {
    btn.disabled = false;
    btn.textContent = orig;
  }
});

el('btnUndo').addEventListener('click', async () => {
  const btn = el('btnUndo');
  const orig = btn.textContent;
  btn.disabled = true;
  btn.textContent = '正在恢复...';
  try {
    setStatus('正在从快照恢复书签...', 'loading');
    await restoreLastSnapshot();
    await scanBookmarks();
    setStatus('已恢复到整理前的书签状态。', 'ok');
  } catch (err) {
    setStatus(`恢复失败: ${err.message}`, 'err');
  } finally {
    btn.textContent = orig;
    await refreshHeaderAndSnapshot();
  }
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'local' && (changes[STORAGE_KEYS.SETTINGS] || changes[STORAGE_KEYS.SNAPSHOT])) {
    refreshHeaderAndSnapshot();
  }
});

(async () => {
  await refreshHeaderAndSnapshot();
  await scanBookmarks();
})();
