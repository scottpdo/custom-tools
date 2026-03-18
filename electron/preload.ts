/**
 * Preload script — runs in a privileged context before the renderer loads.
 * Exposes a curated API via contextBridge so the renderer never touches Node/Electron directly.
 */
import { contextBridge, ipcRenderer } from 'electron';

const invoke = (channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args);

contextBridge.exposeInMainWorld('api', {
  // ── Settings ──────────────────────────────────────────────────────────────
  settings: {
    get:    (key: string)                => invoke('settings:get', key),
    set:    (key: string, value: unknown) => invoke('settings:set', key, value),
    delete: (key: string)                => invoke('settings:delete', key),
  },

  // ── AWS ───────────────────────────────────────────────────────────────────
  aws: {
    getConfig:      ()       => invoke('aws:getConfig'),
    saveConfig:     (config: unknown) => invoke('aws:saveConfig', config),
    testConnection: ()       => invoke('aws:testConnection'),
  },

  // ── S3 ────────────────────────────────────────────────────────────────────
  s3: {
    listBuckets:       ()      => invoke('s3:listBuckets'),
    listObjects:       (opts: unknown) => invoke('s3:listObjects', opts),
    getObject:         (opts: unknown) => invoke('s3:getObject', opts),
    putObject:         (opts: unknown) => invoke('s3:putObject', opts),
    deleteObject:      (opts: unknown) => invoke('s3:deleteObject', opts),
    getPresignedUrl:   (opts: unknown) => invoke('s3:getPresignedUrl', opts),
    downloadFiles:     (opts: unknown) => invoke('s3:downloadFiles', opts),
    showDirectoryDialog: ()   => invoke('s3:showDirectoryDialog'),
    showUploadDialog:   ()    => invoke('s3:showUploadDialog'),
  },

  // ── Video ─────────────────────────────────────────────────────────────────
  video: {
    listProjects:    (opts: unknown) => invoke('video:listProjects', opts),
    createProject:   (opts: unknown) => invoke('video:createProject', opts),
    listProjectFiles:(opts: unknown) => invoke('video:listProjectFiles', opts),
    downloadClip:    (opts: unknown) => invoke('video:downloadClip', opts),
    openFileDialog:  ()              => invoke('video:openFileDialog'),
    uploadFiles:     (opts: unknown) => invoke('video:uploadFiles', opts),
    readProject:     (opts: unknown) => invoke('video:readProject', opts),
    saveProject:     (opts: unknown) => invoke('video:saveProject', opts),
    showSaveDialog:  (opts: unknown) => invoke('video:showSaveDialog', opts),
    render:          (opts: unknown) => invoke('video:render', opts),
    cancelRender:    ()              => invoke('video:cancelRender'),
    onRenderProgress:  (cb: (data: unknown) => void) =>
      ipcRenderer.on('video:render-progress', (_e, data) => cb(data)),
    offRenderProgress: () =>
      ipcRenderer.removeAllListeners('video:render-progress'),
  },
});
