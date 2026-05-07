// ── Audio Editor — transport controls & playback engine ───────────────────────

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
  const totalSeconds = ae.bars * 4 * secPerBeat;

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
