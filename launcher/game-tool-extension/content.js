/**
 * 游戏助手 · 面板脚本（ISOLATED world）
 * 提供浮层面板：连点设置 + 网络场景切换，并与 page-inject.js 通信。
 */
(() => {
  'use strict';
  if (window.__gameToolPanelInjected) return;
  window.__gameToolPanelInjected = true;

  const HOST_ID = 'game-tool-ext-host';
  const STORAGE_KEY = 'gameToolSettings';
  const POSITION_KEY = 'gameToolPanelPosition';
  const RESTORE_POSITION_KEY = 'gameToolRestorePosition';
  const VERSION = '1.8.2';

  const DEFAULT_HOTKEYS = {
    panelToggle: 'F8',
    clickToggle: 'F7',
    recordToggle: 'Alt+Shift+KeyR',
    save15: 'Alt+Shift+KeyA',
    save30: 'Alt+Shift+KeyS',
    save60: 'Alt+Shift+KeyD',
    net1: 'Alt+Shift+Digit1',
    net2: 'Alt+Shift+Digit2',
    net3: 'Alt+Shift+Digit3',
    net4: 'Alt+Shift+Digit4',
    net5: 'Alt+Shift+Digit5',
    net6: 'Alt+Shift+Digit6',
    net7: 'Alt+Shift+Digit7',
    net8: 'Alt+Shift+Digit8',
  };

  const canonicalHotkey = (event) => {
    const parts = [];
    if (event.ctrlKey) parts.push('Ctrl');
    if (event.altKey) parts.push('Alt');
    if (event.shiftKey) parts.push('Shift');
    if (event.metaKey) parts.push('Meta');
    const code = event.code || '';
    parts.push(code.startsWith('Key') || code.startsWith('Digit') ? code : (event.key || code));
    return parts.join('+');
  };

  const domainMatches = (hostname, pattern) => {
    const host = String(hostname || '').toLowerCase();
    let rule = String(pattern || '')
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, '')
      .replace(/\/.*$/, '');
    if (!rule) return false;
    if (rule.startsWith('*.')) {
      const base = rule.slice(2);
      return host === base || host.endsWith('.' + base);
    }
    return host === rule || host.endsWith('.' + rule);
  };

  const displayHotkey = (combo) => String(combo || '')
    .split('+')
    .map((part) => {
      if (part.startsWith('Key')) return part.slice(3);
      if (part.startsWith('Digit')) return part.slice(5);
      return part;
    })
    .join('+');

  const settings = {
    clickEnabled: false,
    clickCount: 5,
    clickIntervalMs: 350,
    replayMode: 'auto', // auto | pointer | mouse | touch | trusted
    showRestorePill: true,
    clickCollapsed: false,
    networkCollapsed: false,
    recordCollapsed: true,
    autoRecord: true,
    enabledDomains: [],
    defaultSaveDir: true,
    compactMode: true,
    hotkeys: { ...DEFAULT_HOTKEYS },
    settingsVersion: 11,
  };

  // 网络场景预设（快捷键 Alt+Shift+1~8 对应前 8 个）
  const NETWORK_PRESETS = [
    { key: 'normal', label: '正常', mode: 'normal' },
    { key: 'weak', label: '弱网', mode: 'weak', latencyMs: 1000, jitterMs: 0, lossRate: 0.1, httpLatencyMs: 1000 },
    { key: 'severe', label: '强弱网', mode: 'severe', latencyMs: 3000, jitterMs: 0, lossRate: 0.3, httpLatencyMs: 3000 },
    { key: 'jitter', label: '抖动', mode: 'jitter', latencyMs: 500, jitterMs: 800, lossRate: 0.02, httpLatencyMs: 500 },
    { key: 'loss', label: '丢包', mode: 'loss', latencyMs: 100, jitterMs: 0, lossRate: 0.3, httpLatencyMs: 0 },
    { key: 'latency', label: '高延迟', mode: 'latency', latencyMs: 2500, jitterMs: 0, lossRate: 0, httpLatencyMs: 2500 },
    { key: 'offline', label: '断网', mode: 'offline' },
    { key: 'offline10', label: '断网10s', mode: 'offline', durationMs: 10000 },
    { key: 'custom', label: '自定义', mode: 'custom' },
  ];
  const PRESET_BY_KEY = new Map(NETWORK_PRESETS.map((preset) => [preset.key, preset]));

  let host = null;
  let shadow = null;
  let refs = {};
  let replayCount = 0;
  let currentMode = 'normal';
  let currentPresetKey = 'normal';
  let autoRestoreTimer = null;
  let dragging = null;
  let restoreDrag = null;
  let panelHidden = false;
  let customVisible = false;
  let savedPosition = null;
  let savedRestorePosition = null;

  const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value) || 0));

  // ---------------- 与页面脚本通信 ----------------
  const postToPage = (type, payload) => {
    try {
      window.postMessage({ __gameTool: true, dir: 'down', type, payload }, '*');
    } catch (e) {
      /* ignore */
    }
  };

  const applyNetwork = (payload) => {
    postToPage('setMode', payload);
  };

  // ---------------- 面板 HTML / CSS ----------------
  const PANEL_CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; }
    .gt-wrap { position: fixed; right: 14px; top: 90px; z-index: 2147483647; font-family: -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif; }
    .gt-panel { width: 250px; background: rgba(24, 27, 34, 0.96); border: 1px solid rgba(255,255,255,0.14); border-radius: 12px; box-shadow: 0 12px 32px rgba(0,0,0,0.45); color: #e8eaed; overflow: hidden; user-select: none; touch-action: none; }
    .gt-panel.gt-dragging { box-shadow: 0 18px 48px rgba(0,0,0,0.6); }
    .gt-panel.gt-dragging, .gt-panel.gt-dragging * { cursor: grabbing !important; }
    .gt-head { display: flex; align-items: center; gap: 8px; padding: 9px 12px; background: linear-gradient(180deg, rgba(255,255,255,0.09), rgba(255,255,255,0.03)); cursor: grab; }
    .gt-dot { width: 8px; height: 8px; border-radius: 50%; background: #35d07f; box-shadow: 0 0 6px #35d07f; flex: 0 0 auto; }
    .gt-title { font-size: 13px; font-weight: 600; letter-spacing: 0.5px; }
    .gt-net-badge { margin-left: auto; font-size: 11px; padding: 1px 8px; border-radius: 999px; background: rgba(53,208,127,0.16); color: #63e6a4; }
    .gt-net-badge.weak { background: rgba(240,180,60,0.16); color: #f4c15a; }
    .gt-net-badge.offline { background: rgba(240,80,80,0.18); color: #ff7b7b; }
    .gt-gear { all: unset; cursor: pointer; width: 20px; height: 20px; line-height: 18px; text-align: center; border-radius: 5px; color: #aeb4bf; font-size: 13px; }
    .gt-gear:hover { background: rgba(255,255,255,0.12); color: #fff; }
    .gt-min { all: unset; cursor: pointer; width: 20px; height: 20px; line-height: 18px; text-align: center; border-radius: 5px; color: #aeb4bf; font-size: 14px; }
    .gt-min:hover { background: rgba(255,255,255,0.12); color: #fff; }
    .gt-body { padding: 10px 12px 8px; }
    .gt-sec-head { display: flex; align-items: center; gap: 8px; cursor: pointer; }
    .gt-sec-title { font-size: 12px; font-weight: 600; color: #dfe3ea; flex: 0 0 auto; }
    .gt-sec-head .gt-small { margin-left: auto; }
    .gt-sec-toggle { all: unset; cursor: pointer; width: 20px; height: 20px; border-radius: 5px; color: #aeb4bf; display: inline-flex; align-items: center; justify-content: center; flex: 0 0 auto; }
    .gt-sec-head:hover .gt-sec-toggle { background: rgba(255,255,255,0.12); color: #fff; }
    .gt-sec-toggle svg { width: 14px; height: 14px; transition: transform 0.15s ease; }
    .gt-sec-toggle.collapsed svg { transform: rotate(180deg); }
    .gt-save-btn { all: unset; cursor: pointer; font-size: 11px; color: #9dc0ff; border: 1px solid rgba(79,140,255,0.35); padding: 3px 7px; border-radius: 5px; white-space: nowrap; }
    .gt-save-btn:hover { background: rgba(79,140,255,0.18); color: #cfe0ff; }
    .gt-save-btn:disabled { opacity: 0.45; cursor: default; }
    .gt-kbd { display: inline-block; margin-left: 4px; padding: 0 3px; border-radius: 3px; font-size: 9px; line-height: 13px; color: #aeb4bf; background: rgba(255,255,255,0.12); }
    .gt-rec-btn { all: unset; cursor: pointer; font-size: 11.5px; color: #cfe0ff; background: rgba(79,140,255,0.18); padding: 4px 10px; border-radius: 6px; white-space: nowrap; }
    .gt-rec-btn:hover { background: rgba(79,140,255,0.3); }
    .gt-rec-btn.recording { background: rgba(240,80,80,0.2); color: #ffb3b3; }
    .gt-rec-btn:disabled { opacity: 0.55; cursor: default; }
    .gt-loc-btn { all: unset; cursor: pointer; font-size: 11px; color: #9dc0ff; border: 1px solid rgba(79,140,255,0.35); padding: 3px 8px; border-radius: 5px; white-space: nowrap; }
    .gt-loc-btn:hover { background: rgba(79,140,255,0.18); color: #cfe0ff; }
    .gt-sec-body.collapsed { display: none; }
    .gt-panel.gt-compact .gt-help { display: none; }
    .gt-panel.gt-compact .gt-body { padding: 7px 10px 6px; max-height: calc(100vh - 150px); overflow-y: auto; overscroll-behavior: contain; }
    .gt-panel.gt-compact .gt-section { padding: 5px 0; }
    .gt-panel.gt-compact .gt-row { margin: 4px 0; }
    .gt-panel.gt-compact .gt-sec-head { padding: 2px 0; }
    .gt-panel.gt-compact .gt-foot { margin-top: 4px; padding-top: 6px; }
    .gt-section { padding: 8px 0; border-top: 1px solid rgba(255,255,255,0.08); }
    .gt-section:first-child { border-top: 0; padding-top: 2px; }
    .gt-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin: 7px 0; }
    .gt-label { font-size: 12px; color: #c7cbd3; flex: 0 0 auto; }
    .gt-small { font-size: 10px; color: #8f96a3; }
    .gt-tip { font-size: 10.5px; line-height: 1.5; color: #8f96a3; margin-top: 6px; overflow-wrap: anywhere; word-break: break-word; }
    #gt-save-loc-status { overflow-wrap: anywhere; word-break: break-all; }
    .gt-tip.warn { color: #f4c15a; }
    .gt-tip.err { color: #ff8a8a; }
    .gt-tip.ok { color: #63e6a4; }
    input[type="number"] { width: 66px; background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.16); border-radius: 6px; color: #fff; font-size: 12px; padding: 3px 6px; outline: none; text-align: right; }
    input[type="number"]:focus { border-color: #4f8cff; }
    select { background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.16); border-radius: 6px; color: #fff; font-size: 11.5px; padding: 3px 4px; outline: none; max-width: 130px; }
    select option { background: #1b1e25; color: #fff; }
    .gt-input-unit { display: inline-flex; align-items: center; gap: 4px; }
    .gt-input-unit em { font-style: normal; font-size: 10px; color: #8f96a3; }
    .gt-switch { position: relative; width: 38px; height: 21px; flex: 0 0 auto; }
    .gt-switch input { opacity: 0; width: 0; height: 0; position: absolute; }
    .gt-slider { position: absolute; inset: 0; background: rgba(255,255,255,0.18); border-radius: 999px; transition: background 0.15s; cursor: pointer; }
    .gt-slider::before { content: ""; position: absolute; width: 15px; height: 15px; left: 3px; top: 3px; border-radius: 50%; background: #fff; transition: transform 0.15s; }
    .gt-switch input:checked + .gt-slider { background: #2fbf71; }
    .gt-switch input:checked + .gt-slider::before { transform: translateX(17px); }
    .gt-modes { display: grid; grid-template-columns: repeat(4, 1fr); gap: 5px; margin-top: 4px; }
    .gt-mode { all: unset; cursor: pointer; text-align: center; padding: 5px 0; border-radius: 6px; background: rgba(255,255,255,0.07); color: #c7cbd3; font-size: 11.5px; }
    .gt-mode:hover { background: rgba(255,255,255,0.14); }
    .gt-mode.active { background: #2f6fed; color: #fff; font-weight: 600; }
    .gt-mode[data-mode="offline"].active { background: #d84a4a; }
    .gt-custom { margin-top: 8px; display: none; }
    .gt-custom.show { display: block; }
    .gt-apply { all: unset; cursor: pointer; display: block; width: 100%; text-align: center; margin-top: 6px; padding: 6px 0; border-radius: 6px; background: rgba(79,140,255,0.22); color: #9dc0ff; font-size: 12px; }
    .gt-apply:hover { background: rgba(79,140,255,0.34); }
    .gt-foot { margin-top: 6px; padding-top: 8px; border-top: 1px solid rgba(255,255,255,0.08); font-size: 10px; color: #737a87; line-height: 1.5; }
    .gt-foot-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    .gt-update-btn { all: unset; cursor: pointer; font-size: 10.5px; color: #9dc0ff; padding: 2px 7px; border-radius: 5px; background: rgba(79,140,255,0.14); white-space: nowrap; }
    .gt-update-btn:hover { background: rgba(79,140,255,0.26); }
    .gt-update-btn:disabled { opacity: 0.55; cursor: default; }
    .gt-update-status { display: none; margin-top: 4px; font-size: 10.5px; line-height: 1.5; word-break: break-all; }
    .gt-update-status.show { display: block; }
    .gt-update-status.ok { color: #63e6a4; }
    .gt-update-status.new { color: #f4c15a; }
    .gt-update-status.err { color: #ff8a8a; }
    .gt-restore { all: unset; position: fixed; right: 14px; top: 90px; z-index: 2147483647; height: 34px; padding: 0 12px 0 10px; display: none; align-items: center; gap: 6px; border-radius: 17px; background: linear-gradient(180deg, rgba(38,43,54,0.97), rgba(24,27,34,0.97)); border: 1px solid rgba(255,255,255,0.24); color: #e8eaed; cursor: grab; box-shadow: 0 8px 22px rgba(0,0,0,0.45); font-family: -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif; user-select: none; touch-action: none; }
    .gt-restore.show { display: inline-flex; }
    .gt-restore:hover { border-color: rgba(255,255,255,0.42); background: linear-gradient(180deg, rgba(48,54,66,0.98), rgba(30,34,42,0.98)); }
    .gt-restore.dragging { cursor: grabbing; }
    .gt-restore-icon { width: 18px; height: 18px; display: inline-flex; align-items: center; justify-content: center; color: #63e6a4; flex: 0 0 auto; }
    .gt-restore-icon svg { width: 18px; height: 18px; display: block; }
    .gt-restore-text { font-size: 12px; letter-spacing: 0.5px; white-space: nowrap; }
    .gt-restore-hide { all: unset; cursor: pointer; width: 18px; height: 18px; line-height: 16px; text-align: center; border-radius: 50%; color: #aab1bd; font-size: 13px; flex: 0 0 auto; background: rgba(255,255,255,0.1); }
    .gt-restore-hide:hover { background: rgba(240,80,80,0.35); color: #fff; }
    .gt-toast { position: fixed; left: 50%; bottom: 46px; transform: translateX(-50%); z-index: 2147483647; max-width: 70vw; padding: 7px 14px; border-radius: 18px; background: rgba(24,27,34,0.95); border: 1px solid rgba(255,255,255,0.22); color: #e8eaed; font-size: 12px; box-shadow: 0 8px 24px rgba(0,0,0,0.45); display: none; white-space: nowrap; }
    .gt-toast.show { display: block; }
    .gt-switch-sm { width: 30px; height: 17px; }
    .gt-switch-sm .gt-slider::before { width: 11px; height: 11px; }
    .gt-switch-sm input:checked + .gt-slider::before { transform: translateX(13px); }
    .gt-hidden { display: none !important; }
  `;

  const PANEL_HTML = `
    <div class="gt-wrap" id="gt-wrap">
      <div class="gt-panel" id="gt-panel">
        <div class="gt-head" id="gt-head">
          <span class="gt-dot"></span>
          <span class="gt-title">游戏助手</span>
          <span class="gt-net-badge" id="gt-net-badge">正常</span>
          <button class="gt-gear" id="gt-open-options" title="打开设置">⚙</button>
          <button class="gt-min" id="gt-min" title="收起面板">—</button>
        </div>
        <div class="gt-body" id="gt-body">
          <div class="gt-section">
            <div class="gt-sec-head" id="gt-click-head" role="button" tabindex="0" title="收起/展开连点设置">
              <span class="gt-sec-title">连点设置</span>
              <span class="gt-small" id="gt-click-summary">已关闭</span>
              <span class="gt-sec-toggle" id="gt-toggle-click">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 15l6-6 6 6"/></svg>
              </span>
            </div>
            <div class="gt-sec-body" id="gt-click-body">
              <div class="gt-row">
                <span class="gt-label">连点模式</span>
                <label class="gt-switch"><input type="checkbox" id="gt-click-enabled"><span class="gt-slider"></span></label>
              </div>
              <div class="gt-row">
                <span class="gt-label">点击次数</span>
                <input type="number" id="gt-click-count" min="1" max="99" step="1" value="5">
              </div>
              <div class="gt-row">
                <span class="gt-label">补点间隔</span>
                <span class="gt-input-unit"><input type="number" id="gt-click-interval" min="0" max="1000" step="10" value="60"><em>ms</em></span>
              </div>
              <div class="gt-row">
                <span class="gt-label">补点方式</span>
                <select id="gt-replay-mode">
                  <option value="auto">自动（推荐）</option>
                  <option value="pointer">Pointer 事件</option>
                  <option value="mouse">鼠标事件</option>
                  <option value="touch">触摸事件</option>
                  <option value="trusted">真实输入（调试器）</option>
                </select>
              </div>
              <div class="gt-tip gt-help">升级/抽卡等有动画的按钮，补点间隔建议 ≥300ms；仍不响应再换「真实输入（调试器）」。</div>
              <div class="gt-tip" id="gt-click-status">开启后：在游戏里点 1 次 = 自动点击设定次数</div>
            </div>
          </div>
          <div class="gt-section">
            <div class="gt-sec-head" id="gt-network-head" role="button" tabindex="0" title="收起/展开网络场景">
              <span class="gt-sec-title">网络场景</span>
              <span class="gt-small" id="gt-conn">WS: -</span>
              <span class="gt-sec-toggle" id="gt-toggle-network">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 15l6-6 6 6"/></svg>
              </span>
            </div>
            <div class="gt-sec-body" id="gt-network-body">
              <div class="gt-modes" id="gt-modes">
                <button class="gt-mode active" data-preset="normal">正常</button>
                <button class="gt-mode" data-preset="weak">弱网</button>
                <button class="gt-mode" data-preset="severe">强弱网</button>
                <button class="gt-mode" data-preset="jitter">抖动</button>
                <button class="gt-mode" data-preset="loss">丢包</button>
                <button class="gt-mode" data-preset="latency">高延迟</button>
                <button class="gt-mode" data-preset="offline">断网</button>
                <button class="gt-mode" data-preset="offline10">断网10s</button>
                <button class="gt-mode" data-preset="custom">自定义</button>
              </div>
              <div class="gt-custom" id="gt-custom">
                <div class="gt-row"><span class="gt-label">WS 延迟</span><span class="gt-input-unit"><input type="number" id="gt-latency" min="0" max="10000" step="100" value="800"><em>ms</em></span></div>
                <div class="gt-row"><span class="gt-label">抖动范围</span><span class="gt-input-unit"><input type="number" id="gt-jitter" min="0" max="5000" step="100" value="0"><em>±ms</em></span></div>
                <div class="gt-row"><span class="gt-label">丢包率</span><span class="gt-input-unit"><input type="number" id="gt-loss" min="0" max="100" step="5" value="10"><em>%</em></span></div>
                <div class="gt-row"><span class="gt-label">HTTP 延迟</span><span class="gt-input-unit"><input type="number" id="gt-http-latency" min="0" max="10000" step="100" value="800"><em>ms</em></span></div>
                <button class="gt-apply" id="gt-apply-custom">应用自定义网络</button>
              </div>
              <div class="gt-tip" id="gt-net-status">当前网络：正常</div>
            </div>
          </div>
          <div class="gt-section">
            <div class="gt-sec-head" id="gt-record-head" role="button" tabindex="0" title="收起/展开录屏回放">
              <span class="gt-sec-title">录屏回放</span>
              <span class="gt-small" id="gt-record-summary">未录制</span>
              <span class="gt-sec-toggle" id="gt-toggle-record">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 15l6-6 6 6"/></svg>
              </span>
            </div>
            <div class="gt-sec-body" id="gt-record-body">
              <div class="gt-row">
                <span class="gt-label">当前页录屏</span>
                <button class="gt-rec-btn" id="gt-record-toggle" title="开始/停止录屏（Alt+Shift+R）">开始录屏</button>
              </div>
              <div class="gt-row">
                <span class="gt-label">保存位置</span>
                <button class="gt-loc-btn" id="gt-choose-save-dir" title="选择视频保存目录">选择目录</button>
              </div>
              <div class="gt-row">
                <span class="gt-label">默认保存到此位置</span>
                <label class="gt-switch gt-switch-sm"><input type="checkbox" id="gt-default-save-dir"><span class="gt-slider"></span></label>
              </div>
              <div class="gt-tip" id="gt-save-loc-status">当前：浏览器默认下载目录；可点「选择目录」指定文件夹。</div>
              <div class="gt-row">
                <span class="gt-label">保存点击前</span>
                <span class="gt-save-btns">
                  <button class="gt-save-btn" data-seconds="15" title="保存点击前 15 秒（Alt+Shift+A）" disabled>15s<span class="gt-kbd">A</span></button>
                  <button class="gt-save-btn" data-seconds="30" title="保存点击前 30 秒（Alt+Shift+S）" disabled>30s<span class="gt-kbd">S</span></button>
                  <button class="gt-save-btn" data-seconds="60" title="保存点击前 60 秒（Alt+Shift+D）" disabled>60s<span class="gt-kbd">D</span></button>
                </span>
              </div>
              <div class="gt-tip" id="gt-record-status">录制缓存会自动保存在内存；自动录屏、快捷键和域名配置在设置页。</div>
              <div class="gt-tip gt-help">视频默认保存为 MP4（浏览器不支持时自动回退 WebM）；录屏按 1 分钟分段滚动缓存，只保留最近约 1~2 分钟；生成时录制继续，不足所选秒数时按实际时长导出。</div>
            </div>
          </div>
          <div class="gt-foot">
            <div class="gt-foot-row">
              <span>游戏助手 v${VERSION}</span>
              <button class="gt-update-btn" id="gt-check-update" title="从代码仓库检查更新">检查更新</button>
            </div>
            <div class="gt-update-status" id="gt-update-status"></div>
            <div>Alt+G 面板 · 快捷键可在设置页修改</div>
          </div>
        </div>
      </div>
      <div class="gt-restore" id="gt-restore" role="button" tabindex="0" title="展开游戏助手（可以拖动）">
        <span class="gt-restore-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
            <path d="M7 7h10a4 4 0 0 1 3.9 3.1l1.1 5.2A2.6 2.6 0 0 1 18.7 18c-.9 0-1.7-.4-2.2-1.1L15.4 15H8.6l-1.1 1.9C7 17.6 6.2 18 5.3 18a2.6 2.6 0 0 1-3.3-2.7l1.1-5.2A4 4 0 0 1 7 7Z"/>
            <path d="M7.5 11.5h2M8.5 10.5v2M16 10.8h.01M17.6 12.4h.01"/>
          </svg>
        </span>
        <span class="gt-restore-text">游戏助手</span>
        <button class="gt-restore-hide" id="gt-restore-hide" title="隐藏入口（Alt+G / F8 可重新打开）">×</button>
      </div>
      <div class="gt-toast" id="gt-toast"></div>
    </div>
  `;

  // ---------------- 连点 ----------------
  const REPLAY_MODE_LABEL = { auto: '自动', pointer: 'Pointer', mouse: '鼠标', touch: '触摸', trusted: '真实输入' };
  let lastReplayInfo = null;
  // 真实输入由 CDP 派发，产生的是“可信事件”，会被页面的 pointerdown 监听再次捕获。
  // 这里在真实输入期间临时抑制自动连点的触发，避免无限套娃。
  let suppressReplayUntil = 0;

  const updateClickStatus = () => {
    if (!refs.clickStatus) return;
    if (!settings.clickEnabled) {
      refs.clickStatus.textContent = '开启后：在游戏里点 1 次 = 自动点击设定次数';
      refs.clickStatus.className = 'gt-tip';
    } else {
      let text = `已开启：每次补点 ${settings.clickCount} 次，本次已补 ${replayCount} 次 · ${REPLAY_MODE_LABEL[settings.replayMode] || settings.replayMode}`;
      if (lastReplayInfo) text += ` · 目标 ${lastReplayInfo.target}${lastReplayInfo.pointerType ? '/' + lastReplayInfo.pointerType : ''}`;
      refs.clickStatus.textContent = text;
      refs.clickStatus.className = 'gt-tip';
    }
    if (refs.clickSummary) {
      refs.clickSummary.textContent = settings.clickEnabled ? `连点 ${settings.clickCount} 次` : '已关闭';
    }
    if (host) {
      host.dataset.replayCount = String(replayCount);
      host.dataset.clickEnabled = settings.clickEnabled ? '1' : '0';
      host.dataset.replayMode = settings.replayMode;
      host.dataset.version = VERSION;
    }
  };

  const findClickTarget = (x, y) => {
    const target = document.elementFromPoint(x, y) || document.querySelector('canvas') || document.body;
    if (!target) return null;
    if (host && (target === host || host.contains(target))) return null;
    return target;
  };

  const dispatchGesture = (x, y, pointerType) => {
    const target = findClickTarget(x, y);
    if (!target) return false;
    const mode = settings.replayMode;
    const base = {
      bubbles: true,
      cancelable: true,
      composed: true,
      clientX: x,
      clientY: y,
      pageX: x,
      pageY: y,
      screenX: x,
      screenY: y,
      pointerId: 91001,
      pointerType,
      isPrimary: true,
      button: 0,
      buttons: 1,
      detail: 1,
      view: window,
    };
    const usePointer = mode === 'pointer' || mode === 'auto';
    const useMouse = mode === 'mouse' || (mode === 'auto' && pointerType !== 'touch');
    const useTouch = mode === 'touch' || (mode === 'auto' && pointerType === 'touch');
    try {
      if (useTouch && typeof TouchEvent === 'function' && typeof Touch === 'function') {
        const touch = new Touch({
          identifier: 1,
          target,
          clientX: x,
          clientY: y,
          pageX: x,
          pageY: y,
          screenX: x,
          screenY: y,
          force: 1,
        });
        target.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, cancelable: true, composed: true, touches: [touch], targetTouches: [touch], changedTouches: [touch] }));
        target.dispatchEvent(new TouchEvent('touchend', { bubbles: true, cancelable: true, composed: true, touches: [], targetTouches: [], changedTouches: [touch] }));
      }
      if (usePointer && typeof PointerEvent === 'function') {
        target.dispatchEvent(new PointerEvent('pointerdown', base));
        target.dispatchEvent(new PointerEvent('pointerup', { ...base, buttons: 0 }));
      }
      if (useMouse && typeof MouseEvent === 'function') {
        target.dispatchEvent(new MouseEvent('mousedown', base));
        target.dispatchEvent(new MouseEvent('mouseup', { ...base, buttons: 0 }));
      }
      if (typeof MouseEvent === 'function' && (useMouse || useTouch || mode === 'auto')) {
        target.dispatchEvent(new MouseEvent('click', { ...base, buttons: 0 }));
      }
      lastReplayInfo = { target: target.tagName || target.nodeName || '?', mode, pointerType };
      return true;
    } catch (e) {
      return false;
    }
  };

  const sendTrustedBurst = (x, y, count, intervalMs, pointerType) =>
    new Promise((resolve) => {
      if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.sendMessage) {
        resolve(false);
        return;
      }
      try {
        chrome.runtime.sendMessage({ __gameToolBg: true, type: 'trustedClicks', x, y, count, intervalMs, pointerType }, (response) => {
          if (chrome.runtime.lastError) {
            showTip('真实输入不可用，已退回合成事件', 'warn');
            resolve(false);
            return;
          }
          if (!response || response.ok === false) {
            showTip(`真实输入失败：${response && response.error ? response.error : '未知错误'}`, 'err');
            resolve(false);
            return;
          }
          resolve(true);
        });
      } catch (e) {
        resolve(false);
      }
    });

  const scheduleReplay = async (x, y, gesture = {}) => {
    const total = clamp(settings.clickCount, 1, 99);
    const interval = clamp(settings.clickIntervalMs, 0, 1000);
    const extras = total - 1;
    if (extras <= 0) return;
    const pointerType = gesture.pointerType === 'touch' ? 'touch' : 'mouse';
    if (settings.replayMode === 'trusted') {
      suppressReplayUntil = Date.now() + 8000;
      const ok = await sendTrustedBurst(x, y, extras, interval, pointerType);
      if (ok && settings.clickEnabled) {
        replayCount += extras;
        lastReplayInfo = { target: 'CDP真实输入', mode: 'trusted', pointerType };
        updateClickStatus();
        setTimeout(() => {
          suppressReplayUntil = 0;
        }, 1200);
        return;
      }
      suppressReplayUntil = 0;
    }
    let sent = 0;
    const step = () => {
      if (!settings.clickEnabled || sent >= extras) return;
      sent += 1;
      replayCount += 1;
      dispatchGesture(x, y, pointerType);
      updateClickStatus();
      if (sent < extras) setTimeout(step, Math.max(16, interval));
    };
    setTimeout(step, Math.max(10, interval));
  };

  const onUserPointerDown = (event) => {
    if (!settings.clickEnabled) return;
    if (Date.now() < suppressReplayUntil) return;
    if (!event.isTrusted) return; // 忽略自己补发的事件，避免递归
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    if (host && event.composedPath && event.composedPath().includes(host)) return;
    scheduleReplay(event.clientX, event.clientY, { pointerType: event.pointerType || 'mouse' });
  };

  // ---------------- 网络状态展示 ----------------
  const modeLabel = { normal: '正常', weak: '弱网', severe: '强弱网', jitter: '抖动', loss: '丢包', latency: '高延迟', offline: '断网', custom: '自定义' };

  const updateNetUi = (state) => {
    if (!state) return;
    currentMode = state.mode || 'normal';
    if (refs.netBadge) {
      refs.netBadge.textContent = modeLabel[currentMode] || currentMode;
      refs.netBadge.className = 'gt-net-badge ' + currentMode;
    }
    if (refs.modes) {
      refs.modes.querySelectorAll('.gt-mode').forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.preset === currentPresetKey);
      });
    }
    const stats = state.stats || {};
    if (refs.conn) {
      refs.conn.textContent = `连接 ${state.sockets || 0} · 建连 ${stats.created || 0} · 收帧 ${stats.recvFrames || 0}`;
    }
    if (refs.netStatus) {
      let text = `当前网络：${modeLabel[currentMode] || currentMode}`;
      if (currentMode !== 'normal') {
        const parts = [];
        if (state.latencyMs) parts.push(`延迟 ${state.latencyMs}${state.jitterMs ? '±' + state.jitterMs : ''}ms`);
        if (state.lossRate) parts.push(`丢包 ${Math.round((state.lossRate || 0) * 100)}%`);
        if (state.httpLatencyMs) parts.push(`HTTP ${state.httpLatencyMs}ms`);
        if (parts.length) text += `（${parts.join(' · ')}）`;
        if (currentMode === 'offline') {
          text += '（已阻止新连接；恢复后如游戏未自动重连，请点游戏内「重连网络」）';
        }
      }
      refs.netStatus.className = 'gt-tip' + (currentMode === 'normal' ? '' : currentMode === 'offline' ? ' err' : ' warn');
      refs.netStatus.textContent = text;
    }
    if (host) host.dataset.netMode = currentMode;
  };

  // 页面内轻提示（切换网络场景时使用）
  const showToast = (text) => {
    if (!refs.toast) return;
    refs.toast.textContent = text;
    refs.toast.classList.add('show');
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => refs.toast.classList.remove('show'), 1800);
  };

  const showTip = (text, level) => {
    if (!refs.netStatus) return;
    refs.netStatus.textContent = text;
    refs.netStatus.className = 'gt-tip' + (level ? ' ' + level : '');
    setTimeout(() => updateNetUi(lastState), 2500);
  };

  let lastState = null;

  // ---------------- 面板创建与事件 ----------------
  const init = () => {
    if (document.getElementById(HOST_ID)) return;
    host = document.createElement('div');
    host.id = HOST_ID;
    host.style.cssText = 'all: initial; position: fixed; inset: 0; pointer-events: none; z-index: 2147483647;';
    shadow = host.attachShadow({ mode: 'open' });
    const styleEl = document.createElement('style');
    styleEl.textContent = PANEL_CSS;
    shadow.appendChild(styleEl);
    const wrap = document.createElement('div');
    wrap.innerHTML = PANEL_HTML;
    shadow.appendChild(wrap);
    document.documentElement.appendChild(host);

    refs = {
      wrap: shadow.getElementById('gt-wrap'),
      panel: shadow.getElementById('gt-panel'),
      head: shadow.getElementById('gt-head'),
      body: shadow.getElementById('gt-body'),
      clickHead: shadow.getElementById('gt-click-head'),
      clickBody: shadow.getElementById('gt-click-body'),
      clickToggle: shadow.getElementById('gt-toggle-click'),
      clickSummary: shadow.getElementById('gt-click-summary'),
      networkHead: shadow.getElementById('gt-network-head'),
      networkBody: shadow.getElementById('gt-network-body'),
      networkToggle: shadow.getElementById('gt-toggle-network'),
      recordHead: shadow.getElementById('gt-record-head'),
      recordBody: shadow.getElementById('gt-record-body'),
      recordSecToggle: shadow.getElementById('gt-toggle-record'),
      recordSummary: shadow.getElementById('gt-record-summary'),
      recToggle: shadow.getElementById('gt-record-toggle'),
      autoRecord: shadow.getElementById('gt-auto-record'),
      chooseSaveDir: shadow.getElementById('gt-choose-save-dir'),
      defaultSaveDir: shadow.getElementById('gt-default-save-dir'),
      saveLocStatus: shadow.getElementById('gt-save-loc-status'),
      saveBtns: Array.from(shadow.querySelectorAll('.gt-save-btn')),
      recordStatus: shadow.getElementById('gt-record-status'),
      restoreHide: shadow.getElementById('gt-restore-hide'),
      netBadge: shadow.getElementById('gt-net-badge'),
      min: shadow.getElementById('gt-min'),
      restore: shadow.getElementById('gt-restore'),
      clickEnabled: shadow.getElementById('gt-click-enabled'),
      clickCount: shadow.getElementById('gt-click-count'),
      clickInterval: shadow.getElementById('gt-click-interval'),
      replayMode: shadow.getElementById('gt-replay-mode'),
      clickStatus: shadow.getElementById('gt-click-status'),
      modes: shadow.getElementById('gt-modes'),
      custom: shadow.getElementById('gt-custom'),
      latency: shadow.getElementById('gt-latency'),
      jitter: shadow.getElementById('gt-jitter'),
      loss: shadow.getElementById('gt-loss'),
      httpLatency: shadow.getElementById('gt-http-latency'),
      applyCustom: shadow.getElementById('gt-apply-custom'),
      netStatus: shadow.getElementById('gt-net-status'),
      conn: shadow.getElementById('gt-conn'),
      checkUpdate: shadow.getElementById('gt-check-update'),
      updateStatus: shadow.getElementById('gt-update-status'),
      openOptions: shadow.getElementById('gt-open-options'),
      toast: shadow.getElementById('gt-toast'),
    };

    // 面板自身事件不传给游戏，也不触发连点
    // 注意：使用冒泡阶段 stopPropagation，避免拦截面板内部按钮的点击
    ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'touchstart', 'touchend'].forEach((type) => {
      host.addEventListener(type, (event) => event.stopPropagation(), false);
    });

    // 面板背景不影响点击游戏（只有面板本身接收事件）
    refs.wrap.style.pointerEvents = 'none';
    refs.panel.style.pointerEvents = 'auto';
    refs.restore.style.pointerEvents = 'auto';

    // 设置同步
    const sectionState = {
      click: { body: 'clickBody', toggle: 'clickToggle', get: () => settings.clickCollapsed, set: (v) => { settings.clickCollapsed = v; } },
      network: { body: 'networkBody', toggle: 'networkToggle', get: () => settings.networkCollapsed, set: (v) => { settings.networkCollapsed = v; } },
      record: { body: 'recordBody', toggle: 'recordSecToggle', get: () => settings.recordCollapsed, set: (v) => { settings.recordCollapsed = v; } },
    };
    const applySectionCollapsed = (section, collapsed) => {
      const info = sectionState[section];
      if (!info) return;
      info.set(!!collapsed);
      if (refs[info.body]) refs[info.body].classList.toggle('collapsed', !!collapsed);
      if (refs[info.toggle]) refs[info.toggle].classList.toggle('collapsed', !!collapsed);
    };
    const applyCompactMode = () => {
      if (refs.panel) refs.panel.classList.toggle('gt-compact', !!settings.compactMode);
      if (host) host.dataset.compact = settings.compactMode ? '1' : '0';
    };
    const toggleSection = (section) => {
      const info = sectionState[section];
      if (!info) return;
      const expanding = info.get();
      applySectionCollapsed(section, !expanding);
      if (settings.compactMode && expanding) {
        Object.keys(sectionState).forEach((other) => {
          if (other !== section) applySectionCollapsed(other, true);
        });
      }
      saveSettings();
    };
    const syncFromSettings = () => {
      refs.clickEnabled.checked = !!settings.clickEnabled;
      refs.clickCount.value = settings.clickCount;
      refs.clickInterval.value = settings.clickIntervalMs;
      refs.replayMode.value = settings.replayMode;
      if (refs.defaultSaveDir) refs.defaultSaveDir.checked = !!settings.defaultSaveDir;
      applySectionCollapsed('click', settings.clickCollapsed);
      applySectionCollapsed('network', settings.networkCollapsed);
      applySectionCollapsed('record', settings.recordCollapsed);
      applyCompactMode();
      if (settings.compactMode) {
        const expanded = ['click', 'network', 'record'].filter((key) => !sectionState[key].get());
        if (expanded.length > 1) {
          ['network', 'record'].forEach((key) => applySectionCollapsed(key, true));
        }
      }
      const hotkeys = settings.hotkeys || DEFAULT_HOTKEYS;
      if (refs.recToggle) refs.recToggle.title = `开始/停止录屏（${displayHotkey(hotkeys.recordToggle)}）`;
      if (refs.saveBtns) {
        refs.saveBtns.forEach((btn) => {
          const seconds = btn.dataset.seconds;
          const action = seconds === '15' ? 'save15' : seconds === '30' ? 'save30' : 'save60';
          const combo = displayHotkey(hotkeys[action]);
          btn.title = `保存点击前 ${seconds} 秒（${combo}）`;
          const badge = btn.querySelector('.gt-kbd');
          if (badge) badge.textContent = combo.split('+').pop() || '';
        });
      }
      if (refs.restoreHide) refs.restoreHide.title = `隐藏入口（${displayHotkey(hotkeys.panelToggle)} 可重新打开）`;
      if (refs.modes) {
        const presetAction = { normal: 'net1', weak: 'net2', severe: 'net3', jitter: 'net4', loss: 'net5', latency: 'net6', offline: 'net7', offline10: 'net8' };
        refs.modes.querySelectorAll('.gt-mode[data-preset]').forEach((btn) => {
          const action = presetAction[btn.dataset.preset];
          if (action) btn.title = `${btn.textContent}（${displayHotkey(hotkeys[action])}）`;
        });
      }
      updateClickStatus();
    };
    syncFromSettings();

    refs.clickEnabled.addEventListener('change', () => {
      settings.clickEnabled = refs.clickEnabled.checked;
      saveSettings();
      updateClickStatus();
    });
    refs.clickCount.addEventListener('change', () => {
      settings.clickCount = clamp(refs.clickCount.value, 1, 99);
      refs.clickCount.value = settings.clickCount;
      saveSettings();
      updateClickStatus();
    });
    refs.clickInterval.addEventListener('change', () => {
      settings.clickIntervalMs = clamp(refs.clickInterval.value, 0, 1000);
      refs.clickInterval.value = settings.clickIntervalMs;
      saveSettings();
      updateClickStatus();
    });
    refs.replayMode.addEventListener('change', () => {
      const allowed = ['auto', 'pointer', 'mouse', 'touch', 'trusted'];
      settings.replayMode = allowed.includes(refs.replayMode.value) ? refs.replayMode.value : 'auto';
      refs.replayMode.value = settings.replayMode;
      saveSettings();
      updateClickStatus();
    });
    if (refs.defaultSaveDir) {
      refs.defaultSaveDir.addEventListener('change', () => {
        settings.defaultSaveDir = refs.defaultSaveDir.checked;
        saveSettings();
        updateSaveLocationUi();
        setRecordStatus(settings.defaultSaveDir ? '已开启默认保存位置。' : '已关闭默认保存位置，每次保存会弹出位置选择。');
      });
    }

    // 网络场景
    const clearAutoRestore = () => {
      if (autoRestoreTimer) {
        clearTimeout(autoRestoreTimer);
        autoRestoreTimer = null;
      }
    };
    const setPresetActive = (key) => {
      currentPresetKey = key;
      if (host) host.dataset.presetKey = key;
      if (refs.modes) {
        refs.modes.querySelectorAll('.gt-mode').forEach((btn) => {
          btn.classList.toggle('active', btn.dataset.preset === key);
        });
      }
    };
    const applyCustomNetwork = () => {
      const latencyMs = clamp(refs.latency.value, 0, 10000);
      const jitterMs = clamp(refs.jitter.value, 0, 5000);
      const lossRate = clamp(refs.loss.value, 0, 100) / 100;
      const httpLatencyMs = clamp(refs.httpLatency.value, 0, 10000);
      refs.latency.value = latencyMs;
      refs.jitter.value = jitterMs;
      refs.loss.value = Math.round(lossRate * 100);
      refs.httpLatency.value = httpLatencyMs;
      clearAutoRestore();
      setPresetActive('custom');
      applyNetwork({ mode: 'custom', latencyMs, jitterMs, lossRate, httpLatencyMs, httpFailRate: 0 });
      showToast('网络场景：自定义');
    };
    const applyPreset = (key) => {
      const preset = PRESET_BY_KEY.get(key);
      if (!preset) return;
      clearAutoRestore();
      if (preset.key === 'custom') {
        customVisible = !customVisible;
        refs.custom.classList.toggle('show', customVisible);
        setPresetActive('custom');
        if (customVisible) applyCustomNetwork();
        return;
      }
      customVisible = false;
      refs.custom.classList.remove('show');
      setPresetActive(preset.key);
      applyNetwork({
        mode: preset.mode,
        latencyMs: preset.latencyMs || 0,
        jitterMs: preset.jitterMs || 0,
        lossRate: preset.lossRate || 0,
        httpLatencyMs: preset.httpLatencyMs || 0,
        httpFailRate: 0,
      });
      if (preset.durationMs) {
        const seconds = Math.round(preset.durationMs / 1000);
        showToast(`${preset.label}：${seconds} 秒后自动恢复`);
        autoRestoreTimer = setTimeout(() => {
          autoRestoreTimer = null;
          applyPreset('normal');
          showToast('网络已恢复：正常');
        }, preset.durationMs);
      } else {
        showToast(`网络场景：${preset.label}`);
      }
    };
    refs.modes.addEventListener('click', (event) => {
      const btn = event.target.closest('.gt-mode[data-preset]');
      if (!btn) return;
      applyPreset(btn.dataset.preset);
    });
    refs.applyCustom.addEventListener('click', applyCustomNetwork);

    // 收起 / 展开（悬浮胶囊的展开逻辑在 pointerup 里处理，拖动时不会误触展开）
    refs.min.addEventListener('click', () => setPanelHidden(true));
    refs.openOptions.addEventListener('click', () => {
      try {
        chrome.runtime.sendMessage({ __gameToolBg: true, type: 'openOptions' });
      } catch (e) {
        try { window.open(chrome.runtime.getURL('options.html')); } catch (e2) { /* 非扩展环境忽略 */ }
      }
    });

    // 连点设置 / 网络场景：两个区块分别收起、展开
    const onSectionHeadClick = (section) => (event) => {
      if (event.target && event.target.closest && event.target.closest('input, select, label, a, .gt-mode, .gt-apply')) return;
      toggleSection(section);
    };
    const onSectionHeadKey = (section) => (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        toggleSection(section);
      }
    };
    refs.clickHead.addEventListener('click', onSectionHeadClick('click'));
    refs.networkHead.addEventListener('click', onSectionHeadClick('network'));
    refs.recordHead.addEventListener('click', onSectionHeadClick('record'));
    refs.clickHead.addEventListener('keydown', onSectionHeadKey('click'));
    refs.networkHead.addEventListener('keydown', onSectionHeadKey('network'));
    refs.recordHead.addEventListener('keydown', onSectionHeadKey('record'));

    // 检查更新：从代码仓库读取 version.json，比较版本号
    let pendingUpdateUrl = '';
    const showUpdateStatus = (text, level) => {
      if (!refs.updateStatus) return;
      refs.updateStatus.textContent = text || '';
      refs.updateStatus.className = 'gt-update-status' + (text ? ' show' : '') + (level ? ' ' + level : '');
    };
    const runUpdateCheck = () => {
      if (pendingUpdateUrl) {
        try {
          chrome.runtime.sendMessage({ __gameToolBg: true, type: 'openUpdatePage', url: pendingUpdateUrl }, (result) => {
            if (chrome.runtime.lastError) showUpdateStatus('打开更新页失败：' + chrome.runtime.lastError.message, 'err');
            else if (result && result.ok === false) showUpdateStatus('打开更新页失败：' + (result.error || '未知错误'), 'err');
          });
        } catch (e) {
          showUpdateStatus('打开更新页失败：' + e.message, 'err');
        }
        return;
      }
      if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.sendMessage) {
        showUpdateStatus('检查更新需要在扩展环境使用', 'err');
        return;
      }
      refs.checkUpdate.disabled = true;
      refs.checkUpdate.textContent = '检查中…';
      showUpdateStatus('', '');
      try {
        chrome.runtime.sendMessage({ __gameToolBg: true, type: 'checkUpdate' }, (result) => {
          refs.checkUpdate.disabled = false;
          refs.checkUpdate.textContent = '检查更新';
          if (chrome.runtime.lastError) {
            showUpdateStatus('检查失败：' + chrome.runtime.lastError.message, 'err');
            return;
          }
          if (!result || result.error) {
            showUpdateStatus('检查失败：' + ((result && result.error) || '无响应'), 'err');
            return;
          }
          if (result.hasUpdate) {
            pendingUpdateUrl = result.pageUrl || '';
            if (pendingUpdateUrl) refs.checkUpdate.textContent = '打开更新页';
            showUpdateStatus(`发现新版本 v${result.latest}（当前 v${result.current}）。自动更新请用启动器；手动更新请用新包覆盖后重新加载扩展。`, 'new');
          } else {
            pendingUpdateUrl = '';
            showUpdateStatus(`已是最新版本 v${result.current}`, 'ok');
          }
        });
      } catch (e) {
        refs.checkUpdate.disabled = false;
        refs.checkUpdate.textContent = '检查更新';
        showUpdateStatus('检查失败：' + e.message, 'err');
      }
    };
    refs.checkUpdate.addEventListener('click', runUpdateCheck);

    // ---------------- 录屏回放（保存点击前 N 秒） ----------------
    let recordStream = null;
    let recordSource = '';
    let recorder = null;
    let recordChunks = [];
    let recordBytes = 0;
    let recordStartedAt = 0;
    let recordElapsedSeconds = 0;
    let recordTimer = null;
    let saveBusy = false;
    let recordSegments = [];
    let segmentStartedAt = 0;
    let segmentTimer = null;
    let rotating = false;
    const SEGMENT_MS = 60000;
    const MAX_SEGMENTS = 2;
    const SAVE_DIR_DB_NAME = 'gameToolFileHandles';
    const SAVE_DIR_STORE = 'handles';
    const SAVE_DIR_KEY = 'saveDirectory';
    let saveDirectoryHandle = null;
    let saveDirectoryName = '';
    const openSaveDirDb = () => new Promise((resolve, reject) => {
      if (!window.indexedDB) { reject(new Error('当前环境不支持目录记忆')); return; }
      const request = indexedDB.open(SAVE_DIR_DB_NAME, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(SAVE_DIR_STORE)) request.result.createObjectStore(SAVE_DIR_STORE);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('打开目录存储失败'));
    });
    const rememberSaveDirectory = async (handle) => {
      const db = await openSaveDirDb();
      await new Promise((resolve, reject) => {
        const transaction = db.transaction(SAVE_DIR_STORE, 'readwrite');
        transaction.objectStore(SAVE_DIR_STORE).put(handle, SAVE_DIR_KEY);
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
      });
    };
    const loadRememberedSaveDirectory = async () => {
      const db = await openSaveDirDb();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction(SAVE_DIR_STORE, 'readonly');
        const request = transaction.objectStore(SAVE_DIR_STORE).get(SAVE_DIR_KEY);
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error);
      });
    };
    const ensureDirectoryPermission = async (handle) => {
      if (!handle) return false;
      try {
        if (typeof handle.queryPermission === 'function') {
          let permission = await handle.queryPermission({ mode: 'readwrite' });
          if (permission === 'granted') return true;
          if (typeof handle.requestPermission === 'function') permission = await handle.requestPermission({ mode: 'readwrite' });
          return permission === 'granted';
        }
        return true;
      } catch (e) {
        return false;
      }
    };
    const writeBlobToFileHandle = async (handle, blob) => {
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
    };
    const writeBlobToDirectory = async (handle, blob, filename) => {
      const fileHandle = await handle.getFileHandle(filename, { create: true });
      await writeBlobToFileHandle(fileHandle, blob);
    };
    const updateSaveLocationUi = () => {
      if (!refs || !refs.saveLocStatus) return;
      const mode = settings.defaultSaveDir ? '默认' : '每次询问';
      let text;
      if (saveDirectoryHandle) {
        text = `当前保存位置：${saveDirectoryName || '已选目录'}（${mode}）`;
        refs.saveLocStatus.title = `目录：${saveDirectoryName || '已选目录'}（浏览器仅提供目录名，不暴露完整路径）`;
      } else {
        text = `当前保存位置：浏览器下载目录（${mode}）`;
        refs.saveLocStatus.title = '未选择自定义目录';
      }
      refs.saveLocStatus.textContent = text;
    };
    const buildReplayTimestamp = () => {
      const stamp = new Date();
      const pad = (value) => String(value).padStart(2, '0');
      return `${stamp.getFullYear()}${pad(stamp.getMonth() + 1)}${pad(stamp.getDate())}-${pad(stamp.getHours())}${pad(stamp.getMinutes())}${pad(stamp.getSeconds())}`;
    };
    const chooseSaveDirectory = async () => {
      if (!window.showDirectoryPicker) {
        setRecordStatus('当前浏览器不支持选择目录，将保存到浏览器默认下载目录。', 'warn');
        return;
      }
      try {
        const handle = await window.showDirectoryPicker({ mode: 'readwrite', id: 'gameToolSaveDir' });
        saveDirectoryHandle = handle;
        saveDirectoryName = handle.name || '已选目录';
        try { await rememberSaveDirectory(handle); } catch (e) { /* 目录记忆失败不影响本次使用 */ }
        settings.defaultSaveDir = true;
        if (refs.defaultSaveDir) refs.defaultSaveDir.checked = true;
        saveSettings();
        updateSaveLocationUi();
        setRecordStatus(`已选择目录：${saveDirectoryName}`, 'ok');
        showToast(`已选择目录：${saveDirectoryName}`);
      } catch (error) {
        if (error && error.name !== 'AbortError') setRecordStatus('选择目录失败：' + ((error && error.message) || error), 'err');
      }
    };
    // 录制缓冲用 WebM（chunk 稳定、延迟低），最终导出再转成 MP4
    const BUFFER_MIME_CANDIDATES = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
    const OUTPUT_MIME_CANDIDATES = [
      'video/mp4;codecs=avc1.42E01E',
      'video/mp4;codecs=avc1',
      'video/mp4',
      'video/webm;codecs=vp9',
      'video/webm;codecs=vp8',
      'video/webm',
    ];
    const pickBufferMime = () => (window.MediaRecorder && BUFFER_MIME_CANDIDATES.find((type) => MediaRecorder.isTypeSupported(type))) || 'video/webm';
    const pickOutputMime = () => (window.MediaRecorder && OUTPUT_MIME_CANDIDATES.find((type) => MediaRecorder.isTypeSupported(type))) || 'video/webm';
    const REC_MAX_BYTES = 300 * 1024 * 1024;
    const fmtSeconds = (seconds) => {
      const total = Math.max(0, Math.floor(seconds));
      return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
    };
    const setRecordStatus = (text, level) => {
      if (!refs.recordStatus) return;
      refs.recordStatus.textContent = text || '';
      refs.recordStatus.className = 'gt-tip' + (level ? ' ' + level : '');
    };
    const recordActive = () => !!(recorder && recorder.state === 'recording');
    let recordRestoreTimer = null;
    const clearRecordRestore = () => {
      if (recordRestoreTimer) {
        clearTimeout(recordRestoreTimer);
        recordRestoreTimer = null;
      }
    };
    const recordLiveText = () => `录制中（${recordSource}）：出现问题时，点 15s / 30s / 60s 或按 ${displayHotkey((settings.hotkeys || DEFAULT_HOTKEYS).save30)} 导出点击前录像。`;
    const updateRecordUi = () => {
      const active = recordActive();
      const bytes = bufferedBytes();
      const bufferText = bytes >= 1048576 ? `${Math.round(bytes / 1048576)}MB` : `${Math.max(1, Math.round(bytes / 1024))}KB`;
      if (refs.recordSummary) {
        refs.recordSummary.textContent = active
          ? '录制中 ' + fmtSeconds((Date.now() - recordStartedAt) / 1000)
          : hasBufferedRecording()
            ? '可保存 ' + bufferText
            : '未录制';
      }
      if (refs.recToggle) {
        refs.recToggle.textContent = active ? '停止录屏' : '开始录屏';
        refs.recToggle.classList.toggle('recording', active);
      }
      if (refs.saveBtns) refs.saveBtns.forEach((btn) => { btn.disabled = saveBusy || !hasBufferedRecording(); });
    };
    const stopRecordTracks = () => {
      if (!recordStream) return;
      try { recordStream.getTracks().forEach((track) => track.stop()); } catch (e) { /* ignore */ }
      recordStream = null;
    };
    const currentSegmentBlob = () => (recordChunks.length ? new Blob(recordChunks, { type: recordChunks[0].type || 'video/webm' }) : null);
    const pushCurrentSegment = (keep = 1) => {
      const blob = currentSegmentBlob();
      if (!blob || !blob.size) { recordChunks = []; recordBytes = 0; return; }
      recordSegments.push({ blob, bytes: blob.size, startedAt: segmentStartedAt, endedAt: Date.now() });
      recordSegments = recordSegments.slice(-Math.max(1, keep));
      recordChunks = [];
      recordBytes = 0;
    };
    const bufferedBytes = () => recordSegments.reduce((sum, segment) => sum + segment.bytes, recordBytes);
    const hasBufferedRecording = () => recordSegments.length > 0 || recordChunks.length > 0;
    const resetSegmentBuffer = () => {
      recordSegments = [];
      recordChunks = [];
      recordBytes = 0;
      segmentStartedAt = 0;
    };
    const stopRecording = (message) => {
      clearRecordRestore();
      recordElapsedSeconds = recordStartedAt ? (Date.now() - recordStartedAt) / 1000 : recordElapsedSeconds;
      if (segmentTimer) { clearInterval(segmentTimer); segmentTimer = null; }
      const finishStop = () => {
        const hadChunks = hasBufferedRecording();
        recorder = null;
        if (recordTimer) { clearInterval(recordTimer); recordTimer = null; }
        stopRecordTracks();
        updateRecordUi();
        setRecordStatus(message || (hadChunks ? '录屏已停止；仍可点 15s/30s/60s 保存已缓存片段。' : '录屏已停止。'));
      };
      if (recorder && recorder.state !== 'inactive') {
        const oldRecorder = recorder;
        oldRecorder.onstop = () => {
          pushCurrentSegment(MAX_SEGMENTS);
          finishStop();
        };
        try { oldRecorder.stop(); } catch (e) { pushCurrentSegment(MAX_SEGMENTS); finishStop(); }
      } else {
        pushCurrentSegment(MAX_SEGMENTS);
        finishStop();
      }
    };
    const startRecorderOnStream = () => {
      if (!recordStream) return;
      const mimeType = pickBufferMime();
      recorder = new MediaRecorder(recordStream, { mimeType, videoBitsPerSecond: 2500000 });
      recorder.ondataavailable = (event) => {
        if (!event.data || !event.data.size) return;
        recordChunks.push(event.data);
        recordBytes += event.data.size;
        updateRecordUi();
        if (bufferedBytes() > REC_MAX_BYTES) {
          stopRecording('录像缓存超过上限，已自动停止；请先保存或重新开始录屏。');
        }
      };
      recorder.onerror = (event) => {
        setRecordStatus('录屏出错：' + ((event.error && event.error.message) || '未知错误'), 'err');
        stopRecording('录屏已停止。');
      };
      recorder.start(1000);
      updateRecordUi();
    };
    const rotateRecordingSegment = async () => {
      if (!recordStream || !recorder || recorder.state !== 'recording' || saveBusy || rotating) return;
      rotating = true;
      try {
        const oldRecorder = recorder;
        recorder = null;
        if (oldRecorder.state !== 'inactive') {
          await new Promise((resolve) => {
            oldRecorder.onstop = resolve;
            try { oldRecorder.stop(); } catch (e) { resolve(); }
          });
        }
        pushCurrentSegment(1);
        if (!recordStream) { updateRecordUi(); return; }
        segmentStartedAt = Date.now();
        startRecorderOnStream();
      } finally {
        rotating = false;
      }
    };
    const acquireRecordStream = async (allowDisplay = true) => {
      // 优先直接录页面里的 canvas（游戏画面），不需要选择窗口，也不会录到面板
      const canvases = Array.from(document.querySelectorAll('canvas')).filter((canvas) => canvas.width > 0 && canvas.height > 0);
      let best = null;
      let bestArea = 0;
      canvases.forEach((canvas) => {
        const area = canvas.width * canvas.height;
        if (area > bestArea) { bestArea = area; best = canvas; }
      });
      if (best && typeof best.captureStream === 'function') {
        try {
          const stream = best.captureStream(30);
          if (stream && stream.getVideoTracks().length) return { stream, source: '游戏画面' };
        } catch (e) { /* 回退到标签页 */ }
      }
      if (!allowDisplay) throw new Error('当前页没有可自动录制的游戏画面');
      if (!navigator.mediaDevices || typeof navigator.mediaDevices.getDisplayMedia !== 'function') {
        throw new Error('当前页没有可录制的 canvas，也不支持标签页录屏');
      }
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: false });
      return { stream, source: '当前标签页' };
    };
    const startRecording = async (options = {}) => {
      if (recordActive()) { stopRecording(); return; }
      if (refs.recToggle) refs.recToggle.disabled = true;
      setRecordStatus('正在开始录屏…');
      try {
        const acquired = await acquireRecordStream(!options.auto);
        recordStream = acquired.stream;
        recordSource = acquired.source;
        resetSegmentBuffer();
        recordElapsedSeconds = 0;
        recordStartedAt = Date.now();
        segmentStartedAt = Date.now();
        startRecorderOnStream();
        if (recordTimer) clearInterval(recordTimer);
        recordTimer = setInterval(updateRecordUi, 1000);
        if (segmentTimer) clearInterval(segmentTimer);
        segmentTimer = setInterval(() => rotateRecordingSegment(), SEGMENT_MS);
        setRecordStatus(recordLiveText(), 'warn');
        showToast(`${options.auto ? '已自动开始录屏' : '开始录屏'}：${recordSource}`);
      } catch (error) {
        setRecordStatus('开始录屏失败：' + ((error && error.message) || error), 'err');
        stopRecordTracks();
      } finally {
        if (refs.recToggle) refs.recToggle.disabled = false;
        updateRecordUi();
      }
    };
    let autoStartTimer = null;
    let manualEnabled = false;
    const pluginAutoEnabled = () => {
      const list = Array.isArray(settings.enabledDomains) ? settings.enabledDomains : [];
      if (!list.length) return true;
      return list.some((rule) => domainMatches(location.hostname, rule));
    };
    const pluginActive = () => pluginAutoEnabled() || manualEnabled;
    const maybeAutoStartRecording = () => {
      if (!settings.autoRecord) return;
      if (!pluginActive()) return;
      if (recordActive() || hasBufferedRecording()) return;
      if (autoStartTimer) { clearTimeout(autoStartTimer); autoStartTimer = null; }
      let tries = 0;
      const attempt = () => {
        if (!settings.autoRecord || recordActive() || hasBufferedRecording()) return;
        if (!pluginActive()) return;
        const canvases = Array.from(document.querySelectorAll('canvas')).filter((canvas) => canvas.width > 0 && canvas.height > 0 && typeof canvas.captureStream === 'function');
        if (canvases.length) {
          startRecording({ auto: true });
          return;
        }
        tries += 1;
        if (tries <= 20) {
          autoStartTimer = setTimeout(attempt, 1000);
        } else {
          setRecordStatus('自动录屏：当前页没有检测到游戏画面，请手动点「开始录屏」。', 'warn');
        }
      };
      setTimeout(attempt, 600);
    };
    const requestRecorderData = () => new Promise((resolve) => {
      if (!recorder || recorder.state !== 'recording') { resolve(); return; }
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        recorder.removeEventListener('dataavailable', onData);
        resolve();
      };
      const onData = () => finish();
      recorder.addEventListener('dataavailable', onData);
      try { recorder.requestData(); } catch (e) { finish(); return; }
      setTimeout(finish, 1000);
    });
    const downloadBlob = (blob, filename) => {
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename;
      anchor.style.display = 'none';
      document.body.appendChild(anchor);
      anchor.click();
      setTimeout(() => {
        try { URL.revokeObjectURL(url); } catch (e) { /* ignore */ }
        anchor.remove();
      }, 20000);
    };
    const getVideoDuration = (video) => new Promise((resolve) => {
      if (Number.isFinite(video.duration) && video.duration > 0) { resolve(video.duration); return; }
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        video.removeEventListener('timeupdate', onTime);
        resolve(Number.isFinite(value) && value > 0 ? value : 0);
      };
      const onTime = () => { if (Number.isFinite(video.duration) && video.duration > 0) finish(video.duration); };
      video.addEventListener('timeupdate', onTime);
      try { video.currentTime = 1e101; } catch (e) { finish(0); }
      setTimeout(() => finish(video.duration), 2500);
    });
    const trimRecordSegments = async (blobs, seconds, onProgress) => {
      const resources = [];
      const loadSegment = async (blob) => {
        const url = URL.createObjectURL(blob);
        const video = document.createElement('video');
        video.muted = true;
        video.playsInline = true;
        video.style.cssText = 'position:fixed;left:-9999px;top:0;width:2px;height:2px;opacity:0;pointer-events:none;';
        document.body.appendChild(video);
        await new Promise((resolve, reject) => {
          let attempt = 0;
          const tryLoad = () => {
            attempt += 1;
            video.onloadedmetadata = () => resolve();
            video.onerror = () => {
              if (attempt < 2) {
                setTimeout(() => {
                  try { video.removeAttribute('src'); video.load(); video.src = url; } catch (e) { /* ignore */ }
                  tryLoad();
                }, 300);
                return;
              }
              const code = video.error && video.error.code;
              reject(new Error(`无法读取录像数据（code=${code || '?'}）`));
            };
            video.src = url;
            video.load();
          };
          tryLoad();
        });
        let duration = await getVideoDuration(video);
        if (!Number.isFinite(duration) || duration <= 0) duration = 0.1;
        return { video, url, duration };
      };
      try {
        for (const blob of blobs) {
          if (blob && blob.size > 0) resources.push(await loadSegment(blob));
        }
        if (!resources.length) throw new Error('没有可用的录像分段');
        const totalDuration = resources.reduce((sum, segment) => sum + segment.duration, 0);
        const clipSeconds = Math.max(1, Math.min(seconds, totalDuration || seconds));
        const startAt = Math.max(0, totalDuration - clipSeconds);
        const width = resources[0].video.videoWidth || 1280;
        const height = resources[0].video.videoHeight || 720;
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const context2d = canvas.getContext('2d');
        const captureStream = canvas.captureStream(30);
        const mimeType = pickOutputMime();
        const clipRecorder = new MediaRecorder(captureStream, { mimeType, videoBitsPerSecond: 2500000 });
        const clipChunks = [];
        clipRecorder.ondataavailable = (event) => { if (event.data && event.data.size) clipChunks.push(event.data); };
        clipRecorder.start(500);
        let activeVideo = null;
        let drawing = true;
        let frameHandle = null;
        const drawFrame = () => {
          if (!drawing) return;
          try {
            if (activeVideo && activeVideo.readyState >= 2) context2d.drawImage(activeVideo, 0, 0, width, height);
          } catch (e) { /* ignore */ }
          frameHandle = requestAnimationFrame(drawFrame);
        };
        drawFrame();
        const trimStartedAt = performance.now();
        let remaining = clipSeconds;
        let skip = startAt;
        for (const segment of resources) {
          if (remaining <= 0.02) break;
          if (skip >= segment.duration) { skip -= segment.duration; continue; }
          const offset = Math.max(0, skip);
          skip = 0;
          const playFor = Math.min(segment.duration - offset, remaining);
          if (playFor <= 0.02) continue;
          segment.video.currentTime = Math.max(0, Math.min(offset, segment.duration - 0.05));
          await new Promise((resolve) => {
            let done = false;
            const finishSeek = () => { if (done) return; done = true; resolve(); };
            segment.video.onseeked = finishSeek;
            setTimeout(finishSeek, 1500);
          });
          activeVideo = segment.video;
          await segment.video.play().catch(() => { /* ignore */ });
          const segmentStarted = performance.now();
          await new Promise((resolve) => {
            const tick = () => {
              const segmentElapsed = (performance.now() - segmentStarted) / 1000;
              if (onProgress) onProgress((performance.now() - trimStartedAt) / 1000, clipSeconds);
              if (segmentElapsed >= playFor || segment.video.ended) { resolve(); return; }
              setTimeout(tick, 100);
            };
            setTimeout(tick, 100);
          });
          segment.video.pause();
          remaining -= playFor;
        }
        drawing = false;
        if (frameHandle) cancelAnimationFrame(frameHandle);
        await new Promise((resolve) => {
          clipRecorder.onstop = () => resolve();
          try { clipRecorder.stop(); } catch (e) { resolve(); }
        });
        try { captureStream.getTracks().forEach((track) => track.stop()); } catch (e) { /* ignore */ }
        return new Blob(clipChunks, { type: mimeType });
      } finally {
        resources.forEach((segment) => {
          try { segment.video.pause(); } catch (e) { /* ignore */ }
          try { URL.revokeObjectURL(segment.url); } catch (e) { /* ignore */ }
          segment.video.remove();
        });
      }
    };
    const saveRecordClip = async (seconds) => {
      if (saveBusy) return;
      if (!hasBufferedRecording()) {
        setRecordStatus('还没有录像缓存，请先点「开始录屏」。', 'err');
        showToast('还没有录像缓存，请先开始录屏');
        return;
      }
      saveBusy = true;
      updateRecordUi();
      clearRecordRestore();
      let saveTarget = { mode: 'download' };
      let saveNote = '';
      try {
        if (settings.defaultSaveDir && saveDirectoryHandle) {
          const granted = await ensureDirectoryPermission(saveDirectoryHandle);
          if (granted) saveTarget = { mode: 'directory', handle: saveDirectoryHandle, name: saveDirectoryName || '已选目录' };
          else saveNote = '（目录权限未授权，已保存到默认下载目录）';
        } else if (!settings.defaultSaveDir && typeof window.showSaveFilePicker === 'function') {
          const guessExt = String(pickOutputMime()).includes('mp4') ? 'mp4' : 'webm';
          const options = {
            suggestedName: `游戏助手回放-${buildReplayTimestamp()}.${guessExt}`,
            types: [{ description: '视频录像', accept: { 'video/mp4': ['.mp4'], 'video/webm': ['.webm'] } }],
          };
          if (saveDirectoryHandle) options.startIn = saveDirectoryHandle;
          try {
            const fileHandle = await window.showSaveFilePicker(options);
            saveTarget = { mode: 'file', handle: fileHandle };
          } catch (error) {
            if (error && error.name === 'AbortError') {
              saveBusy = false;
              updateRecordUi();
              setRecordStatus('已取消保存。');
              return;
            }
            saveNote = '（无法选择保存位置，已改为默认下载目录）';
          }
        } else if (!settings.defaultSaveDir) {
          saveNote = '（当前浏览器不支持选择保存位置，已保存到默认下载目录）';
        }
      } catch (error) {
        saveNote = '（选择保存位置失败，已改为默认下载目录）';
      }
      const savingWhileRecording = recordActive();
      if (savingWhileRecording) {
        setRecordStatus('正在准备录像数据…（录制继续）');
        await requestRecorderData();
      }
      const segmentBlobs = recordSegments.map((segment) => segment.blob);
      if (recordChunks.length) {
        const currentBlob = currentSegmentBlob();
        if (currentBlob && currentBlob.size) segmentBlobs.push(currentBlob);
      }
      const totalBytes = segmentBlobs.reduce((sum, blob) => sum + (blob.size || 0), 0);
      if (!segmentBlobs.length || totalBytes < 1024) {
        saveBusy = false;
        updateRecordUi();
        setRecordStatus('录像数据还在写入，请等 2~3 秒后再点保存。', 'warn');
        showToast('录像数据还在写入，请稍后再试');
        return;
      }
      showToast(`正在生成点击前 ${seconds}s 视频…${savingWhileRecording ? '（录制继续）' : ''}`);
      setRecordStatus(`正在生成点击前 ${seconds} 秒视频…${savingWhileRecording ? '（录制继续）' : ''}`);
      try {
        let actualSeconds = seconds;
        const clip = await trimRecordSegments(segmentBlobs, seconds, (elapsed, total) => {
          actualSeconds = total;
          setRecordStatus(`正在生成点击前 ${seconds} 秒视频… ${Math.min(Math.floor(total), Math.floor(elapsed))}/${Math.floor(total)}s${savingWhileRecording ? '（录制继续）' : ''}`);
        });
        const actualClipSeconds = Math.max(1, Math.round(actualSeconds));
        const shortNote = actualClipSeconds < seconds ? `（录像不足 ${seconds} 秒，按实际 ${actualClipSeconds} 秒导出）` : '';
        const clipMime = (clip && clip.type) || mimeType;
        const fileExt = String(clipMime).includes('mp4') ? 'mp4' : 'webm';
        const stamp = new Date();
        const pad = (value) => String(value).padStart(2, '0');
        const filename = `游戏助手回放-${stamp.getFullYear()}${pad(stamp.getMonth() + 1)}${pad(stamp.getDate())}-${pad(stamp.getHours())}${pad(stamp.getMinutes())}${pad(stamp.getSeconds())}-前${actualClipSeconds}s.${fileExt}`;
        let savedLocation = filename;
        if (saveTarget.mode === 'directory') {
          try {
            await writeBlobToDirectory(saveTarget.handle, clip, filename);
            savedLocation = `${saveTarget.name}/${filename}`;
          } catch (error) {
            downloadBlob(clip, filename);
            saveNote = '（写入所选目录失败，已保存到默认下载目录）';
          }
        } else if (saveTarget.mode === 'file') {
          try {
            await writeBlobToFileHandle(saveTarget.handle, clip);
            savedLocation = (saveTarget.handle && saveTarget.handle.name) || '所选位置';
          } catch (error) {
            downloadBlob(clip, filename);
            saveNote = '（写入所选文件失败，已保存到默认下载目录）';
          }
        } else {
          downloadBlob(clip, filename);
        }
        if (recordActive()) {
          setRecordStatus(`已保存：${savedLocation}${shortNote}${saveNote}（录制继续，未停止）`, 'ok');
          recordRestoreTimer = setTimeout(() => {
            recordRestoreTimer = null;
            if (recordActive()) setRecordStatus(recordLiveText(), 'warn');
          }, 5000);
        } else {
          setRecordStatus(`已保存：${savedLocation}${shortNote}${saveNote}`, 'ok');
        }
        showToast(`已保存点击前 ${actualClipSeconds}s 视频${shortNote ? '（按实际时长）' : ''}${saveNote ? '（已回退默认目录）' : ''}${recordActive() ? '，录制继续' : ''}`);
      } catch (error) {
        setRecordStatus('生成失败：' + ((error && error.message) || error), 'err');
        showToast('生成失败：' + ((error && error.message) || error));
      } finally {
        saveBusy = false;
        updateRecordUi();
      }
    };
    refs.recToggle.addEventListener('click', startRecording);
    if (refs.chooseSaveDir) refs.chooseSaveDir.addEventListener('click', chooseSaveDirectory);
    loadRememberedSaveDirectory()
      .then((handle) => {
        if (!handle) return;
        saveDirectoryHandle = handle;
        saveDirectoryName = handle.name || '已选目录';
        updateSaveLocationUi();
      })
      .catch(() => { /* IndexedDB 不可用时忽略 */ });
    updateSaveLocationUi();
    if (refs.saveBtns) refs.saveBtns.forEach((btn) => btn.addEventListener('click', () => saveRecordClip(Number(btn.dataset.seconds) || 30)));

    updateRecordUi();

    // 可配置快捷键（在设置页修改）
    const HOTKEY_ACTION_HANDLERS = {
      panelToggle: () => setPanelHidden(!panelHidden),
      clickToggle: () => {
        settings.clickEnabled = !settings.clickEnabled;
        saveSettings();
        if (refs.clickEnabled) refs.clickEnabled.checked = settings.clickEnabled;
        updateClickStatus();
      },
      recordToggle: () => {
        if (recordActive()) {
          stopRecording();
          showToast('录屏已停止');
        } else {
          startRecording();
        }
      },
      save15: () => saveRecordClip(15),
      save30: () => saveRecordClip(30),
      save60: () => saveRecordClip(60),
      net1: () => applyPreset('normal'),
      net2: () => applyPreset('weak'),
      net3: () => applyPreset('severe'),
      net4: () => applyPreset('jitter'),
      net5: () => applyPreset('loss'),
      net6: () => applyPreset('latency'),
      net7: () => applyPreset('offline'),
      net8: () => applyPreset('offline10'),
    };
    window.addEventListener(
      'keydown',
      (event) => {
        if (!pluginActive()) return;
        const tag = (document.activeElement && document.activeElement.tagName) || '';
        if (/INPUT|TEXTAREA|SELECT/.test(tag)) return;
        const combo = canonicalHotkey(event);
        const hotkeys = settings.hotkeys || DEFAULT_HOTKEYS;
        const entry = Object.entries(hotkeys).find(([, value]) => value === combo);
        if (!entry) return;
        const handler = HOTKEY_ACTION_HANDLERS[entry[0]];
        if (!handler) return;
        event.preventDefault();
        event.stopPropagation();
        handler();
      },
      true,
    );

    // 拖动：整块面板都可拖（按钮/输入框等控件除外），并记住面板位置
    const getPositionBounds = () => {
      const rect = refs.wrap.getBoundingClientRect();
      const width = rect.width || 250;
      const height = rect.height || 300;
      return {
        maxLeft: Math.max(2, window.innerWidth - width - 2),
        maxTop: Math.max(2, window.innerHeight - height - 2),
      };
    };
    const clampPosition = (left, top) => {
      const bounds = getPositionBounds();
      return {
        left: Math.min(bounds.maxLeft, Math.max(2, left)),
        top: Math.min(bounds.maxTop, Math.max(2, top)),
      };
    };
    const applyPosition = (left, top) => {
      const pos = clampPosition(left, top);
      refs.wrap.style.left = pos.left + 'px';
      refs.wrap.style.top = pos.top + 'px';
      refs.wrap.style.right = 'auto';
      refs.wrap.style.bottom = 'auto';
    };
    // 面板重新显示时把位置拉回窗口内，避免窗口变窄后右侧被裁掉
    window.__gameToolClampPanel = () => {
      if (!refs.wrap || !refs.wrap.style.left) return;
      const rect = refs.wrap.getBoundingClientRect();
      applyPosition(rect.left, rect.top);
    };
    const savePanelPosition = () => {
      try {
        const rect = refs.wrap.getBoundingClientRect();
        if (rect.left >= 0 && rect.top >= 0) {
          chrome.storage.local.set({ [POSITION_KEY]: { left: Math.round(rect.left), top: Math.round(rect.top) } });
        }
      } catch (e) {
        /* ignore */
      }
    };
    const DRAG_IGNORE = 'button, input, label, select, textarea, a, .gt-switch, .gt-mode, .gt-apply, .gt-sec-head';
    const onDragStart = (event) => {
      if (event.button !== undefined && event.button !== 0) return;
      const target = event.target;
      if (target && target.closest && target.closest(DRAG_IGNORE)) return;
      const rect = refs.wrap.getBoundingClientRect();
      dragging = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, left: rect.left, top: rect.top };
      refs.panel.classList.add('gt-dragging');
      try {
        refs.panel.setPointerCapture(event.pointerId);
      } catch (e) {
        /* ignore */
      }
      event.preventDefault();
    };
    const onDragMove = (event) => {
      if (!dragging || event.pointerId !== dragging.pointerId) return;
      applyPosition(dragging.left + event.clientX - dragging.startX, dragging.top + event.clientY - dragging.startY);
      event.preventDefault();
    };
    const onDragEnd = (event) => {
      if (!dragging) return;
      if (event && event.pointerId !== undefined && event.pointerId !== dragging.pointerId) return;
      dragging = null;
      refs.panel.classList.remove('gt-dragging');
      savePanelPosition();
    };
    refs.panel.addEventListener('pointerdown', onDragStart);
    window.addEventListener('pointermove', onDragMove, true);
    window.addEventListener('pointerup', onDragEnd, true);
    window.addEventListener('pointercancel', onDragEnd, true);
    window.addEventListener('resize', () => {
      if (refs.wrap.style.left) {
        const rect = refs.wrap.getBoundingClientRect();
        applyPosition(rect.left, rect.top);
      }
    });

    // 折叠胶囊：单击展开，按住可拖动并记住位置
    const onRestorePointerDown = (event) => {
      if (event.button !== undefined && event.button !== 0) return;
      if (event.target && event.target.closest && event.target.closest('#gt-restore-hide')) return;
      const rect = refs.restore.getBoundingClientRect();
      restoreDrag = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, left: rect.left, top: rect.top, moved: false };
      refs.restore.classList.add('dragging');
      try {
        refs.restore.setPointerCapture(event.pointerId);
      } catch (e) {
        /* ignore */
      }
      event.preventDefault();
    };
    const onRestorePointerMove = (event) => {
      if (!restoreDrag || event.pointerId !== restoreDrag.pointerId) return;
      const dx = event.clientX - restoreDrag.startX;
      const dy = event.clientY - restoreDrag.startY;
      if (!restoreDrag.moved && Math.abs(dx) + Math.abs(dy) > 5) restoreDrag.moved = true;
      if (restoreDrag.moved) {
        applyRestorePosition(restoreDrag.left + dx, restoreDrag.top + dy);
        event.preventDefault();
      }
    };
    const onRestorePointerUp = (event) => {
      if (!restoreDrag) return;
      if (event && event.pointerId !== undefined && event.pointerId !== restoreDrag.pointerId) return;
      const wasDrag = restoreDrag.moved;
      restoreDrag = null;
      refs.restore.classList.remove('dragging');
      if (wasDrag) saveRestorePosition();
      else setPanelHidden(false);
    };
    refs.restore.addEventListener('pointerdown', onRestorePointerDown);
    window.addEventListener('pointermove', onRestorePointerMove, true);
    window.addEventListener('pointerup', onRestorePointerUp, true);
    window.addEventListener('pointercancel', onRestorePointerUp, true);

    // 胶囊上的 ×：隐藏这个入口（之后用 Alt+G / F8 / 扩展图标重新打开面板）
    if (refs.restoreHide) {
      refs.restoreHide.addEventListener('pointerdown', (event) => {
        event.stopPropagation();
        event.preventDefault();
      });
      refs.restoreHide.addEventListener('click', (event) => {
        event.stopPropagation();
        event.preventDefault();
        setPanelHidden(true, { showPill: false });
        showToast('入口已隐藏，按 Alt+G 或 F8 可重新打开');
      });
    }

    // 消息与轮询
    window.addEventListener('message', (event) => {
      if (event.source !== window) return;
      const data = event.data;
      if (!data || data.__gameTool !== true || data.dir !== 'up') return;
      if (data.type === 'state' && data.payload) {
        lastState = data.payload;
        updateNetUi(data.payload);
      } else if (data.type === 'note' && data.payload) {
        showTip(data.payload.text || '提示', 'warn');
      }
    });
    setInterval(() => postToPage('getState'), 1200);

    loadSettings(() => {
      syncFromSettings();
      if (savedPosition) applyPosition(savedPosition.left, savedPosition.top);
      if (!recordActive() && !recordChunks.length) {
        setRecordStatus(settings.autoRecord ? '自动录屏已开启；页面出现游戏画面后会自动开始录制。' : '自动录屏已关闭；可手动开始录屏或按快捷键。');
      }
      setTimeout(() => maybeAutoStartRecording(), 800);
    });
    updateNetUi({ mode: 'normal', stats: {}, sockets: 0 });

    // 默认不显示面板；需要时点浏览器扩展图标、按 Alt+G 或 F8 打开
    setPanelHidden(true, { showPill: false });

    // 后台脚本（工具栏图标 / 快捷键）控制面板显隐
    try {
      chrome.runtime.onMessage.addListener((message) => {
        if (!message || message.__gameToolBg !== true) return;
        if (message.type === 'togglePanel') {
          manualEnabled = true;
          setPanelHidden(!panelHidden);
          setTimeout(() => maybeAutoStartRecording(), 300);
        } else if (message.type === 'showPanel') {
          manualEnabled = true;
          setPanelHidden(false);
          setTimeout(() => maybeAutoStartRecording(), 300);
        } else if (message.type === 'hidePanel') {
          setPanelHidden(true);
        }
      });
    } catch (e) {
      /* 本地调试（非扩展环境）下忽略 */
    }

    // 设置页修改后实时同步
    try {
      chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName !== 'local' || !changes[STORAGE_KEY]) return;
        const saved = changes[STORAGE_KEY].newValue || {};
        if (typeof saved.autoRecord === 'boolean') settings.autoRecord = saved.autoRecord;
        if (Array.isArray(saved.enabledDomains)) {
          settings.enabledDomains = saved.enabledDomains.map((item) => String(item).trim()).filter(Boolean);
        } else if (Array.isArray(saved.autoRecordDomains)) {
          settings.enabledDomains = saved.autoRecordDomains.map((item) => String(item).trim()).filter(Boolean);
        }
        if (typeof saved.showRestorePill === 'boolean') settings.showRestorePill = saved.showRestorePill;
        if (typeof saved.defaultSaveDir === 'boolean') settings.defaultSaveDir = saved.defaultSaveDir;
        if (typeof saved.compactMode === 'boolean') settings.compactMode = saved.compactMode;
        if (saved.hotkeys && typeof saved.hotkeys === 'object') {
          const merged = { ...DEFAULT_HOTKEYS };
          Object.keys(DEFAULT_HOTKEYS).forEach((key) => {
            if (typeof saved.hotkeys[key] === 'string' && saved.hotkeys[key]) merged[key] = saved.hotkeys[key];
          });
          settings.hotkeys = merged;
        }
        syncFromSettings();
        updateSaveLocationUi();
        if (!settings.showRestorePill && panelHidden && refs.restore) refs.restore.classList.remove('show');
        if (settings.autoRecord) setTimeout(() => maybeAutoStartRecording(), 300);
      });
    } catch (e) {
      /* 本地调试（非扩展环境）下忽略 */
    }

    window.__gameToolPanel = {
      getReplayCount: () => replayCount,
      getRecordState: () => ({ active: recordActive(), chunks: recordChunks.length, bytes: recordBytes, segments: recordSegments.length, segmentsBytes: recordSegments.reduce((sum, segment) => sum + segment.bytes, 0), source: recordSource }),
      settings,
      presets: NETWORK_PRESETS,
      applyPreset,
      toggle: () => setPanelHidden(!panelHidden),
      show: () => setPanelHidden(false),
      hide: () => setPanelHidden(true, { showPill: true }),
    };
  };

  const applyRestorePosition = (left, top) => {
    if (!refs.restore) return;
    const rect = refs.restore.getBoundingClientRect();
    const width = rect.width || 96;
    const height = rect.height || 34;
    const x = Math.max(2, Math.min(Math.max(2, window.innerWidth - width - 2), Number(left) || 0));
    const y = Math.max(2, Math.min(Math.max(2, window.innerHeight - height - 2), Number(top) || 0));
    refs.restore.style.left = x + 'px';
    refs.restore.style.top = y + 'px';
    refs.restore.style.right = 'auto';
    refs.restore.style.bottom = 'auto';
  };

  const saveRestorePosition = () => {
    if (!refs.restore) return;
    try {
      const rect = refs.restore.getBoundingClientRect();
      if (rect.left >= 0 && rect.top >= 0) {
        chrome.storage.local.set({ [RESTORE_POSITION_KEY]: { left: Math.round(rect.left), top: Math.round(rect.top) } });
      }
    } catch (e) {
      /* ignore */
    }
  };

  const setPanelHidden = (hidden, options = {}) => {
    panelHidden = hidden;
    const showPill = (options.showPill !== undefined ? options.showPill : hidden) && settings.showRestorePill;
    if (!refs.panel) return;
    refs.panel.classList.toggle('gt-hidden', hidden);
    refs.restore.classList.toggle('show', hidden && showPill);
    if (hidden && showPill && savedRestorePosition) {
      applyRestorePosition(savedRestorePosition.left, savedRestorePosition.top);
    }
    if (host) {
      host.dataset.panelHidden = hidden ? '1' : '0';
      host.dataset.panelVisible = hidden ? '0' : '1';
    }
    if (!hidden && typeof window.__gameToolClampPanel === 'function') {
      setTimeout(() => window.__gameToolClampPanel(), 0);
    }
  };

  const loadSettings = (done) => {
    try {
      chrome.storage.local.get([STORAGE_KEY, POSITION_KEY, RESTORE_POSITION_KEY], (result) => {
        const saved = result && result[STORAGE_KEY];
        if (saved) {
          if (typeof saved.clickEnabled === 'boolean') settings.clickEnabled = saved.clickEnabled;
          if (Number.isFinite(Number(saved.clickCount))) settings.clickCount = clamp(saved.clickCount, 1, 99);
          if (Number.isFinite(Number(saved.clickIntervalMs))) settings.clickIntervalMs = clamp(saved.clickIntervalMs, 0, 1000);
          const savedVersion = Number(saved.settingsVersion) || 0;
          // v1.3 起默认补点间隔改为 350ms：老版本里 60ms 这类过短间隔自动迁移一次
          if (savedVersion < 2 && settings.clickIntervalMs <= 80) settings.clickIntervalMs = 350;
          if (typeof saved.showRestorePill === 'boolean') settings.showRestorePill = saved.showRestorePill;
          // v1.5.2 起改为两个区块分别折叠；兼容 v1.5.1 的整体折叠状态
          const oldCollapsed = typeof saved.panelCollapsed === 'boolean' ? saved.panelCollapsed : null;
          if (typeof saved.clickCollapsed === 'boolean') settings.clickCollapsed = saved.clickCollapsed;
          else if (oldCollapsed !== null) settings.clickCollapsed = oldCollapsed;
          if (typeof saved.networkCollapsed === 'boolean') settings.networkCollapsed = saved.networkCollapsed;
          else if (oldCollapsed !== null) settings.networkCollapsed = oldCollapsed;
          if (typeof saved.recordCollapsed === 'boolean') settings.recordCollapsed = saved.recordCollapsed;
          if (typeof saved.autoRecord === 'boolean') settings.autoRecord = saved.autoRecord;
          if (typeof saved.defaultSaveDir === 'boolean') settings.defaultSaveDir = saved.defaultSaveDir;
          if (Array.isArray(saved.enabledDomains)) {
            settings.enabledDomains = saved.enabledDomains.map((item) => String(item).trim()).filter(Boolean);
          } else if (Array.isArray(saved.autoRecordDomains)) {
            settings.enabledDomains = saved.autoRecordDomains.map((item) => String(item).trim()).filter(Boolean);
          }
          if (saved.hotkeys && typeof saved.hotkeys === 'object') {
            const merged = { ...DEFAULT_HOTKEYS };
            Object.keys(DEFAULT_HOTKEYS).forEach((key) => {
              if (typeof saved.hotkeys[key] === 'string' && saved.hotkeys[key]) merged[key] = saved.hotkeys[key];
            });
            settings.hotkeys = merged;
          }
          if (typeof saved.compactMode === 'boolean') settings.compactMode = saved.compactMode;
          if (savedVersion < 10) {
            settings.compactMode = true;
            settings.clickCollapsed = false;
            settings.networkCollapsed = true;
            settings.recordCollapsed = true;
          }
          settings.settingsVersion = 11;
          const allowedReplayModes = ['auto', 'pointer', 'mouse', 'touch', 'trusted'];
          if (saved.replayMode && allowedReplayModes.includes(saved.replayMode)) settings.replayMode = saved.replayMode;
        }
        const pos = result && result[POSITION_KEY];
        if (pos && Number.isFinite(Number(pos.left)) && Number.isFinite(Number(pos.top))) {
          savedPosition = { left: Number(pos.left), top: Number(pos.top) };
        }
        const restorePos = result && result[RESTORE_POSITION_KEY];
        if (restorePos && Number.isFinite(Number(restorePos.left)) && Number.isFinite(Number(restorePos.top))) {
          savedRestorePosition = { left: Number(restorePos.left), top: Number(restorePos.top) };
        }
        done();
      });
    } catch (e) {
      done();
    }
  };

  const saveSettings = () => {
    try {
      chrome.storage.local.set({ [STORAGE_KEY]: { ...settings } });
    } catch (e) {
      /* ignore */
    }
  };

  window.addEventListener('pointerdown', onUserPointerDown, true);

  if (document.documentElement) init();
  else document.addEventListener('DOMContentLoaded', init, { once: true });
})();
