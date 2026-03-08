/**
 * S3 service module.
 * All methods return plain serialisable objects so they can travel over IPC.
 */
const {
  S3Client,
  ListBucketsCommand,
  ListObjectsV2Command,
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
} = require('@aws-sdk/client-s3');
const { Upload } = require('@aws-sdk/lib-storage');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const fs = require('fs');
const path = require('path');
const { buildClientConfig, getAwsConfig } = require('./config');

function getClient() {
  return new S3Client(buildClientConfig());
}

// ── Buckets ───────────────────────────────────────────────────────────────────

async function listBuckets() {
  try {
    const client = getClient();
    const { Buckets } = await client.send(new ListBucketsCommand({}));
    return { ok: true, buckets: Buckets.map((b) => ({ name: b.Name, createdAt: b.CreationDate })) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// ── Objects ───────────────────────────────────────────────────────────────────

/**
 * List objects in a bucket under an optional prefix.
 * Returns up to 1000 results; add pagination support as needed.
 */
async function listObjects({ bucket, prefix = '' } = {}) {
  const resolvedBucket = bucket || getAwsConfig().bucket;
  try {
    const client = getClient();
    const response = await client.send(
      new ListObjectsV2Command({ Bucket: resolvedBucket, Prefix: prefix, Delimiter: '/' })
    );
    return {
      ok: true,
      objects: (response.Contents || []).map((o) => ({
        key: o.Key,
        size: o.Size,
        lastModified: o.LastModified,
        etag: o.ETag,
      })),
      prefixes: (response.CommonPrefixes || []).map((p) => p.Prefix),
      isTruncated: response.IsTruncated,
      nextToken: response.NextContinuationToken,
    };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * Download an object and return its body as a base64 string.
 * For large files (video/audio), use getPresignedUrl instead.
 */
async function getObject({ bucket, key } = {}) {
  const resolvedBucket = bucket || getAwsConfig().bucket;
  try {
    const client = getClient();
    const response = await client.send(
      new GetObjectCommand({ Bucket: resolvedBucket, Key: key })
    );
    const chunks = [];
    for await (const chunk of response.Body) {
      chunks.push(chunk);
    }
    const buffer = Buffer.concat(chunks);
    return {
      ok: true,
      body: buffer.toString('base64'),
      contentType: response.ContentType,
      contentLength: response.ContentLength,
    };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * Upload a local file to S3.
 * Uses multipart upload via @aws-sdk/lib-storage for large files.
 */
async function putObject({ bucket, key, filePath, contentType } = {}) {
  const resolvedBucket = bucket || getAwsConfig().bucket;
  try {
    const fileStream = fs.createReadStream(filePath);
    const resolvedContentType = contentType || guessMime(filePath);
    const client = getClient();

    const upload = new Upload({
      client,
      params: {
        Bucket: resolvedBucket,
        Key: key,
        Body: fileStream,
        ContentType: resolvedContentType,
      },
    });

    await upload.done();
    return { ok: true, bucket: resolvedBucket, key };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function deleteObject({ bucket, key } = {}) {
  const resolvedBucket = bucket || getAwsConfig().bucket;
  try {
    const client = getClient();
    await client.send(new DeleteObjectCommand({ Bucket: resolvedBucket, Key: key }));
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * Generate a pre-signed GET URL (default 1 hour).
 * Useful for streaming large video/audio files directly in the renderer.
 */
async function getPresignedUrl({ bucket, key, expiresIn = 3600 } = {}) {
  const resolvedBucket = bucket || getAwsConfig().bucket;
  try {
    const client = getClient();
    const command = new GetObjectCommand({ Bucket: resolvedBucket, Key: key });
    const url = await getSignedUrl(client, command, { expiresIn });
    return { ok: true, url };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const MIME_MAP = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.aac': 'audio/aac',
  '.flac': 'audio/flac',
  '.pdf': 'application/pdf',
  '.json': 'application/json',
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
};

function guessMime(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return MIME_MAP[ext] || 'application/octet-stream';
}

module.exports = { listBuckets, listObjects, getObject, putObject, deleteObject, getPresignedUrl };
