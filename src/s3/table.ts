import { formatBytes } from '../utils/format';
import { isImageKey, isVideoKey, isAudioKey } from './constants';
import { openPreviewViewer } from './preview';
import type { PreviewEntry } from './preview';
import { downloadKeys } from './download';
import type { S3Object } from '../types/models';

interface TableCallbacks {
  onFolderClick: (prefix: string) => void;
  onDelete: (bucket: string, key: string) => void;
  onSelectionChange: () => void;
}

type MediaType = PreviewEntry['type'];

function mediaType(key: string): MediaType | null {
  if (isImageKey(key)) return 'image';
  if (isVideoKey(key)) return 'video';
  if (isAudioKey(key)) return 'audio';
  return null;
}

const ICON: Record<MediaType, string> = { image: '🖼 ', video: '🎬 ', audio: '🎵 ' };

export function renderTable(
  tbody: HTMLTableSectionElement,
  bucket: string,
  prefixes: string[],
  objects: S3Object[],
  callbacks: TableCallbacks,
): void {
  // Build the ordered list of previewable entries so the viewer can navigate
  const previewEntries: PreviewEntry[] = [];
  const previewIndexByKey = new Map<string, number>();
  objects.forEach((obj) => {
    const mt = mediaType(obj.key);
    if (mt) {
      previewIndexByKey.set(obj.key, previewEntries.length);
      previewEntries.push({ bucket, key: obj.key, type: mt });
    }
  });

  const rows: string[] = [];

  prefixes.forEach((pfx) => {
    const label = pfx.replace(/\/$/, '').split('/').filter(Boolean).at(-1) ?? pfx;
    rows.push(`
      <tr tabindex="0">
        <td></td>
        <td><button class="link-btn" data-prefix="${pfx}" title="${pfx}">📁 ${label}</button></td>
        <td>—</td><td>—</td><td></td>
      </tr>
    `);
  });

  objects.forEach((obj) => {
    const mt    = mediaType(obj.key);
    const label = obj.key.split('/').filter(Boolean).at(-1) ?? obj.key;
    const icon  = mt ? ICON[mt] : '';
    const pi    = mt !== null ? previewIndexByKey.get(obj.key) : undefined;
    rows.push(`
      <tr tabindex="0"${pi !== undefined ? ` data-preview-idx="${pi}"` : ''}>
        <td><input type="checkbox" class="s3-row-check" data-key="${obj.key}" /></td>
        <td title="${obj.key}">${icon}${label}</td>
        <td>${formatBytes(obj.size)}</td>
        <td>${new Date(obj.lastModified).toLocaleString()}</td>
        <td>
          ${pi !== undefined ? `<button class="link-btn" data-action="preview" data-preview-idx="${pi}">Preview</button> ` : ''}
          <button class="link-btn" data-action="download" data-bucket="${bucket}" data-key="${obj.key}">Download</button>
          <button class="link-btn" data-action="presign"  data-bucket="${bucket}" data-key="${obj.key}">Link</button>
          <button class="link-btn danger" data-action="delete" data-bucket="${bucket}" data-key="${obj.key}">Delete</button>
        </td>
      </tr>
    `);
  });

  tbody.innerHTML = rows.join('');

  // Folder navigation
  tbody.querySelectorAll<HTMLButtonElement>('[data-prefix]').forEach((btn) => {
    btn.addEventListener('click', () => callbacks.onFolderClick(btn.dataset.prefix!));
  });

  // Row actions
  tbody.querySelectorAll<HTMLButtonElement>('[data-action]').forEach((btn) => {
    btn.addEventListener('click', () => handleAction(btn, previewEntries, callbacks));
  });

  // Checkbox events
  tbody.querySelectorAll<HTMLInputElement>('.s3-row-check').forEach((cb) => {
    cb.addEventListener('change', callbacks.onSelectionChange);
  });

  // Keyboard nav
  tbody.addEventListener('keydown', (e) => {
    const row = (e.target as Element).closest<HTMLTableRowElement>('tr[tabindex]');
    if (!row) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const rows = Array.from(tbody.querySelectorAll<HTMLTableRowElement>('tr[tabindex="0"]'));
      const i = rows.indexOf(row);
      rows[e.key === 'ArrowDown' ? i + 1 : i - 1]?.focus();
    } else if ((e.key === 'Enter' || e.key === ' ') && row.dataset.previewIdx !== undefined) {
      e.preventDefault();
      openPreviewViewer(previewEntries, parseInt(row.dataset.previewIdx, 10));
    }
  });
}

async function handleAction(
  btn: HTMLButtonElement,
  previewEntries: PreviewEntry[],
  callbacks: TableCallbacks,
): Promise<void> {
  const { action, bucket, key } = btn.dataset as { action: string; bucket: string; key: string };

  if (action === 'preview') {
    openPreviewViewer(previewEntries, parseInt(btn.dataset.previewIdx!, 10));
  } else if (action === 'download') {
    await downloadKeys(bucket, [key]);
  } else if (action === 'presign') {
    const result = await window.api.s3.getPresignedUrl({ bucket, key, expiresIn: 3600 });
    if (result.ok) {
      await navigator.clipboard.writeText(result.url);
      btn.textContent = 'Copied!';
      setTimeout(() => (btn.textContent = 'Link'), 1500);
    }
  } else if (action === 'delete') {
    if (!confirm(`Delete "${key}"?`)) return;
    const result = await window.api.s3.deleteObject({ bucket, key });
    if (result.ok) callbacks.onDelete(bucket, key);
  }
}
