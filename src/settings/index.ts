import { el, setStatus } from '../utils/dom';

const settingsForm   = el<HTMLFormElement>('settings-form');
const settingsStatus = el('settings-status');

export function initSettings(): void {
  settingsForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = settingsForm as HTMLFormElement & {
      region: HTMLInputElement;
      accessKeyId: HTMLInputElement;
      secretAccessKey: HTMLInputElement;
      profile: HTMLInputElement;
      bucket: HTMLInputElement;
    };
    const data = {
      region:          form.region.value.trim(),
      accessKeyId:     form.accessKeyId.value.trim() === '(stored)' ? undefined : form.accessKeyId.value.trim(),
      secretAccessKey: form.secretAccessKey.value,
      profile:         form.profile.value.trim(),
      bucket:          form.bucket.value.trim(),
    };
    await window.api.aws.saveConfig(data);
    setStatus(settingsStatus, 'ok', 'Settings saved.');
    await checkConnection();
  });

  el('btn-test-connection').addEventListener('click', async () => {
    setStatus(settingsStatus, '', 'Testing…');
    const result = await window.api.aws.testConnection();
    if (result.ok) {
      setStatus(settingsStatus, 'ok', `Connected as ${result.arn}`);
    } else {
      setStatus(settingsStatus, 'error', `Error: ${result.error}`);
    }
  });
}

export async function loadSettingsForm(): Promise<void> {
  const form = settingsForm as HTMLFormElement & {
    region: HTMLInputElement;
    accessKeyId: HTMLInputElement;
    profile: HTMLInputElement;
    bucket: HTMLInputElement;
  };
  const cfg = await window.api.aws.getConfig();
  form.region.value      = cfg.region || '';
  form.accessKeyId.value = cfg.hasCredentials && !cfg.profile ? '(stored)' : '';
  form.profile.value     = cfg.profile || '';
  form.bucket.value      = String((await window.api.settings.get('aws.bucket')) ?? '');
}

export async function checkConnection(): Promise<void> {
  const badge = el('connection-badge');
  badge.className = 'badge badge-unknown';
  badge.textContent = 'Checking AWS…';

  const result = await window.api.aws.testConnection();
  if (result.ok) {
    badge.className = 'badge badge-ok';
    badge.textContent = `Connected · ${result.account}`;
  } else {
    badge.className = 'badge badge-error';
    badge.textContent = 'Not connected';
  }
}
