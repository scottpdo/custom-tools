// ── Audio Editor — track list, instrument loading & grid note editing ─────────

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
      if (ae.samplers[i]) ae.samplers[i].volume.value = gainToDb(track.volume);
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

// ── Grid mouse: add / remove notes ────────────────────────────────────────────

aeGridCanvas.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  const rect = aeGridContainer.getBoundingClientRect();
  const rawX = e.clientX - rect.left + aeGridContainer.scrollLeft;
  const rawY = e.clientY - rect.top + aeGridContainer.scrollTop;

  const snap = ae.snapBeats;
  const beat = Math.floor(rawX / PX_PER_BEAT / snap) * snap;
  const pitch = PITCH_MAX - Math.floor(rawY / NOTE_HEIGHT);

  if (pitch < PITCH_MIN || pitch > PITCH_MAX) return;

  const track = ae.tracks[ae.activeTrack];
  if (!track) return;

  const overlap = track.notes.some((n) =>
    n.pitch === pitch && beat < n.beat + n.duration && beat + snap > n.beat
  );
  if (overlap) return;

  track.notes.push({ pitch, beat, duration: snap, velocity: 80 });
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
