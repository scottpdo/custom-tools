import { ipcMain } from 'electron';
import type Store from 'electron-store';
import { getAwsConfig, saveAwsConfig } from '../aws/config';

export function registerSettingsHandlers(store: Store): void {
  ipcMain.handle('settings:get', (_event, key: string) => store.get(key));
  ipcMain.handle('settings:set', (_event, key: string, value: unknown) => store.set(key, value));
  ipcMain.handle('settings:delete', (_event, key: string) => store.delete(key));

  ipcMain.handle('aws:getConfig', () => {
    const cfg = getAwsConfig();
    return {
      region:         cfg.region,
      bucket:         cfg.bucket,
      hasCredentials: !!(cfg.accessKeyId || cfg.profile),
      profile:        cfg.profile ?? null,
    };
  });

  ipcMain.handle('aws:saveConfig', (_event, config: Record<string, unknown>) => {
    saveAwsConfig(config, store);
    return { ok: true };
  });

  ipcMain.handle('aws:testConnection', async () => {
    const { STSClient, GetCallerIdentityCommand } = await import('@aws-sdk/client-sts');
    try {
      const cfg = getAwsConfig();
      const sts = new STSClient({
        region: cfg.region,
        ...(cfg.accessKeyId && {
          credentials: {
            accessKeyId:     cfg.accessKeyId,
            secretAccessKey: cfg.secretAccessKey!,
          },
        }),
      });
      const identity = await sts.send(new GetCallerIdentityCommand({}));
      return { ok: true, account: identity.Account, arn: identity.Arn };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  });
}
