import { el } from '../utils/dom';
import { escHtml, formatBytes } from '../utils/format';
import { ve } from './state';
import { addToStrip } from './strip';

const veLibraryList = el('ve-library-list');

export async function loadLibrary(): Promise<void> {
  veLibraryList.innerHTML = '<p class="muted" style="padding:8px 12px">Loading…</p>';
  if (!ve.project) return;

  const { bucket, prefix } = ve.project;
  const result = await window.api.video.listProjectFiles({ bucket, prefix });

  if (!result.ok) {
    veLibraryList.innerHTML = `<p class="muted" style="padding:8px 12px">Error: ${escHtml(result.error)}</p>`;
    return;
  }

  ve.files = result.files;
  renderLibrary();
}

export function renderLibrary(): void {
  if (ve.files.length === 0) {
    veLibraryList.innerHTML = '<p class="muted" style="padding:8px 12px">No video files yet.</p>';
    return;
  }

  veLibraryList.innerHTML = '';
  ve.files.forEach((file) => {
    const name = file.key.split('/').pop() ?? file.key;
    const row = document.createElement('div');
    row.className = 've-lib-item';
    row.draggable = true;
    row.dataset.key = file.key;
    row.innerHTML = `
      <span class="ve-lib-name" title="${escHtml(file.key)}">${escHtml(name)}</span>
      <span class="ve-lib-size">${formatBytes(file.size)}</span>
      <button class="ve-lib-add" title="Add to timeline">+</button>
    `;

    row.querySelector('.ve-lib-add')!.addEventListener('click', () => addToStrip(file.key));

    row.addEventListener('dragstart', (e) => {
      ve.drag = { type: 'library', key: file.key };
      e.dataTransfer!.effectAllowed = 'copy';
      e.dataTransfer!.setData('text/plain', 'library:' + file.key);
      row.classList.add('ve-dragging');
    });
    row.addEventListener('dragend', () => {
      row.classList.remove('ve-dragging');
      ve.drag = null;
    });

    veLibraryList.appendChild(row);
  });
}

export function initLibrary(): void {
  el('ve-refresh-lib-btn').addEventListener('click', loadLibrary);
}
