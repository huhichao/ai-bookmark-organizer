import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve('.');
const ASSETS_DIR = process.env.ABO_SHOT_DIR || path.join(os.tmpdir(), 'abo-e2e-shots');
fs.mkdirSync(ASSETS_DIR, { recursive: true });

function findChromium() {
  const pwRoot = path.join(process.env.LOCALAPPDATA || '', 'ms-playwright');
  if (fs.existsSync(pwRoot)) {
    const dirs = fs.readdirSync(pwRoot).filter((d) => d.startsWith('chromium-')).sort().reverse();
    for (const d of dirs) {
      const exe = path.join(pwRoot, d, 'chrome-win64', 'chrome.exe');
      if (fs.existsSync(exe)) return exe;
    }
  }
  throw new Error('Playwright Chromium binary not found under %LOCALAPPDATA%\\ms-playwright');
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      srv.close(() => resolve(addr.port));
    });
    srv.on('error', reject);
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class CdpClient {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.nextId = 1;
    this.pending = new Map();
    this.events = [];
  }

  async connect() {
    await new Promise((resolve, reject) => {
      this.ws.addEventListener('open', resolve, { once: true });
      this.ws.addEventListener('error', reject, { once: true });
    });
    this.ws.addEventListener('message', (evt) => {
      const msg = JSON.parse(String(evt.data));
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message || JSON.stringify(msg.error)));
        else resolve(msg.result);
      } else if (msg.method) {
        this.events.push(msg);
      }
    });
  }

  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async eval(expression) {
    const res = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (res.exceptionDetails) {
      throw new Error(
        res.exceptionDetails.exception?.description ||
          res.exceptionDetails.text ||
          'Runtime evaluation failed'
      );
    }
    return res.result?.value;
  }

  close() {
    try {
      this.ws.close();
    } catch {}
  }
}

async function waitForTargets(port, predicate, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const list = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json());
      const found = list.find(predicate);
      if (found) return found;
    } catch {}
    await sleep(250);
  }
  throw new Error('Timed out waiting for CDP target');
}

async function renderSidepanelStoreFrame(cdp, panelPngBase64, lang) {
  const isEn = lang === 'en';
  const title = isEn ? 'AI Bookmark Organizer' : 'AI 书签整理助手';
  const subtitle = isEn
    ? 'Organize bookmarks cleanly in Chrome Side Panel'
    : '在 Chrome 右侧边栏高效整理与归档书签';
  const pills = isEn
    ? ['AI Tools & Chat', 'Dev & Tech', 'Ops & Network', 'Frequent', 'Archive']
    : ['AI 对话与工具', '开发与技术', '运维与网络', '常用', '历史归档'];
  const bullets = isEn
    ? [
        'Smart categorization via Built-in AI, BYOK API, or No-Key Web AI',
        'Keep recent bookmarks organized, archive old folders safely',
        'Auto-dedup, clean garbled titles & one-click snapshot undo',
      ]
    : [
        '支持 Chrome 内置 AI、自定义大模型 API 与免 Key 网页 AI 模式',
        '近期常用书签智能归类，早期旧书签完整移入「历史归档」',
        '自动去重、清理乱码标题，支持整理前快照一键撤销',
      ];

  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8" />
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    width: 1280px; height: 800px; overflow: hidden;
    font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
    background: linear-gradient(135deg, #eff6ff 0%, #f8fafc 55%, #eef2ff 100%);
    display: flex; align-items: center; justify-content: center;
    padding: 24px;
  }
  .browser {
    width: 1232px; height: 752px;
    background: #ffffff;
    border-radius: 14px;
    border: 1px solid #cbd5e1;
    box-shadow: 0 24px 60px rgba(15, 23, 42, 0.14);
    display: flex; flex-direction: column; overflow: hidden;
  }
  .chrome-bar {
    height: 44px; background: #f1f5f9; border-bottom: 1px solid #e2e8f0;
    display: flex; align-items: center; gap: 12px; padding: 0 16px;
  }
  .dots { display: flex; gap: 7px; }
  .dot { width: 11px; height: 11px; border-radius: 50%; background: #cbd5e1; }
  .dot.r { background: #fca5a5; } .dot.y { background: #fcd34d; } .dot.g { background: #86efac; }
  .omnibox {
    flex: 1; height: 28px; background: #ffffff; border: 1px solid #e2e8f0;
    border-radius: 999px; display: flex; align-items: center; padding: 0 14px;
    color: #64748b; font-size: 12px;
  }
  .bookmarks-bar {
    height: 34px; background: #ffffff; border-bottom: 1px solid #e2e8f0;
    display: flex; align-items: center; gap: 8px; padding: 0 14px;
  }
  .bm-pill {
    font-size: 12px; font-weight: 600; color: #334155;
    background: #f8fafc; border: 1px solid #e2e8f0;
    border-radius: 6px; padding: 3px 10px;
  }
  .bm-pill.archive { color: #64748b; margin-left: auto; }
  .workspace { flex: 1; display: flex; min-height: 0; }
  .left-hero {
    flex: 1; padding: 56px 52px; display: flex; flex-direction: column; justify-content: center;
    background: radial-gradient(circle at top left, #eff6ff 0%, #ffffff 70%);
    border-right: 1px solid #e2e8f0;
  }
  .badge {
    display: inline-block; align-self: flex-start;
    background: #dbeafe; color: #1d4ed8; font-size: 12px; font-weight: 700;
    padding: 4px 12px; border-radius: 999px; margin-bottom: 16px;
  }
  .left-hero h1 { font-size: 36px; line-height: 1.2; color: #0f172a; margin-bottom: 14px; }
  .left-hero p { font-size: 17px; color: #475569; margin-bottom: 28px; }
  .list { list-style: none; display: flex; flex-direction: column; gap: 14px; }
  .list li {
    display: flex; align-items: flex-start; gap: 10px;
    font-size: 15px; color: #1e293b; line-height: 1.5;
  }
  .check {
    flex-shrink: 0; width: 22px; height: 22px; border-radius: 50%;
    background: #2563eb; color: #fff; font-size: 13px; font-weight: 700;
    display: inline-flex; align-items: center; justify-content: center; margin-top: 1px;
  }
  .sidepanel-dock {
    width: 400px; height: 100%; background: #f8fafc;
    display: flex; align-items: flex-start; justify-content: center;
    overflow: hidden;
  }
  .sidepanel-dock img { width: 400px; height: auto; display: block; }
</style>
</head>
<body>
  <div class="browser">
    <div class="chrome-bar">
      <div class="dots"><span class="dot r"></span><span class="dot y"></span><span class="dot g"></span></div>
      <div class="omnibox">chrome://bookmarks — ${title}</div>
    </div>
    <div class="bookmarks-bar">
      ${pills.map((p, idx) => `<span class="bm-pill${idx === pills.length - 1 ? ' archive' : ''}">📁 ${p}</span>`).join('')}
    </div>
    <div class="workspace">
      <div class="left-hero">
        <span class="badge">Chrome Manifest V3 · Side Panel</span>
        <h1>${title}</h1>
        <p>${subtitle}</p>
        <ul class="list">
          ${bullets.map((b) => `<li><span class="check">✓</span><span>${b}</span></li>`).join('')}
        </ul>
      </div>
      <div class="sidepanel-dock">
        <img src="data:image/png;base64,${panelPngBase64}" />
      </div>
    </div>
  </div>
</body>
</html>`;

  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 1280,
    height: 800,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await cdp.send('Page.setDocumentContent', {
    frameId: (await cdp.send('Page.getFrameTree')).frameTree.frame.id,
    html,
  });
  await sleep(200);
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
  return Buffer.from(shot.data, 'base64');
}

async function openTab(port, url, width = 1280, height = 800) {
  const target = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`, {
    method: 'PUT',
  }).then((r) => r.json());
  const cdp = new CdpClient(target.webSocketDebuggerUrl);
  await cdp.connect();
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await sleep(600);
  return { target, cdp };
}

async function main() {
  const chromeExe = findChromium();
  const port = await getFreePort();
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'abo-e2e-'));

  console.log('[e2e] Launching Chromium:', chromeExe);
  const mockServer = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] }));
  });
  await new Promise((r) => mockServer.listen(0, '127.0.0.1', r));
  const mockPort = mockServer.address().port;

  const proc = spawn(
    chromeExe,
    [
      '--headless=new',
      '--no-sandbox',
      '--disable-gpu',
      '--disable-crash-reporter',
      '--no-first-run',
      '--no-default-browser-check',
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profileDir}`,
      `--load-extension=${ROOT}`,
      '--window-size=1280,800',
      'about:blank',
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] }
  );
  let stderrBuf = '';
  proc.stderr.on('data', (d) => { stderrBuf += d.toString(); });

  const consoleErrors = [];

  try {
    const swTarget = await waitForTargets(
      port,
      (t) => t.type === 'service_worker' && t.url.includes('service-worker.js')
    );
    const extId = new URL(swTarget.url).hostname;
    console.log('[e2e] Extension loaded, ID:', extId);

    // 1. Open Options page, seed bookmarks, test UI & take Screenshot 2
    const optionsUrl = `chrome-extension://${extId}/src/options/options.html`;
    const { cdp: optCdp } = await openTab(port, optionsUrl);

    const optErrors = await optCdp.eval(`
      (async () => {
        const providerCount = document.querySelectorAll('#provider option').length;
        if (providerCount < 5) throw new Error('Expected >= 5 providers, got ' + providerCount);
        return { providerCount, title: document.title, lang: document.documentElement.lang };
      })()
    `);
    console.log('[e2e] Options page verified:', optErrors);

    // Switch UI language explicitly to zh_CN for deterministic Chinese flow & verify live switch
    await optCdp.eval(`
      (async () => {
        document.getElementById('uiLanguage').value = 'zh_CN';
        document.getElementById('uiLanguage').dispatchEvent(new Event('change'));
        await new Promise((r) => setTimeout(r, 150));
      })()
    `);

    // Verify Test Connection validation & real mock request on Options page
    const testEmptyKeyMsg = await optCdp.eval(`
      (() => {
        document.getElementById('btnTestAi').click();
        return document.getElementById('aiStatusMsg').textContent;
      })()
    `);
    assert.ok(testEmptyKeyMsg.includes('API Key'), `Expected API Key hint, got: ${testEmptyKeyMsg}`);

    const testMockMsg = await optCdp.eval(`
      (async () => {
        document.getElementById('provider').value = 'ollama';
        document.getElementById('provider').dispatchEvent(new Event('change'));
        document.getElementById('baseUrl').value = 'http://127.0.0.1:${mockPort}/v1';
        document.getElementById('model').value = 'test-model';
        document.getElementById('btnTestAi').click();
        for (let i = 0; i < 30; i++) {
          const t = document.getElementById('aiStatusMsg').textContent || '';
          if (t.includes('连接成功') || t.includes('失败')) return t;
          await new Promise((r) => setTimeout(r, 100));
        }
        return document.getElementById('aiStatusMsg').textContent;
      })()
    `);
    console.log('[e2e] Options Test Connection result:', testMockMsg);
    assert.ok(testMockMsg.includes('连接成功'), `Expected connection success, got: ${testMockMsg}`);

    // Verify switching to English updates DOM labels & capture clean English Options screenshot, then restore zh_CN
    const enSwitchOk = await optCdp.eval(`
      (async () => {
        document.getElementById('provider').value = 'deepseek';
        document.getElementById('provider').dispatchEvent(new Event('change'));
        document.getElementById('aiStatusMsg').textContent = '';
        document.getElementById('uiLanguage').value = 'en';
        document.getElementById('uiLanguage').dispatchEvent(new Event('change'));
        await new Promise((r) => setTimeout(r, 150));
        document.getElementById('langStatusMsg').textContent = '';
        return {
          enBtn: document.getElementById('btnTestAi').textContent,
          enArchive: document.getElementById('archiveFolderName').value,
        };
      })()
    `);
    const optShotEn = await optCdp.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(ASSETS_DIR, 'store-screenshot-2-en.png'), Buffer.from(optShotEn.data, 'base64'));
    console.log('[e2e] Saved assets/store-screenshot-2-en.png (1280x800)');

    const zhBackBtn = await optCdp.eval(`
      (async () => {
        document.getElementById('uiLanguage').value = 'zh_CN';
        document.getElementById('uiLanguage').dispatchEvent(new Event('change'));
        await new Promise((r) => setTimeout(r, 150));
        document.getElementById('langStatusMsg').textContent = '';
        return document.getElementById('btnTestAi').textContent;
      })()
    `);
    console.log('[e2e] Language switch verified:', { ...enSwitchOk, zhBtn: zhBackBtn });
    assert.equal(enSwitchOk.enBtn, 'Test Connection');
    assert.equal(enSwitchOk.enArchive, 'Archive');
    assert.equal(zhBackBtn, '测试连接');

    // Verify custom prompt field, template selector, and reset button work
    const promptOk = await optCdp.eval(`
      (() => {
        const ta = document.getElementById('customPrompt');
        const sel = document.getElementById('promptTemplate');
        if (!ta.value.includes('分类原则')) throw new Error('Expected default prompt pre-filled');
        if (sel.options.length < 4) throw new Error('Expected >= 4 prompt templates');
        sel.value = 'minimal_top';
        sel.dispatchEvent(new Event('change'));
        if (!ta.value.includes('常用置顶')) throw new Error('Expected minimal_top template loaded');
        document.getElementById('btnResetPrompt').click();
        return ta.value.includes('AI 对话与工具');
      })()
    `);
    assert.equal(promptOk, true);

    // Reset back to DeepSeek preset before screenshot
    await optCdp.eval(`
      (() => {
        document.getElementById('provider').value = 'deepseek';
        document.getElementById('provider').dispatchEvent(new Event('change'));
        document.getElementById('aiStatusMsg').textContent = '';
      })()
    `);

    const optShot = await optCdp.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(ASSETS_DIR, 'store-screenshot-2.png'), Buffer.from(optShot.data, 'base64'));
    console.log('[e2e] Saved assets/store-screenshot-2.png (1280x800)');

    // Seed realistic bookmarks via chrome.bookmarks in extension context
    const seededIds = await optCdp.eval(`
      (async () => {
        const tree = await chrome.bookmarks.getTree();
        const barId = tree[0].children[0].id;
        // Clear any default bookmarks on bar
        for (const ch of [...(tree[0].children[0].children || [])]) {
          if (ch.url) await chrome.bookmarks.remove(ch.id);
          else await chrome.bookmarks.removeTree(ch.id);
        }
        const b1 = await chrome.bookmarks.create({ parentId: barId, title: 'Claude', url: 'https://claude.ai/new' });
        const b2 = await chrome.bookmarks.create({ parentId: barId, title: '\\u200c\\ufeff通往 AGI 之路', url: 'https://waytoagi.feishu.cn/wiki/demo' });
        const b3 = await chrome.bookmarks.create({ parentId: barId, title: 'React 中文文档', url: 'https://zh-hans.react.dev/learn' });
        const b4 = await chrome.bookmarks.create({ parentId: barId, title: '1Panel 运维面板', url: 'https://1panel.cn/' });
        const b5 = await chrome.bookmarks.create({ parentId: barId, title: '2026新春采购季', url: 'https://cloud.tencent.com/act/pro/spring2026' });
        const oldDir = await chrome.bookmarks.create({ parentId: barId, title: '早期资料' });
        await chrome.bookmarks.create({ parentId: oldDir.id, title: 'Java教程', url: 'https://java-old.example.com/' });
        await chrome.bookmarks.create({ parentId: oldDir.id, title: 'Java教程重复', url: 'https://java-old.example.com/' });
        await chrome.bookmarks.create({ parentId: oldDir.id, title: '空文件夹' });
        return { b1: b1.id, b2: b2.id, b3: b3.id, b4: b4.id, b5: b5.id };
      })()
    `);
    console.log('[e2e] Seeded test bookmarks:', seededIds);
    for (const ev of optCdp.events) {
      if (ev.method === 'Runtime.exceptionThrown') consoleErrors.push(ev.params);
    }
    optCdp.close();

    // 2. Open Side Panel page at authentic 400x674 vertical sidebar size, scan, parse AI JSON, screenshot, apply & undo
    const sidepanelUrl = `chrome-extension://${extId}/src/sidepanel/sidepanel.html`;
    const { cdp: spCdp } = await openTab(port, sidepanelUrl, 400, 674);
    await sleep(500);

    const scanStats = await spCdp.eval(`
      (async () => {
        document.getElementById('btnScan').click();
        await new Promise((r) => setTimeout(r, 250));
        return {
          total: document.getElementById('statTotal').textContent,
          active: document.getElementById('statActive').textContent,
          dup: document.getElementById('statDup').textContent,
          empty: document.getElementById('statEmpty').textContent,
        };
      })()
    `);
    console.log('[e2e] SidePanel scan stats:', scanStats);
    assert.equal(scanStats.total, '7');
    assert.equal(scanStats.dup, '1');
    assert.equal(scanStats.empty, '1');

    const manualPlan = {
      folders: ['AI 对话与工具', '开发与技术', '运维与网络'],
      assignments: [
        { id: seededIds.b1, folder: 'AI 对话与工具' },
        { id: seededIds.b2, folder: 'AI 对话与工具', rename: '通往 AGI 之路' },
        { id: seededIds.b3, folder: '开发与技术' },
        { id: seededIds.b4, folder: '运维与网络' },
        { id: seededIds.b5, folder: '__TEMP__' },
      ],
    };

    const previewRes = await spCdp.eval(`
      (() => {
        const box = document.getElementById('manualBox');
        const initialDisplay = getComputedStyle(box).display;
        if (initialDisplay !== 'none') {
          throw new Error('Expected manualBox to start hidden, got: ' + initialDisplay);
        }
        document.getElementById('tabManualMode').click();
        const toggledDisplay = getComputedStyle(box).display;
        if (toggledDisplay !== 'flex') {
          throw new Error('Expected manualBox to become flex after tab click, got: ' + toggledDisplay);
        }
        document.getElementById('manualJsonInput').value = ${JSON.stringify(JSON.stringify(manualPlan))};
        document.getElementById('btnParseManual').click();
        return {
          summary: document.getElementById('previewSummary').textContent,
          folderTitles: [...document.querySelectorAll('#previewTree .folder-title')].map((e) => e.textContent),
          applyDisabled: document.getElementById('btnApply').disabled,
        };
      })()
    `);
    console.log('[e2e] Preview rendered:', previewRes);
    assert.equal(previewRes.applyDisabled, false);
    assert.ok(previewRes.folderTitles.some((t) => t.startsWith('AI 对话与工具')));

    const spShot = await spCdp.send('Page.captureScreenshot', { format: 'png' });

    // Capture English SidePanel screenshot too (at 400x674)
    const manualPlanEn = {
      folders: ['AI Tools & Chat', 'Dev & Tech', 'Ops & Network'],
      assignments: [
        { id: seededIds.b1, folder: 'AI Tools & Chat' },
        { id: seededIds.b2, folder: 'AI Tools & Chat', rename: 'Way to AGI' },
        { id: seededIds.b3, folder: 'Dev & Tech' },
        { id: seededIds.b4, folder: 'Ops & Network' },
        { id: seededIds.b5, folder: '__TEMP__' },
      ],
    };
    await spCdp.eval(`
      (async () => {
        await chrome.storage.local.set({
          abo_settings_v1: {
            ...(await chrome.storage.local.get('abo_settings_v1')).abo_settings_v1,
            uiLanguage: 'en',
            archiveFolderName: 'Archive',
            frequentFolderName: 'Frequent',
          }
        });
        await new Promise((r) => setTimeout(r, 150));
        document.getElementById('manualJsonInput').value = ${JSON.stringify(JSON.stringify(manualPlanEn))};
        document.getElementById('btnParseManual').click();
      })()
    `);
    const spShotEn = await spCdp.send('Page.captureScreenshot', { format: 'png' });

    // Composite authentic 400px-wide vertical Side Panel onto 1280x800 Chrome showcase tabs
    const { cdp: frameCdp } = await openTab(port, 'about:blank', 1280, 800);
    fs.writeFileSync(
      path.join(ASSETS_DIR, 'store-screenshot-1.png'),
      await renderSidepanelStoreFrame(frameCdp, spShot.data, 'zh_CN')
    );
    console.log('[e2e] Saved assets/store-screenshot-1.png (1280x800 with 400px Side Panel)');
    fs.writeFileSync(
      path.join(ASSETS_DIR, 'store-screenshot-1-en.png'),
      await renderSidepanelStoreFrame(frameCdp, spShotEn.data, 'en')
    );
    console.log('[e2e] Saved assets/store-screenshot-1-en.png (1280x800 with 400px Side Panel)');
    frameCdp.close();

    // Switch back to zh_CN before Chinese apply/undo assertions
    await spCdp.eval(`
      (async () => {
        await chrome.storage.local.set({
          abo_settings_v1: {
            ...(await chrome.storage.local.get('abo_settings_v1')).abo_settings_v1,
            uiLanguage: 'zh_CN',
            archiveFolderName: '历史归档',
            frequentFolderName: '常用',
          }
        });
        await new Promise((r) => setTimeout(r, 150));
        document.getElementById('manualJsonInput').value = ${JSON.stringify(JSON.stringify(manualPlan))};
        document.getElementById('btnParseManual').click();
      })()
    `);

    // Apply plan in real Chromium
    const afterApply = await spCdp.eval(`
      (async () => {
        document.getElementById('btnApply').click();
        for (let i = 0; i < 30; i++) {
          const txt = document.getElementById('statusText').textContent || '';
          if (txt.includes('整理完成')) break;
          await new Promise((r) => setTimeout(r, 150));
        }
        const tree = await chrome.bookmarks.getTree();
        const bar = tree[0].children[0];
        return {
          status: document.getElementById('statusText').textContent,
          barFolders: bar.children.map((c) => ({ title: c.title, count: (c.children || []).length })),
          undoDisabled: document.getElementById('btnUndo').disabled,
        };
      })()
    `);
    console.log('[e2e] After apply:', JSON.stringify(afterApply));
    assert.ok(afterApply.status.includes('整理完成'));
    assert.equal(afterApply.undoDisabled, false);
    assert.ok(afterApply.barFolders.some((f) => f.title === '历史归档'));

    // Undo and verify snapshot restore
    const afterUndo = await spCdp.eval(`
      (async () => {
        document.getElementById('btnUndo').click();
        for (let i = 0; i < 30; i++) {
          const txt = document.getElementById('statusText').textContent || '';
          if (txt.includes('已恢复')) break;
          await new Promise((r) => setTimeout(r, 150));
        }
        const tree = await chrome.bookmarks.getTree();
        const bar = tree[0].children[0];
        return {
          status: document.getElementById('statusText').textContent,
          barChildCount: bar.children.length,
        };
      })()
    `);
    console.log('[e2e] After undo:', afterUndo);
    assert.ok(afterUndo.status.includes('已恢复'));
    assert.equal(afterUndo.barChildCount, 6); // 5 loose URLs + 1 folder '早期资料'

    for (const ev of spCdp.events) {
      if (ev.method === 'Runtime.exceptionThrown') consoleErrors.push(ev.params);
    }
    spCdp.close();

    assert.equal(consoleErrors.length, 0, `Unexpected runtime exceptions: ${JSON.stringify(consoleErrors)}`);
    console.log('[e2e] ALL REAL CHROMIUM E2E CHECKS PASSED!');
  } finally {
    if (stderrBuf) console.log('[e2e:chrome-stderr]', stderrBuf.slice(-500));
    try {
      mockServer.close();
    } catch {}
    try {
      proc.kill('SIGTERM');
    } catch {}
    await sleep(400);
    fs.rmSync(profileDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error('[e2e] FAILED:', err);
  process.exit(1);
});
