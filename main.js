const {
  app,
  BrowserWindow,
  Tray,
  Menu,
  nativeImage,
  nativeTheme,
  ipcMain,
  shell
} = require('electron');
const path = require('path');
const fs = require('fs');
const fsPromises = require('fs/promises');
const os = require('os');
const activeWin = require('active-win');
const AutoLaunch = require('auto-launch');

const APP_DIR_NAME = 'SelectionCopy';
const CONFIG_FILENAME = 'config.json';
const LOG_DIRNAME = 'logs';
const LOG_FILENAME = 'application.log';
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

let mainWindow;
let tray;
let configWatcher;
let currentConfig = { ...DEFAULT_CONFIG };
let autoLauncher;

const getAppStoragePath = (...segments) =>
  path.join(app.getPath('appData'), APP_DIR_NAME, ...segments);

const getConfigPath = () => getAppStoragePath(CONFIG_FILENAME);

const getLogDirectory = () => getAppStoragePath(LOG_DIRNAME);

const getLogFilePath = () => path.join(getLogDirectory(), LOG_FILENAME);

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

const mergeDeep = (base, overrides) => {
  if (!isRecord(overrides)) {
    return base;
  }

  const output = Array.isArray(base) ? [...base] : { ...base };

  for (const [key, value] of Object.entries(overrides)) {
    if (Array.isArray(value)) {
      output[key] = [...value];
    } else if (isRecord(value)) {
      output[key] = mergeDeep(isRecord(output[key]) ? output[key] : {}, value);
    } else if (value !== undefined) {
      output[key] = value;
    }
  }

  return output;
};

const logMessage = async (level, message, meta = {}) => {
  try {
    await fsPromises.mkdir(getLogDirectory(), { recursive: true });
    const entry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      data: meta
    };
    await fsPromises.appendFile(getLogFilePath(), `${JSON.stringify(entry)}${os.EOL}`, 'utf-8');
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Failed to write log entry', error);
  }
};

const ensureConfigFile = async () => {
  await fsPromises.mkdir(getAppStoragePath(), { recursive: true });
  const configPath = getConfigPath();
  try {
    await fsPromises.access(configPath, fs.constants.F_OK);
  } catch (error) {
    await fsPromises.writeFile(configPath, `${JSON.stringify(DEFAULT_CONFIG, null, 2)}\n`, 'utf-8');
  }
};

const loadConfigFromDisk = async () => {
  try {
    const raw = await fsPromises.readFile(getConfigPath(), 'utf-8');
    const parsed = JSON.parse(raw);
    currentConfig = mergeDeep(DEFAULT_CONFIG, parsed);
  } catch (error) {
    currentConfig = { ...DEFAULT_CONFIG };
    await logMessage('error', 'Failed to read config file, using defaults', { error: error.message });
  }
};

const watchConfigFile = async () => {
  if (configWatcher) {
    configWatcher.close();
  }

  try {
    configWatcher = fs.watch(getConfigPath(), { persistent: false }, async () => {
      await loadConfigFromDisk();
      notifyRendererAboutConfig();
      refreshTrayMenu();
      await applyAutoLaunchSetting();
    });
  } catch (error) {
    await logMessage('error', 'Failed to watch config file', { error: error.message });
  }
};

const notifyRendererAboutConfig = () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('selection-copy:config-updated', currentConfig);
  }
};

const showMainWindow = () => {
  if (!mainWindow) {
    return;
  }
  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  mainWindow.show();
  mainWindow.focus();
};

const trayIconFallback = () => {
  const pngBuffer = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAMAAAAoLQ9TAAABF1BMVEUAAAD///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////+rxJ/qAAAAKXRSTlMAAQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGhscHR4fICEiIyQnKoAyp7IAAAAwSURBVBjTY2AgDVQIhImJiSGKYGEwKikpiWGoYGRsYmBgZGJgYAAWolMBkMNFVQZCOVLYGBgYGZhY2BgYmBi+EAOD8jHK5PnKAAAAAElFTkSuQmCC',
    'base64'
  );
  return nativeImage.createFromBuffer(pngBuffer).resize({ width: 16, height: 16 });
};

const getTrayIcon = () => {
  const iconPath = path.join(__dirname, 'assets', 'tray.png');
  const image = nativeImage.createFromPath(iconPath);
  if (image.isEmpty()) {
    return trayIconFallback();
  }
  return image.resize({ width: 16, height: 16 });
};

const refreshTrayMenu = () => {
  if (!tray) {
    return;
  }

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Open',
      click: showMainWindow
    },
    {
      label: 'Settings',
      click: () => {
        const folderPath = path.dirname(getConfigPath());
        shell.openPath(folderPath);
      }
    },
    { type: 'separator' },
    {
      label: currentConfig.autoLaunch ? 'Disable Auto Launch' : 'Enable Auto Launch',
      click: async () => {
        currentConfig.autoLaunch = !currentConfig.autoLaunch;
        await fsPromises.writeFile(getConfigPath(), `${JSON.stringify(currentConfig, null, 2)}\n`, 'utf-8');
        await applyAutoLaunchSetting();
        refreshTrayMenu();
      }
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => app.quit()
    }
  ]);

  tray.setContextMenu(contextMenu);
};

const createTray = () => {
  if (tray) {
    return;
  }
  tray = new Tray(getTrayIcon());
  tray.setToolTip('SelectionCopy');
  tray.on('click', showMainWindow);
  refreshTrayMenu();
};

const applyAutoLaunchSetting = async () => {
  try {
    if (!autoLauncher) {
      autoLauncher = new AutoLaunch({
        name: 'SelectionCopy',
        path: process.execPath
      });
    }

    const isEnabled = await autoLauncher.isEnabled();
    if (currentConfig.autoLaunch && !isEnabled) {
      await autoLauncher.enable();
    } else if (!currentConfig.autoLaunch && isEnabled) {
      await autoLauncher.disable();
    }
  } catch (error) {
    await logMessage('error', 'Failed to apply auto launch preference', { error: error.message });
  }
};

const createMainWindow = () => {
  mainWindow = new BrowserWindow({
    width: 420,
    height: 380,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'src/index.html'));

  mainWindow.webContents.on('did-finish-load', () => {
    notifyRendererAboutConfig();
    const mode = nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
    mainWindow.webContents.send('selection-copy:native-theme', mode);
  });

  mainWindow.on('close', (event) => {
    if (app.isQuiting) {
      return;
    }
    event.preventDefault();
    mainWindow.hide();
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });
};

const setupIpc = () => {
  ipcMain.handle('selection-copy:read-config', async () => currentConfig);

  ipcMain.handle('selection-copy:get-active-app', async () => {
    try {
      const result = await activeWin();
      if (!result || !result.owner) {
        return null;
      }
      const owner = result.owner;
      const processName =
        (owner.processName || owner.name || owner.path || '').split(path.sep).pop()?.toLowerCase() ?? '';

      return {
        name: owner.name || '',
        processName,
        path: owner.path || '',
        id: owner.processId || null
      };
    } catch (error) {
      await logMessage('error', 'Failed to fetch active window', { error: error.message });
      return null;
    }
  });

  ipcMain.handle('selection-copy:open-config-folder', async () => {
    const folderPath = path.dirname(getConfigPath());
    await shell.openPath(folderPath);
    return true;
  });

  ipcMain.on('selection-copy:log-error', async (_event, payload) => {
    await logMessage('error', 'Renderer reported an error', { payload });
  });
};

const setupNativeThemeBridge = () => {
  nativeTheme.on('updated', () => {
    const mode = nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('selection-copy:native-theme', mode);
    }
  });
};

app.whenReady().then(async () => {
  await ensureConfigFile();
  await loadConfigFromDisk();
  await applyAutoLaunchSetting();
  await watchConfigFile();
  setupIpc();
  setupNativeThemeBridge();
  createMainWindow();
  createTray();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    } else {
      showMainWindow();
    }
  });
});

app.on('before-quit', () => {
  app.isQuiting = true;
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
