import 'dotenv/config';
import { app, BrowserWindow, shell } from 'electron';
import path from 'path';
import Store from 'electron-store';
import { setStore } from './aws/config';
import { registerSettingsHandlers } from './ipc/settings';
import { registerS3Handlers } from './ipc/s3';
import { registerVideoHandlers } from './ipc/video';

const store = new Store({
  name: 'custom-tools-settings',
  encryptionKey: 'ct-local-store-key',
});

setStore(store as unknown as import('electron-store').default);

// ─── Window ───────────────────────────────────────────────────────────────────

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    show: false,
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  mainWindow.once('ready-to-show', () => mainWindow?.show());

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

app.whenReady().then(() => {
  registerSettingsHandlers(store as unknown as import('electron-store').default);
  registerS3Handlers();
  registerVideoHandlers();

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
