import { ipcMain, dialog } from 'electron';
import path from 'path';
import * as s3 from '../aws/s3';

export function registerS3Handlers(): void {
  ipcMain.handle('s3:listBuckets', () => s3.listBuckets());

  ipcMain.handle('s3:listObjects', (_event, opts: { bucket: string; prefix: string }) =>
    s3.listObjects(opts));

  ipcMain.handle('s3:getObject', (_event, opts: { bucket: string; key: string }) =>
    s3.getObject(opts));

  ipcMain.handle('s3:putObject', (_event, opts: { bucket: string; key: string; filePath: string; contentType?: string }) =>
    s3.putObject(opts));

  ipcMain.handle('s3:deleteObject', (_event, opts: { bucket: string; key: string }) =>
    s3.deleteObject(opts));

  ipcMain.handle('s3:getPresignedUrl', (_event, opts: { bucket: string; key: string; expiresIn?: number }) =>
    s3.getPresignedUrl(opts));

  ipcMain.handle('s3:downloadFiles', async (_event, { bucket, keys, destDir }: { bucket: string; keys: string[]; destDir: string }) => {
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
}
