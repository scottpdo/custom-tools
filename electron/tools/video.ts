import { app, dialog } from 'electron';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { S3Client, ListObjectsV2Command, PutObjectCommand } from '@aws-sdk/client-s3';
import * as s3 from '../aws/s3';
import { getAwsConfig, buildClientConfig } from '../aws/config';

const MANIFEST_FILENAME = 'custom-tools-video.json';
const VIDEO_EXTS = new Set(['.mp4', '.mov', '.webm', '.avi', '.mkv', '.m4v']);

// ── Temp dir ──────────────────────────────────────────────────────────────────

function getTempDir(): string {
  const dir = path.join(app.getPath('temp'), 'custom-tools-video');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function tempPathForKey(key: string): string {
  const hash = crypto.createHash('md5').update(key).digest('hex');
  const ext  = path.extname(key);
  return path.join(getTempDir(), `${hash}${ext}`);
}

// ── Projects ──────────────────────────────────────────────────────────────────

export async function listProjects({ bucket }: { bucket?: string } = {}) {
  const resolvedBucket = bucket || getAwsConfig().bucket!;
  try {
    const client = new S3Client(buildClientConfig());
    let allObjects: { Key?: string; LastModified?: Date }[] = [];
    let token: string | undefined;
    do {
      const res = await client.send(
        new ListObjectsV2Command({ Bucket: resolvedBucket, ContinuationToken: token })
      );
      allObjects = allObjects.concat(res.Contents ?? []);
      token = res.NextContinuationToken;
    } while (token);

    const projects = allObjects
      .filter((obj) => obj.Key?.endsWith('/' + MANIFEST_FILENAME))
      .map((obj) => {
        const prefix = obj.Key!.slice(0, -MANIFEST_FILENAME.length);
        const name   = prefix.replace(/\/$/, '').split('/').pop()!;
        return { key: obj.Key!, prefix, name, lastModified: obj.LastModified! };
      });

    return { ok: true as const, projects };
  } catch (err) {
    return { ok: false as const, error: (err as Error).message };
  }
}

export async function createProject({ bucket, name }: { bucket?: string; name: string } = { name: '' }) {
  const resolvedBucket = bucket || getAwsConfig().bucket!;
  const safeName  = name.trim().replace(/[^a-zA-Z0-9\-_. ]/g, '-');
  const prefix    = `${safeName}/`;
  const manifestKey = `${prefix}${MANIFEST_FILENAME}`;

  const manifest = {
    version:   1,
    name:      safeName,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    settings:  { frameRate: 30, resolution: { width: 1920, height: 1080 } },
    tracks:    [{ id: 'track-v1', type: 'video' as const, label: 'Video 1', muted: false, clips: [] }],
  };

  try {
    const client = new S3Client(buildClientConfig());
    await client.send(new PutObjectCommand({
      Bucket:      resolvedBucket,
      Key:         manifestKey,
      Body:        JSON.stringify(manifest, null, 2),
      ContentType: 'application/json',
    }));
    return { ok: true as const, prefix, manifestKey, manifest };
  } catch (err) {
    return { ok: false as const, error: (err as Error).message };
  }
}

// ── Project files ─────────────────────────────────────────────────────────────

export async function listProjectFiles({ bucket, prefix }: { bucket?: string; prefix: string } = { prefix: '' }) {
  const resolvedBucket = bucket || getAwsConfig().bucket!;
  try {
    const result = await s3.listObjects({ bucket: resolvedBucket, prefix });
    if (!result.ok) return result;
    const files = result.objects.filter((obj) => {
      if (path.basename(obj.key) === MANIFEST_FILENAME) return false;
      return VIDEO_EXTS.has(path.extname(obj.key).toLowerCase());
    });
    return { ok: true as const, files };
  } catch (err) {
    return { ok: false as const, error: (err as Error).message };
  }
}

// ── Download ──────────────────────────────────────────────────────────────────

export async function downloadClip({ bucket, key }: { bucket?: string; key: string } = { key: '' }) {
  const resolvedBucket = bucket || getAwsConfig().bucket!;
  const localPath = tempPathForKey(key);

  if (fs.existsSync(localPath)) return { ok: true as const, localPath, cached: true };

  const result = await s3.downloadFile({ bucket: resolvedBucket, key, destPath: localPath });
  return result.ok ? { ok: true as const, localPath, cached: false } : result;
}

// ── Upload ────────────────────────────────────────────────────────────────────

export async function openFileDialog() {
  const result = await dialog.showOpenDialog({
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Video Files', extensions: ['mp4', 'mov', 'webm', 'avi', 'mkv', 'm4v'] }],
  });
  return result.canceled ? { ok: true as const, paths: [] } : { ok: true as const, paths: result.filePaths };
}

export async function uploadFiles({
  bucket, prefix, filePaths,
}: { bucket?: string; prefix: string; filePaths: string[] } = { prefix: '', filePaths: [] }) {
  const resolvedBucket = bucket || getAwsConfig().bucket!;
  const results = [];
  for (const filePath of filePaths) {
    const filename = path.basename(filePath);
    const key = `${prefix}${filename}`;
    const result = await s3.putObject({ bucket: resolvedBucket, key, filePath });
    results.push({ filePath, key, filename, ...result });
  }
  return { ok: true as const, results };
}

// ── Manifest read / write ─────────────────────────────────────────────────────

export async function readProject({ bucket, prefix }: { bucket?: string; prefix: string } = { prefix: '' }) {
  const resolvedBucket = bucket || getAwsConfig().bucket!;
  try {
    const result = await s3.getObject({ bucket: resolvedBucket, key: `${prefix}${MANIFEST_FILENAME}` });
    if (!result.ok) return result;
    const manifest = JSON.parse(Buffer.from(result.body, 'base64').toString('utf8'));
    return { ok: true as const, manifest };
  } catch (err) {
    return { ok: false as const, error: (err as Error).message };
  }
}

export async function saveProject({
  bucket, prefix, manifest,
}: { bucket?: string; prefix: string; manifest: unknown } = { prefix: '', manifest: {} }) {
  const resolvedBucket = bucket || getAwsConfig().bucket!;
  try {
    const client = new S3Client(buildClientConfig());
    await client.send(new PutObjectCommand({
      Bucket:      resolvedBucket,
      Key:         `${prefix}${MANIFEST_FILENAME}`,
      Body:        JSON.stringify(manifest, null, 2),
      ContentType: 'application/json',
    }));
    return { ok: true as const };
  } catch (err) {
    return { ok: false as const, error: (err as Error).message };
  }
}
