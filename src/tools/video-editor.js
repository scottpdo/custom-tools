/**
 * Video Editor renderer logic.
 * Loaded after renderer.js — uses window.api (preload bridge) and the global
 * showPanel / formatBytes functions defined in renderer.js.
 */

// ── State ─────────────────────────────────────────────────────────────────────

const ve = {
  project: null,   // { bucket, prefix, name }
  files:   [],     // S3 objects in the project folder (library)
  strip:   [],     // ordered clip objects: { key, name, localPath, thumbnail, downloading }
  player: { isPlaying: false, currentIdx: -1 },
  drag:    null,   // { type: 'strip'|'library', index?, key? }
};

// ── DOM refs ──────────────────────────────────────────────────────────────────

const veProjectsView = document.getElementById('ve-projects-view');
const veEditorView   = document.getElementById('ve-editor-view');
const veProjectsList = document.getElementById('ve-projects-list');
const veProjectTitle = document.getElementById('ve-project-title');
const veVideo        = document.getElementById('ve-video');
const veStrip        = document.getElementById('ve-strip');
const veStripEmpty   = document.getElementById('ve-strip-empty');
const veDropZone     = document.getElementById('ve-drop-zone');
const veLibraryList  = document.getElementById('ve-library-list');
const veProgressBar  = document.getElementById('ve-progress-bar');
const veProgressFill = document.getElementById('ve-progress-fill');
const veTimeDisplay  = document.getElementById('ve-time-display');
const veCtrlPlay     = document.getElementById('ve-ctrl-play');
const veOverlay      = document.getElementById('ve-player-overlay');
const veOverlayPlay  = document.getElementById('ve-overlay-play');

// ── Navigation ────────────────────────────────────────────────────────────────

document.querySelector('[data-tool="video-editor"]').addEventListener('click', loadProjects);

document.getElementById('ve-back-btn').addEventListener('click', () => {
  stopPlayback();
  showView('projects');
  loadProjects();
});

function showView(name) {
  veProjectsView.classList.toggle('ve-hidden', name !== 'projects');
  veEditorView.classList.toggle('ve-hidden', name !== 'editor');
}

// ── Projects ──────────────────────────────────────────────────────────────────

async function loadProjects() {
  veProjectsList.innerHTML = '<p class="muted">Loading…</p>';
  const cfg = await window.api.aws.getConfig();
  const result = await window.api.video.listProjects({ bucket: cfg.bucket });

  if (!result.ok) {
    veProjectsList.innerHTML = `<p class="muted">Error: ${escHtml(result.error)}</p>`;
    return;
  }

  if (result.projects.length === 0) {
    veProjectsList.innerHTML = '<p class="muted">No projects yet. Create one above.</p>';
    return;
  }

  veProjectsList.innerHTML = '';
  result.projects.forEach((project) => {
    const row = document.createElement('div');
    row.className = 've-project-row';
    row.innerHTML = `
      <div class="ve-project-info">
        <span class="ve-project-name">${escHtml(project.name)}</span>
        <span class="muted" style="font-size:12px">${escHtml(project.prefix)}</span>
      </div>
      <button>Open →</button>
    `;
    row.querySelector('button').addEventListener('click', () => openProject(project));
    veProjectsList.appendChild(row);
  });
}

document.getElementById('ve-create-project-btn').addEventListener('click', async () => {
  const input = document.getElementById('ve-new-project-input');
  const name = input.value.trim();
  if (!name) return;

  const cfg = await window.api.aws.getConfig();
  const result = await window.api.video.createProject({ bucket: cfg.bucket, name });
  if (result.ok) {
    input.value = '';
    openProject({ prefix: result.prefix, name: result.manifest.name });
  } else {
    alert(`Failed to create project: ${result.error}`);
  }
});

async function openProject(project) {
  const cfg = await window.api.aws.getConfig();
  ve.project = { bucket: cfg.bucket, prefix: project.prefix, name: project.name };
  ve.strip = [];
  ve.files = [];
  ve.player = { isPlaying: false, currentIdx: -1 };

  veProjectTitle.textContent = project.name;
  veVideo.src = '';
  veOverlay.style.display = '';
  veCtrlPlay.textContent = '▶';

  showView('editor');
  renderStrip();
  loadLibrary();
}

// ── Library ───────────────────────────────────────────────────────────────────

async function loadLibrary() {
  veLibraryList.innerHTML = '<p class="muted" style="padding:8px 12px">Loading…</p>';
  const { bucket, prefix } = ve.project;
  const result = await window.api.video.listProjectFiles({ bucket, prefix });

  if (!result.ok) {
    veLibraryList.innerHTML = `<p class="muted" style="padding:8px 12px">Error: ${escHtml(result.error)}</p>`;
    return;
  }

  ve.files = result.files;
  renderLibrary();
}

document.getElementById('ve-refresh-lib-btn').addEventListener('click', loadLibrary);

function renderLibrary() {
  if (ve.files.length === 0) {
    veLibraryList.innerHTML = '<p class="muted" style="padding:8px 12px">No video files yet.</p>';
    return;
  }

  veLibraryList.innerHTML = '';
  ve.files.forEach((file) => {
    const name = file.key.split('/').pop();
    const row = document.createElement('div');
    row.className = 've-lib-item';
    row.draggable = true;
    row.dataset.key = file.key;
    row.innerHTML = `
      <span class="ve-lib-name" title="${escHtml(file.key)}">${escHtml(name)}</span>
      <span class="ve-lib-size">${formatBytes(file.size)}</span>
      <button class="ve-lib-add" title="Add to timeline">+</button>
    `;

    row.querySelector('.ve-lib-add').addEventListener('click', () => addToStrip(file.key));

    row.addEventListener('dragstart', (e) => {
      ve.drag = { type: 'library', key: file.key };
      e.dataTransfer.effectAllowed = 'copy';
      e.dataTransfer.setData('text/plain', 'library:' + file.key);
      row.classList.add('ve-dragging');
    });
    row.addEventListener('dragend', () => {
      row.classList.remove('ve-dragging');
      ve.drag = null;
    });

    veLibraryList.appendChild(row);
  });
}

// ── Strip ─────────────────────────────────────────────────────────────────────

function addToStrip(key) {
  const name = key.split('/').pop();
  const clip = { key, name, localPath: null, thumbnail: null, downloading: true };
  ve.strip.push(clip);
  renderStrip();
  downloadAndPrepare(ve.strip.length - 1);
}

function renderStrip() {
  // Remove all clip cards (keep the empty placeholder)
  Array.from(veStrip.children).forEach((child) => {
    if (child !== veStripEmpty) child.remove();
  });

  veStripEmpty.style.display = ve.strip.length === 0 ? 'flex' : 'none';

  ve.strip.forEach((clip, idx) => {
    const card = document.createElement('div');
    card.className = 've-clip-card';
    if (ve.player.isPlaying && ve.player.currentIdx === idx) card.classList.add('ve-playing');
    card.draggable = true;
    card.dataset.idx = idx;

    card.innerHTML = `
      <button class="ve-clip-remove" title="Remove">×</button>
      <div class="ve-clip-thumb">
        ${clip.downloading
          ? '<span class="ve-clip-loading">⟳</span>'
          : clip.thumbnail
            ? `<img src="${clip.thumbnail}" alt="" />`
            : '<span class="ve-clip-no-thumb">🎬</span>'
        }
        ${ve.player.isPlaying && ve.player.currentIdx === idx
          ? '<div class="ve-clip-playing-overlay">▶</div>'
          : ''
        }
      </div>
      <div class="ve-clip-name" title="${escHtml(clip.name)}">${escHtml(clip.name)}</div>
    `;

    card.querySelector('.ve-clip-remove').addEventListener('click', (e) => {
      e.stopPropagation();
      ve.strip.splice(idx, 1);
      if (ve.player.currentIdx >= ve.strip.length) ve.player.currentIdx = ve.strip.length - 1;
      renderStrip();
    });

    // Drag to reorder within strip
    card.addEventListener('dragstart', (e) => {
      if (e.target.classList.contains('ve-clip-remove')) { e.preventDefault(); return; }
      ve.drag = { type: 'strip', index: idx };
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', 'strip:' + idx);
      setTimeout(() => card.classList.add('ve-dragging'), 0);
    });
    card.addEventListener('dragend', () => {
      card.classList.remove('ve-dragging');
      ve.drag = null;
    });
    card.addEventListener('dragover', (e) => {
      if (ve.drag?.type !== 'strip') return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      card.classList.add('ve-drag-over');
    });
    card.addEventListener('dragleave', () => card.classList.remove('ve-drag-over'));
    card.addEventListener('drop', (e) => {
      e.preventDefault();
      card.classList.remove('ve-drag-over');
      if (ve.drag?.type === 'strip' && ve.drag.index !== idx) {
        const [moved] = ve.strip.splice(ve.drag.index, 1);
        ve.strip.splice(idx, 0, moved);
        renderStrip();
      }
    });

    veStrip.insertBefore(card, veStripEmpty);
  });
}

// Strip accepts library drags and OS file drops
veStrip.addEventListener('dragover', (e) => {
  if (ve.drag?.type === 'library' || e.dataTransfer.types.includes('Files')) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    veStrip.classList.add('ve-drag-active');
  }
});
veStrip.addEventListener('dragleave', (e) => {
  if (!veStrip.contains(e.relatedTarget)) veStrip.classList.remove('ve-drag-active');
});
veStrip.addEventListener('drop', async (e) => {
  e.preventDefault();
  veStrip.classList.remove('ve-drag-active');
  if (ve.drag?.type === 'library') {
    addToStrip(ve.drag.key);
    ve.drag = null;
  } else if (e.dataTransfer.files.length > 0) {
    await handleDroppedFiles(Array.from(e.dataTransfer.files), true);
  }
});

// ── Upload ────────────────────────────────────────────────────────────────────

veDropZone.addEventListener('dragover', (e) => {
  if (e.dataTransfer.types.includes('Files')) {
    e.preventDefault();
    veDropZone.classList.add('ve-drag-active');
  }
});
veDropZone.addEventListener('dragleave', () => veDropZone.classList.remove('ve-drag-active'));
veDropZone.addEventListener('drop', async (e) => {
  e.preventDefault();
  veDropZone.classList.remove('ve-drag-active');
  if (e.dataTransfer.files.length > 0) {
    await handleDroppedFiles(Array.from(e.dataTransfer.files), false);
  }
});

document.getElementById('ve-add-files-btn').addEventListener('click', async () => {
  const result = await window.api.video.openFileDialog();
  if (result.ok && result.paths.length > 0) {
    const { bucket, prefix } = ve.project;
    const uploadResult = await window.api.video.uploadFiles({ bucket, prefix, filePaths: result.paths });
    if (uploadResult.ok) loadLibrary();
  }
});

async function handleDroppedFiles(files, addToStripAfter) {
  // In Electron, File objects have a .path property with the local filesystem path
  const filePaths = files.map((f) => f.path).filter(Boolean);
  if (!filePaths.length) return;

  const dropSpan = veDropZone.querySelector('span');
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

// ── Download & thumbnails ─────────────────────────────────────────────────────

async function downloadAndPrepare(idx) {
  const clip = ve.strip[idx];
  if (!clip) return;

  const { bucket } = ve.project;
  const result = await window.api.video.downloadClip({ bucket, key: clip.key });

  if (result.ok) {
    clip.localPath = result.localPath;
    clip.thumbnail = await generateThumbnail(result.localPath);
  } else {
    console.error('Download failed:', result.error);
  }

  clip.downloading = false;
  renderStrip();

  // If playback was waiting on this clip, start it now
  if (ve.player.isPlaying && ve.player.currentIdx === idx && clip.localPath) {
    playClip(idx);
  }
}

function generateThumbnail(localPath) {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    video.muted = true;
    video.preload = 'metadata';
    // Keep it off-screen but attached to DOM (required for Chromium canvas capture)
    video.style.cssText = 'position:fixed;opacity:0;pointer-events:none;width:1px;height:1px;top:-2px';
    document.body.appendChild(video);

    const cleanup = () => { try { video.remove(); } catch {} };
    const timeout = setTimeout(() => { cleanup(); resolve(null); }, 12000);

    video.addEventListener('loadedmetadata', () => {
      video.currentTime = Math.min(0.5, (video.duration || 1) * 0.1);
    });

    video.addEventListener('seeked', () => {
      clearTimeout(timeout);
      try {
        const canvas = document.createElement('canvas');
        canvas.width = 160;
        canvas.height = 90;
        canvas.getContext('2d').drawImage(video, 0, 0, 160, 90);
        resolve(canvas.toDataURL('image/jpeg', 0.8));
      } catch {
        resolve(null);
      } finally {
        cleanup();
      }
    });

    video.addEventListener('error', () => { clearTimeout(timeout); cleanup(); resolve(null); });
    video.src = `file://${localPath}`;
  });
}

// ── Playback ──────────────────────────────────────────────────────────────────

veCtrlPlay.addEventListener('click', togglePlayback);
veOverlayPlay.addEventListener('click', togglePlayback);

function togglePlayback() {
  ve.player.isPlaying ? stopPlayback() : startPlayback();
}

function startPlayback(fromIdx = null) {
  if (ve.strip.length === 0) return;

  const idx = fromIdx !== null
    ? fromIdx
    : (ve.player.currentIdx >= 0 && ve.player.currentIdx < ve.strip.length
        ? ve.player.currentIdx
        : 0);

  const clip = ve.strip[idx];
  if (!clip) return;

  if (clip.downloading || !clip.localPath) {
    // Mark as intending to play; downloadAndPrepare will call playClip when ready
    ve.player.isPlaying = true;
    ve.player.currentIdx = idx;
    veCtrlPlay.textContent = '⟳';
    return;
  }

  playClip(idx);
}

function playClip(idx) {
  const clip = ve.strip[idx];
  if (!clip?.localPath) return;

  ve.player.isPlaying = true;
  ve.player.currentIdx = idx;

  veVideo.src = `file://${clip.localPath}`;
  veVideo.play().catch((err) => console.error('Playback error:', err));

  veCtrlPlay.textContent = '⏸';
  veOverlay.style.display = 'none';
  renderStrip();
}

function stopPlayback() {
  ve.player.isPlaying = false;
  veVideo.pause();
  veCtrlPlay.textContent = '▶';
  veOverlay.style.display = '';
  renderStrip();
}

// Advance to next clip when current one ends
veVideo.addEventListener('ended', () => {
  const nextIdx = ve.player.currentIdx + 1;
  if (nextIdx < ve.strip.length) {
    startPlayback(nextIdx);
  } else {
    // End of strip — reset to beginning
    ve.player.isPlaying = false;
    ve.player.currentIdx = 0;
    veCtrlPlay.textContent = '▶';
    veOverlay.style.display = '';
    renderStrip();
  }
});

veVideo.addEventListener('timeupdate', () => {
  if (!veVideo.duration) return;
  const pct = (veVideo.currentTime / veVideo.duration) * 100;
  veProgressFill.style.width = `${pct}%`;
  veTimeDisplay.textContent = `${fmtTime(veVideo.currentTime)} / ${fmtTime(veVideo.duration)}`;
});

// Click progress bar to seek
veProgressBar.addEventListener('click', (e) => {
  if (!veVideo.duration) return;
  const rect = veProgressBar.getBoundingClientRect();
  veVideo.currentTime = ((e.clientX - rect.left) / rect.width) * veVideo.duration;
});

// ── Utilities ─────────────────────────────────────────────────────────────────

function fmtTime(sec) {
  if (!isFinite(sec)) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
