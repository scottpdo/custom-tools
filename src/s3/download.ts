export async function downloadKeys(bucket: string, keys: string[]): Promise<void> {
  if (!keys.length) return;
  const dirResult = await window.api.s3.showDirectoryDialog();
  if (!dirResult.ok || !dirResult.path) return;
  const result = await window.api.s3.downloadFiles({ bucket, keys, destDir: dirResult.path });
  if (!result.ok) alert(`Download failed: ${result.error}`);
}
