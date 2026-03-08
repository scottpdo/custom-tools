/**
 * AWS configuration loader.
 *
 * Priority order (highest → lowest):
 *   1. Values saved in electron-store (user entered via Settings UI)
 *   2. Environment variables (.env or shell)
 *   3. SDK default chain (IAM role, ~/.aws/credentials, etc.)
 */

let _store = null; // set lazily from main.js after store is initialised

function setStore(store) {
  _store = store;
}

function getAwsConfig() {
  const stored = _store
    ? {
        accessKeyId: _store.get('aws.accessKeyId'),
        secretAccessKey: _store.get('aws.secretAccessKey'),
        region: _store.get('aws.region'),
        bucket: _store.get('aws.bucket'),
        profile: _store.get('aws.profile'),
      }
    : {};

  return {
    accessKeyId: stored.accessKeyId || process.env.AWS_ACCESS_KEY_ID || undefined,
    secretAccessKey: stored.secretAccessKey || process.env.AWS_SECRET_ACCESS_KEY || undefined,
    region: stored.region || process.env.AWS_REGION || 'us-east-1',
    bucket: stored.bucket || process.env.S3_BUCKET || undefined,
    profile: stored.profile || process.env.AWS_PROFILE || undefined,
  };
}

/**
 * Persist AWS config to electron-store.
 * secretAccessKey is only updated when explicitly provided (non-empty).
 */
function saveAwsConfig(config, store) {
  if (!store) return;

  if (config.accessKeyId !== undefined) store.set('aws.accessKeyId', config.accessKeyId);
  if (config.secretAccessKey) store.set('aws.secretAccessKey', config.secretAccessKey);
  if (config.region) store.set('aws.region', config.region);
  if (config.bucket !== undefined) store.set('aws.bucket', config.bucket);
  if (config.profile !== undefined) store.set('aws.profile', config.profile);
}

/**
 * Build a credentials object for AWS SDK clients, or undefined to fall back
 * to the SDK's default credential provider chain.
 */
function buildCredentials(cfg) {
  if (cfg.accessKeyId && cfg.secretAccessKey) {
    return {
      accessKeyId: cfg.accessKeyId,
      secretAccessKey: cfg.secretAccessKey,
    };
  }
  return undefined; // SDK will use default chain (profile, instance role, etc.)
}

/**
 * Returns a base config object suitable for spreading into any AWS SDK client.
 */
function buildClientConfig() {
  const cfg = getAwsConfig();
  const clientConfig = { region: cfg.region };
  const credentials = buildCredentials(cfg);
  if (credentials) clientConfig.credentials = credentials;
  return clientConfig;
}

module.exports = { getAwsConfig, saveAwsConfig, setStore, buildClientConfig };
