require('dotenv').config();
const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const path = require('path');
const Store = require('electron-store');

const { getAwsConfig, saveAwsConfig, setStore } = require('./aws/config');
const s3 = require('./aws/s3');
const video = require('./tools/video');
const render = require('./tools/render');

// Persistent local settings store
const store = new Store({
  name: 'custom-tools-settings',
  encryptionKey: 'ct-local-store-key', // obfuscation; not true encryption
});

// Give the AWS config module access to the store
setStore(store);

// ─── Window ───────────────────────────────────────────────────────────────────

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,   // renderer cannot access Node APIs directly
      nodeIntegration: false,   // security: keep Node out of renderer
      sandbox: false,           // preload needs require(); disable sandbox
    },
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    show: false, // show once ready to avoid flash
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'src', 'index.html'));

  mainWindow.once('ready-to-show', () => mainWindow.show());

  // Open external links in the system browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ─── IPC: Settings ────────────────────────────────────────────────────────────

ipcMain.handle('settings:get', (_event, key) => store.get(key));
ipcMain.handle('settings:set', (_event, key, value) => store.set(key, value));
ipcMain.handle('settings:delete', (_event, key) => store.delete(key));

// ─── IPC: AWS Config ──────────────────────────────────────────────────────────

ipcMain.handle('aws:getConfig', () => {
  const cfg = getAwsConfig();
  // Never expose secret keys to the renderer
  return {
    region: cfg.region,
    bucket: cfg.bucket,
    hasCredentials: !!(cfg.accessKeyId || cfg.profile),
    profile: cfg.profile || null,
  };
});

ipcMain.handle('aws:saveConfig', (_event, config) => {
  saveAwsConfig(config, store);
  return { ok: true };
});

ipcMain.handle('aws:testConnection', async () => {
  const { STSClient, GetCallerIdentityCommand } = require('@aws-sdk/client-sts');
  try {
    const cfg = getAwsConfig();
    const sts = new STSClient({
      region: cfg.region,
      ...(cfg.accessKeyId && {
        credentials: {
          accessKeyId: cfg.accessKeyId,
          secretAccessKey: cfg.secretAccessKey,
        },
      }),
    });
    const identity = await sts.send(new GetCallerIdentityCommand({}));
    return { ok: true, account: identity.Account, arn: identity.Arn };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// ─── IPC: S3 ──────────────────────────────────────────────────────────────────

ipcMain.handle('s3:listObjects', async (_event, { bucket, prefix }) => {
  return s3.listObjects({ bucket, prefix });
});

ipcMain.handle('s3:getObject', async (_event, { bucket, key }) => {
  return s3.getObject({ bucket, key });
});

ipcMain.handle('s3:putObject', async (_event, { bucket, key, filePath, contentType }) => {
  return s3.putObject({ bucket, key, filePath, contentType });
});

ipcMain.handle('s3:deleteObject', async (_event, { bucket, key }) => {
  return s3.deleteObject({ bucket, key });
});

ipcMain.handle('s3:getPresignedUrl', async (_event, { bucket, key, expiresIn }) => {
  return s3.getPresignedUrl({ bucket, key, expiresIn });
});

ipcMain.handle('s3:listBuckets', async () => {
  return s3.listBuckets();
});

ipcMain.handle('s3:downloadFiles', async (_event, { bucket, keys, destDir }) => {
  const results = await Promise.all(
    keys.map((key) => {
      const fileName = path.basename(key);
      return s3.downloadFile({ bucket, key, destPath: path.join(destDir, fileName) });
    })
  );
  const failed = results.filter((r) => !r.ok);
  return failed.length
    ? { ok: false, error: `${failed.length} of ${keys.length} file(s) failed to download` }
    : { ok: true, count: keys.length, destDir };
});

ipcMain.handle('s3:showDirectoryDialog', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory'],
    title: 'Choose Download Folder',
  });
  return result.canceled ? { ok: true, path: null } : { ok: true, path: result.filePaths[0] };
});

ipcMain.handle('s3:showUploadDialog', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openFile', 'multiSelections'],
    title: 'Select Files to Upload',
  });
  return result.canceled ? { ok: true, paths: [] } : { ok: true, paths: result.filePaths };
});

// ─── IPC: Video ───────────────────────────────────────────────────────────────

ipcMain.handle('video:listProjects', async (_event, opts) => {
  return video.listProjects(opts);
});

ipcMain.handle('video:createProject', async (_event, opts) => {
  return video.createProject(opts);
});

ipcMain.handle('video:listProjectFiles', async (_event, opts) => {
  return video.listProjectFiles(opts);
});

ipcMain.handle('video:downloadClip', async (_event, opts) => {
  return video.downloadClip(opts);
});

ipcMain.handle('video:openFileDialog', async () => {
  return video.openFileDialog();
});

ipcMain.handle('video:uploadFiles', async (_event, opts) => {
  return video.uploadFiles(opts);
});

ipcMain.handle('video:readProject', async (_event, opts) => {
  return video.readProject(opts);
});

ipcMain.handle('video:saveProject', async (_event, opts) => {
  return video.saveProject(opts);
});

// ─── IPC: Render ──────────────────────────────────────────────────────────────

ipcMain.handle('video:showSaveDialog', async (_event, { defaultName } = {}) => {
  const result = await dialog.showSaveDialog({
    title: 'Export Video',
    defaultPath: `${defaultName || 'output'}.mp4`,
    filters: [{ name: 'MP4 Video', extensions: ['mp4'] }],
  });
  return result.canceled ? { ok: true, path: null } : { ok: true, path: result.filePath };
});

ipcMain.handle('video:render', async (event, opts) => {
  try {
    return await render.startRender(opts, (progress) => {
      event.sender.send('video:render-progress', progress);
    });
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('video:cancelRender', () => {
  render.cancelRender();
  return { ok: true };
});
