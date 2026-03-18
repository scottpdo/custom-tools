import { el } from '../utils/dom';
import type { VideoClip, ActiveProject, ProjectManifest } from '../types/models';

export interface PlayerState {
  isPlaying: boolean;
  currentIdx: number;
}

export interface DragState {
  type: 'strip' | 'library';
  index?: number;
  key?: string;
}

export interface VeState {
  project: ActiveProject | null;
  manifest: ProjectManifest | null;
  files: Array<{ key: string; size: number }>;
  strip: VideoClip[];
  player: PlayerState;
  drag: DragState | null;
  dirty: boolean;
}

export const ve: VeState = {
  project:  null,
  manifest: null,
  files:    [],
  strip:    [],
  player:   { isPlaying: false, currentIdx: -1 },
  drag:     null,
  dirty:    false,
};

const veSaveBtn = el<HTMLButtonElement>('ve-save-btn');

export function markDirty(): void {
  if (ve.dirty) return;
  ve.dirty = true;
  updateSaveBtn();
}

export function markClean(): void {
  ve.dirty = false;
  updateSaveBtn();
}

export function updateSaveBtn(): void {
  veSaveBtn.disabled = !ve.dirty;
  veSaveBtn.textContent = ve.dirty ? 'Save' : 'Saved ✓';
}

export function makeEmptyManifest(name: string): ProjectManifest {
  return {
    version:   1,
    name,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    settings:  { frameRate: 30, resolution: { width: 1920, height: 1080 } },
    tracks:    [{ id: 'track-v1', type: 'video', label: 'Video 1', muted: false, clips: [] }],
  };
}
