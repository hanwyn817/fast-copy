const { BrowserWindow, screen } = require('electron');
const path = require('path');

let SelectionHookConstructor = null;
try {
  SelectionHookConstructor = require('selection-hook');
} catch (error) {
  // Native module not available (likely non-Windows); handled gracefully by consumers.
  console.warn('[SelectionService] selection-hook not available:', error.message);
}

const POSITION_PADDING = 12;
const TOOLBAR_DEFAULT_WIDTH = 180;
const TOOLBAR_DEFAULT_HEIGHT = 48;

const TriggerMode = {
  SELECTED: 'selected',
  CTRL_KEY: 'ctrlkey',
  SHORTCUT: 'shortcut'
};

class SelectionService {
  constructor(options) {
    this.available = Boolean(SelectionHookConstructor);
    this.options = options;
    this.selectionHook = null;

    this.toolbarWindow = null;
    this.toolbarSize = { width: TOOLBAR_DEFAULT_WIDTH, height: TOOLBAR_DEFAULT_HEIGHT };
    this.started = false;
    this.zoomFactor = 1;

    this.blacklist = new Set();
    this.filterMode = 'blacklist';
    this.filterList = [];
    this.triggerMode = TriggerMode.SELECTED;

    this.lastSelectionText = '';

    this.hideListenersAttached = false;
    this.lastCtrlKeyDownAt = 0;
  }

  isAvailable() {
    return this.available;
  }

  updateConfig(config = {}) {
    this.blacklist = new Set(
      Array.isArray(config.blacklist) ? config.blacklist.map((item) => item.toLowerCase()) : []
    );
    this.filterMode = config.selectionFilterMode || 'blacklist';
    this.filterList = Array.isArray(config.selectionFilterList)
      ? config.selectionFilterList.map((item) => item.toLowerCase())
      : [];
    this.triggerMode = config.selectionTriggerMode || TriggerMode.SELECTED;
    this.zoomFactor = Number(config.zoomFactor || 1) || 1;
  }

  setToolbarSize(width, height) {
    if (Number.isFinite(width) && width > 0) {
      this.toolbarSize.width = Math.ceil(width);
    }
    if (Number.isFinite(height) && height > 0) {
      this.toolbarSize.height = Math.ceil(height);
    }
  }

  ensureHook() {
    if (this.selectionHook || !this.available) {
      return;
    }

    this.selectionHook = new SelectionHookConstructor();
    if (!this.selectionHook) {
      throw new Error('Failed to instantiate selection-hook');
    }
  }

  async start() {
    if (!this.available || this.started) {
      return false;
    }

    try {
      this.ensureHook();
      if (!this.selectionHook) {
        return false;
      }

      this.selectionHook.on('text-selection', this.handleTextSelection);
      this.selectionHook.on('error', this.handleHookError);

      this.attachHideListeners();
      this.attachCtrlKeyListener();

      const started = this.selectionHook.start({ debug: Boolean(this.options?.debug) });
      if (!started) {
        this.logError(new Error('selection-hook start() returned false'));
        return false;
      }

      this.started = true;
      this.logInfo('SelectionService started');
      return true;
    } catch (error) {
      this.logError(error);
      return false;
    }
  }

  stop() {
    if (!this.selectionHook || !this.started) {
      return;
    }

    try {
      this.selectionHook.stop();
      this.detachHideListeners();
      this.detachCtrlKeyListener();

      this.hideToolbar();

      this.started = false;
      this.logInfo('SelectionService stopped');
    } catch (error) {
      this.logError(error);
    }
  }

  quit() {
    this.stop();
    if (this.selectionHook) {
      try {
        this.selectionHook.cleanup?.();
      } catch (error) {
        this.logError(error);
      }
    }
    this.selectionHook = null;
    this.started = false;
  }

  handleHookError = (error) => {
    this.logError(error);
  };

  handleTextSelection = (selectionData) => {
    if (!selectionData || typeof selectionData.text !== 'string') {
      return;
    }

    const trimmed = selectionData.text.trim();
    if (!trimmed) {
      this.hideToolbar();
      return;
    }

    if (!this.shouldProcessSelection(selectionData)) {
      this.hideToolbar();
      return;
    }

    const { point, orientation } = this.deriveReferencePoint(selectionData);
    if (!point) {
      this.hideToolbar();
      return;
    }

    this.lastSelectionText = trimmed;
    this.showToolbar(point, orientation, selectionData);
  };

  shouldProcessSelection(selectionData) {
    if (!selectionData) {
      return false;
    }

    const programName = (selectionData.programName || '').toLowerCase();

    if (this.triggerMode === TriggerMode.SELECTED) {
      if (programName && this.blacklist.has(programName)) {
        return false;
      }

      if (this.filterMode === 'whitelist' && this.filterList.length > 0) {
        return this.filterList.some((name) => programName.includes(name));
      }

      if (this.filterMode === 'blacklist' && this.filterList.length > 0) {
        return !this.filterList.some((name) => programName.includes(name));
      }
    }

    return true;
  }

  deriveReferencePoint(selectionData) {
    const rangePadding = POSITION_PADDING * this.zoomFactor;
    const posLevel = selectionData.posLevel;
    const SelectionHook = SelectionHookConstructor;

    let referencePoint = null;
    let orientation = 'bottomRight';

    const toDip = (point) => {
      if (!point) {
        return { x: 0, y: 0 };
      }
      const converted = screen.screenToDipPoint({ x: point.x, y: point.y });
      return { x: Math.round(converted.x), y: Math.round(converted.y) };
    };

    switch (posLevel) {
      case SelectionHook?.PositionLevel.NONE: {
        const cursorPoint = screen.getCursorScreenPoint();
        const dip = toDip({ x: cursorPoint.x, y: cursorPoint.y });
        referencePoint = { x: dip.x, y: dip.y + rangePadding };
        orientation = 'bottomMiddle';
        break;
      }
      case SelectionHook?.PositionLevel.MOUSE_SINGLE: {
        const dip = toDip(selectionData.mousePosEnd);
        referencePoint = { x: dip.x, y: dip.y + rangePadding };
        orientation = 'bottomMiddle';
        break;
      }
      case SelectionHook?.PositionLevel.MOUSE_DUAL: {
        const start = toDip(selectionData.mousePosStart);
        const end = toDip(selectionData.mousePosEnd);
        const yDistance = end.y - start.y;
        const xDistance = end.x - start.x;

        if (Math.abs(yDistance) > 14) {
          if (yDistance > 0) {
            orientation = 'bottomLeft';
            referencePoint = { x: end.x, y: end.y + rangePadding };
          } else {
            orientation = 'topRight';
            referencePoint = { x: end.x, y: end.y - rangePadding };
          }
        } else if (xDistance > 0) {
          orientation = 'bottomLeft';
          referencePoint = { x: end.x, y: end.y + rangePadding };
        } else {
          orientation = 'bottomRight';
          referencePoint = { x: end.x, y: end.y + rangePadding };
        }
        break;
      }
      case SelectionHook?.PositionLevel.SEL_FULL:
      case SelectionHook?.PositionLevel.SEL_DETAILED: {
        const mouseStart = toDip(selectionData.mousePosStart);
        const mouseEnd = toDip(selectionData.mousePosEnd);
        const isNoMouse =
          mouseStart.x === 0 && mouseStart.y === 0 && mouseEnd.x === 0 && mouseEnd.y === 0;

        if (isNoMouse) {
          const endBottom = toDip(selectionData.endBottom);
          orientation = 'bottomLeft';
          referencePoint = { x: endBottom.x, y: endBottom.y + rangePadding / 3 };
          break;
        }

        const isDoubleClick = mouseStart.x === mouseEnd.x && mouseStart.y === mouseEnd.y;
        const startTop = toDip(selectionData.startTop);
        const startBottom = toDip(selectionData.startBottom);
        const endTop = toDip(selectionData.endTop);
        const endBottom = toDip(selectionData.endBottom);

        const isSameLine = startTop.y === endTop.y && startBottom.y === endBottom.y;

        if (isDoubleClick && isSameLine) {
          orientation = 'bottomMiddle';
          referencePoint = { x: mouseEnd.x, y: endBottom.y + rangePadding / 3 };
          break;
        }

        if (isSameLine) {
          const direction = mouseEnd.x - mouseStart.x;
          if (direction >= 0) {
            orientation = 'bottomLeft';
            referencePoint = { x: endBottom.x, y: endBottom.y + rangePadding / 3 };
          } else {
            orientation = 'bottomRight';
            referencePoint = { x: startBottom.x, y: startBottom.y + rangePadding / 3 };
          }
          break;
        }

        const direction = mouseEnd.y - mouseStart.y;
        if (direction >= 0) {
          orientation = 'bottomLeft';
          referencePoint = { x: endBottom.x, y: endBottom.y + rangePadding / 3 };
        } else {
          orientation = 'topRight';
          referencePoint = { x: startTop.x, y: startTop.y - rangePadding / 3 };
        }
        break;
      }
      default: {
        const cursorPoint = screen.getCursorScreenPoint();
        const dip = toDip({ x: cursorPoint.x, y: cursorPoint.y });
        referencePoint = { x: dip.x, y: dip.y + rangePadding };
        orientation = 'bottomMiddle';
      }
    }

    if (!referencePoint) {
      return { point: null, orientation };
    }

    return { point: referencePoint, orientation };
  }

  getToolbarBounds(point, orientation) {
    const display = screen.getDisplayNearestPoint({ x: point.x, y: point.y });
    const workArea = display.workArea;
    const width = Math.round(this.toolbarSize.width * this.zoomFactor);
    const height = Math.round(this.toolbarSize.height * this.zoomFactor);
    let x;
    let y;

    switch (orientation) {
      case 'topLeft':
        x = point.x - width;
        y = point.y - height;
        break;
      case 'topRight':
        x = point.x;
        y = point.y - height;
        break;
      case 'topMiddle':
        x = point.x - width / 2;
        y = point.y - height;
        break;
      case 'bottomLeft':
        x = point.x - width;
        y = point.y;
        break;
      case 'bottomRight':
        x = point.x;
        y = point.y;
        break;
      case 'bottomMiddle':
        x = point.x - width / 2;
        y = point.y;
        break;
      case 'middleLeft':
        x = point.x - width;
        y = point.y - height / 2;
        break;
      case 'middleRight':
        x = point.x;
        y = point.y - height / 2;
        break;
      case 'center':
      default:
        x = point.x - width / 2;
        y = point.y - height / 2;
        break;
    }

    const clamp = (value, min, max) => Math.max(min, Math.min(value, max));
    x = Math.round(clamp(x, workArea.x, workArea.x + workArea.width - width));
    y = Math.round(clamp(y, workArea.y, workArea.y + workArea.height - height));

    return { x, y, width, height };
  }

  showToolbar(point, orientation, selectionData) {
    this.ensureToolbarWindow();

    if (this.toolbarWindow.webContents.isLoading()) {
      this.toolbarWindow.webContents.once('did-finish-load', () => {
        this.showToolbar(point, orientation, selectionData);
      });
      return;
    }

    const bounds = this.getToolbarBounds(point, orientation);

    this.toolbarWindow.setBounds(bounds);
    this.toolbarWindow.showInactive?.();
    this.toolbarWindow.show();

    this.toolbarWindow.webContents.send('selection-copy:show-bubble', {
      text: this.lastSelectionText,
      program: selectionData.programName || ''
    });
  }

  hideToolbar() {
    if (!this.toolbarWindow || this.toolbarWindow.isDestroyed()) {
      return;
    }

    this.toolbarWindow.hide();
    this.toolbarWindow.webContents.send('selection-copy:hide-bubble');
  }

  ensureToolbarWindow() {
    if (this.toolbarWindow && !this.toolbarWindow.isDestroyed()) {
      return;
    }

    this.toolbarWindow = new BrowserWindow({
      width: this.toolbarSize.width,
      height: this.toolbarSize.height,
      frame: false,
      transparent: true,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      show: false,
      skipTaskbar: true,
      focusable: false,
      alwaysOnTop: true,
      hasShadow: false,
      roundedCorners: true,
      backgroundColor: '#00000000',
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false
      }
    });

    this.toolbarWindow.setAlwaysOnTop(true, 'screen-saver');
    this.toolbarWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

    const url = new URL(`file://${path.join(__dirname, 'src/index.html')}`);
    url.searchParams.set('overlay', '1');
    this.toolbarWindow.loadURL(url.toString());

    this.toolbarWindow.on('closed', () => {
      this.toolbarWindow = null;
    });
  }

  writeToClipboard(text) {
    if (!this.selectionHook || !this.started) {
      return false;
    }
    try {
      return this.selectionHook.writeToClipboard(text);
    } catch (error) {
      this.logError(error);
      return false;
    }
  }

  attachHideListeners() {
    if (this.hideListenersAttached || !this.selectionHook) {
      return;
    }
    this.selectionHook.on('mouse-down', this.handleGlobalMouseDown);
    this.selectionHook.on('mouse-wheel', this.handleGlobalMouseWheel);
    this.selectionHook.on('key-down', this.handleGlobalKeyDown);
    this.hideListenersAttached = true;
  }

  detachHideListeners() {
    if (!this.hideListenersAttached || !this.selectionHook) {
      return;
    }
    this.selectionHook.off('mouse-down', this.handleGlobalMouseDown);
    this.selectionHook.off('mouse-wheel', this.handleGlobalMouseWheel);
    this.selectionHook.off('key-down', this.handleGlobalKeyDown);
    this.hideListenersAttached = false;
  }

  attachCtrlKeyListener() {
    if (!this.selectionHook || this.triggerMode !== TriggerMode.CTRL_KEY) {
      return;
    }
    this.selectionHook.on('key-down', this.handleCtrlKeyDown);
    this.selectionHook.on('key-up', this.handleCtrlKeyUp);
  }

  detachCtrlKeyListener() {
    if (!this.selectionHook) {
      return;
    }
    this.selectionHook.off('key-down', this.handleCtrlKeyDown);
    this.selectionHook.off('key-up', this.handleCtrlKeyUp);
  }

  handleGlobalMouseWheel = () => {
    this.hideToolbar();
  };

  handleGlobalKeyDown = (event) => {
    const vk = event?.vkCode;
    if (vk === 160 || vk === 161) return;
    if (vk === 162 || vk === 163) return;
    if (vk === 164 || vk === 165) return;
    this.hideToolbar();
  };

  handleGlobalMouseDown = (event) => {
    if (!this.toolbarWindow || this.toolbarWindow.isDestroyed()) {
      return;
    }
    const mouseDip = screen.screenToDipPoint({ x: event.x, y: event.y });
    const bounds = this.toolbarWindow.getBounds();

    const isInside =
      mouseDip.x >= bounds.x &&
      mouseDip.x <= bounds.x + bounds.width &&
      mouseDip.y >= bounds.y &&
      mouseDip.y <= bounds.y + bounds.height;

    if (!isInside) {
      this.hideToolbar();
    }
  };

  handleCtrlKeyDown = (event) => {
    const vk = event?.vkCode;
    if (vk !== 162 && vk !== 163) {
      if (this.lastCtrlKeyDownAt > 0) {
        this.lastCtrlKeyDownAt = -1;
      }
      return;
    }

    if (this.lastCtrlKeyDownAt === 0) {
      this.lastCtrlKeyDownAt = Date.now();
      return;
    }

    if (this.lastCtrlKeyDownAt === -1) {
      return;
    }

    if (Date.now() - this.lastCtrlKeyDownAt > 350) {
      this.lastCtrlKeyDownAt = -1;
      const selectionData = this.selectionHook?.getCurrentSelection?.();
      if (selectionData) {
        this.handleTextSelection(selectionData);
      }
    }
  };

  handleCtrlKeyUp = (event) => {
    const vk = event?.vkCode;
    if (vk === 162 || vk === 163) {
      this.lastCtrlKeyDownAt = 0;
    }
  };

  logInfo(message) {
    if (this.options?.logger?.info) {
      this.options.logger.info(message);
    } else {
      console.info('[SelectionService]', message);
    }
  }

  logError(error) {
    if (this.options?.logger?.error) {
      this.options.logger.error(error);
    } else {
      console.error('[SelectionService] Error:', error);
    }
  }
}

let serviceInstance = null;

function createSelectionService(options) {
  if (!serviceInstance) {
    serviceInstance = new SelectionService(options);
  }
  return serviceInstance;
}

function getSelectionService() {
  return serviceInstance;
}

module.exports = {
  createSelectionService,
  getSelectionService,
  SelectionService,
  TriggerMode
};
