/**
 * 游戏助手 · 页面注入脚本（MAIN world）
 * 在游戏脚本之前执行，负责：
 *  1. 包装 WebSocket：支持弱网延迟、丢包、断网（阻止新建连接）
 *  2. 包装 fetch / XHR：支持 HTTP 延迟与断网
 *  3. 暴露 window.__gameToolNet 给面板脚本控制，并回传状态
 */
(() => {
  'use strict';
  if (window.__gameToolNet) return;
  const NativeWS = window.WebSocket;
  if (typeof NativeWS !== 'function') return;

  const BLOCK_URL = 'wss://127.0.0.1:1/__game-tool-offline__';

  const state = {
    mode: 'normal', // normal | weak | offline | custom
    latencyMs: 0, // WS 单程延迟
    lossRate: 0, // WS 丢包率 0~1
    httpLatencyMs: 0,
    httpFailRate: 0,
  };

  const stats = {
    created: 0,
    opened: 0,
    closed: 0,
    errored: 0,
    sentFrames: 0,
    recvFrames: 0,
    sentBytes: 0,
    recvBytes: 0,
    droppedInbound: 0,
    droppedOutbound: 0,
    forcedClose: 0,
  };

  const sockets = new Set();
  const messages = [];

  const byteLength = (data) => {
    if (typeof data === 'string') return data.length;
    if (data && typeof data.byteLength === 'number') return data.byteLength;
    if (data && typeof data.size === 'number') return data.size;
    return 0;
  };

  const shouldDrop = (rate) => {
    const value = Number(rate) || 0;
    return value > 0 && Math.random() < Math.min(1, value);
  };

  const currentLatency = () => (state.mode === 'normal' ? 0 : Math.max(0, Number(state.latencyMs) || 0));

  const pushMessage = (direction, data) => {
    let preview = '';
    try {
      if (typeof data === 'string') preview = data.slice(0, 300);
      else preview = '[' + Object.prototype.toString.call(data) + ' ' + byteLength(data) + ']';
    } catch (e) {
      preview = '[unprintable]';
    }
    messages.push({ t: Date.now(), direction, size: byteLength(data), preview });
    if (messages.length > 30) messages.shift();
  };

  const getState = () => ({
    mode: state.mode,
    latencyMs: state.latencyMs,
    lossRate: state.lossRate,
    httpLatencyMs: state.httpLatencyMs,
    httpFailRate: state.httpFailRate,
    stats: { ...stats },
    sockets: sockets.size,
    messages: messages.slice(-5),
  });

  const emit = (type, payload) => {
    try {
      window.postMessage({ __gameTool: true, dir: 'up', type, payload }, '*');
    } catch (e) {
      /* ignore */
    }
  };

  // ---------------- WebSocket 包装 ----------------
  class GameToolWebSocket extends NativeWS {
    constructor(url, protocols) {
      const offline = state.mode === 'offline';
      if (protocols === undefined) super(offline ? BLOCK_URL : url);
      else super(offline ? BLOCK_URL : url, protocols);

      sockets.add(this);
      stats.created += 1;
      this.__gtOnMessage = null;
      this.__gtListeners = new Map();

      const addNative = NativeWS.prototype.addEventListener;
      addNative.call(this, 'open', () => {
        stats.opened += 1;
        emit('state', getState());
      });
      addNative.call(this, 'close', () => {
        stats.closed += 1;
        sockets.delete(this);
        emit('state', getState());
      });
      addNative.call(this, 'error', () => {
        stats.errored += 1;
      });
      addNative.call(this, 'message', (event) => this.__gtDispatch(event));
    }

    __gtDispatch(event) {
      stats.recvFrames += 1;
      stats.recvBytes += byteLength(event && event.data);
      pushMessage('in', event && event.data);
      if (shouldDrop(state.lossRate)) {
        stats.droppedInbound += 1;
        return;
      }
      const delay = currentLatency();
      if (delay > 0) setTimeout(() => this.__gtDeliver(event), delay);
      else this.__gtDeliver(event);
    }

    __gtDeliver(event) {
      const listeners = this.__gtListeners;
      if (!listeners) return;
      if (typeof this.__gtOnMessage === 'function') {
        try {
          this.__gtOnMessage.call(this, event);
        } catch (e) {
          /* ignore */
        }
      }
      for (const listener of Array.from(listeners.keys())) {
        try {
          if (typeof listener === 'function') listener.call(this, event);
          else if (listener && typeof listener.handleEvent === 'function') listener.handleEvent(event);
        } catch (e) {
          /* ignore */
        }
      }
    }

    addEventListener(type, listener, options) {
      if (type !== 'message') return super.addEventListener(type, listener, options);
      this.__gtListeners.set(listener, true);
    }

    removeEventListener(type, listener, options) {
      if (type !== 'message') return super.removeEventListener(type, listener, options);
      this.__gtListeners.delete(listener);
    }

    get onmessage() {
      return this.__gtOnMessage;
    }

    set onmessage(fn) {
      this.__gtOnMessage = typeof fn === 'function' ? fn : null;
    }

    send(data) {
      stats.sentFrames += 1;
      stats.sentBytes += byteLength(data);
      pushMessage('out', data);
      if (shouldDrop(state.lossRate)) {
        stats.droppedOutbound += 1;
        return;
      }
      const delay = currentLatency();
      if (delay > 0) {
        setTimeout(() => {
          try {
            NativeWS.prototype.send.call(this, data);
          } catch (e) {
            /* ignore */
          }
        }, delay);
        return;
      }
      return NativeWS.prototype.send.call(this, data);
    }
  }

  window.WebSocket = GameToolWebSocket;
  window.__gameToolNativeWebSocket = NativeWS;

  // ---------------- fetch 包装 ----------------
  const nativeFetch = window.fetch;
  if (typeof nativeFetch === 'function') {
    window.fetch = function gameToolFetch(input, init) {
      const offline = state.mode === 'offline';
      const fail = offline || shouldDrop(state.httpFailRate);
      const delay = Math.max(0, Number(state.httpLatencyMs) || 0);
      const run = () => {
        if (fail) return Promise.reject(new TypeError('Failed to fetch（游戏助手模拟网络异常）'));
        return nativeFetch.call(window, input, init);
      };
      if (delay > 0) return new Promise((resolve, reject) => setTimeout(() => run().then(resolve, reject), delay));
      return run();
    };
  }

  // ---------------- XHR 包装（延迟 / 断网中止） ----------------
  const NativeXHR = window.XMLHttpRequest;
  if (NativeXHR && NativeXHR.prototype) {
    const nativeXhrSend = NativeXHR.prototype.send;
    NativeXHR.prototype.send = function gameToolXhrSend(body) {
      const offline = state.mode === 'offline';
      const fail = offline || shouldDrop(state.httpFailRate);
      const delay = Math.max(0, Number(state.httpLatencyMs) || 0);
      if (!offline && delay === 0 && !fail) return nativeXhrSend.call(this, body);
      setTimeout(() => {
        if (fail) {
          try {
            this.abort();
          } catch (e) {
            /* ignore */
          }
          return;
        }
        try {
          nativeXhrSend.call(this, body);
        } catch (e) {
          /* ignore */
        }
      }, delay);
      return undefined;
    };
  }

  // ---------------- 控制接口 ----------------
  const applyMode = (params) => {
    const data = params || {};
    const prevMode = state.mode;
    state.mode = data.mode || 'normal';
    state.latencyMs = Math.max(0, Math.min(30000, Number(data.latencyMs) || 0));
    state.lossRate = Math.min(1, Math.max(0, Number(data.lossRate) || 0));
    state.httpLatencyMs = Math.max(0, Math.min(30000, Number(data.httpLatencyMs) || 0));
    state.httpFailRate = Math.min(1, Math.max(0, Number(data.httpFailRate) || 0));

    if (state.mode === 'offline') {
      for (const socket of Array.from(sockets)) {
        try {
          socket.close(4001, 'game-tool-offline');
          stats.forcedClose += 1;
        } catch (e) {
          /* ignore */
        }
      }
    }
    if (prevMode === 'offline' && state.mode !== 'offline') {
      // 从断网切回：页面里已无可用连接，游戏通常会自动重连或需要点「重连网络」
      emit('note', { text: '网络已恢复，若游戏未自动重连，请在游戏内点击「重连网络」或重启游戏' });
    }
    emit('state', getState());
    return getState();
  };

  window.__gameToolNet = {
    getState,
    setMode: applyMode,
    reset() {
      return applyMode({ mode: 'normal' });
    },
  };

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.__gameTool !== true || data.dir !== 'down') return;
    if (data.type === 'setMode') applyMode(data.payload);
    else if (data.type === 'getState') emit('state', getState());
    else if (data.type === 'reset') applyMode({ mode: 'normal' });
  });

  // 页面首次加载完成后主动回报一次
  window.addEventListener('DOMContentLoaded', () => emit('state', getState()));
  setTimeout(() => emit('state', getState()), 1000);
})();
