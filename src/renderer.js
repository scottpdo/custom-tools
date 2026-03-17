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

const IMAGE_EXTS = new Set(['jpg','jpeg','png','gif','webp','svg','bmp','ico','avif','tiff','tif']);
const isImageKey = (key) => IMAGE_EXTS.has(key.split('.').pop().toLowerCase());

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

  // Pre-select the configured default bucket if present
  const cfg = await window.api.aws.getConfig();
  if (cfg.bucket) bucketSelect.value = cfg.bucket;
}

document.getElementById('btn-list').addEventListener('click', listObjects);
bucketSelect.addEventListener('change', listObjects);

async function listObjects() {
  const bucket = bucketSelect.value;
  if (!bucket) {
    s3Tbody.innerHTML = '<tr><td colspan="4" class="muted">Select a bucket first.</td></tr>';
    return;
  }
  s3Tbody.innerHTML = '<tr><td colspan="4" class="muted">Loading…</td></tr>';

  const result = await window.api.s3.listObjects({ bucket, prefix: prefixInput.value });
  if (!result.ok) {
    s3Tbody.innerHTML = `<tr><td colspan="4" class="muted">Error: ${result.error}</td></tr>`;
    return;
  }

  if (result.objects.length === 0 && result.prefixes.length === 0) {
    s3Tbody.innerHTML = '<tr><td colspan="4" class="muted">Empty.</td></tr>';
    return;
  }

  const rows = [];

  // Render "folders" (common prefixes)
  result.prefixes.forEach((prefix) => {
    rows.push(`
      <tr tabindex="0">
        <td>
          <button class="link-btn" data-prefix="${prefix}">📁 ${prefix}</button>
        </td>
        <td>—</td><td>—</td><td></td>
      </tr>
    `);
  });

  // Render objects
  result.objects.forEach((obj) => {
    const img = isImageKey(obj.key);
    rows.push(`
      <tr tabindex="0"${img ? ` data-image-key="${obj.key}" data-bucket="${bucket}" class="s3-row-image"` : ''}>
        <td title="${obj.key}">${img ? '🖼 ' : ''}${obj.key}</td>
        <td>${formatBytes(obj.size)}</td>
        <td>${new Date(obj.lastModified).toLocaleString()}</td>
        <td>
          ${img ? `<button class="link-btn" data-action="open-image" data-bucket="${bucket}" data-key="${obj.key}">Open</button>` : ''}
          <button class="link-btn" data-action="presign" data-bucket="${bucket}" data-key="${obj.key}">Link</button>
          <button class="link-btn danger" data-action="delete" data-bucket="${bucket}" data-key="${obj.key}">Delete</button>
        </td>
      </tr>
    `);
  });

  s3Tbody.innerHTML = rows.join('');

  // Folder navigation
  s3Tbody.querySelectorAll('[data-prefix]').forEach((btn) => {
    btn.addEventListener('click', () => {
      prefixInput.value = btn.dataset.prefix;
      listObjects();
    });
  });

  // Actions
  s3Tbody.querySelectorAll('[data-action]').forEach((btn) => {
    btn.addEventListener('click', () => handleS3Action(btn));
  });
}

// Keyboard navigation within the table
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

async function handleS3Action(btn) {
  const { action, bucket, key } = btn.dataset;
  if (action === 'open-image') {
    openImageViewer(bucket, key);
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
    if (result.ok) listObjects();
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
