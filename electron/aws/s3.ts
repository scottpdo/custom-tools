/**
 * S3 service module.
 * All methods return plain serialisable objects so they can travel over IPC.
 */
import {
  S3Client,
  ListBucketsCommand,
  ListObjectsV2Command,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import fs from 'fs';
import path from 'path';
import { buildClientConfig, getAwsConfig } from './config';

function getClient(): S3Client {
  return new S3Client(buildClientConfig());
}

// ── Buckets ───────────────────────────────────────────────────────────────────

export async function listBuckets() {
  try {
    const client = getClient();
    const { Buckets } = await client.send(new ListBucketsCommand({}));
    return {
      ok: true as const,
      buckets: (Buckets ?? []).map((b) => ({ name: b.Name!, createdAt: b.CreationDate! })),
    };
  } catch (err) {
    return { ok: false as const, error: (err as Error).message };
  }
}

// ── Objects ───────────────────────────────────────────────────────────────────

export async function listObjects({ bucket, prefix = '' }: { bucket?: string; prefix?: string } = {}) {
  const resolvedBucket = bucket || getAwsConfig().bucket!;
  try {
    const client = getClient();
    const response = await client.send(
      new ListObjectsV2Command({ Bucket: resolvedBucket, Prefix: prefix, Delimiter: '/' })
    );
    return {
      ok: true as const,
      objects: (response.Contents ?? []).map((o) => ({
        key:          o.Key!,
        size:         o.Size ?? 0,
        lastModified: o.LastModified!,
        etag:         o.ETag ?? '',
      })),
      prefixes:    (response.CommonPrefixes ?? []).map((p) => p.Prefix!),
      isTruncated: response.IsTruncated ?? false,
      nextToken:   response.NextContinuationToken,
    };
  } catch (err) {
    return { ok: false as const, error: (err as Error).message };
  }
}

export async function getObject({ bucket, key }: { bucket?: string; key: string } = { key: '' }) {
  const resolvedBucket = bucket || getAwsConfig().bucket!;
  try {
    const client = getClient();
    const response = await client.send(new GetObjectCommand({ Bucket: resolvedBucket, Key: key }));
    const chunks: Uint8Array[] = [];
    for await (const chunk of response.Body as AsyncIterable<Uint8Array>) {
      chunks.push(chunk);
    }
    const buffer = Buffer.concat(chunks);
    return {
      ok:            true as const,
      body:          buffer.toString('base64'),
      contentType:   response.ContentType ?? '',
      contentLength: response.ContentLength ?? 0,
    };
  } catch (err) {
    return { ok: false as const, error: (err as Error).message };
  }
}

export async function putObject({
  bucket, key, filePath, contentType,
}: { bucket?: string; key: string; filePath: string; contentType?: string } = { key: '', filePath: '' }) {
  const resolvedBucket = bucket || getAwsConfig().bucket!;
  try {
    const fileStream = fs.createReadStream(filePath);
    const resolvedContentType = contentType || guessMime(filePath);
    const client = getClient();

    const upload = new Upload({
      client,
      params: {
        Bucket:      resolvedBucket,
        Key:         key,
        Body:        fileStream,
        ContentType: resolvedContentType,
      },
    });

    await upload.done();
    return { ok: true as const, bucket: resolvedBucket, key };
  } catch (err) {
    return { ok: false as const, error: (err as Error).message };
  }
}

export async function deleteObject({ bucket, key }: { bucket?: string; key: string } = { key: '' }) {
  const resolvedBucket = bucket || getAwsConfig().bucket!;
  try {
    const client = getClient();
    await client.send(new DeleteObjectCommand({ Bucket: resolvedBucket, Key: key }));
    return { ok: true as const };
  } catch (err) {
    return { ok: false as const, error: (err as Error).message };
  }
}

export async function getPresignedUrl({
  bucket, key, expiresIn = 3600,
}: { bucket?: string; key: string; expiresIn?: number } = { key: '' }) {
  const resolvedBucket = bucket || getAwsConfig().bucket!;
  try {
    const client  = getClient();
    const command = new GetObjectCommand({ Bucket: resolvedBucket, Key: key });
    const url     = await getSignedUrl(client, command, { expiresIn });
    return { ok: true as const, url };
  } catch (err) {
    return { ok: false as const, error: (err as Error).message };
  }
}

export async function downloadFile({
  bucket, key, destPath,
}: { bucket?: string; key: string; destPath: string } = { key: '', destPath: '' }) {
  const resolvedBucket = bucket || getAwsConfig().bucket!;
  try {
    const client   = getClient();
    const response = await client.send(new GetObjectCommand({ Bucket: resolvedBucket, Key: key }));

    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    const writeStream = fs.createWriteStream(destPath);

    await new Promise<void>((resolve, reject) => {
      (response.Body as NodeJS.ReadableStream).pipe(writeStream);
      writeStream.on('finish', resolve);
      writeStream.on('error', reject);
      (response.Body as NodeJS.ReadableStream).on('error', reject);
    });

    return { ok: true as const, destPath };
  } catch (err) {
    try { fs.unlinkSync(destPath); } catch { /* ignore */ }
    return { ok: false as const, error: (err as Error).message };
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const MIME_MAP: Record<string, string> = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.gif': 'image/gif',  '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4',  '.mov': 'video/quicktime', '.webm': 'video/webm',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav',   '.aac': 'audio/aac',
  '.flac': 'audio/flac', '.pdf': 'application/pdf', '.json': 'application/json',
  '.html': 'text/html', '.css': 'text/css',    '.js': 'application/javascript',
};

function guessMime(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  return MIME_MAP[ext] ?? 'application/octet-stream';
}
