type RefreshFn = () => void;

export async function uploadFilePaths(
  filePaths: string[],
  bucket: string,
  prefix: string,
  refresh: RefreshFn,
): Promise<void> {
  if (!bucket) { alert('Select a bucket first.'); return; }
  if (!filePaths.length) return;

  const tbody = document.getElementById('s3-tbody') as HTMLTableSectionElement;
  tbody.innerHTML = `<tr><td colspan="5" class="muted">Uploading ${filePaths.length} file(s)…</td></tr>`;

  await Promise.all(
    filePaths.map((filePath) => {
      const fileName = filePath.replace(/\\/g, '/').split('/').pop() ?? filePath;
      return window.api.s3.putObject({ bucket, key: prefix + fileName, filePath });
    })
  );

  refresh();
}

export function initDragUpload(
  panelBody: HTMLElement,
  getBucket: () => string,
  getPrefix: () => string,
  refresh: RefreshFn,
): void {
  panelBody.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if ([...e.dataTransfer!.types].includes('Files')) {
      panelBody.classList.add('s3-drag-active');
    }
  });

  panelBody.addEventListener('dragleave', (e) => {
    if (!panelBody.contains(e.relatedTarget as Node)) {
      panelBody.classList.remove('s3-drag-active');
    }
  });

  panelBody.addEventListener('drop', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    panelBody.classList.remove('s3-drag-active');
    // Electron extends File with a `path` property for OS-dragged files
    const filePaths = Array.from(e.dataTransfer!.files)
      .map((f) => (f as File & { path: string }).path)
      .filter(Boolean);
    await uploadFilePaths(filePaths, getBucket(), getPrefix(), refresh);
  });
}
