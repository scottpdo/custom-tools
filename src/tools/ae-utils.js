// ── Audio Editor — pure helpers ───────────────────────────────────────────────

const AE_NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];

function midiToNoteName(midi) {
  return AE_NOTE_NAMES[midi % 12] + (Math.floor(midi / 12) - 1);
}

function isBlack(pitch) {
  return [1, 3, 6, 8, 10].includes(pitch % 12);
}

function gainToDb(gain) {
  return gain <= 0 ? -Infinity : 20 * Math.log10(gain);
}
