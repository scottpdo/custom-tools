import { el } from '../utils/dom';
import { fmtTime } from '../utils/format';
import { ve, markDirty } from './state';
import { renderStrip } from './strip';

const veVideo        = el<HTMLVideoElement>('ve-video');
const veCtrlPlay     = el<HTMLButtonElement>('ve-ctrl-play');
const veOverlay      = el('ve-player-overlay');
const veProgressBar  = el('ve-progress-bar');
const veProgressFill = el('ve-progress-fill');
const veTimeDisplay  = el('ve-time-display');

export function togglePlayback(): void {
  ve.player.isPlaying ? stopPlayback() : startPlayback();
}

export function startPlayback(fromIdx: number | null = null): void {
  if (ve.strip.length === 0) return;

  const idx = fromIdx !== null
    ? fromIdx
    : (ve.player.currentIdx >= 0 && ve.player.currentIdx < ve.strip.length
        ? ve.player.currentIdx
        : 0);

  const clip = ve.strip[idx];
  if (!clip) return;

  if (clip.downloading || !clip.localPath) {
    ve.player.isPlaying  = true;
    ve.player.currentIdx = idx;
    veCtrlPlay.textContent = '⟳';
    return;
  }

  playClip(idx);
}

export function playClip(idx: number): void {
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

export function stopPlayback(): void {
  ve.player.isPlaying = false;
  veVideo.pause();
  veCtrlPlay.textContent  = '▶';
  veOverlay.style.display = '';
  renderStrip();
}

export async function downloadAndPrepare(idx: number): Promise<void> {
  const clip = ve.strip[idx];
  if (!clip || !ve.project) return;

  const result = await window.api.video.downloadClip({ bucket: ve.project.bucket, key: clip.key });

  if (result.ok) {
    clip.localPath = result.localPath;
    const { thumbnail, duration } = await extractVideoInfo(result.localPath);
    clip.thumbnail = thumbnail;
    if (!clip.duration) {
      clip.duration = duration;
      clip.trimOut  = duration;
      markDirty();
    }
  } else {
    console.error('Download failed:', result.error);
  }

  clip.downloading = false;
  renderStrip();

  if (ve.player.isPlaying && ve.player.currentIdx === idx && clip.localPath) {
    playClip(idx);
  }
}

export function extractVideoInfo(localPath: string): Promise<{ thumbnail: string | null; duration: number }> {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    video.muted   = true;
    video.preload = 'metadata';
    video.style.cssText = 'position:fixed;opacity:0;pointer-events:none;width:1px;height:1px;top:-2px';
    document.body.appendChild(video);

    const cleanup = (): void => { try { video.remove(); } catch { /* ignore */ } };
    const timeout = setTimeout(() => { cleanup(); resolve({ thumbnail: null, duration: 0 }); }, 12000);

    video.addEventListener('loadedmetadata', () => {
      video.currentTime = Math.min(0.5, (video.duration || 1) * 0.1);
    });

    video.addEventListener('seeked', () => {
      clearTimeout(timeout);
      const duration = isFinite(video.duration) ? video.duration : 0;
      let thumbnail: string | null = null;
      try {
        const canvas = document.createElement('canvas');
        canvas.width  = 160;
        canvas.height = 90;
        canvas.getContext('2d')!.drawImage(video, 0, 0, 160, 90);
        thumbnail = canvas.toDataURL('image/jpeg', 0.8);
      } catch { /* ignore */ }
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

export function initPlayer(): void {
  veCtrlPlay.addEventListener('click', togglePlayback);
  el('ve-overlay-play').addEventListener('click', togglePlayback);

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
}
