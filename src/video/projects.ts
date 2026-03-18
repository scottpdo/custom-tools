import { el } from '../utils/dom';
import { escHtml } from '../utils/format';
import { ve, markDirty, markClean, updateSaveBtn, makeEmptyManifest } from './state';
import { renderStrip } from './strip';
import { loadLibrary } from './library';
import { stopPlayback } from './player';
import { downloadAndPrepare } from './player';
import type { ProjectInfo } from '../types/models';

const veProjectsList = el('ve-projects-list');
const veProjectTitle = el('ve-project-title');
const veVideo        = el<HTMLVideoElement>('ve-video');
const veOverlay      = el('ve-player-overlay');
const veCtrlPlay     = el<HTMLButtonElement>('ve-ctrl-play');
const veSaveBtn      = el<HTMLButtonElement>('ve-save-btn');

export function showView(name: 'projects' | 'editor'): void {
  el('ve-projects-view').classList.toggle('ve-hidden', name !== 'projects');
  el('ve-editor-view').classList.toggle('ve-hidden', name !== 'editor');
}

export async function loadProjects(): Promise<void> {
  veProjectsList.innerHTML = '<p class="muted">Loading…</p>';
  const cfg = await window.api.aws.getConfig();
  const result = await window.api.video.listProjects({ bucket: cfg.bucket ?? '' });

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
    row.querySelector('button')!.addEventListener('click', () => openProject(project));
    veProjectsList.appendChild(row);
  });
}

export async function openProject(project: ProjectInfo): Promise<void> {
  const cfg = await window.api.aws.getConfig();
  ve.project  = { bucket: cfg.bucket ?? '', prefix: project.prefix, name: project.name };
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

  const [manifestResult] = await Promise.all([
    window.api.video.readProject({ bucket: ve.project.bucket, prefix: project.prefix }),
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
        name:        c.src.split('/').pop() ?? c.src,
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
    ve.manifest = makeEmptyManifest(project.name);
  }
}

export function initProjects(): void {
  document.querySelector('[data-tool="video-editor"]')!
    .addEventListener('click', loadProjects);

  el('ve-back-btn').addEventListener('click', () => {
    stopPlayback();
    showView('projects');
    loadProjects();
  });

  el('ve-create-project-btn').addEventListener('click', async () => {
    const input = el<HTMLInputElement>('ve-new-project-input');
    const name = input.value.trim();
    if (!name) return;

    const cfg = await window.api.aws.getConfig();
    const result = await window.api.video.createProject({ bucket: cfg.bucket ?? '', name });
    if (result.ok) {
      input.value = '';
      openProject({ prefix: result.prefix, name: result.manifest.name, key: '', lastModified: '' });
    } else {
      alert(`Failed to create project: ${result.error}`);
    }
  });

  veSaveBtn.addEventListener('click', saveStrip);
}

async function saveStrip(): Promise<void> {
  veSaveBtn.disabled = true;
  veSaveBtn.textContent = 'Saving…';

  if (!ve.project || !ve.manifest) return;

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
        ...(ve.manifest.tracks?.[0] ?? { id: 'track-v1', type: 'video' as const, label: 'Video 1', muted: false }),
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
    ve.dirty = true;
    updateSaveBtn();
    alert(`Save failed: ${result.error}`);
  }
}
