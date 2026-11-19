/**
 * 游戏助手 · 后台脚本
 * 点击工具栏图标或按 Alt+G 时，通知当前标签页切换面板显示。
 * 如果页面在扩展安装/刷新之前就已打开（没有 content script），先按需注入再切换。
 */

const TOGGLE_MESSAGE = { __gameToolBg: true, type: 'togglePanel' };

async function sendToggle(tabId) {
  try {
    await chrome.tabs.sendMessage(tabId, TOGGLE_MESSAGE);
    return true;
  } catch (error) {
    return false;
  }
}

async function injectScripts(tabId) {
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['page-inject.js'], world: 'MAIN' });
  } catch (error) {
    /* chrome:// 等页面无法注入，忽略 */
  }
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'], world: 'ISOLATED' });
  } catch (error) {
    /* ignore */
  }
}

async function togglePanel(tab) {
  if (!tab || typeof tab.id !== 'number' || tab.id < 0) return;
  const ok = await sendToggle(tab.id);
  if (!ok) {
    await injectScripts(tab.id);
    // 注入后给面板一点初始化时间
    setTimeout(() => sendToggle(tab.id), 120);
  }
}

chrome.action.onClicked.addListener((tab) => {
  togglePanel(tab);
});

chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command !== 'toggle-panel') return;
  if (tab && typeof tab.id === 'number') {
    await togglePanel(tab);
    return;
  }
  // 部分 Chrome 版本的 onCommand 不传 tab 参数，这里兜底查询当前标签页
  try {
    const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (active) await togglePanel(active);
  } catch (error) {
    /* ignore */
  }
});

// ---------------- 真实输入（调试器） ----------------
// 部分游戏会忽略合成事件，这时通过 chrome.debugger 发送 CDP 输入事件（isTrusted=true）。
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function ensureAttached(tabId) {
  try {
    await chrome.debugger.attach({ tabId }, '1.3');
    return;
  } catch (error) {
    const message = String((error && error.message) || error);
    if (/already attached/i.test(message)) return;
    throw new Error(`无法连接调试器：${message.split('\n')[0]}（请确认没有打开 DevTools）`);
  }
}

async function dispatchTrustedClicks(tabId, { x, y, count, intervalMs, pointerType }) {
  const total = Math.max(1, Math.min(50, Number(count) || 0));
  const interval = Math.max(0, Math.min(500, Number(intervalMs) || 0));
  const useTouch = pointerType === 'touch';
  await ensureAttached(tabId);
  try {
    for (let i = 0; i < total; i += 1) {
      if (useTouch) {
        await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchTouchEvent', {
          type: 'touchStart',
          touchPoints: [{ x, y, id: 1, radiusX: 2, radiusY: 2, force: 1 }],
        });
        await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      } else {
        await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', buttons: 0 });
        await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
        await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
      }
      if (i < total - 1 && interval > 0) await sleep(interval);
    }
    return { ok: true, count: total };
  } finally {
    try {
      await chrome.debugger.detach({ tabId });
    } catch (error) {
      /* ignore */
    }
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.__gameToolBg !== true || message.type !== 'trustedClicks') return false;
  const tabId = sender.tab && sender.tab.id;
  if (typeof tabId !== 'number') {
    sendResponse({ ok: false, error: '没有找到当前标签页' });
    return false;
  }
  dispatchTrustedClicks(tabId, message)
    .then((result) => sendResponse(result))
    .catch((error) => sendResponse({ ok: false, error: String((error && error.message) || error) }));
  return true;
});

// ---------------- 检查更新（代码仓库） ----------------
const DEFAULT_UPDATE_VERSION_URL = 'https://raw.githubusercontent.com/vibewei/game-tool-extension/main/version.json';
const DEFAULT_UPDATE_PAGE_URL = 'https://github.com/vibewei/game-tool-extension/releases/latest';

function compareVersions(a, b) {
  const pa = String(a || '0').split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b || '0').split('.').map((n) => parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i += 1) {
    const da = pa[i] || 0;
    const db = pb[i] || 0;
    if (da > db) return 1;
    if (da < db) return -1;
  }
  return 0;
}

async function checkExtensionUpdate() {
  const current = chrome.runtime.getManifest().version;
  let config = {};
  try {
    const stored = await chrome.storage.local.get(['gameToolUpdateConfig']);
    config = stored.gameToolUpdateConfig || {};
  } catch (error) {
    config = {};
  }
  const versionUrl = config.versionUrl || DEFAULT_UPDATE_VERSION_URL;
  let pageUrl = config.pageUrl || DEFAULT_UPDATE_PAGE_URL;
  try {
    const response = await fetch(versionUrl, { cache: 'no-store' });
    if (!response.ok) throw new Error('HTTP ' + response.status);
    const text = (await response.text()).trim();
    let latest = '';
    let zipUrl = '';
    try {
      const json = JSON.parse(text);
      latest = String(json.version || '').trim();
      if (json.pageUrl) pageUrl = String(json.pageUrl);
      if (json.zipUrl) zipUrl = String(json.zipUrl);
    } catch (error) {
      latest = (text.split(/\s+/)[0] || '').replace(/^"|"$/g, '');
    }
    if (!latest) throw new Error('未读取到版本号');
    return { current, latest, hasUpdate: compareVersions(latest, current) > 0, pageUrl, zipUrl };
  } catch (error) {
    return { current, error: String((error && error.message) || error) };
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.__gameToolBg !== true) return false;
  if (message.type === 'checkUpdate') {
    checkExtensionUpdate()
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ error: String((error && error.message) || error) }));
    return true;
  }
  if (message.type === 'openUpdatePage') {
    const url = String(message.url || '');
    if (!/^https:\/\//i.test(url)) {
      sendResponse({ ok: false, error: '地址不合法' });
      return false;
    }
    chrome.tabs
      .create({ url })
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: String((error && error.message) || error) }));
    return true;
  }
  return false;
});
