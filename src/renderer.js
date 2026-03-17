/**
 * Renderer process — runs in the browser context with no Node access.
 * Communicates with the main process exclusively via window.api (preload bridge).
 */

// ── Navigation ────────────────────────────────────────────────────────────────

const navItems = document.querySelectorAll('.nav-item[data-tool]');
const panels   = document.querySelectorAll('.panel');

function showPanel(toolName) {
  panels.forEach((p) => p.classList.remove('active'));
  navItems.forEach((n) => n.classList.remove('active'));

  const panel = document.getElementById(`panel-${toolName}`);
  const nav   = document.querySelector(`.nav-item[data-tool="${toolName}"]`);
  if (panel) panel.classList.add('active');
  if (nav)   nav.classList.add('active');

  if (toolName === 's3-browser') listObjects();
}

navItems.forEach((btn) => {
  btn.addEventListener('click', () => showPanel(btn.dataset.tool));
});

// ── AWS connection status ─────────────────────────────────────────────────────

const connectionBadge = document.getElementById('connection-badge');

async function checkConnection() {
  connectionBadge.className = 'badge badge-unknown';
  connectionBadge.textContent = 'Checking AWS…';

  const result = await window.api.aws.testConnection();
  if (result.ok) {
    connectionBadge.className = 'badge badge-ok';
    connectionBadge.textContent = `Connected · ${result.account}`;
  } else {
    connectionBadge.className = 'badge badge-error';
    connectionBadge.textContent = 'Not connected';
  }
}

// ── Settings panel ────────────────────────────────────────────────────────────

const settingsForm   = document.getElementById('settings-form');
const settingsStatus = document.getElementById('settings-status');

async function loadSettingsForm() {
  const cfg = await window.api.aws.getConfig();
  settingsForm.region.value     = cfg.region || '';
  settingsForm.accessKeyId.value= cfg.hasCredentials && !cfg.profile ? '(stored)' : '';
  settingsForm.profile.value    = cfg.profile || '';
  settingsForm.bucket.value     = (await window.api.settings.get('aws.bucket')) || '';
}

settingsForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const data = {
    region:          settingsForm.region.value.trim(),
    accessKeyId:     settingsForm.accessKeyId.value.trim() === '(stored)' ? undefined : settingsForm.accessKeyId.value.trim(),
    secretAccessKey: settingsForm.secretAccessKey.value,
    profile:         settingsForm.profile.value.trim(),
    bucket:          settingsForm.bucket.value.trim(),
  };
  await window.api.aws.saveConfig(data);
  setStatus(settingsStatus, 'ok', 'Settings saved.');
  checkConnection();
});

document.getElementById('btn-test-connection').addEventListener('click', async () => {
  setStatus(settingsStatus, '', 'Testing…');
  const result = await window.api.aws.testConnection();
  if (result.ok) {
    setStatus(settingsStatus, 'ok', `Connected as ${result.arn}`);
  } else {
    setStatus(settingsStatus, 'error', `Error: ${result.error}`);
  }
});

// ── S3 Browser panel ──────────────────────────────────────────────────────────

const bucketSelect = document.getElementById('bucket-select');
const prefixInput  = document.getElementById('prefix-input');
const s3Tbody      = document.getElementById('s3-tbody');
const s3PanelBody  = document.getElementById('s3-panel-body');
const btnBack      = document.getElementById('btn-s3-back');
const btnFwd       = document.getElementById('btn-s3-fwd');
const btnUp        = document.getElementById('btn-s3-up');
const btnDlSel     = document.getElementById('btn-download-selected');
const selectAll    = document.getElementById('s3-select-all');

const IMAGE_EXTS = new Set(['jpg','jpeg','png','gif','webp','svg','bmp','ico','avif','tiff','tif']);
const isImageKey = (key) => IMAGE_EXTS.has(key.split('.').pop().toLowerCase());

// ── Navigation history ─────────────────────────────────────────────────────

let s3History = [];
let s3HistIdx = -1;

function s3PushHistory(bucket, prefix) {
  const cur = s3History[s3HistIdx];
  if (cur && cur.bucket === bucket && cur.prefix === prefix) return;
  s3History.splice(s3HistIdx + 1);
  s3History.push({ bucket, prefix });
  s3HistIdx = s3History.length - 1;
  s3UpdateNavBtns();
}

function s3UpdateNavBtns() {
  btnBack.disabled = s3HistIdx <= 0;
  btnFwd.disabled  = s3HistIdx >= s3History.length - 1;
  btnUp.disabled   = !prefixInput.value;
}

btnBack.addEventListener('click', () => {
  if (s3HistIdx <= 0) return;
  s3HistIdx--;
  const { bucket, prefix } = s3History[s3HistIdx];
  bucketSelect.value = bucket;
  prefixInput.value  = prefix;
  s3UpdateNavBtns();
  _doListObjects(bucket, prefix);
});

btnFwd.addEventListener('click', () => {
  if (s3HistIdx >= s3History.length - 1) return;
  s3HistIdx++;
  const { bucket, prefix } = s3History[s3HistIdx];
  bucketSelect.value = bucket;
  prefixInput.value  = prefix;
  s3UpdateNavBtns();
  _doListObjects(bucket, prefix);
});

btnUp.addEventListener('click', () => {
  const prefix = prefixInput.value;
  if (!prefix) return;
  const trimmed = prefix.endsWith('/') ? prefix.slice(0, -1) : prefix;
  const lastSlash = trimmed.lastIndexOf('/');
  prefixInput.value = lastSlash >= 0 ? trimmed.slice(0, lastSlash + 1) : '';
  listObjects();
});

// ── Buckets ────────────────────────────────────────────────────────────────

async function loadBuckets() {
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

document.getElementById('btn-list').addEventListener('click', () => listObjects());
bucketSelect.addEventListener('change', () => listObjects());

// ── Listing ────────────────────────────────────────────────────────────────

async function listObjects(push = true) {
  const bucket = bucketSelect.value;
  const prefix = prefixInput.value;
  if (push) s3PushHistory(bucket, prefix);
  await _doListObjects(bucket, prefix);
}

async function _doListObjects(bucket, prefix) {
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

  const rows = [];

  // Folders (common prefixes)
  result.prefixes.forEach((pfx) => {
    rows.push(`
      <tr tabindex="0">
        <td></td>
        <td><button class="link-btn" data-prefix="${pfx}">📁 ${pfx}</button></td>
        <td>—</td><td>—</td><td></td>
      </tr>
    `);
  });

  // Files
  result.objects.forEach((obj) => {
    const img = isImageKey(obj.key);
    rows.push(`
      <tr tabindex="0"${img ? ` data-image-key="${obj.key}" data-bucket="${bucket}" class="s3-row-image"` : ''}>
        <td><input type="checkbox" class="s3-row-check" data-key="${obj.key}" /></td>
        <td title="${obj.key}">${img ? '🖼 ' : ''}${obj.key}</td>
        <td>${formatBytes(obj.size)}</td>
        <td>${new Date(obj.lastModified).toLocaleString()}</td>
        <td>
          ${img ? `<button class="link-btn" data-action="open-image" data-bucket="${bucket}" data-key="${obj.key}">Open</button> ` : ''}
          <button class="link-btn" data-action="download" data-bucket="${bucket}" data-key="${obj.key}">Download</button>
          <button class="link-btn" data-action="presign"  data-bucket="${bucket}" data-key="${obj.key}">Link</button>
          <button class="link-btn danger" data-action="delete" data-bucket="${bucket}" data-key="${obj.key}">Delete</button>
        </td>
      </tr>
    `);
  });

  s3Tbody.innerHTML = rows.join('');
  selectAll.checked = false;
  updateDownloadSelectedBtn();

  // Folder navigation
  s3Tbody.querySelectorAll('[data-prefix]').forEach((btn) => {
    btn.addEventListener('click', () => {
      prefixInput.value = btn.dataset.prefix;
      listObjects();
    });
  });

  // Row actions
  s3Tbody.querySelectorAll('[data-action]').forEach((btn) => {
    btn.addEventListener('click', () => handleS3Action(btn));
  });

  // Checkbox events
  s3Tbody.querySelectorAll('.s3-row-check').forEach((cb) => {
    cb.addEventListener('change', onRowCheckChange);
  });
}

// ── Selection ──────────────────────────────────────────────────────────────

function updateDownloadSelectedBtn() {
  const checked = s3Tbody.querySelectorAll('.s3-row-check:checked');
  btnDlSel.disabled = checked.length === 0;
}

function onRowCheckChange() {
  const all     = s3Tbody.querySelectorAll('.s3-row-check');
  const checked = s3Tbody.querySelectorAll('.s3-row-check:checked');
  selectAll.indeterminate = checked.length > 0 && checked.length < all.length;
  selectAll.checked       = all.length > 0 && checked.length === all.length;
  updateDownloadSelectedBtn();
}

selectAll.addEventListener('change', () => {
  s3Tbody.querySelectorAll('.s3-row-check').forEach((cb) => {
    cb.checked = selectAll.checked;
  });
  updateDownloadSelectedBtn();
});

// ── Downloads ──────────────────────────────────────────────────────────────

async function downloadKeys(bucket, keys) {
  if (!keys.length) return;
  const dirResult = await window.api.s3.showDirectoryDialog();
  if (!dirResult.ok || !dirResult.path) return;
  const result = await window.api.s3.downloadFiles({ bucket, keys, destDir: dirResult.path });
  if (!result.ok) alert(`Download failed: ${result.error}`);
}

btnDlSel.addEventListener('click', async () => {
  const bucket  = bucketSelect.value;
  const checked = Array.from(s3Tbody.querySelectorAll('.s3-row-check:checked'));
  await downloadKeys(bucket, checked.map((cb) => cb.dataset.key));
});

// ── Uploads ────────────────────────────────────────────────────────────────

async function uploadFilePaths(filePaths) {
  const bucket = bucketSelect.value;
  const prefix = prefixInput.value;
  if (!bucket) { alert('Select a bucket first.'); return; }
  if (!filePaths.length) return;

  s3Tbody.innerHTML = `<tr><td colspan="5" class="muted">Uploading ${filePaths.length} file(s)…</td></tr>`;
  await Promise.all(
    filePaths.map((filePath) => {
      const fileName = filePath.replace(/\\/g, '/').split('/').pop();
      return window.api.s3.putObject({ bucket, key: prefix + fileName, filePath });
    })
  );
  listObjects(false);
}

document.getElementById('btn-upload-files').addEventListener('click', async () => {
  const result = await window.api.s3.showUploadDialog();
  if (result.ok && result.paths.length) await uploadFilePaths(result.paths);
});

// ── Drag-in upload ─────────────────────────────────────────────────────────

s3PanelBody.addEventListener('dragover', (e) => {
  e.preventDefault();
  e.stopPropagation();
  if ([...e.dataTransfer.types].includes('Files')) {
    s3PanelBody.classList.add('s3-drag-active');
  }
});

s3PanelBody.addEventListener('dragleave', (e) => {
  if (!s3PanelBody.contains(e.relatedTarget)) {
    s3PanelBody.classList.remove('s3-drag-active');
  }
});

s3PanelBody.addEventListener('drop', async (e) => {
  e.preventDefault();
  e.stopPropagation();
  s3PanelBody.classList.remove('s3-drag-active');
  // Electron extends File with a `path` property for OS-dragged files
  const filePaths = Array.from(e.dataTransfer.files).map((f) => f.path).filter(Boolean);
  await uploadFilePaths(filePaths);
});

// ── Keyboard navigation ────────────────────────────────────────────────────

s3Tbody.addEventListener('keydown', (e) => {
  const row = e.target.closest('tr[tabindex]');
  if (!row) return;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    const rows = Array.from(s3Tbody.querySelectorAll('tr[tabindex="0"]'));
    const i    = rows.indexOf(row);
    rows[e.key === 'ArrowDown' ? i + 1 : i - 1]?.focus();
  } else if ((e.key === 'Enter' || e.key === ' ') && row.dataset.imageKey) {
    e.preventDefault();
    openImageViewer(row.dataset.bucket, row.dataset.imageKey);
  }
});

// ── Actions ────────────────────────────────────────────────────────────────

async function handleS3Action(btn) {
  const { action, bucket, key } = btn.dataset;
  if (action === 'open-image') {
    openImageViewer(bucket, key);
  } else if (action === 'download') {
    await downloadKeys(bucket, [key]);
  } else if (action === 'presign') {
    const result = await window.api.s3.getPresignedUrl({ bucket, key, expiresIn: 3600 });
    if (result.ok) {
      await navigator.clipboard.writeText(result.url);
      btn.textContent = 'Copied!';
      setTimeout(() => (btn.textContent = 'Link'), 1500);
    }
  } else if (action === 'delete') {
    if (!confirm(`Delete "${key}"?`)) return;
    const result = await window.api.s3.deleteObject({ bucket, key });
    if (result.ok) listObjects(false);
  }
}

// ── Image viewer overlay ───────────────────────────────────────────────────────

async function openImageViewer(bucket, key) {
  const overlay = document.createElement('div');
  overlay.className = 's3-img-overlay';
  overlay.innerHTML = `
    <button class="s3-img-close" title="Close (Esc)">×</button>
    <div class="s3-img-loading">Loading…</div>
    <div class="s3-img-wrap">
      <img class="s3-img-el" draggable="false" alt="" />
    </div>
    <div class="s3-img-hint">Scroll to zoom · Drag to pan · Esc to close</div>
  `;
  document.body.appendChild(overlay);

  const wrap    = overlay.querySelector('.s3-img-wrap');
  const img     = overlay.querySelector('.s3-img-el');
  const loading = overlay.querySelector('.s3-img-loading');

  let tx = 0, ty = 0, zoom = 1;
  let dragging = false, dragX0, dragY0, tx0, ty0;

  const applyTransform = () => {
    img.style.transform = `translate(${tx}px, ${ty}px) scale(${zoom})`;
  };

  // Fetch and display
  const result = await window.api.s3.getPresignedUrl({ bucket, key, expiresIn: 3600 });
  if (!result.ok) {
    loading.textContent = `Error: ${result.error}`;
    return;
  }
  img.src = result.url;
  img.onload = () => {
    loading.style.display = 'none';
    // Fit-to-screen initial position
    const cw = wrap.clientWidth, ch = wrap.clientHeight;
    const iw = img.naturalWidth,  ih = img.naturalHeight;
    zoom = Math.min(cw / iw, ch / ih);
    tx   = (cw - iw * zoom) / 2;
    ty   = (ch - ih * zoom) / 2;
    applyTransform();
  };
  img.onerror = () => { loading.textContent = 'Failed to load image.'; };

  // Zoom on scroll wheel, anchored at cursor
  wrap.addEventListener('wheel', (e) => {
    e.preventDefault();
    const factor   = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    const newZoom  = Math.max(0.05, Math.min(40, zoom * factor));
    const f        = newZoom / zoom;
    const rect     = wrap.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    tx   = cx - (cx - tx) * f;
    ty   = cy - (cy - ty) * f;
    zoom = newZoom;
    applyTransform();
  }, { passive: false });

  // Pan on drag
  wrap.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    dragging = true;
    dragX0 = e.clientX; dragY0 = e.clientY;
    tx0 = tx; ty0 = ty;
    wrap.style.cursor = 'grabbing';
  });

  const onMouseMove = (e) => {
    if (!dragging) return;
    tx = tx0 + (e.clientX - dragX0);
    ty = ty0 + (e.clientY - dragY0);
    applyTransform();
  };
  const onMouseUp = () => {
    if (!dragging) return;
    dragging = false;
    wrap.style.cursor = '';
  };
  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mouseup',   onMouseUp);

  // Close
  const close = () => {
    overlay.remove();
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup',   onMouseUp);
    document.removeEventListener('keydown',   onKeyDown);
  };
  const onKeyDown = (e) => { if (e.key === 'Escape') close(); };

  overlay.querySelector('.s3-img-close').addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  document.addEventListener('keydown', onKeyDown);
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function formatBytes(bytes) {
  if (bytes == null) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

function setStatus(el, type, msg) {
  el.className = `status-message ${type}`;
  el.textContent = msg;
}

// ── Init ──────────────────────────────────────────────────────────────────────

(async function init() {
  checkConnection();
  loadSettingsForm();
  await loadBuckets();
  // Auto-populate if S3 browser is somehow the starting panel
  if (document.querySelector('.panel.active')?.id === 'panel-s3-browser') listObjects();
})();
