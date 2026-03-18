// ── S3 models ─────────────────────────────────────────────────────────────────

export interface S3BucketInfo {
  name: string;
  createdAt: string;
}

export interface S3Object {
  key: string;
  size: number;
  lastModified: string;
  etag: string;
}

// ── Video models ──────────────────────────────────────────────────────────────

export interface FadeTransition {
  type: 'fade';
  duration: number;
}

export interface ClipTransitions {
  in?: FadeTransition;
  out?: FadeTransition;
}

export interface VideoClip {
  id: string;
  key: string;
  name: string;
  duration: number;
  trimIn: number;
  trimOut: number;
  volume: number;
  transitions: ClipTransitions;
  effects: unknown[];
  meta: Record<string, unknown>;
  localPath: string | null;
  thumbnail: string | null;
  downloading: boolean;
}

export interface ProjectManifestSettings {
  frameRate: number;
  resolution: { width: number; height: number };
}

export interface ManifestClip {
  id: string;
  src: string;
  startTime: number;
  duration: number;
  trim: { in: number; out: number };
  volume: number;
  transitions: ClipTransitions;
  effects: unknown[];
  meta: Record<string, unknown>;
}

export interface ManifestTrack {
  id: string;
  type: 'video';
  label: string;
  muted: boolean;
  clips: ManifestClip[];
}

export interface ProjectManifest {
  version: number;
  name: string;
  createdAt: string;
  updatedAt: string;
  settings: ProjectManifestSettings;
  tracks: ManifestTrack[];
}

export interface ProjectInfo {
  key: string;
  prefix: string;
  name: string;
  lastModified: string;
}

export interface ActiveProject {
  bucket: string;
  prefix: string;
  name: string;
}

export type RenderState = 'idle' | 'rendering' | 'done' | 'error';
