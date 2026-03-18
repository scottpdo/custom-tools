/**
 * AWS configuration loader.
 *
 * Priority order (highest → lowest):
 *   1. Values saved in electron-store (user entered via Settings UI)
 *   2. Environment variables (.env or shell)
 *   3. SDK default chain (IAM role, ~/.aws/credentials, etc.)
 */
import type Store from 'electron-store';

export interface AwsConfig {
  accessKeyId?:     string;
  secretAccessKey?: string;
  region:           string;
  bucket?:          string;
  profile?:         string;
}

let _store: Store | null = null;

export function setStore(store: Store): void {
  _store = store;
}

export function getAwsConfig(): AwsConfig {
  const stored = _store
    ? {
        accessKeyId:     _store.get('aws.accessKeyId') as string | undefined,
        secretAccessKey: _store.get('aws.secretAccessKey') as string | undefined,
        region:          _store.get('aws.region') as string | undefined,
        bucket:          _store.get('aws.bucket') as string | undefined,
        profile:         _store.get('aws.profile') as string | undefined,
      }
    : {};

  return {
    accessKeyId:     stored.accessKeyId     || process.env.AWS_ACCESS_KEY_ID     || undefined,
    secretAccessKey: stored.secretAccessKey || process.env.AWS_SECRET_ACCESS_KEY || undefined,
    region:          stored.region          || process.env.AWS_REGION             || 'us-east-1',
    bucket:          stored.bucket          || process.env.S3_BUCKET              || undefined,
    profile:         stored.profile         || process.env.AWS_PROFILE            || undefined,
  };
}

/**
 * Persist AWS config to electron-store.
 * secretAccessKey is only updated when explicitly provided (non-empty).
 */
export function saveAwsConfig(config: Record<string, unknown>, store: Store): void {
  if (!store) return;
  if (config.accessKeyId  !== undefined) store.set('aws.accessKeyId',  config.accessKeyId);
  if (config.secretAccessKey)            store.set('aws.secretAccessKey', config.secretAccessKey);
  if (config.region)                     store.set('aws.region',  config.region);
  if (config.bucket       !== undefined) store.set('aws.bucket',  config.bucket);
  if (config.profile      !== undefined) store.set('aws.profile', config.profile);
}

function buildCredentials(cfg: AwsConfig) {
  if (cfg.accessKeyId && cfg.secretAccessKey) {
    return { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey };
  }
  return undefined;
}

export function buildClientConfig() {
  const cfg = getAwsConfig();
  const clientConfig: Record<string, unknown> = { region: cfg.region };
  const credentials = buildCredentials(cfg);
  if (credentials) clientConfig.credentials = credentials;
  return clientConfig;
}
