export const IMAGE_EXTS = new Set([
  'jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif', 'tiff', 'tif',
]);

export const VIDEO_EXTS = new Set([
  'mp4', 'webm', 'ogg', 'ogv', 'mov', 'mkv', 'm4v', 'avi',
]);

export const AUDIO_EXTS = new Set([
  'mp3', 'wav', 'ogg', 'oga', 'flac', 'aac', 'm4a', 'opus', 'weba',
]);

function ext(key: string): string {
  return key.split('.').pop()?.toLowerCase() ?? '';
}

export function isImageKey(key: string): boolean { return IMAGE_EXTS.has(ext(key)); }
export function isVideoKey(key: string): boolean { return VIDEO_EXTS.has(ext(key)); }
export function isAudioKey(key: string): boolean { return AUDIO_EXTS.has(ext(key)); }
