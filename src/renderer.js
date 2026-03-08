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
      <tr>
        <td>
          <button class="link-btn" data-prefix="${prefix}">📁 ${prefix}</button>
        </td>
        <td>—</td>
        <td>—</td>
        <td></td>
      </tr>
    `);
  });

  // Render objects
  result.objects.forEach((obj) => {
    rows.push(`
      <tr>
        <td title="${obj.key}">${obj.key}</td>
        <td>${formatBytes(obj.size)}</td>
        <td>${new Date(obj.lastModified).toLocaleString()}</td>
        <td>
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

async function handleS3Action(btn) {
  const { action, bucket, key } = btn.dataset;
  if (action === 'presign') {
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
  loadBuckets();
})();
