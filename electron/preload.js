/**
 * Preload script — runs in a privileged context before the renderer loads.
 * Exposes a curated API via contextBridge so the renderer never touches Node/Electron directly.
 */
const { contextBridge, ipcRenderer } = require('electron');

// Helper to keep invocations tidy
const invoke = (channel, ...args) => ipcRenderer.invoke(channel, ...args);

contextBridge.exposeInMainWorld('api', {
  // ── Settings ──────────────────────────────────────────────────────────────
  settings: {
    get: (key) => invoke('settings:get', key),
    set: (key, value) => invoke('settings:set', key, value),
    delete: (key) => invoke('settings:delete', key),
  },

  // ── AWS ───────────────────────────────────────────────────────────────────
  aws: {
    getConfig: () => invoke('aws:getConfig'),
    saveConfig: (config) => invoke('aws:saveConfig', config),
    testConnection: () => invoke('aws:testConnection'),
  },

  // ── S3 ────────────────────────────────────────────────────────────────────
  s3: {
    listBuckets: () => invoke('s3:listBuckets'),
    listObjects: (opts) => invoke('s3:listObjects', opts),
    getObject: (opts) => invoke('s3:getObject', opts),
    putObject: (opts) => invoke('s3:putObject', opts),
    deleteObject: (opts) => invoke('s3:deleteObject', opts),
    getPresignedUrl: (opts) => invoke('s3:getPresignedUrl', opts),
    downloadFiles: (opts) => invoke('s3:downloadFiles', opts),
    showDirectoryDialog: () => invoke('s3:showDirectoryDialog'),
    showUploadDialog: () => invoke('s3:showUploadDialog'),
  },

  // ── Video ─────────────────────────────────────────────────────────────────
  video: {
    listProjects: (opts) => invoke('video:listProjects', opts),
    createProject: (opts) => invoke('video:createProject', opts),
    listProjectFiles: (opts) => invoke('video:listProjectFiles', opts),
    downloadClip: (opts) => invoke('video:downloadClip', opts),
    openFileDialog: () => invoke('video:openFileDialog'),
    uploadFiles: (opts) => invoke('video:uploadFiles', opts),
    readProject: (opts) => invoke('video:readProject', opts),
    saveProject: (opts) => invoke('video:saveProject', opts),
    showSaveDialog: (opts) => invoke('video:showSaveDialog', opts),
    render: (opts) => invoke('video:render', opts),
    cancelRender: () => invoke('video:cancelRender'),
    // Push-style progress events from the main process during a render
    onRenderProgress: (cb) => ipcRenderer.on('video:render-progress', (_e, data) => cb(data)),
    offRenderProgress: () => ipcRenderer.removeAllListeners('video:render-progress'),
  },
});
