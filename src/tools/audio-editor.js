// ── Audio Editor ──────────────────────────────────────────────────────────────

// ── Constants ─────────────────────────────────────────────────────────────────

const PITCH_MIN = 36, PITCH_MAX = 95, PITCH_RANGE = 60;
const NOTE_HEIGHT = 14, KEY_WIDTH = 52, RULER_HEIGHT = 28, PX_PER_BEAT = 60;
const TRACK_COUNT = 4;

// ── State ─────────────────────────────────────────────────────────────────────

const ae = {
  project: null,      // { bucket, prefix, name }
  manifest: null,
  dirty: false,
  activeTrack: 0,
  bpm: 120,
  bars: 8,
  snapBeats: 1,
  tracks: [],         // [{ id, name, instrument, volume, muted, notes: [{pitch,beat,duration,velocity}] }]
  samplers: [],       // Tone.Sampler[] per track (null until loaded)
  parts: [],          // Tone.Part[] created fresh each play
  sampleUrls: [],     // { [toneNote]: fileUrl } per track
  isPlaying: false,
  rafId: null,
  instruments: [],    // [{ id, label }]
};

// ── DOM refs ──────────────────────────────────────────────────────────────────

const aeProjectsView      = document.getElementById('ae-projects-view');
const aeEditorView        = document.getElementById('ae-editor-view');
const aeProjectsList      = document.getElementById('ae-projects-list');
const aeNewProjectInput   = document.getElementById('ae-new-project-input');
const aeCreateProjectBtn  = document.getElementById('ae-create-project-btn');
const aeBackBtn           = document.getElementById('ae-back-btn');
const aeProjectTitle      = document.getElementById('ae-project-title');
const aeSaveBtn           = document.getElementById('ae-save-btn');
const aeExportBtn         = document.getElementById('ae-export-btn');
const aePlayBtn           = document.getElementById('ae-play-btn');
const aeStopBtn           = document.getElementById('ae-stop-btn');
const aeBpmInput          = document.getElementById('ae-bpm-input');
const aeBarsInput         = document.getElementById('ae-bars-input');
const aeSnapSelect        = document.getElementById('ae-snap-select');
const aePositionDisplay   = document.getElementById('ae-position-display');
const aeTracksEl          = document.getElementById('ae-tracks');
const aeRulerContainer    = document.getElementById('ae-ruler-container');
const aeKeyboardContainer = document.getElementById('ae-keyboard-container');
const aeGridContainer     = document.getElementById('ae-grid-container');
const aeRulerCanvas       = document.getElementById('ae-ruler-canvas');
const aeKeyboardCanvas    = document.getElementById('ae-keyboard-canvas');
const aeGridCanvas        = document.getElementById('ae-grid-canvas');
const aeExportPanel       = document.getElementById('ae-export-panel');
const aeExportLabel       = document.getElementById('ae-export-label');
const aeExportFill        = document.getElementById('ae-export-fill');
const aeExportPct         = document.getElementById('ae-export-pct');

// ── Helpers ───────────────────────────────────────────────────────────────────

const AE_NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];

function midiToNoteName(midi) {
  return AE_NOTE_NAMES[midi % 12] + (Math.floor(midi / 12) - 1);
}

function isBlack(pitch) {
  return [1, 3, 6, 8, 10].includes(pitch % 12);
}

// ── Navigation ────────────────────────────────────────────────────────────────

document.querySelector('[data-tool="audio-editor"]').addEventListener('click', async () => {
  if (ae.instruments.length === 0) {
    const result = await window.api.audio.getInstruments();
    if (result.ok) ae.instruments = result.instruments;
  }
  loadAeProjects();
});

aeBackBtn.addEventListener('click', () => {
  stopPlayback();
  showAeView('projects');
  loadAeProjects();
});

function showAeView(name) {
  aeProjectsView.classList.toggle('ae-hidden', name !== 'projects');
  aeEditorView.classList.toggle('ae-hidden', name !== 'editor');
}

// ── Projects ──────────────────────────────────────────────────────────────────

async function loadAeProjects() {
  showAeView('projects');
  aeProjectsList.innerHTML = '<p class="muted">Loading…</p>';
  const cfg = await window.api.aws.getConfig();
  const result = await window.api.audio.listProjects({ bucket: cfg.bucket });

  if (!result.ok) {
    aeProjectsList.innerHTML = `<p class="muted">Error: ${escHtml(result.error)}</p>`;
    return;
  }

  if (result.projects.length === 0) {
    aeProjectsList.innerHTML = '<p class="muted">No projects yet. Create one above.</p>';
    return;
  }

  aeProjectsList.innerHTML = '';
  result.projects.forEach((project) => {
    const row = document.createElement('div');
    row.className = 've-project-row';
    const lastMod = project.lastModified ? new Date(project.lastModified).toLocaleString() : '';
    row.innerHTML = `
      <div class="ve-project-info">
        <span class="ve-project-name">${escHtml(project.name)}</span>
        <span class="ve-project-date">${escHtml(lastMod)}</span>
      </div>
      <button class="ae-open-btn">Open</button>
    `;
    row.querySelector('.ae-open-btn').addEventListener('click', () => {
      openAeProject({ bucket: cfg.bucket, prefix: project.prefix, name: project.name });
    });
    aeProjectsList.appendChild(row);
  });
}

aeCreateProjectBtn.addEventListener('click', async () => {
  const name = aeNewProjectInput.value.trim();
  if (!name) return;
  const cfg = await window.api.aws.getConfig();
  const result = await window.api.audio.createProject({ bucket: cfg.bucket, name });
  if (!result.ok) {
    alert('Failed to create project: ' + result.error);
    return;
  }
  aeNewProjectInput.value = '';
  openAeProject({ bucket: cfg.bucket, prefix: result.prefix, name });
});

async function openAeProject(project) {
  ae.project = project;
  const result = await window.api.audio.readProject({ bucket: project.bucket, prefix: project.prefix });
  if (!result.ok) {
    alert('Failed to open project: ' + result.error);
    return;
  }

  const m = result.manifest;
  ae.manifest = m;
  ae.bpm = m.bpm || 120;
  ae.bars = m.bars || 8;
  ae.tracks = m.tracks.slice(0, TRACK_COUNT);
  ae.activeTrack = 0;
  ae.dirty = false;

  aeProjectTitle.textContent = project.name;
  aeBpmInput.value = ae.bpm;
  aeBarsInput.value = ae.bars;
  aeSaveBtn.disabled = true;
  aeSaveBtn.textContent = 'Saved ✓';

  showAeView('editor');
  renderTrackList();
  resizeCanvases();
  redrawAll();

  for (let i = 0; i < ae.tracks.length; i++) {
    loadInstrument(i, ae.tracks[i].instrument, true);
  }
}

// ── Save ──────────────────────────────────────────────────────────────────────

function markDirty() {
  ae.dirty = true;
  aeSaveBtn.disabled = false;
  aeSaveBtn.textContent = 'Save';
}

function buildManifest() {
  return { ...ae.manifest, bpm: ae.bpm, bars: ae.bars, tracks: ae.tracks };
}

aeSaveBtn.addEventListener('click', async () => {
  if (!ae.project) return;
  const result = await window.api.audio.saveProject({
    bucket: ae.project.bucket,
    prefix: ae.project.prefix,
    manifest: buildManifest(),
  });
  if (result.ok) {
    ae.dirty = false;
    aeSaveBtn.disabled = true;
    aeSaveBtn.textContent = 'Saved ✓';
  } else {
    alert('Save failed: ' + result.error);
  }
});

// ── Transport ─────────────────────────────────────────────────────────────────

aeBpmInput.addEventListener('change', () => {
  let v = parseInt(aeBpmInput.value, 10);
  v = Math.max(40, Math.min(240, isNaN(v) ? 120 : v));
  aeBpmInput.value = v;
  ae.bpm = v;
  Tone.Transport.bpm.value = v;
  markDirty();
});

aeBarsInput.addEventListener('change', () => {
  let v = parseInt(aeBarsInput.value, 10);
  v = Math.max(1, Math.min(64, isNaN(v) ? 8 : v));
  aeBarsInput.value = v;
  ae.bars = v;
  resizeCanvases();
  redrawAll();
  markDirty();
});

aeSnapSelect.addEventListener('change', () => {
  ae.snapBeats = parseFloat(aeSnapSelect.value);
});

document.addEventListener('keydown', (e) => {
  if (e.code !== 'Space') return;
  const tag = document.activeElement ? document.activeElement.tagName : '';
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
  const aePanel = document.getElementById('panel-audio-editor');
  if (!aePanel || !aePanel.classList.contains('active')) return;
  e.preventDefault();
  ae.isPlaying ? stopPlayback() : startPlayback();
});

aePlayBtn.addEventListener('click', () => startPlayback());
aeStopBtn.addEventListener('click', () => stopPlayback());

// ── Track list ────────────────────────────────────────────────────────────────

function renderTrackList() {
  aeTracksEl.innerHTML = '';
  ae.tracks.forEach((track, i) => {
    const div = document.createElement('div');
    div.className = 'ae-track' + (i === ae.activeTrack ? ' ae-track-active' : '');

    const instrOptions = ae.instruments.map((instr) =>
      `<option value="${escHtml(instr.id)}"${instr.id === track.instrument ? ' selected' : ''}>${escHtml(instr.label)}</option>`
    ).join('');

    div.innerHTML = `
      <div class="ae-track-header">
        <div class="ae-track-select-indicator"></div>
        <span class="ae-track-name">${escHtml(track.name)}</span>
        <button class="ae-track-mute${track.muted ? ' ae-muted' : ''}">M</button>
      </div>
      <div class="ae-track-controls">
        <select class="ae-instr-select">${instrOptions}</select>
        <input type="range" class="ae-vol-slider" min="0" max="1" step="0.01" value="${track.volume != null ? track.volume : 0.8}" />
        <span class="ae-load-indicator" id="ae-load-${i}"></span>
      </div>
    `;

    div.addEventListener('click', (e) => {
      const t = e.target;
      if (t.tagName === 'SELECT' || t.tagName === 'INPUT' || t.tagName === 'BUTTON' || t.tagName === 'OPTION') return;
      selectTrack(i);
    });

    div.querySelector('.ae-track-mute').addEventListener('click', (e) => {
      e.stopPropagation();
      track.muted = !track.muted;
      e.currentTarget.classList.toggle('ae-muted', track.muted);
      markDirty();
    });

    div.querySelector('.ae-instr-select').addEventListener('change', (e) => {
      e.stopPropagation();
      track.instrument = e.target.value;
      loadInstrument(i, track.instrument, false);
      markDirty();
    });

    div.querySelector('.ae-vol-slider').addEventListener('input', (e) => {
      e.stopPropagation();
      track.volume = parseFloat(e.target.value);
      if (ae.samplers[i]) {
        ae.samplers[i].volume.value = gainToDb(track.volume);
      }
      markDirty();
    });

    aeTracksEl.appendChild(div);
  });
}

function selectTrack(idx) {
  ae.activeTrack = idx;
  aeTracksEl.querySelectorAll('.ae-track').forEach((div, i) => {
    div.classList.toggle('ae-track-active', i === idx);
  });
  redrawGrid();
}

function gainToDb(gain) {
  return gain <= 0 ? -Infinity : 20 * Math.log10(gain);
}

// ── Instrument loading ────────────────────────────────────────────────────────

async function loadInstrument(trackIdx, instrument, silent) {
  const indicator = document.getElementById(`ae-load-${trackIdx}`);

  if (ae.samplers[trackIdx]) {
    try { ae.samplers[trackIdx].dispose(); } catch {}
    ae.samplers[trackIdx] = null;
  }

  if (!silent && indicator) indicator.textContent = 'Loading…';

  const cached = await window.api.audio.getCachedSamples({ instrument });
  let urls;

  if (cached.ok && cached.cached) {
    urls = cached.urls;
  } else {
    if (indicator) indicator.textContent = '0%';
    window.api.audio.onSampleProgress(({ done, total }) => {
      if (indicator) indicator.textContent = Math.round((done / total) * 100) + '%';
    });
    const result = await window.api.audio.ensureSamples({ instrument });
    window.api.audio.offSampleProgress();
    if (!result.ok) {
      if (indicator) indicator.textContent = 'Err';
      return;
    }
    urls = result.urls;
  }

  ae.sampleUrls[trackIdx] = urls;

  if (!urls || Object.keys(urls).length === 0) {
    if (indicator) indicator.textContent = 'No samples';
    return;
  }

  const track = ae.tracks[trackIdx];
  const sampler = new Tone.Sampler({
    urls,
    onload: () => { if (indicator) indicator.textContent = ''; },
    onerror: () => { if (indicator) indicator.textContent = 'Err'; },
  });
  sampler.volume.value = gainToDb(track.volume != null ? track.volume : 0.8);
  sampler.toDestination();
  ae.samplers[trackIdx] = sampler;
}

// ── Playback ──────────────────────────────────────────────────────────────────

async function startPlayback() {
  if (ae.isPlaying) return;

  await Tone.start();

  ae.parts.forEach((p) => { try { p.dispose(); } catch {} });
  ae.parts = [];
  Tone.Transport.cancel();
  Tone.Transport.stop();
  Tone.Transport.position = 0;
  Tone.Transport.bpm.value = ae.bpm;

  const secPerBeat = 60 / ae.bpm;
  const totalBeats = ae.bars * 4;
  const totalSeconds = totalBeats * secPerBeat;

  for (let i = 0; i < ae.tracks.length; i++) {
    const track = ae.tracks[i];
    if (track.muted || !ae.samplers[i] || !track.notes || track.notes.length === 0) continue;

    const sampler = ae.samplers[i];
    const events = track.notes.map((note) => [
      note.beat * secPerBeat,
      { note: midiToNoteName(note.pitch), duration: note.duration * secPerBeat, velocity: (note.velocity || 80) / 127 },
    ]);

    const part = new Tone.Part((time, ev) => {
      sampler.triggerAttackRelease(ev.note, ev.duration, time, ev.velocity);
    }, events);
    part.start(0);
    ae.parts.push(part);
  }

  Tone.Transport.scheduleOnce(() => stopPlayback(), totalSeconds);
  Tone.Transport.start();
  ae.isPlaying = true;
  aePlayBtn.textContent = '⏸';

  function tick() {
    if (!ae.isPlaying) return;
    const beat = Tone.Transport.seconds / (60 / ae.bpm);
    const bar = Math.floor(beat / 4) + 1;
    const beatInBar = Math.floor(beat % 4) + 1;
    aePositionDisplay.textContent = `${bar} : ${beatInBar}`;
    redrawGrid();
    ae.rafId = requestAnimationFrame(tick);
  }
  ae.rafId = requestAnimationFrame(tick);
}

function stopPlayback() {
  Tone.Transport.stop();
  Tone.Transport.cancel();

  ae.parts.forEach((p) => { try { p.dispose(); } catch {} });
  ae.parts = [];

  if (ae.rafId) { cancelAnimationFrame(ae.rafId); ae.rafId = null; }

  ae.isPlaying = false;
  aePlayBtn.textContent = '▶';
  aePositionDisplay.textContent = '1 : 1';
  redrawGrid();
}

// ── Canvas sizing ─────────────────────────────────────────────────────────────

function resizeCanvases() {
  const gw = ae.bars * 4 * PX_PER_BEAT;
  const gh = PITCH_RANGE * NOTE_HEIGHT;
  aeRulerCanvas.width = gw;      aeRulerCanvas.height = RULER_HEIGHT;
  aeKeyboardCanvas.width = KEY_WIDTH; aeKeyboardCanvas.height = gh;
  aeGridCanvas.width = gw;       aeGridCanvas.height = gh;
}

// ── Synchronized scrolling ────────────────────────────────────────────────────

aeGridContainer.addEventListener('scroll', () => {
  aeRulerContainer.scrollLeft = aeGridContainer.scrollLeft;
  aeKeyboardContainer.scrollTop = aeGridContainer.scrollTop;
});

// ── Drawing ───────────────────────────────────────────────────────────────────

function redrawAll() { drawRuler(); drawKeyboard(); drawGrid(); }
function redrawGrid() { drawGrid(); }

function drawRuler() {
  const ctx = aeRulerCanvas.getContext('2d');
  const w = aeRulerCanvas.width;
  ctx.fillStyle = '#252530';
  ctx.fillRect(0, 0, w, RULER_HEIGHT);

  const totalBeats = ae.bars * 4;
  for (let beat = 0; beat <= totalBeats; beat++) {
    const x = beat * PX_PER_BEAT;
    const isBar = beat % 4 === 0;
    ctx.strokeStyle = isBar ? '#6060a0' : '#3a3a55';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x + 0.5, RULER_HEIGHT - (isBar ? 14 : 8));
    ctx.lineTo(x + 0.5, RULER_HEIGHT);
    ctx.stroke();

    if (isBar) {
      ctx.fillStyle = '#a0a0c0';
      ctx.font = '11px monospace';
      ctx.fillText(beat / 4 + 1, x + 4, RULER_HEIGHT - 14 + 11);
    }
  }
}

function drawKeyboard() {
  const ctx = aeKeyboardCanvas.getContext('2d');
  const w = KEY_WIDTH;
  const h = aeKeyboardCanvas.height;
  ctx.clearRect(0, 0, w, h);

  for (let pitch = PITCH_MAX; pitch >= PITCH_MIN; pitch--) {
    const y = (PITCH_MAX - pitch) * NOTE_HEIGHT;
    ctx.fillStyle = isBlack(pitch) ? '#141420' : '#2a2a3c';
    ctx.fillRect(0, y, w, NOTE_HEIGHT);

    ctx.strokeStyle = '#3a3a55';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, y + NOTE_HEIGHT - 0.5);
    ctx.lineTo(w, y + NOTE_HEIGHT - 0.5);
    ctx.stroke();

    if (pitch % 12 === 0) {
      ctx.fillStyle = '#6060a0';
      ctx.font = '10px sans-serif';
      ctx.fillText(`C${Math.floor(pitch / 12) - 1}`, 4, y + NOTE_HEIGHT - 3);
    }
  }

  ctx.strokeStyle = '#3a3a55';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(w - 0.5, 0);
  ctx.lineTo(w - 0.5, h);
  ctx.stroke();
}

function drawGrid() {
  const ctx = aeGridCanvas.getContext('2d');
  const w = aeGridCanvas.width;
  const h = aeGridCanvas.height;

  // Row backgrounds
  for (let pitch = PITCH_MAX; pitch >= PITCH_MIN; pitch--) {
    const y = (PITCH_MAX - pitch) * NOTE_HEIGHT;
    ctx.fillStyle = isBlack(pitch) ? '#1a1a24' : '#1f1f2d';
    ctx.fillRect(0, y, w, NOTE_HEIGHT);
  }

  // Horizontal lines at C octave boundaries
  for (let pitch = PITCH_MIN; pitch <= PITCH_MAX; pitch++) {
    if (pitch % 12 === 0) {
      const y = (PITCH_MAX - pitch) * NOTE_HEIGHT + 0.5;
      ctx.strokeStyle = '#2e2e46';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }
  }

  // Vertical beat/bar lines
  const totalBeats = ae.bars * 4;
  for (let beat = 0; beat <= totalBeats; beat++) {
    const x = beat * PX_PER_BEAT + 0.5;
    ctx.strokeStyle = beat % 4 === 0 ? '#3a3a55' : '#252535';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
  }

  // Notes for active track
  const track = ae.tracks[ae.activeTrack];
  if (track && track.notes) {
    track.notes.forEach((note) => {
      const x = note.beat * PX_PER_BEAT;
      const y = (PITCH_MAX - note.pitch) * NOTE_HEIGHT;
      const nw = note.duration * PX_PER_BEAT;

      ctx.fillStyle = '#4f8ef7';
      ctx.fillRect(x + 1, y + 1, nw - 2, NOTE_HEIGHT - 2);

      ctx.fillStyle = 'rgba(255,255,255,0.2)';
      ctx.fillRect(x + 1, y + 1, nw - 2, 2);

      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.fillRect(x + nw - 4, y + 1, 3, NOTE_HEIGHT - 2);
    });
  }

  // Playhead
  if (ae.isPlaying) {
    const px = (Tone.Transport.seconds / (60 / ae.bpm)) * PX_PER_BEAT;
    if (px >= 0 && px <= w) {
      ctx.strokeStyle = '#e05c5c';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(px, 0);
      ctx.lineTo(px, h);
      ctx.stroke();
    }
  }
}

// ── Mouse interaction on grid ─────────────────────────────────────────────────

aeGridCanvas.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  const rect = aeGridContainer.getBoundingClientRect();
  const rawX = e.clientX - rect.left + aeGridContainer.scrollLeft;
  const rawY = e.clientY - rect.top + aeGridContainer.scrollTop;

  const snapBeats = ae.snapBeats;
  const beat = Math.floor(rawX / PX_PER_BEAT / snapBeats) * snapBeats;
  const pitch = PITCH_MAX - Math.floor(rawY / NOTE_HEIGHT);

  if (pitch < PITCH_MIN || pitch > PITCH_MAX) return;

  const track = ae.tracks[ae.activeTrack];
  if (!track) return;

  const overlap = track.notes.some((n) =>
    n.pitch === pitch && beat < n.beat + n.duration && beat + snapBeats > n.beat
  );
  if (overlap) return;

  track.notes.push({ pitch, beat, duration: snapBeats, velocity: 80 });
  markDirty();
  redrawGrid();
});

aeGridCanvas.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  const rect = aeGridContainer.getBoundingClientRect();
  const rawX = e.clientX - rect.left + aeGridContainer.scrollLeft;
  const rawY = e.clientY - rect.top + aeGridContainer.scrollTop;

  const clickBeat = rawX / PX_PER_BEAT;
  const clickPitch = PITCH_MAX - Math.floor(rawY / NOTE_HEIGHT);

  const track = ae.tracks[ae.activeTrack];
  if (!track) return;

  const idx = track.notes.findIndex((n) =>
    n.pitch === clickPitch && clickBeat >= n.beat && clickBeat < n.beat + n.duration
  );
  if (idx !== -1) {
    track.notes.splice(idx, 1);
    markDirty();
    redrawGrid();
  }
});

// ── Export ────────────────────────────────────────────────────────────────────

aeExportBtn.addEventListener('click', exportWav);

async function exportWav() {
  const { filePath } = await window.api.audio.showExportDialog({
    defaultName: ae.project ? ae.project.name : 'export',
  });
  if (!filePath) return;

  aeExportPanel.classList.remove('ae-hidden');
  aeExportLabel.textContent = 'Rendering…';
  aeExportFill.style.width = '0%';
  aeExportPct.textContent = '0%';

  await Tone.start();

  const secPerBeat = 60 / ae.bpm;
  const totalSeconds = ae.bars * 4 * secPerBeat;

  let audioBuffer;
  try {
    audioBuffer = await Tone.Offline(async ({ transport }) => {
      for (let i = 0; i < ae.tracks.length; i++) {
        const track = ae.tracks[i];
        if (track.muted || !ae.sampleUrls[i] || Object.keys(ae.sampleUrls[i]).length === 0) continue;
        if (!track.notes || track.notes.length === 0) continue;

        const sampler = new Tone.Sampler({ urls: ae.sampleUrls[i] });
        sampler.volume.value = gainToDb(track.volume != null ? track.volume : 0.8);
        sampler.toDestination();

        const events = track.notes.map((note) => [
          note.beat * secPerBeat,
          { note: midiToNoteName(note.pitch), duration: note.duration * secPerBeat, velocity: (note.velocity || 80) / 127 },
        ]);

        const part = new Tone.Part((time, ev) => {
          sampler.triggerAttackRelease(ev.note, ev.duration, time, ev.velocity);
        }, events);
        part.start(0);
      }

      await Tone.loaded();
      transport.start();
    }, totalSeconds);
  } catch (err) {
    aeExportPanel.classList.add('ae-hidden');
    alert('Export failed: ' + err.message);
    return;
  }

  aeExportFill.style.width = '80%';
  aeExportPct.textContent = '80%';
  aeExportLabel.textContent = 'Encoding WAV…';

  const wavBuffer = encodeWav(audioBuffer);

  aeExportFill.style.width = '95%';
  aeExportPct.textContent = '95%';
  aeExportLabel.textContent = 'Writing file…';

  const result = await window.api.audio.writeExportFile({
    filePath,
    data: Array.from(new Uint8Array(wavBuffer)),
  });

  aeExportFill.style.width = '100%';
  aeExportPct.textContent = '100%';

  if (result.ok) {
    aeExportLabel.textContent = 'Export complete!';
    setTimeout(() => aeExportPanel.classList.add('ae-hidden'), 3000);
  } else {
    aeExportLabel.textContent = 'Error: ' + result.error;
    setTimeout(() => aeExportPanel.classList.add('ae-hidden'), 5000);
  }
}

function encodeWav(audioBuffer) {
  const numChannels = audioBuffer.numberOfChannels;
  const sampleRate = audioBuffer.sampleRate;
  const numSamples = audioBuffer.length;
  const blockAlign = numChannels * 2;
  const dataSize = numSamples * blockAlign;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeStr = (off, str) => { for (let i = 0; i < str.length; i++) view.setUint8(off + i, str.charCodeAt(i)); };
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < numSamples; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      const s = Math.max(-1, Math.min(1, audioBuffer.getChannelData(ch)[i]));
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
      offset += 2;
    }
  }
  return buffer;
}
