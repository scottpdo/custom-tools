// ── Audio Editor — canvas drawing ─────────────────────────────────────────────

function resizeCanvases() {
  const gw = ae.bars * 4 * PX_PER_BEAT;
  const gh = PITCH_RANGE * NOTE_HEIGHT;
  aeRulerCanvas.width = gw;           aeRulerCanvas.height = RULER_HEIGHT;
  aeKeyboardCanvas.width = KEY_WIDTH; aeKeyboardCanvas.height = gh;
  aeGridCanvas.width = gw;            aeGridCanvas.height = gh;
}

aeGridContainer.addEventListener('scroll', () => {
  aeRulerContainer.scrollLeft = aeGridContainer.scrollLeft;
  aeKeyboardContainer.scrollTop = aeGridContainer.scrollTop;
});

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
