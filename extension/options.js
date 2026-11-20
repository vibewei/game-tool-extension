(() => {
  'use strict';

  const STORAGE_KEY = 'gameToolSettings';
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
  const HOTKEY_ROWS = [
    ['panelToggle', '显示 / 隐藏面板'],
    ['clickToggle', '开关连点'],
    ['recordToggle', '开始 / 停止录屏'],
    ['save15', '保存点击前 15s'],
    ['save30', '保存点击前 30s'],
    ['save60', '保存点击前 60s'],
    ['net1', '网络：正常'],
    ['net2', '网络：弱网'],
    ['net3', '网络：强弱网'],
    ['net4', '网络：抖动'],
    ['net5', '网络：丢包'],
    ['net6', '网络：高延迟'],
    ['net7', '网络：断网'],
    ['net8', '网络：断网10s'],
  ];

  const $ = (id) => document.getElementById(id);
  const canonical = (event) => {
    const parts = [];
    if (event.ctrlKey) parts.push('Ctrl');
    if (event.altKey) parts.push('Alt');
    if (event.shiftKey) parts.push('Shift');
    if (event.metaKey) parts.push('Meta');
    const code = event.code || '';
    parts.push(code.startsWith('Key') || code.startsWith('Digit') ? code : (event.key || code));
    return parts.join('+');
  };
  const display = (combo) => String(combo || '').split('+').map((part) => {
    if (part.startsWith('Key')) return part.slice(3);
    if (part.startsWith('Digit')) return part.slice(5);
    return part;
  }).join('+');
  const isFnKey = (combo) => /^F([1-9]|1[0-2])$/i.test(combo || '');
  const hasModifier = (combo) => /^(Ctrl|Alt|Shift|Meta)\+/.test(combo || '');

  let currentSettings = {};
  let hotkeyInputs = {};

  const setStatus = (text, level) => {
    const el = $('status');
    el.textContent = text || '';
    el.className = 'status' + (level ? ' ' + level : '');
  };

  const renderHotkeys = (hotkeys) => {
    const table = $('hotkeyTable');
    table.innerHTML = '';
    hotkeyInputs = {};
    HOTKEY_ROWS.forEach(([action, label]) => {
      const labelEl = document.createElement('div');
      labelEl.className = 'hotkey-label';
      labelEl.textContent = label;
      const cell = document.createElement('div');
      cell.className = 'hotkey-cell';
      const input = document.createElement('input');
      input.className = 'hotkey-input';
      input.readOnly = true;
      input.dataset.combo = hotkeys[action] || '';
      input.value = display(hotkeys[action] || '');
      input.title = '点这里后按下组合键；Backspace 清空，Esc 取消';
      input.addEventListener('keydown', (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (event.key === 'Escape') { input.blur(); return; }
        if (event.key === 'Backspace') { input.value = ''; input.dataset.combo = ''; return; }
        if (['Control', 'Alt', 'Shift', 'Meta'].includes(event.key)) return;
        const combo = canonical(event);
        input.value = display(combo);
        input.dataset.combo = combo;
        input.blur();
      });
      const reset = document.createElement('button');
      reset.className = 'reset-btn';
      reset.type = 'button';
      reset.textContent = '恢复默认';
      reset.title = '恢复该快捷键的默认值';
      reset.addEventListener('click', () => {
        input.dataset.combo = DEFAULT_HOTKEYS[action];
        input.value = display(DEFAULT_HOTKEYS[action]);
      });
      cell.appendChild(input);
      cell.appendChild(reset);
      table.appendChild(labelEl);
      table.appendChild(cell);
      hotkeyInputs[action] = input;
    });
  };

  const load = () => {
    chrome.storage.local.get([STORAGE_KEY], (result) => {
      const saved = (result && result[STORAGE_KEY]) || {};
      currentSettings = saved;
      $('autoRecord').checked = typeof saved.autoRecord === 'boolean' ? saved.autoRecord : true;
      $('showRestorePill').checked = typeof saved.showRestorePill === 'boolean' ? saved.showRestorePill : true;
      $('compactMode').checked = typeof saved.compactMode === 'boolean' ? saved.compactMode : true;
      const domains = Array.isArray(saved.enabledDomains)
        ? saved.enabledDomains
        : Array.isArray(saved.autoRecordDomains)
          ? saved.autoRecordDomains
          : [];
      $('enabledDomains').value = domains.join('\n');
      const hotkeys = { ...DEFAULT_HOTKEYS };
      if (saved.hotkeys && typeof saved.hotkeys === 'object') {
        Object.keys(DEFAULT_HOTKEYS).forEach((key) => {
          if (typeof saved.hotkeys[key] === 'string') hotkeys[key] = saved.hotkeys[key];
        });
      }
      renderHotkeys(hotkeys);
      $('version').textContent = 'v' + chrome.runtime.getManifest().version;
    });
  };

  const collectSave = () => {
    const enabledDomains = $('enabledDomains').value
      .split(/\r?\n|,/)
      .map((line) => line.trim())
      .filter(Boolean);
    const hotkeys = {};
    const seen = new Map();
    for (const [action] of HOTKEY_ROWS) {
      const input = hotkeyInputs[action];
      const combo = (input.dataset.combo || '').trim();
      if (combo && seen.has(combo)) {
        return { error: `快捷键冲突：${display(combo)} 同时被「${seen.get(combo)}」和「${HOTKEY_ROWS.find((row) => row[0] === action)[1]}」使用` };
      }
      if (combo) seen.set(combo, HOTKEY_ROWS.find((row) => row[0] === action)[1]);
      if (combo && !hasModifier(combo) && !isFnKey(combo)) {
        return { error: `「${HOTKEY_ROWS.find((row) => row[0] === action)[1]}」使用了单个普通按键 ${display(combo)}，容易误触；请加 Ctrl/Alt/Shift 或使用 F1~F12` };
      }
      hotkeys[action] = combo;
    }
    return { enabledDomains, hotkeys };
  };

  $('saveBtn').addEventListener('click', () => {
    const result = collectSave();
    if (result.error) {
      setStatus(result.error, 'err');
      return;
    }
    chrome.storage.local.get([STORAGE_KEY], (stored) => {
      const current = (stored && stored[STORAGE_KEY]) || {};
      const next = {
        ...current,
        autoRecord: $('autoRecord').checked,
        enabledDomains: result.enabledDomains,
        showRestorePill: $('showRestorePill').checked,
        compactMode: $('compactMode').checked,
        hotkeys: result.hotkeys,
        settingsVersion: 11,
      };
      delete next.autoRecordDomains;
      chrome.storage.local.set({ [STORAGE_KEY]: next }, () => {
        if (chrome.runtime.lastError) setStatus('保存失败：' + chrome.runtime.lastError.message, 'err');
        else setStatus('已保存，页面里的助手会实时生效。', 'ok');
      });
    });
  });

  $('resetHotkeys').addEventListener('click', () => {
    renderHotkeys({ ...DEFAULT_HOTKEYS });
    setStatus('已恢复默认快捷键，点「保存设置」后生效。');
  });

  load();
})();
