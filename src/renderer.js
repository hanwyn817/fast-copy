const selectionBridge = window.selectionCopy ?? {};
const bubble = document.getElementById('copy-bubble');
const copyButton = document.getElementById('copy-button');
const feedback = document.getElementById('copy-feedback');

const VIEWPORT_PADDING = 12;
const FEEDBACK_TIMEOUT = 1200;
const ACTIVE_APP_CACHE_MS = 1200;

const DEFAULT_CONFIG = {
  blacklist: [
    'excel.exe',
    'powerpnt.exe',
    'photoshop.exe',
    'acad.exe',
    'mstsc.exe',
    'snipaste.exe',
    'illustrator.exe'
  ],
  delayedCopy: {
    defaultDelayMs: 0,
    apps: {
      'acrobat.exe': 320,
      'acrord32.exe': 320,
      'wps.exe': 280,
      'wpspdf.exe': 280,
      'foxitreader.exe': 260
    }
  },
  animations: {
    enable: true
  },
  theme: 'system',
  bubbleStyle: {
    accentColor: '#4c82ff',
    textColor: '#ffffff',
    backgroundColor: 'rgba(31, 31, 45, 0.9)'
  },
  autoLaunch: true
};

const state = {
  config: structuredClone(DEFAULT_CONFIG),
  blacklist: new Set(),
  delayMap: new Map(),
  defaultDelay: DEFAULT_CONFIG.delayedCopy.defaultDelayMs,
  animationsEnabled: DEFAULT_CONFIG.animations.enable !== false,
  systemTheme: window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
  activeAppCache: {
    timestamp: 0,
    value: null
  },
  lastSelectionText: '',
  selectionCheckQueued: false,
  feedbackTimeoutId: null,
  bubbleVisible: false
};

function structuredClone(value) {
  return JSON.parse(JSON.stringify(value));
}

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const isRecord = (value) => value && typeof value === 'object' && !Array.isArray(value);

const deepMerge = (target, source) => {
  const output = Array.isArray(target) ? [...target] : { ...target };
  if (!isRecord(source)) {
    return output;
  }

  for (const [key, value] of Object.entries(source)) {
    if (Array.isArray(value)) {
      output[key] = [...value];
    } else if (isRecord(value)) {
      output[key] = deepMerge(isRecord(output[key]) ? output[key] : {}, value);
    } else if (value !== undefined) {
      output[key] = value;
    }
  }

  return output;
};

const normalizeProcessName = (value) => (typeof value === 'string' ? value.toLowerCase() : '');

const shadeHexColor = (hex, percent) => {
  const normalized = hex.trim();
  const match = normalized.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!match) {
    return hex;
  }
  let value = match[1];
  if (value.length === 3) {
    value = value
      .split('')
      .map((char) => char + char)
      .join('');
  }
  const num = parseInt(value, 16);
  const r = (num >> 16) & 0xff;
  const g = (num >> 8) & 0xff;
  const b = num & 0xff;

  const adjust = (channel) => {
    const target = percent >= 0 ? 255 : 0;
    return Math.round(channel + (target - channel) * Math.abs(percent));
  };

  const nextR = clamp(adjust(r), 0, 255);
  const nextG = clamp(adjust(g), 0, 255);
  const nextB = clamp(adjust(b), 0, 255);
  return `#${((1 << 24) + (nextR << 16) + (nextG << 8) + nextB).toString(16).slice(1)}`;
};

const applyBubbleStyle = (styleConfig = {}) => {
  const accentColor = styleConfig.accentColor || DEFAULT_CONFIG.bubbleStyle.accentColor;
  const textColor = styleConfig.textColor || DEFAULT_CONFIG.bubbleStyle.textColor;
  const backgroundColor = styleConfig.backgroundColor || DEFAULT_CONFIG.bubbleStyle.backgroundColor;

  document.documentElement.style.setProperty('--accent-color', accentColor);
  document.documentElement.style.setProperty('--accent-color-hover', shadeHexColor(accentColor, 0.16));
  document.documentElement.style.setProperty('--accent-color-active', shadeHexColor(accentColor, -0.12));
  document.documentElement.style.setProperty('--bubble-text', textColor);
  document.documentElement.style.setProperty('--bubble-bg', backgroundColor);
};

const applyAnimationsPreference = (enabled) => {
  state.animationsEnabled = enabled;
  document.documentElement.dataset.animations = enabled ? 'on' : 'off';
};

const applyThemePreference = () => {
  const requested = state.config.theme || 'system';
  const resolved = requested === 'system' ? state.systemTheme : requested;
  document.documentElement.dataset.theme = resolved === 'dark' ? 'dark' : 'light';
};

const applyConfig = (incoming) => {
  const merged = deepMerge(structuredClone(DEFAULT_CONFIG), incoming || {});
  state.config = merged;
  state.blacklist = new Set(
    Array.isArray(merged.blacklist) ? merged.blacklist.map(normalizeProcessName) : []
  );
  const delayEntries = merged.delayedCopy?.apps ? Object.entries(merged.delayedCopy.apps) : [];
  state.delayMap = new Map(delayEntries.map(([key, value]) => [normalizeProcessName(key), Number(value) || 0]));
  state.defaultDelay = Number(merged.delayedCopy?.defaultDelayMs ?? 0);
  applyBubbleStyle(merged.bubbleStyle);
  applyAnimationsPreference(merged.animations?.enable !== false);
  applyThemePreference();
  queueSelectionEvaluation();
};

const clearFeedback = () => {
  if (state.feedbackTimeoutId) {
    clearTimeout(state.feedbackTimeoutId);
    state.feedbackTimeoutId = null;
  }
  feedback.classList.remove('show');
};

const showFeedback = () => {
  clearFeedback();
  feedback.classList.add('show');
  state.feedbackTimeoutId = window.setTimeout(() => {
    feedback.classList.remove('show');
    state.feedbackTimeoutId = null;
  }, FEEDBACK_TIMEOUT);
};

const hideBubble = (immediate = false) => {
  clearFeedback();
  bubble.classList.remove('show');
  state.bubbleVisible = false;
  if (immediate || !state.animationsEnabled) {
    bubble.classList.add('hidden');
    return;
  }
  window.setTimeout(() => {
    if (!state.bubbleVisible) {
      bubble.classList.add('hidden');
    }
  }, 180);
};

const adjustPositionWithinViewport = (left, top) => {
  const width = bubble.offsetWidth || 140;
  const height = bubble.offsetHeight || 40;
  const halfWidth = width / 2;
  const halfHeight = height / 2;

  const clampedLeft = clamp(
    left,
    halfWidth + VIEWPORT_PADDING,
    window.innerWidth - halfWidth - VIEWPORT_PADDING
  );
  const clampedTop = clamp(
    top,
    halfHeight + VIEWPORT_PADDING,
    window.innerHeight - halfHeight - VIEWPORT_PADDING
  );
  return { left: clampedLeft, top: clampedTop };
};

const drawBubble = (position) => {
  bubble.style.left = `${position.left}px`;
  bubble.style.top = `${position.top}px`;
  bubble.classList.remove('hidden');
  bubble.style.visibility = 'hidden';

  requestAnimationFrame(() => {
    const adjusted = adjustPositionWithinViewport(position.left, position.top);
    bubble.style.left = `${adjusted.left}px`;
    bubble.style.top = `${adjusted.top}px`;
    bubble.style.visibility = '';
    bubble.classList.add('show');
    state.bubbleVisible = true;
  });
};

const getSelectionDetails = () => {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
    return null;
  }

  const text = selection.toString().trim();
  if (!text) {
    return null;
  }

  const range = selection.getRangeAt(0).cloneRange();
  const rect = range.getBoundingClientRect();
  if (!rect || (rect.width === 0 && rect.height === 0)) {
    return null;
  }

  const left = rect.right + VIEWPORT_PADDING;
  const top = rect.bottom + VIEWPORT_PADDING;

  return {
    text,
    position: { left, top }
  };
};

const getActiveAppInfo = async (force = false) => {
  if (typeof selectionBridge.getActiveApp !== 'function') {
    return null;
  }

  const now = Date.now();
  if (!force && now - state.activeAppCache.timestamp < ACTIVE_APP_CACHE_MS) {
    return state.activeAppCache.value;
  }

  try {
    const info = await selectionBridge.getActiveApp();
    if (info) {
      info.processName = normalizeProcessName(info.processName || info.name || '');
    }
    state.activeAppCache = {
      timestamp: now,
      value: info
    };
    return info;
  } catch (error) {
    selectionBridge.logError?.({ scope: 'renderer#getActiveApp', message: error.message });
    return null;
  }
};

const shouldSuppressForActiveApp = async () => {
  const info = await getActiveAppInfo();
  if (!info) {
    return false;
  }
  return state.blacklist.has(info.processName);
};

const queueSelectionEvaluation = () => {
  if (state.selectionCheckQueued) {
    return;
  }

  state.selectionCheckQueued = true;
  requestAnimationFrame(async () => {
    state.selectionCheckQueued = false;
    await evaluateSelection();
  });
};

const evaluateSelection = async () => {
  const details = getSelectionDetails();
  if (!details) {
    state.lastSelectionText = '';
    hideBubble();
    return;
  }

  if (await shouldSuppressForActiveApp()) {
    state.lastSelectionText = '';
    hideBubble(true);
    return;
  }

  state.lastSelectionText = details.text;
  drawBubble(details.position);
};

const getCopyDelay = async () => {
  const info = await getActiveAppInfo();
  if (!info) {
    return state.defaultDelay;
  }

  return state.delayMap.get(info.processName) ?? state.defaultDelay;
};

const copyWithFallback = async (text) => {
  if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  textarea.style.pointerEvents = 'none';
  document.body.appendChild(textarea);
  textarea.select();
  try {
    document.execCommand('copy');
  } finally {
    document.body.removeChild(textarea);
  }
};

const handleCopy = async (event) => {
  event.preventDefault();
  event.stopPropagation();

  if (!state.lastSelectionText) {
    hideBubble(true);
    return;
  }

  const delay = await getCopyDelay();
  if (delay > 0) {
    await wait(delay);
  }

  try {
    await copyWithFallback(state.lastSelectionText);
    showFeedback();
  } catch (error) {
    selectionBridge.logError?.({
      scope: 'renderer#copy',
      message: error.message,
      textLength: state.lastSelectionText.length
    });
  }
};

const setupBridgeListeners = () => {
  if (typeof selectionBridge.onConfigUpdated === 'function') {
    selectionBridge.onConfigUpdated((updatedConfig) => {
      applyConfig(updatedConfig);
    });
  }

  if (typeof selectionBridge.onNativeTheme === 'function') {
    selectionBridge.onNativeTheme((mode) => {
      state.systemTheme = mode === 'dark' ? 'dark' : 'light';
      applyThemePreference();
    });
  } else if (window.matchMedia) {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (event) => {
      state.systemTheme = event.matches ? 'dark' : 'light';
      applyThemePreference();
    };
    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', handler);
    } else if (typeof mediaQuery.addListener === 'function') {
      mediaQuery.addListener(handler);
    }
  }
};

const init = async () => {
  applyConfig(DEFAULT_CONFIG);
  setupBridgeListeners();

  if (typeof selectionBridge.readConfig === 'function') {
    try {
      const initialConfig = await selectionBridge.readConfig();
      applyConfig(initialConfig);
    } catch (error) {
      selectionBridge.logError?.({ scope: 'renderer#init', message: error.message });
    }
  }

  document.addEventListener('selectionchange', queueSelectionEvaluation);
  document.addEventListener('mouseup', queueSelectionEvaluation);
  document.addEventListener('keyup', queueSelectionEvaluation);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      window.getSelection()?.removeAllRanges();
      hideBubble(true);
      state.lastSelectionText = '';
    }
  });

  document.addEventListener('mousedown', (event) => {
    if (!bubble.contains(event.target)) {
      hideBubble(true);
    }
  });

  window.addEventListener('resize', queueSelectionEvaluation, { passive: true });
  window.addEventListener('scroll', queueSelectionEvaluation, { passive: true });
  window.addEventListener('blur', () => hideBubble(true));

  copyButton.addEventListener('click', handleCopy);
  hideBubble(true);
};

init().catch((error) => {
  selectionBridge.logError?.({ scope: 'renderer#init', message: error.message });
});
