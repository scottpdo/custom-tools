/**
 * Video Editor renderer logic.
 * Loaded after renderer.js — uses window.api (preload bridge) and the global
 * formatBytes function defined in renderer.js.
 */

// ── State ─────────────────────────────────────────────────────────────────────

const ve = {
  project:  null,   // { bucket, prefix, name }
  manifest: null,   // last-read manifest; updated on save
  files:    [],     // S3 objects in the project folder (library)
  strip:    [],     // ordered clip objects (see addToStrip for shape)
  player:   { isPlaying: false, currentIdx: -1 },
  drag:     null,   // { type: 'strip'|'library', index?, key? }
  dirty:    false,
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
const veSaveBtn      = document.getElementById('ve-save-btn');

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
  ve.project  = { bucket: cfg.bucket, prefix: project.prefix, name: project.name };
  ve.manifest = null;
  ve.strip    = [];
  ve.files    = [];
  ve.player   = { isPlaying: false, currentIdx: -1 };
  ve.dirty    = false;

  veProjectTitle.textContent = project.name;
  veVideo.src = '';
  veOverlay.style.display = '';
  veCtrlPlay.textContent = '▶';
  updateSaveBtn();

  showView('editor');
  renderStrip();

  // Read manifest and load library in parallel
  const [manifestResult] = await Promise.all([
    window.api.video.readProject({ bucket: cfg.bucket, prefix: project.prefix }),
    loadLibrary(),
  ]);

  if (manifestResult.ok) {
    ve.manifest = manifestResult.manifest;
    const videoTrack = manifestResult.manifest.tracks?.find((t) => t.type === 'video')
      ?? manifestResult.manifest.tracks?.[0];
    const savedClips = videoTrack?.clips ?? [];

    if (savedClips.length > 0) {
      ve.strip = savedClips.map((c) => ({
        id:          c.id,
        key:         c.src,
        name:        c.src.split('/').pop(),
        duration:    c.duration    ?? 0,
        trimIn:      c.trim?.in    ?? 0,
        trimOut:     c.trim?.out   ?? (c.duration ?? 0),
        volume:      c.volume      ?? 1.0,
        transitions: c.transitions ?? {},
        effects:     c.effects     ?? [],
        meta:        c.meta        ?? {},
        localPath:   null,
        thumbnail:   null,
        downloading: true,
      }));
      renderStrip();
      ve.strip.forEach((_, idx) => downloadAndPrepare(idx));
    }
  } else {
    // New or unreadable manifest — seed an in-memory one so save works
    ve.manifest = makeEmptyManifest(project.name);
  }
}

function makeEmptyManifest(name) {
  return {
    version:   1,
    name,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    settings:  { frameRate: 30, resolution: { width: 1920, height: 1080 } },
    tracks:    [{ id: 'track-v1', type: 'video', label: 'Video 1', muted: false, clips: [] }],
  };
}

// ── Dirty tracking ────────────────────────────────────────────────────────────

function markDirty() {
  if (ve.dirty) return;
  ve.dirty = true;
  updateSaveBtn();
}

function markClean() {
  ve.dirty = false;
  updateSaveBtn();
}

function updateSaveBtn() {
  veSaveBtn.disabled = !ve.dirty;
  veSaveBtn.textContent = ve.dirty ? 'Save' : 'Saved ✓';
}

// ── Save ──────────────────────────────────────────────────────────────────────

veSaveBtn.addEventListener('click', saveStrip);

async function saveStrip() {
  veSaveBtn.disabled = true;
  veSaveBtn.textContent = 'Saving…';

  // Build manifest clips by laying the strip end-to-end
  let cursor = 0;
  const clips = ve.strip.map((clip) => {
    const dur = clip.duration || 0;
    const mc = {
      id:          clip.id,
      src:         clip.key,
      startTime:   cursor,
      duration:    dur,
      trim:        { in: clip.trimIn ?? 0, out: clip.trimOut ?? dur },
      volume:      clip.volume      ?? 1.0,
      transitions: clip.transitions ?? {},
      effects:     clip.effects     ?? [],
      meta:        clip.meta        ?? {},
    };
    cursor += dur;
    return mc;
  });

  const updatedManifest = {
    ...ve.manifest,
    updatedAt: new Date().toISOString(),
    tracks: [
      {
        ...(ve.manifest.tracks?.[0] ?? { id: 'track-v1', type: 'video', label: 'Video 1', muted: false }),
        clips,
      },
      ...(ve.manifest.tracks?.slice(1) ?? []),
    ],
  };

  const result = await window.api.video.saveProject({
    bucket:   ve.project.bucket,
    prefix:   ve.project.prefix,
    manifest: updatedManifest,
  });

  if (result.ok) {
    ve.manifest = updatedManifest;
    markClean();
  } else {
    // Re-enable on failure so user can retry
    ve.dirty = true;
    updateSaveBtn();
    alert(`Save failed: ${result.error}`);
  }
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
  ve.strip.push({
    id:          generateId(),
    key,
    name:        key.split('/').pop(),
    duration:    0,    // filled in after download
    trimIn:      0,
    trimOut:     0,    // filled in after download
    volume:      1.0,
    transitions: {},
    effects:     [],
    meta:        {},
    localPath:   null,
    thumbnail:   null,
    downloading: true,
  });
  renderStrip();
  markDirty();
  downloadAndPrepare(ve.strip.length - 1);
}

function renderStrip() {
  Array.from(veStrip.children).forEach((child) => {
    if (child !== veStripEmpty) child.remove();
  });

  veStripEmpty.style.display = ve.strip.length === 0 ? 'flex' : 'none';

  ve.strip.forEach((clip, idx) => {
    const isPlaying = ve.player.isPlaying && ve.player.currentIdx === idx;
    const card = document.createElement('div');
    card.className = 've-clip-card' + (isPlaying ? ' ve-playing' : '');
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
        ${isPlaying ? '<div class="ve-clip-playing-overlay">▶</div>' : ''}
      </div>
      <div class="ve-clip-name" title="${escHtml(clip.name)}">${escHtml(clip.name)}</div>
    `;

    card.querySelector('.ve-clip-remove').addEventListener('click', (e) => {
      e.stopPropagation();
      ve.strip.splice(idx, 1);
      if (ve.player.currentIdx >= ve.strip.length) ve.player.currentIdx = ve.strip.length - 1;
      renderStrip();
      markDirty();
    });

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
        markDirty();
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

// ── Download & video info ─────────────────────────────────────────────────────

async function downloadAndPrepare(idx) {
  const clip = ve.strip[idx];
  if (!clip) return;

  const result = await window.api.video.downloadClip({ bucket: ve.project.bucket, key: clip.key });

  if (result.ok) {
    clip.localPath = result.localPath;
    const { thumbnail, duration } = await extractVideoInfo(result.localPath);
    clip.thumbnail = thumbnail;
    // Only update duration when we don't already have it from a saved manifest
    if (!clip.duration) {
      clip.duration = duration;
      clip.trimOut  = duration;
      markDirty(); // now we know the real duration; worth saving
    }
  } else {
    console.error('Download failed:', result.error);
  }

  clip.downloading = false;
  renderStrip();

  // Resume playback if this clip was being waited on
  if (ve.player.isPlaying && ve.player.currentIdx === idx && clip.localPath) {
    playClip(idx);
  }
}

/**
 * Load a local video file into a hidden element, seek to an early frame,
 * capture a thumbnail, and return both the image and the total duration.
 */
function extractVideoInfo(localPath) {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    video.muted   = true;
    video.preload = 'metadata';
    // Must be in DOM for Chromium's canvas drawImage to work
    video.style.cssText = 'position:fixed;opacity:0;pointer-events:none;width:1px;height:1px;top:-2px';
    document.body.appendChild(video);

    const cleanup = () => { try { video.remove(); } catch {} };
    const timeout = setTimeout(() => { cleanup(); resolve({ thumbnail: null, duration: 0 }); }, 12000);

    video.addEventListener('loadedmetadata', () => {
      video.currentTime = Math.min(0.5, (video.duration || 1) * 0.1);
    });

    video.addEventListener('seeked', () => {
      clearTimeout(timeout);
      const duration = isFinite(video.duration) ? video.duration : 0;
      let thumbnail = null;
      try {
        const canvas = document.createElement('canvas');
        canvas.width  = 160;
        canvas.height = 90;
        canvas.getContext('2d').drawImage(video, 0, 0, 160, 90);
        thumbnail = canvas.toDataURL('image/jpeg', 0.8);
      } catch {}
      cleanup();
      resolve({ thumbnail, duration });
    });

    video.addEventListener('error', () => {
      clearTimeout(timeout);
      cleanup();
      resolve({ thumbnail: null, duration: 0 });
    });

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
    // Clip still downloading — flag intent; downloadAndPrepare will resume
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

  ve.player.isPlaying  = true;
  ve.player.currentIdx = idx;

  veVideo.src = `file://${clip.localPath}`;
  veVideo.play().catch((err) => console.error('Playback error:', err));

  veCtrlPlay.textContent  = '⏸';
  veOverlay.style.display = 'none';
  renderStrip();
}

function stopPlayback() {
  ve.player.isPlaying = false;
  veVideo.pause();
  veCtrlPlay.textContent  = '▶';
  veOverlay.style.display = '';
  renderStrip();
}

veVideo.addEventListener('ended', () => {
  const nextIdx = ve.player.currentIdx + 1;
  if (nextIdx < ve.strip.length) {
    startPlayback(nextIdx);
  } else {
    ve.player.isPlaying  = false;
    ve.player.currentIdx = 0;
    veCtrlPlay.textContent  = '▶';
    veOverlay.style.display = '';
    renderStrip();
  }
});

veVideo.addEventListener('timeupdate', () => {
  if (!veVideo.duration) return;
  const pct = (veVideo.currentTime / veVideo.duration) * 100;
  veProgressFill.style.width = `${pct}%`;
  veTimeDisplay.textContent  = `${fmtTime(veVideo.currentTime)} / ${fmtTime(veVideo.duration)}`;
});

veProgressBar.addEventListener('click', (e) => {
  if (!veVideo.duration) return;
  const rect = veProgressBar.getBoundingClientRect();
  veVideo.currentTime = ((e.clientX - rect.left) / rect.width) * veVideo.duration;
});

// ── Utilities ─────────────────────────────────────────────────────────────────

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

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

// ── Export / Render ───────────────────────────────────────────────────────────

const veRenderPanel   = document.getElementById('ve-render-panel');
const veRenderLabel   = document.getElementById('ve-render-label');
const veRenderFill    = document.getElementById('ve-render-fill');
const veRenderPct     = document.getElementById('ve-render-pct');
const veExportBtn     = document.getElementById('ve-export-btn');
const veCancelRender  = document.getElementById('ve-cancel-render-btn');

document.getElementById('ve-export-btn').addEventListener('click', startExport);
document.getElementById('ve-cancel-render-btn').addEventListener('click', async () => {
  await window.api.video.cancelRender();
});

async function startExport() {
  if (ve.strip.length === 0) {
    alert('Add some clips to the timeline before exporting.');
    return;
  }

  const notReady = ve.strip.filter((c) => c.downloading || !c.localPath);
  if (notReady.length > 0) {
    alert(`${notReady.length} clip(s) are still downloading. Please wait and try again.`);
    return;
  }

  // Ask where to save
  const saveResult = await window.api.video.showSaveDialog({ defaultName: ve.project.name });
  if (!saveResult.path) return; // user cancelled dialog

  // Build serialisable clip descriptors for the main process
  const clips = ve.strip.map((c) => ({
    localPath:   c.localPath,
    trimIn:      c.trimIn,
    trimOut:     c.trimOut,
    transitions: c.transitions,
    duration:    c.duration,
  }));

  setRenderUI('rendering', 0);

  // Listen for incremental progress pushed from the main process
  window.api.video.onRenderProgress(({ pct, timemark }) => {
    setRenderUI('rendering', pct, timemark);
  });

  const result = await window.api.video.render({
    clips,
    outputPath: saveResult.path,
    settings:   ve.manifest?.settings,
  });

  window.api.video.offRenderProgress();

  if (result.ok) {
    setRenderUI('done', 100, null, saveResult.path);
  } else if (result.cancelled) {
    setRenderUI('idle');
  } else {
    setRenderUI('error', 0, null, result.error);
  }
}

/**
 * Update the render panel state.
 * @param {'idle'|'rendering'|'done'|'error'} state
 * @param {number} [pct]
 * @param {string} [timemark]
 * @param {string} [detail]  - output path on done, error message on error
 */
function setRenderUI(state, pct = 0, timemark, detail) {
  const panel = veRenderPanel;

  if (state === 'idle') {
    panel.classList.add('ve-hidden');
    panel.classList.remove('ve-render-done', 've-render-error');
    veExportBtn.disabled = false;
    return;
  }

  panel.classList.remove('ve-hidden', 've-render-done', 've-render-error');
  veExportBtn.disabled = true;

  if (state === 'rendering') {
    veRenderLabel.textContent = timemark ? `Rendering… ${timemark}` : 'Rendering…';
    veRenderFill.style.width  = `${pct}%`;
    veRenderPct.textContent   = `${pct}%`;
    veCancelRender.style.display = '';
  } else if (state === 'done') {
    panel.classList.add('ve-render-done');
    veRenderLabel.textContent = `Exported → ${detail}`;
    veRenderFill.style.width  = '100%';
    veRenderPct.textContent   = '100%';
    veCancelRender.style.display = 'none';
    veExportBtn.disabled = false;
  } else if (state === 'error') {
    panel.classList.add('ve-render-error');
    veRenderLabel.textContent = `Error: ${detail}`;
    veRenderFill.style.width  = '0%';
    veRenderPct.textContent   = '';
    veCancelRender.style.display = 'none';
    veExportBtn.disabled = false;
  }
}
