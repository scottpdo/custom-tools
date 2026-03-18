import { formatBytes } from '../utils/format';
import { isImageKey } from './constants';
import { openImageViewer } from './image-viewer';
import { downloadKeys } from './download';
import type { S3Object } from '../types/models';

interface TableCallbacks {
  onFolderClick: (prefix: string) => void;
  onDelete: (bucket: string, key: string) => void;
  onSelectionChange: () => void;
}

export function renderTable(
  tbody: HTMLTableSectionElement,
  bucket: string,
  prefixes: string[],
  objects: S3Object[],
  callbacks: TableCallbacks,
): void {
  const rows: string[] = [];

  prefixes.forEach((pfx) => {
    rows.push(`
      <tr tabindex="0">
        <td></td>
        <td><button class="link-btn" data-prefix="${pfx}">📁 ${pfx}</button></td>
        <td>—</td><td>—</td><td></td>
      </tr>
    `);
  });

  objects.forEach((obj) => {
    const img = isImageKey(obj.key);
    rows.push(`
      <tr tabindex="0"${img ? ` data-image-key="${obj.key}" data-bucket="${bucket}" class="s3-row-image"` : ''}>
        <td><input type="checkbox" class="s3-row-check" data-key="${obj.key}" /></td>
        <td title="${obj.key}">${img ? '🖼 ' : ''}${obj.key}</td>
        <td>${formatBytes(obj.size)}</td>
        <td>${new Date(obj.lastModified).toLocaleString()}</td>
        <td>
          ${img ? `<button class="link-btn" data-action="open-image" data-bucket="${bucket}" data-key="${obj.key}">Open</button> ` : ''}
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
    btn.addEventListener('click', () => handleAction(btn, callbacks));
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
    } else if ((e.key === 'Enter' || e.key === ' ') && row.dataset.imageKey) {
      e.preventDefault();
      openImageViewer(row.dataset.bucket!, row.dataset.imageKey!);
    }
  });
}

async function handleAction(btn: HTMLButtonElement, callbacks: TableCallbacks): Promise<void> {
  const { action, bucket, key } = btn.dataset as { action: string; bucket: string; key: string };

  if (action === 'open-image') {
    openImageViewer(bucket, key);
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
