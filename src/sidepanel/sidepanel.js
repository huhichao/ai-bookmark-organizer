import { analyzeBookmarkTree } from '../core/analyzer.js';
import { applyOrganizationPlan } from '../core/applier.js';
import { PROVIDER_PRESETS } from '../core/constants.js';
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

function setStatus(msg) {
  el('statusText').textContent = msg;
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
    setStatus('正在扫描书签...');
    await scanBookmarks();
    setStatus('扫描完成。');
  } catch (err) {
    setStatus(`扫描失败: ${err.message}`);
  }
});

el('btnAiPlan').addEventListener('click', async () => {
  if (!currentAnalysis) await scanBookmarks();
  const preset = PROVIDER_PRESETS[currentSettings.provider];
  if (preset?.needsKey && !currentSettings.apiKey) {
    setStatus('请先在「设置」页面配置 API Key，或使用「免 Key 提示词模式」。');
    return;
  }

  el('btnAiPlan').disabled = true;
  try {
    const plan = await generateAiOrganizationPlan(
      currentAnalysis,
      currentSettings,
      (msg) => setStatus(msg)
    );
    renderPreview(plan);
    setStatus('AI 分类预览已生成，确认无误后点击「应用整理方案」。');
  } catch (err) {
    setStatus(`AI 生成失败: ${err.message}`);
  } finally {
    el('btnAiPlan').disabled = false;
  }
});

el('btnToggleManual').addEventListener('click', () => {
  el('manualBox').classList.toggle('hidden');
});

el('btnCopyPrompt').addEventListener('click', async () => {
  if (!currentAnalysis) await scanBookmarks();
  const promptText = buildManualPromptBundle(currentAnalysis, currentSettings);
  await navigator.clipboard.writeText(promptText);
  setStatus(`已复制 ${currentAnalysis.activeItems.length} 条脱敏书签及提示词，请粘贴给网页版 AI。`);
});

el('btnParseManual').addEventListener('click', async () => {
  if (!currentAnalysis) await scanBookmarks();
  try {
    const raw = el('manualJsonInput').value;
    const plan = buildPlanFromAiResponse(currentAnalysis, raw, currentSettings);
    renderPreview(plan);
    setStatus('JSON 解析成功！请在下方预览确认后应用。');
  } catch (err) {
    setStatus(`JSON 解析失败: ${err.message}`);
  }
});

el('btnApply').addEventListener('click', async () => {
  if (!currentPlan) return;
  el('btnApply').disabled = true;
  try {
    const result = await applyOrganizationPlan(currentPlan, (msg) => setStatus(msg));
    await scanBookmarks();
    await refreshHeaderAndSnapshot();
    setStatus(
      `整理完成！已归类 ${result.movedActive} 条、临时链接 ${result.movedTemp} 条、` +
      `归档旧文件夹 ${result.archivedOldFolders} 个、去重 ${result.removedDuplicates} 条、清理空文件夹 ${result.removedEmpty} 个。`
    );
  } catch (err) {
    setStatus(`应用失败: ${err.message}`);
  } finally {
    el('btnApply').disabled = false;
  }
});

el('btnUndo').addEventListener('click', async () => {
  el('btnUndo').disabled = true;
  try {
    setStatus('正在从快照恢复书签...');
    await restoreLastSnapshot();
    await scanBookmarks();
    setStatus('已恢复到整理前的书签状态。');
  } catch (err) {
    setStatus(`恢复失败: ${err.message}`);
  } finally {
    await refreshHeaderAndSnapshot();
  }
});

(async () => {
  await refreshHeaderAndSnapshot();
  await scanBookmarks();
})();
