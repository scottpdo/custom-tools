// ── Audio Editor — WAV export ─────────────────────────────────────────────────

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
