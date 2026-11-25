import { app, BrowserWindow, ipcMain, Menu, shell } from 'electron';
import { autoUpdater } from 'electron-updater';
import path from 'node:path';

export interface UpdateStatusPayload {
  state:
    | 'idle'
    | 'checking'
    | 'available'
    | 'not-available'
    | 'downloading'
    | 'downloaded'
    | 'error';
  version?: string;
  currentVersion: string;
  percent?: number;
  bytesPerSecond?: number;
  releaseUrl?: string;
  message?: string;
}

const GITHUB_OWNER = 'halxo';
const GITHUB_REPO = 'veloframe';
const GITHUB_RELEASES_URL = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases`;

// Hardware-accelerated rendering flags for locked 60-120fps Canvas 2D compositing
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');
app.commandLine.appendSwitch('ignore-gpu-blocklist');

let mainWindow: BrowserWindow | null = null;
let latestUpdateStatus: UpdateStatusPayload = {
  state: 'idle',
  currentVersion: app.getVersion(),
  releaseUrl: GITHUB_RELEASES_URL,
};

function broadcastUpdateStatus(payload: UpdateStatusPayload): void {
  latestUpdateStatus = payload;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('veloframe:update-status', payload);
  }
}

function setupAutoUpdater(): void {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowPrerelease = false;
  autoUpdater.setFeedURL({
    provider: 'github',
    owner: GITHUB_OWNER,
    repo: GITHUB_REPO,
  });

  autoUpdater.on('checking-for-update', () => {
    broadcastUpdateStatus({
      state: 'checking',
      currentVersion: app.getVersion(),
      releaseUrl: GITHUB_RELEASES_URL,
      message: 'Checking GitHub Releases for updates…',
    });
  });

  autoUpdater.on('update-available', (info) => {
    broadcastUpdateStatus({
      state: 'available',
      version: info.version,
      currentVersion: app.getVersion(),
      releaseUrl: `${GITHUB_RELEASES_URL}/tag/v${info.version}`,
      message: `VeloFrame v${info.version} is available. Downloading…`,
    });
  });

  autoUpdater.on('update-not-available', (info) => {
    broadcastUpdateStatus({
      state: 'not-available',
      version: info.version,
      currentVersion: app.getVersion(),
      releaseUrl: GITHUB_RELEASES_URL,
      message: `VeloFrame v${app.getVersion()} is up to date.`,
    });
  });

  autoUpdater.on('download-progress', (progress) => {
    broadcastUpdateStatus({
      state: 'downloading',
      version: latestUpdateStatus.version,
      currentVersion: app.getVersion(),
      percent: Math.round(progress.percent),
      bytesPerSecond: Math.round(progress.bytesPerSecond),
      releaseUrl: latestUpdateStatus.releaseUrl,
      message: `Downloading update (${Math.round(progress.percent)}%)…`,
    });
  });

  autoUpdater.on('update-downloaded', (info) => {
    broadcastUpdateStatus({
      state: 'downloaded',
      version: info.version,
      currentVersion: app.getVersion(),
      percent: 100,
      releaseUrl: `${GITHUB_RELEASES_URL}/tag/v${info.version}`,
      message: `VeloFrame v${info.version} is ready to install.`,
    });
  });

  autoUpdater.on('error', (err) => {
    broadcastUpdateStatus({
      state: 'error',
      currentVersion: app.getVersion(),
      releaseUrl: GITHUB_RELEASES_URL,
      message: err instanceof Error ? err.message : 'Unable to check for updates.',
    });
  });
}

async function triggerUpdateCheck(): Promise<UpdateStatusPayload> {
  if (!app.isPackaged) {
    const devStatus: UpdateStatusPayload = {
      state: 'not-available',
      currentVersion: app.getVersion(),
      releaseUrl: GITHUB_RELEASES_URL,
      message: `Running unpacked dev build (v${app.getVersion()}). Auto-updates run in installed .exe builds pointing to github.com/${GITHUB_OWNER}/${GITHUB_REPO}.`,
    };
    broadcastUpdateStatus(devStatus);
    return devStatus;
  }

  try {
    await autoUpdater.checkForUpdates();
    return latestUpdateStatus;
  } catch (err) {
    const errorStatus: UpdateStatusPayload = {
      state: 'error',
      currentVersion: app.getVersion(),
      releaseUrl: GITHUB_RELEASES_URL,
      message: err instanceof Error ? err.message : 'Failed to check GitHub Releases.',
    };
    broadcastUpdateStatus(errorStatus);
    return errorStatus;
  }
}

function createApplicationMenu(): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: 'File',
      submenu: [{ role: 'quit' }],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'Check for Updates…',
          click: () => {
            void triggerUpdateCheck();
          },
        },
        {
          label: 'GitHub Releases',
          click: () => {
            void shell.openExternal(GITHUB_RELEASES_URL);
          },
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createMainWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    title: 'VeloFrame',
    backgroundColor: '#ECEEF2',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) {
    void mainWindow.loadURL(devUrl);
  } else {
    void mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function registerIpcHandlers(): void {
  ipcMain.handle('veloframe:get-app-info', () => ({
    version: app.getVersion(),
    isPackaged: app.isPackaged,
    platform: process.platform,
    githubRepo: `${GITHUB_OWNER}/${GITHUB_REPO}`,
    releasesUrl: GITHUB_RELEASES_URL,
    updateStatus: latestUpdateStatus,
  }));

  ipcMain.handle('veloframe:check-updates', () => triggerUpdateCheck());

  ipcMain.handle('veloframe:download-update', async () => {
    if (app.isPackaged) {
      await autoUpdater.downloadUpdate();
    }
  });

  ipcMain.handle('veloframe:install-update', () => {
    if (app.isPackaged) {
      autoUpdater.quitAndInstall(false, true);
    }
  });

  ipcMain.handle('veloframe:open-external', (_event, url: string) => {
    if (typeof url === 'string' && (url.startsWith('https://') || url.startsWith('http://'))) {
      return shell.openExternal(url);
    }
    return Promise.resolve();
  });
}

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    setupAutoUpdater();
    registerIpcHandlers();
    createApplicationMenu();
    createMainWindow();

    if (app.isPackaged) {
      setTimeout(() => {
        void triggerUpdateCheck();
      }, 3000);
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createMainWindow();
      }
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });
}
