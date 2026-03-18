import { el } from '../utils/dom';
import { s3PushHistory, s3NavBack, s3NavFwd, s3NavUp } from './history';
import { renderTable } from './table';
import { downloadKeys } from './download';
import { uploadFilePaths, initDragUpload } from './upload';

const bucketSelect = el<HTMLSelectElement>('bucket-select');
const prefixInput  = el<HTMLInputElement>('prefix-input');
const s3Tbody      = el<HTMLTableSectionElement>('s3-tbody');
const s3PanelBody  = el('s3-panel-body');
const btnDlSel     = el<HTMLButtonElement>('btn-download-selected');
const selectAll    = el<HTMLInputElement>('s3-select-all');

// ── Internal listing ───────────────────────────────────────────────────────────

async function doList(bucket: string, prefix: string): Promise<void> {
  if (!bucket) {
    s3Tbody.innerHTML = '<tr><td colspan="5" class="muted">Select a bucket first.</td></tr>';
    selectAll.checked = false;
    updateDownloadSelectedBtn();
    return;
  }
  s3Tbody.innerHTML = '<tr><td colspan="5" class="muted">Loading…</td></tr>';

  const result = await window.api.s3.listObjects({ bucket, prefix });
  if (!result.ok) {
    s3Tbody.innerHTML = `<tr><td colspan="5" class="muted">Error: ${result.error}</td></tr>`;
    return;
  }

  if (result.objects.length === 0 && result.prefixes.length === 0) {
    s3Tbody.innerHTML = '<tr><td colspan="5" class="muted">Empty.</td></tr>';
    return;
  }

  renderTable(s3Tbody, bucket, result.prefixes, result.objects, {
    onFolderClick: (prefix) => {
      prefixInput.value = prefix;
      listObjects();
    },
    onDelete: () => listObjects(false),
    onSelectionChange: onRowCheckChange,
  });

  selectAll.checked = false;
  updateDownloadSelectedBtn();
}

// ── Public API ─────────────────────────────────────────────────────────────────

export async function listObjects(push = true): Promise<void> {
  const bucket = bucketSelect.value;
  const prefix = prefixInput.value;
  if (push) s3PushHistory(bucket, prefix);
  await doList(bucket, prefix);
}

export async function loadBuckets(): Promise<void> {
  const result = await window.api.s3.listBuckets();
  if (!result.ok) return;

  bucketSelect.innerHTML = '<option value="">— select bucket —</option>';
  result.buckets.forEach((b) => {
    const opt = document.createElement('option');
    opt.value = b.name;
    opt.textContent = b.name;
    bucketSelect.appendChild(opt);
  });

  const cfg = await window.api.aws.getConfig();
  if (cfg.bucket) bucketSelect.value = cfg.bucket;
}

// ── Selection helpers ──────────────────────────────────────────────────────────

function updateDownloadSelectedBtn(): void {
  btnDlSel.disabled = s3Tbody.querySelectorAll('.s3-row-check:checked').length === 0;
}

function onRowCheckChange(): void {
  const all     = s3Tbody.querySelectorAll('.s3-row-check');
  const checked = s3Tbody.querySelectorAll('.s3-row-check:checked');
  selectAll.indeterminate = checked.length > 0 && checked.length < all.length;
  selectAll.checked       = all.length > 0 && checked.length === all.length;
  updateDownloadSelectedBtn();
}

// ── Init ───────────────────────────────────────────────────────────────────────

export function initS3Browser(): void {
  // Toolbar buttons
  el('btn-list').addEventListener('click', () => listObjects());
  bucketSelect.addEventListener('change', () => listObjects());

  // Nav buttons
  el('btn-s3-back').addEventListener('click', () => {
    const entry = s3NavBack();
    if (!entry) return;
    bucketSelect.value = entry.bucket;
    prefixInput.value  = entry.prefix;
    doList(entry.bucket, entry.prefix);
  });
  el('btn-s3-fwd').addEventListener('click', () => {
    const entry = s3NavFwd();
    if (!entry) return;
    bucketSelect.value = entry.bucket;
    prefixInput.value  = entry.prefix;
    doList(entry.bucket, entry.prefix);
  });
  el('btn-s3-up').addEventListener('click', () => {
    prefixInput.value = s3NavUp(prefixInput.value);
    listObjects();
  });

  // Select-all checkbox
  selectAll.addEventListener('change', () => {
    s3Tbody.querySelectorAll<HTMLInputElement>('.s3-row-check').forEach((cb) => {
      cb.checked = selectAll.checked;
    });
    updateDownloadSelectedBtn();
  });

  // Download Selected
  btnDlSel.addEventListener('click', async () => {
    const checked = Array.from(s3Tbody.querySelectorAll<HTMLInputElement>('.s3-row-check:checked'));
    await downloadKeys(bucketSelect.value, checked.map((cb) => cb.dataset.key!));
  });

  // Upload button
  el('btn-upload-files').addEventListener('click', async () => {
    const result = await window.api.s3.showUploadDialog();
    if (result.ok && result.paths.length) {
      await uploadFilePaths(result.paths, bucketSelect.value, prefixInput.value, () => listObjects(false));
    }
  });

  // Drag-in upload
  initDragUpload(
    s3PanelBody,
    () => bucketSelect.value,
    () => prefixInput.value,
    () => listObjects(false),
  );
}
