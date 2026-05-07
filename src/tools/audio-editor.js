// ── Audio Editor — entry point ────────────────────────────────────────────────
// Load order: ae-constants → ae-utils → ae-draw → ae-tracks → ae-transport
//             → ae-projects → ae-export → this file

document.querySelector('[data-tool="audio-editor"]').addEventListener('click', async () => {
  if (ae.instruments.length === 0) {
    const result = await window.api.audio.getInstruments();
    if (result.ok) ae.instruments = result.instruments;
  }
  loadAeProjects();
});
