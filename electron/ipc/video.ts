import { ipcMain, dialog } from 'electron';
import * as video from '../tools/video';
import * as render from '../tools/render';

export function registerVideoHandlers(): void {
  ipcMain.handle('video:listProjects',    (_event, opts) => video.listProjects(opts));
  ipcMain.handle('video:createProject',   (_event, opts) => video.createProject(opts));
  ipcMain.handle('video:listProjectFiles',(_event, opts) => video.listProjectFiles(opts));
  ipcMain.handle('video:downloadClip',    (_event, opts) => video.downloadClip(opts));
  ipcMain.handle('video:openFileDialog',  ()             => video.openFileDialog());
  ipcMain.handle('video:uploadFiles',     (_event, opts) => video.uploadFiles(opts));
  ipcMain.handle('video:readProject',     (_event, opts) => video.readProject(opts));
  ipcMain.handle('video:saveProject',     (_event, opts) => video.saveProject(opts));

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
      return { ok: false, error: (err as Error).message };
    }
  });

  ipcMain.handle('video:cancelRender', () => {
    render.cancelRender();
    return { ok: true };
  });
}
