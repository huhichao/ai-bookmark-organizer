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

async function openTab(port, url) {
  const target = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`, {
    method: 'PUT',
  }).then((r) => r.json());
  const cdp = new CdpClient(target.webSocketDebuggerUrl);
  await cdp.connect();
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 1280,
    height: 800,
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
        return { providerCount, title: document.title };
      })()
    `);
    console.log('[e2e] Options page verified:', optErrors);

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

    // 2. Open Side Panel page, scan, parse AI JSON, screenshot, apply & undo
    const sidepanelUrl = `chrome-extension://${extId}/src/sidepanel/sidepanel.html`;
    const { cdp: spCdp } = await openTab(port, sidepanelUrl);
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
    fs.writeFileSync(path.join(ASSETS_DIR, 'store-screenshot-1.png'), Buffer.from(spShot.data, 'base64'));
    console.log('[e2e] Saved assets/store-screenshot-1.png (1280x800)');

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
