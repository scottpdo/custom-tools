export const IMAGE_EXTS = new Set([
  'jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif', 'tiff', 'tif',
]);

export function isImageKey(key: string): boolean {
  return IMAGE_EXTS.has(key.split('.').pop()?.toLowerCase() ?? '');
}
