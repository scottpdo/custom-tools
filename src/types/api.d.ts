import type { S3BucketInfo, S3Object, ProjectManifest, ProjectInfo } from './models';

// ── Result helpers ─────────────────────────────────────────────────────────────

type OkResult<T extends Record<string, unknown> = Record<string, never>> = { ok: true } & T;
type ErrResult = { ok: false; error: string };
type Result<T extends Record<string, unknown> = Record<string, never>> = OkResult<T> | ErrResult;

// ── Per-namespace APIs ─────────────────────────────────────────────────────────

interface SettingsApi {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
}

interface AwsConfigResult {
  region: string;
  bucket?: string;
  hasCredentials: boolean;
  profile?: string | null;
}

interface AwsApi {
  getConfig(): Promise<AwsConfigResult>;
  saveConfig(config: Record<string, unknown>): Promise<{ ok: true }>;
  testConnection(): Promise<{ ok: true; account: string; arn: string } | ErrResult>;
}

interface S3ListObjectsResult {
  objects: S3Object[];
  prefixes: string[];
  isTruncated: boolean;
  nextToken?: string;
}

interface S3Api {
  listBuckets(): Promise<Result<{ buckets: S3BucketInfo[] }>>;
  listObjects(opts: { bucket: string; prefix: string }): Promise<Result<S3ListObjectsResult>>;
  getObject(opts: { bucket: string; key: string }): Promise<Result<{ body: string; contentType: string; contentLength: number }>>;
  putObject(opts: { bucket: string; key: string; filePath: string; contentType?: string }): Promise<Result<{ bucket: string; key: string }>>;
  deleteObject(opts: { bucket: string; key: string }): Promise<Result>;
  getPresignedUrl(opts: { bucket: string; key: string; expiresIn?: number }): Promise<Result<{ url: string }>>;
  downloadFiles(opts: { bucket: string; keys: string[]; destDir: string }): Promise<Result<{ count: number; destDir: string }>>;
  showDirectoryDialog(): Promise<{ ok: true; path: string | null }>;
  showUploadDialog(): Promise<{ ok: true; paths: string[] }>;
}

interface UploadFileResult {
  filePath: string;
  key: string;
  filename: string;
  ok: boolean;
  error?: string;
}

interface VideoApi {
  listProjects(opts: { bucket: string }): Promise<Result<{ projects: ProjectInfo[] }>>;
  createProject(opts: { bucket: string; name: string }): Promise<Result<{ prefix: string; manifestKey: string; manifest: ProjectManifest }>>;
  listProjectFiles(opts: { bucket: string; prefix: string }): Promise<Result<{ files: S3Object[] }>>;
  downloadClip(opts: { bucket: string; key: string }): Promise<Result<{ localPath: string; cached: boolean }>>;
  openFileDialog(): Promise<{ ok: true; paths: string[] }>;
  uploadFiles(opts: { bucket: string; prefix: string; filePaths: string[] }): Promise<Result<{ results: UploadFileResult[] }>>;
  readProject(opts: { bucket: string; prefix: string }): Promise<Result<{ manifest: ProjectManifest }>>;
  saveProject(opts: { bucket: string; prefix: string; manifest: ProjectManifest }): Promise<Result>;
  showSaveDialog(opts?: { defaultName?: string }): Promise<{ ok: true; path: string | null }>;
  render(opts: { clips: unknown[]; outputPath: string; settings?: unknown }): Promise<Result<{ outputPath: string }> | { ok: false; cancelled: true; error: string }>;
  cancelRender(): Promise<{ ok: true }>;
  onRenderProgress(cb: (data: { pct: number; timemark: string | null }) => void): void;
  offRenderProgress(): void;
}

// ── Global window augmentation ────────────────────────────────────────────────

declare global {
  interface Window {
    api: {
      settings: SettingsApi;
      aws: AwsApi;
      s3: S3Api;
      video: VideoApi;
    };
  }
}

export {};
