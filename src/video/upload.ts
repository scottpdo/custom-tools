import { el } from '../utils/dom';
import { ve } from './state';
import { loadLibrary } from './library';
import { addToStrip, initStripDropZone } from './strip';

const veDropZone = el('ve-drop-zone');
const veStrip    = el('ve-strip');

async function handleDroppedFiles(files: File[], addToStripAfter: boolean): Promise<void> {
  const filePaths = files
    .map((f) => (f as File & { path: string }).path)
    .filter(Boolean);
  if (!filePaths.length || !ve.project) return;

  const dropSpan = veDropZone.querySelector('span') as HTMLElement;
  dropSpan.textContent = `Uploading ${filePaths.length} file(s)…`;

  const { bucket, prefix } = ve.project;
  const result = await window.api.video.uploadFiles({ bucket, prefix, filePaths });

  dropSpan.textContent = 'Drop video files here to upload';

  if (result.ok) {
    await loadLibrary();
    if (addToStripAfter) {
      result.results.filter((r) => r.ok).forEach((r) => addToStrip(r.key));
    }
  }
}

export function initUpload(): void {
  // Drop zone (upload only)
  veDropZone.addEventListener('dragover', (e) => {
    if (e.dataTransfer!.types.includes('Files')) {
      e.preventDefault();
      veDropZone.classList.add('ve-drag-active');
    }
  });
  veDropZone.addEventListener('dragleave', () => veDropZone.classList.remove('ve-drag-active'));
  veDropZone.addEventListener('drop', async (e) => {
    e.preventDefault();
    veDropZone.classList.remove('ve-drag-active');
    if (e.dataTransfer!.files.length > 0) {
      await handleDroppedFiles(Array.from(e.dataTransfer!.files), false);
    }
  });

  // Strip drop zone (upload + add to strip)
  initStripDropZone();
  veStrip.addEventListener('drop', async (e) => {
    e.preventDefault();
    veStrip.classList.remove('ve-drag-active');
    if (ve.drag?.type === 'library') {
      addToStrip(ve.drag.key!);
      ve.drag = null;
    } else if (e.dataTransfer!.files.length > 0) {
      await handleDroppedFiles(Array.from(e.dataTransfer!.files), true);
    }
  });

  // Add files button
  el('ve-add-files-btn').addEventListener('click', async () => {
    if (!ve.project) return;
    const result = await window.api.video.openFileDialog();
    if (result.ok && result.paths.length > 0) {
      const { bucket, prefix } = ve.project;
      const uploadResult = await window.api.video.uploadFiles({ bucket, prefix, filePaths: result.paths });
      if (uploadResult.ok) loadLibrary();
    }
  });
}
