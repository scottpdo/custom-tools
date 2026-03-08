const { app, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { S3Client, ListObjectsV2Command, PutObjectCommand } = require('@aws-sdk/client-s3');
const s3 = require('../aws/s3');
const { getAwsConfig, buildClientConfig } = require('../aws/config');

const MANIFEST_FILENAME = 'custom-tools-video.json';
const VIDEO_EXTS = new Set(['.mp4', '.mov', '.webm', '.avi', '.mkv', '.m4v']);

// ── Temp dir ──────────────────────────────────────────────────────────────────

function getTempDir() {
  const dir = path.join(app.getPath('temp'), 'custom-tools-video');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function tempPathForKey(key) {
  const hash = crypto.createHash('md5').update(key).digest('hex');
  const ext = path.extname(key);
  return path.join(getTempDir(), `${hash}${ext}`);
}

// ── Projects ──────────────────────────────────────────────────────────────────

async function listProjects({ bucket } = {}) {
  const resolvedBucket = bucket || getAwsConfig().bucket;
  try {
    const client = new S3Client(buildClientConfig());
    let allObjects = [];
    let token;
    do {
      const res = await client.send(
        new ListObjectsV2Command({ Bucket: resolvedBucket, ContinuationToken: token })
      );
      allObjects = allObjects.concat(res.Contents || []);
      token = res.NextContinuationToken;
    } while (token);

    const projects = allObjects
      .filter((obj) => obj.Key.endsWith('/' + MANIFEST_FILENAME))
      .map((obj) => {
        const prefix = obj.Key.slice(0, -MANIFEST_FILENAME.length);
        const name = prefix.replace(/\/$/, '').split('/').pop();
        return { key: obj.Key, prefix, name, lastModified: obj.LastModified };
      });

    return { ok: true, projects };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function createProject({ bucket, name } = {}) {
  const resolvedBucket = bucket || getAwsConfig().bucket;
  const safeName = name.trim().replace(/[^a-zA-Z0-9\-_. ]/g, '-');
  const prefix = `${safeName}/`;
  const manifestKey = `${prefix}${MANIFEST_FILENAME}`;

  const manifest = {
    version: 1,
    name: safeName,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    settings: {
      frameRate: 30,
      resolution: { width: 1920, height: 1080 },
    },
    tracks: [
      {
        id: 'track-v1',
        type: 'video',
        label: 'Video 1',
        muted: false,
        clips: [],
      },
    ],
  };

  try {
    const client = new S3Client(buildClientConfig());
    await client.send(
      new PutObjectCommand({
        Bucket: resolvedBucket,
        Key: manifestKey,
        Body: JSON.stringify(manifest, null, 2),
        ContentType: 'application/json',
      })
    );
    return { ok: true, prefix, manifestKey, manifest };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// ── Project files ─────────────────────────────────────────────────────────────

async function listProjectFiles({ bucket, prefix } = {}) {
  const resolvedBucket = bucket || getAwsConfig().bucket;
  try {
    const result = await s3.listObjects({ bucket: resolvedBucket, prefix });
    if (!result.ok) return result;

    const files = result.objects.filter((obj) => {
      if (path.basename(obj.key) === MANIFEST_FILENAME) return false;
      return VIDEO_EXTS.has(path.extname(obj.key).toLowerCase());
    });

    return { ok: true, files };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// ── Download ──────────────────────────────────────────────────────────────────

async function downloadClip({ bucket, key } = {}) {
  const resolvedBucket = bucket || getAwsConfig().bucket;
  const localPath = tempPathForKey(key);

  if (fs.existsSync(localPath)) {
    return { ok: true, localPath, cached: true };
  }

  const result = await s3.downloadFile({ bucket: resolvedBucket, key, destPath: localPath });
  return result.ok ? { ok: true, localPath, cached: false } : result;
}

// ── Upload ────────────────────────────────────────────────────────────────────

async function openFileDialog() {
  const result = await dialog.showOpenDialog({
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Video Files', extensions: ['mp4', 'mov', 'webm', 'avi', 'mkv', 'm4v'] }],
  });
  if (result.canceled) return { ok: true, paths: [] };
  return { ok: true, paths: result.filePaths };
}

async function uploadFiles({ bucket, prefix, filePaths } = {}) {
  const resolvedBucket = bucket || getAwsConfig().bucket;
  const results = [];
  for (const filePath of filePaths) {
    const filename = path.basename(filePath);
    const key = `${prefix}${filename}`;
    const result = await s3.putObject({ bucket: resolvedBucket, key, filePath });
    results.push({ filePath, key, filename, ...result });
  }
  return { ok: true, results };
}

// ── Manifest read / write ─────────────────────────────────────────────────────

async function readProject({ bucket, prefix } = {}) {
  const resolvedBucket = bucket || getAwsConfig().bucket;
  try {
    const result = await s3.getObject({ bucket: resolvedBucket, key: `${prefix}${MANIFEST_FILENAME}` });
    if (!result.ok) return result;
    const manifest = JSON.parse(Buffer.from(result.body, 'base64').toString('utf8'));
    return { ok: true, manifest };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function saveProject({ bucket, prefix, manifest } = {}) {
  const resolvedBucket = bucket || getAwsConfig().bucket;
  try {
    const client = new S3Client(buildClientConfig());
    await client.send(
      new PutObjectCommand({
        Bucket: resolvedBucket,
        Key: `${prefix}${MANIFEST_FILENAME}`,
        Body: JSON.stringify(manifest, null, 2),
        ContentType: 'application/json',
      })
    );
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

module.exports = {
  listProjects,
  createProject,
  readProject,
  saveProject,
  listProjectFiles,
  downloadClip,
  openFileDialog,
  uploadFiles,
};
