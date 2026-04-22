// ── Audio Editor — shared constants, state & DOM refs ─────────────────────────

const PITCH_MIN = 36, PITCH_MAX = 95, PITCH_RANGE = 60;
const NOTE_HEIGHT = 14, KEY_WIDTH = 52, RULER_HEIGHT = 28, PX_PER_BEAT = 60;
const TRACK_COUNT = 4;

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
