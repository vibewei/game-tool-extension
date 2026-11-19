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
  const VERSION = '1.4.0';

  const settings = {
    clickEnabled: false,
    clickCount: 5,
    clickIntervalMs: 350,
    replayMode: 'auto', // auto | pointer | mouse | touch | trusted
    settingsVersion: 2,
  };

  let host = null;
  let shadow = null;
  let refs = {};
  let replayCount = 0;
  let currentMode = 'normal';
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
    .gt-min { all: unset; cursor: pointer; width: 20px; height: 20px; line-height: 18px; text-align: center; border-radius: 5px; color: #aeb4bf; font-size: 14px; }
    .gt-min:hover { background: rgba(255,255,255,0.12); color: #fff; }
    .gt-body { padding: 10px 12px 8px; }
    .gt-section { padding: 8px 0; border-top: 1px solid rgba(255,255,255,0.08); }
    .gt-section:first-child { border-top: 0; padding-top: 2px; }
    .gt-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin: 7px 0; }
    .gt-label { font-size: 12px; color: #c7cbd3; flex: 0 0 auto; }
    .gt-small { font-size: 10px; color: #8f96a3; }
    .gt-tip { font-size: 10.5px; line-height: 1.5; color: #8f96a3; margin-top: 6px; }
    .gt-tip.warn { color: #f4c15a; }
    .gt-tip.err { color: #ff8a8a; }
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
    .gt-hidden { display: none !important; }
  `;

  const PANEL_HTML = `
    <div class="gt-wrap" id="gt-wrap">
      <div class="gt-panel" id="gt-panel">
        <div class="gt-head" id="gt-head">
          <span class="gt-dot"></span>
          <span class="gt-title">游戏助手</span>
          <span class="gt-net-badge" id="gt-net-badge">正常</span>
          <button class="gt-min" id="gt-min" title="收起 (F8)">—</button>
        </div>
        <div class="gt-body" id="gt-body">
          <div class="gt-section">
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
            <div class="gt-tip">升级/抽卡等有动画的按钮，补点间隔建议 ≥300ms；仍不响应再换「真实输入（调试器）」。</div>
            <div class="gt-tip" id="gt-click-status">开启后：在游戏里点 1 次 = 自动点击设定次数</div>
          </div>
          <div class="gt-section">
            <div class="gt-row">
              <span class="gt-label">网络场景</span>
              <span class="gt-small" id="gt-conn">WS: -</span>
            </div>
            <div class="gt-modes" id="gt-modes">
              <button class="gt-mode active" data-mode="normal">正常</button>
              <button class="gt-mode" data-mode="weak">弱网</button>
              <button class="gt-mode" data-mode="offline">断网</button>
              <button class="gt-mode" data-mode="custom">自定义</button>
            </div>
            <div class="gt-custom" id="gt-custom">
              <div class="gt-row"><span class="gt-label">WS 延迟</span><span class="gt-input-unit"><input type="number" id="gt-latency" min="0" max="10000" step="100" value="800"><em>ms</em></span></div>
              <div class="gt-row"><span class="gt-label">丢包率</span><span class="gt-input-unit"><input type="number" id="gt-loss" min="0" max="100" step="5" value="10"><em>%</em></span></div>
              <div class="gt-row"><span class="gt-label">HTTP 延迟</span><span class="gt-input-unit"><input type="number" id="gt-http-latency" min="0" max="10000" step="100" value="800"><em>ms</em></span></div>
              <button class="gt-apply" id="gt-apply-custom">应用自定义网络</button>
            </div>
            <div class="gt-tip" id="gt-net-status">当前网络：正常</div>
          </div>
          <div class="gt-foot">
            <div class="gt-foot-row">
              <span>游戏助手 v${VERSION}</span>
              <button class="gt-update-btn" id="gt-check-update" title="从代码仓库检查更新">检查更新</button>
            </div>
            <div class="gt-update-status" id="gt-update-status"></div>
            <div>F8 隐藏面板 · F7 开关连点 · 仅作用于当前页面</div>
          </div>
        </div>
      </div>
      <button class="gt-restore" id="gt-restore" title="展开游戏助手（可以拖动）">
        <span class="gt-restore-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
            <path d="M7 7h10a4 4 0 0 1 3.9 3.1l1.1 5.2A2.6 2.6 0 0 1 18.7 18c-.9 0-1.7-.4-2.2-1.1L15.4 15H8.6l-1.1 1.9C7 17.6 6.2 18 5.3 18a2.6 2.6 0 0 1-3.3-2.7l1.1-5.2A4 4 0 0 1 7 7Z"/>
            <path d="M7.5 11.5h2M8.5 10.5v2M16 10.8h.01M17.6 12.4h.01"/>
          </svg>
        </span>
        <span class="gt-restore-text">游戏助手</span>
      </button>
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
  const modeLabel = { normal: '正常', weak: '弱网', offline: '断网', custom: '自定义' };

  const updateNetUi = (state) => {
    if (!state) return;
    currentMode = state.mode || 'normal';
    if (refs.netBadge) {
      refs.netBadge.textContent = modeLabel[currentMode] || currentMode;
      refs.netBadge.className = 'gt-net-badge ' + currentMode;
    }
    if (refs.modes) {
      refs.modes.querySelectorAll('.gt-mode').forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.mode === currentMode);
      });
    }
    const stats = state.stats || {};
    if (refs.conn) {
      refs.conn.textContent = `连接 ${state.sockets || 0} · 建连 ${stats.created || 0} · 收帧 ${stats.recvFrames || 0}`;
    }
    if (refs.netStatus) {
      let text = `当前网络：${modeLabel[currentMode] || currentMode}`;
      if (currentMode === 'weak' || currentMode === 'custom') {
        text += `（延迟 ${state.latencyMs || 0}ms · 丢包 ${Math.round((state.lossRate || 0) * 100)}%）`;
        refs.netStatus.className = 'gt-tip warn';
      } else if (currentMode === 'offline') {
        text += '（已阻止新连接；恢复后如游戏未自动重连，请点游戏内「重连网络」）';
        refs.netStatus.className = 'gt-tip err';
      } else {
        refs.netStatus.className = 'gt-tip';
      }
      refs.netStatus.textContent = text;
    }
    if (host) host.dataset.netMode = currentMode;
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
      loss: shadow.getElementById('gt-loss'),
      httpLatency: shadow.getElementById('gt-http-latency'),
      applyCustom: shadow.getElementById('gt-apply-custom'),
      netStatus: shadow.getElementById('gt-net-status'),
      conn: shadow.getElementById('gt-conn'),
      checkUpdate: shadow.getElementById('gt-check-update'),
      updateStatus: shadow.getElementById('gt-update-status'),
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
    const syncFromSettings = () => {
      refs.clickEnabled.checked = !!settings.clickEnabled;
      refs.clickCount.value = settings.clickCount;
      refs.clickInterval.value = settings.clickIntervalMs;
      refs.replayMode.value = settings.replayMode;
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

    // 网络按钮
    refs.modes.addEventListener('click', (event) => {
      const btn = event.target.closest('.gt-mode');
      if (!btn) return;
      const mode = btn.dataset.mode;
      if (mode === 'normal') {
        refs.custom.classList.remove('show');
        customVisible = false;
        applyNetwork({ mode: 'normal', latencyMs: 0, lossRate: 0, httpLatencyMs: 0, httpFailRate: 0 });
      } else if (mode === 'weak') {
        refs.custom.classList.remove('show');
        customVisible = false;
        applyNetwork({ mode: 'weak', latencyMs: 1000, lossRate: 0.1, httpLatencyMs: 1000, httpFailRate: 0 });
      } else if (mode === 'offline') {
        refs.custom.classList.remove('show');
        customVisible = false;
        applyNetwork({ mode: 'offline', latencyMs: 0, lossRate: 0, httpLatencyMs: 0, httpFailRate: 0 });
      } else if (mode === 'custom') {
        customVisible = !customVisible;
        refs.custom.classList.toggle('show', customVisible);
        if (customVisible) applyCustomNetwork();
      }
    });

    const applyCustomNetwork = () => {
      const latencyMs = clamp(refs.latency.value, 0, 10000);
      const lossRate = clamp(refs.loss.value, 0, 100) / 100;
      const httpLatencyMs = clamp(refs.httpLatency.value, 0, 10000);
      refs.latency.value = latencyMs;
      refs.loss.value = Math.round(lossRate * 100);
      refs.httpLatency.value = httpLatencyMs;
      applyNetwork({ mode: 'custom', latencyMs, lossRate, httpLatencyMs, httpFailRate: 0 });
    };
    refs.applyCustom.addEventListener('click', applyCustomNetwork);

    // 收起 / 展开（悬浮胶囊的展开逻辑在 pointerup 里处理，拖动时不会误触展开）
    refs.min.addEventListener('click', () => setPanelHidden(true));

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
    const DRAG_IGNORE = 'button, input, label, select, textarea, a, .gt-switch, .gt-mode, .gt-apply';
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
    });
    updateNetUi({ mode: 'normal', stats: {}, sockets: 0 });

    // 默认不显示面板；需要时点浏览器扩展图标、按 Alt+G 或 F8 打开
    setPanelHidden(true, { showPill: false });

    // 后台脚本（工具栏图标 / 快捷键）控制面板显隐
    try {
      chrome.runtime.onMessage.addListener((message) => {
        if (!message || message.__gameToolBg !== true) return;
        if (message.type === 'togglePanel') setPanelHidden(!panelHidden);
        else if (message.type === 'showPanel') setPanelHidden(false);
        else if (message.type === 'hidePanel') setPanelHidden(true);
      });
    } catch (e) {
      /* 本地调试（非扩展环境）下忽略 */
    }

    window.__gameToolPanel = {
      getReplayCount: () => replayCount,
      settings,
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
    const showPill = options.showPill !== undefined ? options.showPill : hidden;
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
          settings.settingsVersion = 2;
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

  // 快捷键 F8 显示/隐藏，F7 开关连点
  window.addEventListener(
    'keydown',
    (event) => {
      const tag = (document.activeElement && document.activeElement.tagName) || '';
      if (/INPUT|TEXTAREA|SELECT/.test(tag)) return;
      if (event.key === 'F8') {
        event.preventDefault();
        setPanelHidden(!panelHidden);
      } else if (event.key === 'F7') {
        event.preventDefault();
        settings.clickEnabled = !settings.clickEnabled;
        saveSettings();
        if (refs.clickEnabled) refs.clickEnabled.checked = settings.clickEnabled;
        updateClickStatus();
      }
    },
    true,
  );

  window.addEventListener('pointerdown', onUserPointerDown, true);

  if (document.documentElement) init();
  else document.addEventListener('DOMContentLoaded', init, { once: true });
})();
