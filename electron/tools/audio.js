const { app, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
const { pathToFileURL } = require('url');
const { S3Client, ListObjectsV2Command, PutObjectCommand } = require('@aws-sdk/client-s3');
const { getAwsConfig, buildClientConfig } = require('../aws/config');

const MANIFEST_FILENAME = 'custom-tools-audio.json';
const SOUNDFONT_BASE = 'https://gleitz.github.io/midi-js-soundfonts/FluidR3_GM';

// Samples to fetch per instrument: Tone.js note name → gleitz filename stem
// Every 3 semitones from A0 to C7 gives Tone.Sampler enough range to interpolate
const SAMPLE_MAP = {
  'A0':'A0',  'C1':'C1',  'D#1':'Ds1', 'F#1':'Fs1',
  'A1':'A1',  'C2':'C2',  'D#2':'Ds2', 'F#2':'Fs2',
  'A2':'A2',  'C3':'C3',  'D#3':'Ds3', 'F#3':'Fs3',
  'A3':'A3',  'C4':'C4',  'D#4':'Ds4', 'F#4':'Fs4',
  'A4':'A4',  'C5':'C5',  'D#5':'Ds5', 'F#5':'Fs5',
  'A5':'A5',  'C6':'C6',  'D#6':'Ds6', 'F#6':'Fs6',
  'A6':'A6',  'C7':'C7',
};

const INSTRUMENTS = [
  { id: 'acoustic_grand_piano',   label: 'Grand Piano' },
  { id: 'electric_piano_1',       label: 'Electric Piano' },
  { id: 'acoustic_guitar_nylon',  label: 'Nylon Guitar' },
  { id: 'electric_bass_finger',   label: 'Bass Guitar' },
  { id: 'violin',                 label: 'Violin' },
  { id: 'trumpet',                label: 'Trumpet' },
  { id: 'flute',                  label: 'Flute' },
  { id: 'choir_aahs',             label: 'Choir' },
  { id: 'string_ensemble_1',      label: 'Strings' },
  { id: 'synth_lead_1_square',    label: 'Synth Lead' },
];

// ── Cache dirs ────────────────────────────────────────────────────────────────

function getSoundfontsDir() {
  const dir = path.join(app.getPath('userData'), 'soundfonts');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function getInstrumentDir(instrument) {
  const dir = path.join(getSoundfontsDir(), instrument);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// ── Download ──────────────────────────────────────────────────────────────────

function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath);
    const cleanup = () => { file.close(); fs.unlink(destPath, () => {}); };
    https.get(url, (res) => {
      if (res.statusCode !== 200) {
        cleanup();
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      res.pipe(file);
      file.on('finish', () => file.close(resolve));
    }).on('error', (err) => { cleanup(); reject(err); });
  });
}

// Download any missing samples for an instrument; push progress events via callback.
async function ensureSamples({ instrument }, onProgress) {
  const dir = getInstrumentDir(instrument);
  const entries = Object.entries(SAMPLE_MAP);
  const urls = {};
  let done = 0;

  for (const [toneNote, gleitzStem] of entries) {
    const filename = `${gleitzStem}.mp3`;
    const localPath = path.join(dir, filename);

    if (!fs.existsSync(localPath)) {
      const url = `${SOUNDFONT_BASE}/${instrument}-mp3/${filename}`;
      try {
        await downloadFile(url, localPath);
      } catch {
        done++;
        onProgress?.({ done, total: entries.length });
        continue;
      }
    }

    urls[toneNote] = pathToFileURL(localPath).href;
    done++;
    onProgress?.({ done, total: entries.length });
  }

  return { ok: true, urls };
}

// Returns cached file:// URLs for already-downloaded samples (no network calls).
function getCachedSamples(instrument) {
  const dir = getInstrumentDir(instrument);
  const urls = {};
  for (const [toneNote, gleitzStem] of Object.entries(SAMPLE_MAP)) {
    const localPath = path.join(dir, `${gleitzStem}.mp3`);
    if (fs.existsSync(localPath)) urls[toneNote] = pathToFileURL(localPath).href;
  }
  const cached = Object.keys(urls).length > 0;
  return { ok: true, cached, urls: cached ? urls : {} };
}

function getInstruments() {
  return { ok: true, instruments: INSTRUMENTS };
}

// ── S3 project CRUD ───────────────────────────────────────────────────────────

async function listProjects({ bucket } = {}) {
  const resolvedBucket = bucket || getAwsConfig().bucket;
  try {
    const client = new S3Client(buildClientConfig());
    let objects = [], token;
    do {
      const res = await client.send(
        new ListObjectsV2Command({ Bucket: resolvedBucket, ContinuationToken: token })
      );
      objects = objects.concat(res.Contents || []);
      token = res.NextContinuationToken;
    } while (token);

    const projects = objects
      .filter((o) => o.Key.endsWith('/' + MANIFEST_FILENAME))
      .map((o) => {
        const prefix = o.Key.slice(0, -MANIFEST_FILENAME.length);
        const name = prefix.replace(/\/$/, '').split('/').pop();
        return { key: o.Key, prefix, name, lastModified: o.LastModified };
      });

    return { ok: true, projects };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

function makeDefaultManifest(name) {
  const trackNames = ['Track 1', 'Track 2', 'Track 3', 'Track 4'];
  const instruments = [
    'acoustic_grand_piano', 'electric_piano_1', 'violin', 'electric_bass_finger',
  ];
  return {
    version: 1,
    name,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    bpm: 120,
    bars: 8,
    tracks: trackNames.map((trackName, i) => ({
      id: `track-${i}`,
      name: trackName,
      instrument: instruments[i],
      volume: 0.8,
      muted: false,
      notes: [],
    })),
  };
}

async function createProject({ bucket, name } = {}) {
  const resolvedBucket = bucket || getAwsConfig().bucket;
  const safeName = name.trim().replace(/[^a-zA-Z0-9\-_. ]/g, '-');
  const prefix = `audio/${safeName}/`;
  const manifestKey = `${prefix}${MANIFEST_FILENAME}`;
  const manifest = makeDefaultManifest(safeName);

  try {
    const client = new S3Client(buildClientConfig());
    await client.send(new PutObjectCommand({
      Bucket: resolvedBucket,
      Key: manifestKey,
      Body: JSON.stringify(manifest, null, 2),
      ContentType: 'application/json',
    }));
    return { ok: true, prefix, manifest };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function readProject({ bucket, prefix } = {}) {
  const resolvedBucket = bucket || getAwsConfig().bucket;
  try {
    const client = new S3Client(buildClientConfig());
    const { GetObjectCommand } = require('@aws-sdk/client-s3');
    const res = await client.send(new GetObjectCommand({
      Bucket: resolvedBucket,
      Key: `${prefix}${MANIFEST_FILENAME}`,
    }));
    const body = await res.Body.transformToString('utf8');
    return { ok: true, manifest: JSON.parse(body) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function saveProject({ bucket, prefix, manifest } = {}) {
  const resolvedBucket = bucket || getAwsConfig().bucket;
  try {
    const client = new S3Client(buildClientConfig());
    await client.send(new PutObjectCommand({
      Bucket: resolvedBucket,
      Key: `${prefix}${MANIFEST_FILENAME}`,
      Body: JSON.stringify({ ...manifest, updatedAt: new Date().toISOString() }, null, 2),
      ContentType: 'application/json',
    }));
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// ── Export ────────────────────────────────────────────────────────────────────

async function showExportDialog({ defaultName } = {}) {
  const result = await dialog.showSaveDialog({
    title: 'Export Audio',
    defaultPath: `${defaultName || 'export'}.wav`,
    filters: [{ name: 'WAV Audio', extensions: ['wav'] }],
  });
  return result.canceled ? { ok: true, filePath: null } : { ok: true, filePath: result.filePath };
}

async function writeExportFile({ filePath, data } = {}) {
  try {
    fs.writeFileSync(filePath, Buffer.from(data));
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

module.exports = {
  getInstruments,
  ensureSamples,
  getCachedSamples,
  listProjects,
  createProject,
  readProject,
  saveProject,
  showExportDialog,
  writeExportFile,
};
