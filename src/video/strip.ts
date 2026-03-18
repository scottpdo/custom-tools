import { el } from '../utils/dom';
import { escHtml, generateId } from '../utils/format';
import { ve, markDirty } from './state';
import { showContextMenu } from './context-menu';
import { playClip, downloadAndPrepare } from './player';
import type { VideoClip } from '../types/models';

const DEFAULT_TRANSITION_DURATION = 1.0;

const veStrip      = el('ve-strip');
const veStripEmpty = el('ve-strip-empty');

export function addToStrip(key: string): void {
  ve.strip.push({
    id:          generateId(),
    key,
    name:        key.split('/').pop() ?? key,
    duration:    0,
    trimIn:      0,
    trimOut:     0,
    volume:      1.0,
    transitions: {},
    effects:     [],
    meta:        {},
    localPath:   null,
    thumbnail:   null,
    downloading: true,
  });
  renderStrip();
  markDirty();
  downloadAndPrepare(ve.strip.length - 1);
}

export function renderStrip(): void {
  Array.from(veStrip.children).forEach((child) => {
    if (child !== veStripEmpty) child.remove();
  });

  veStripEmpty.style.display = ve.strip.length === 0 ? 'flex' : 'none';

  const n = ve.strip.length;
  ve.strip.forEach((clip, idx) => {
    const card = buildClipCard(clip, idx, n);
    veStrip.insertBefore(card, veStripEmpty);
  });
}

function buildClipCard(clip: VideoClip, idx: number, n: number): HTMLElement {
  const isPlaying = ve.player.isPlaying && ve.player.currentIdx === idx;
  const card = document.createElement('div');
  card.className = 've-clip-card' + (isPlaying ? ' ve-playing' : '');
  card.draggable = true;
  card.dataset.idx = String(idx);

  const hasFadeIn  = clip.transitions?.in?.type  === 'fade';
  const hasFadeOut = clip.transitions?.out?.type === 'fade';
  const fadeInDur  = clip.transitions?.in?.duration  ?? 0;
  const fadeOutDur = clip.transitions?.out?.duration ?? 0;

  card.innerHTML = `
    <button class="ve-clip-remove" title="Remove">×</button>
    <div class="ve-clip-thumb">
      ${clip.downloading
        ? '<span class="ve-clip-loading">⟳</span>'
        : clip.thumbnail
          ? `<img src="${clip.thumbnail}" alt="" />`
          : '<span class="ve-clip-no-thumb">🎬</span>'
      }
      ${isPlaying ? '<div class="ve-clip-playing-overlay">▶</div>' : ''}
    </div>
    <div class="ve-clip-name" title="${escHtml(clip.name)}">${escHtml(clip.name)}</div>
    ${hasFadeIn  ? `<div class="ve-trans-handle ve-trans-left"  data-side="in"  title="Fade in: ${fadeInDur.toFixed(1)}s"><span>${fadeInDur.toFixed(1)}s</span></div>`  : ''}
    ${hasFadeOut ? `<div class="ve-trans-handle ve-trans-right" data-side="out" title="Fade out: ${fadeOutDur.toFixed(1)}s"><span>${fadeOutDur.toFixed(1)}s</span></div>` : ''}
  `;

  // Remove button
  card.querySelector('.ve-clip-remove')!.addEventListener('click', (e) => {
    e.stopPropagation();
    if (idx > 0) delete ve.strip[idx - 1].transitions.out;
    if (idx < ve.strip.length - 1) delete ve.strip[idx + 1].transitions.in;
    ve.strip.splice(idx, 1);
    if (ve.player.currentIdx >= ve.strip.length) ve.player.currentIdx = ve.strip.length - 1;
    renderStrip();
    markDirty();
  });

  // Context menu
  card.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    e.stopPropagation();
    showContextMenu(e, buildContextMenuItems(clip, idx, n));
  });

  // Transition handle drag
  card.querySelectorAll<HTMLElement>('.ve-trans-handle').forEach((handle) => {
    handle.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      handleTransitionDrag(e, handle, clip, idx);
    });
  });

  // Drag-to-reorder (strip clips)
  card.addEventListener('dragstart', (e) => {
    if ((e.target as Element).classList.contains('ve-clip-remove')) { e.preventDefault(); return; }
    ve.drag = { type: 'strip', index: idx };
    e.dataTransfer!.effectAllowed = 'move';
    e.dataTransfer!.setData('text/plain', 'strip:' + idx);
    setTimeout(() => card.classList.add('ve-dragging'), 0);
  });
  card.addEventListener('dragend', () => { card.classList.remove('ve-dragging'); ve.drag = null; });
  card.addEventListener('dragover', (e) => {
    if (ve.drag?.type !== 'strip') return;
    e.preventDefault();
    e.dataTransfer!.dropEffect = 'move';
    card.classList.add('ve-drag-over');
  });
  card.addEventListener('dragleave', () => card.classList.remove('ve-drag-over'));
  card.addEventListener('drop', (e) => {
    e.preventDefault();
    card.classList.remove('ve-drag-over');
    if (ve.drag?.type === 'strip' && ve.drag.index !== idx) {
      const [moved] = ve.strip.splice(ve.drag.index!, 1);
      ve.strip.splice(idx, 0, moved);
      renderStrip();
      markDirty();
    }
  });

  // Click to play
  card.addEventListener('click', () => {
    if (ve.player.currentIdx === idx && ve.player.isPlaying) return;
    playClip(idx);
  });

  return card;
}

function buildContextMenuItems(clip: VideoClip, idx: number, n: number) {
  const items: { label: string; action: () => void }[] = [];
  const prevClip = idx > 0 ? ve.strip[idx - 1] : null;
  const nextClip = idx < n - 1 ? ve.strip[idx + 1] : null;

  // Left side
  if (idx === 0) {
    const has = clip.transitions?.in?.type === 'fade';
    items.push({
      label: has ? 'Remove fade in' : 'Add fade in',
      action: () => {
        clip.transitions = clip.transitions || {};
        if (has) { delete clip.transitions.in; }
        else {
          const maxDur = clip.duration > 0 ? clip.duration / 2 : DEFAULT_TRANSITION_DURATION;
          clip.transitions.in = { type: 'fade', duration: Math.min(DEFAULT_TRANSITION_DURATION, maxDur) };
        }
        renderStrip(); markDirty();
      },
    });
  } else {
    const has = clip.transitions?.in?.type === 'fade';
    items.push({
      label: has ? 'Remove transition before' : 'Add transition before',
      action: () => {
        clip.transitions     = clip.transitions     || {};
        prevClip!.transitions = prevClip!.transitions || {};
        if (has) {
          delete clip.transitions.in;
          delete prevClip!.transitions.out;
        } else {
          const maxDur = Math.min(
            clip.duration     > 0 ? clip.duration     / 2 : DEFAULT_TRANSITION_DURATION,
            prevClip!.duration > 0 ? prevClip!.duration / 2 : DEFAULT_TRANSITION_DURATION,
          );
          const dur = Math.max(0.1, Math.min(DEFAULT_TRANSITION_DURATION, maxDur));
          clip.transitions.in       = { type: 'fade', duration: dur };
          prevClip!.transitions.out = { type: 'fade', duration: dur };
        }
        renderStrip(); markDirty();
      },
    });
  }

  // Right side
  if (idx === n - 1) {
    const has = clip.transitions?.out?.type === 'fade';
    items.push({
      label: has ? 'Remove fade out' : 'Add fade out',
      action: () => {
        clip.transitions = clip.transitions || {};
        if (has) { delete clip.transitions.out; }
        else {
          const maxDur = clip.duration > 0 ? clip.duration / 2 : DEFAULT_TRANSITION_DURATION;
          clip.transitions.out = { type: 'fade', duration: Math.min(DEFAULT_TRANSITION_DURATION, maxDur) };
        }
        renderStrip(); markDirty();
      },
    });
  } else {
    const has = clip.transitions?.out?.type === 'fade';
    items.push({
      label: has ? 'Remove transition after' : 'Add transition after',
      action: () => {
        clip.transitions      = clip.transitions      || {};
        nextClip!.transitions = nextClip!.transitions || {};
        if (has) {
          delete clip.transitions.out;
          delete nextClip!.transitions.in;
        } else {
          const maxDur = Math.min(
            clip.duration      > 0 ? clip.duration      / 2 : DEFAULT_TRANSITION_DURATION,
            nextClip!.duration > 0 ? nextClip!.duration / 2 : DEFAULT_TRANSITION_DURATION,
          );
          const dur = Math.max(0.1, Math.min(DEFAULT_TRANSITION_DURATION, maxDur));
          clip.transitions.out    = { type: 'fade', duration: dur };
          nextClip!.transitions.in = { type: 'fade', duration: dur };
        }
        renderStrip(); markDirty();
      },
    });
  }

  return items;
}

function handleTransitionDrag(e: MouseEvent, handle: HTMLElement, clip: VideoClip, idx: number): void {
  const side     = handle.dataset.side as 'in' | 'out';
  const startY   = e.clientY;
  const startDur = side === 'in'
    ? (clip.transitions.in?.duration  ?? DEFAULT_TRANSITION_DURATION)
    : (clip.transitions.out?.duration ?? DEFAULT_TRANSITION_DURATION);

  const clipDur = clip.duration > 0 ? clip.duration : Infinity;
  let maxDur = clipDur / 2;
  if (side === 'in' && idx > 0) {
    const prevDur = ve.strip[idx - 1].duration;
    if (prevDur > 0) maxDur = Math.min(maxDur, prevDur / 2);
  }
  if (side === 'out' && idx < ve.strip.length - 1) {
    const nextDur = ve.strip[idx + 1].duration;
    if (nextDur > 0) maxDur = Math.min(maxDur, nextDur / 2);
  }

  const label = handle.querySelector('span') as HTMLElement;

  const onMove = (ev: MouseEvent): void => {
    const dy     = startY - ev.clientY;
    const newDur = Math.max(0.1, Math.min(maxDur, startDur + dy * 0.02));

    if (side === 'in') {
      clip.transitions.in!.duration = newDur;
      if (idx > 0 && ve.strip[idx - 1].transitions?.out?.type === 'fade') {
        ve.strip[idx - 1].transitions.out!.duration = newDur;
      }
    } else {
      clip.transitions.out!.duration = newDur;
      if (idx < ve.strip.length - 1 && ve.strip[idx + 1].transitions?.in?.type === 'fade') {
        ve.strip[idx + 1].transitions.in!.duration = newDur;
      }
    }

    label.textContent = `${newDur.toFixed(1)}s`;
    handle.title = `${side === 'in' ? 'Fade in' : 'Fade out'}: ${newDur.toFixed(1)}s`;
  };

  const onUp = (): void => {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup',   onUp);
    renderStrip();
    markDirty();
  };

  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup',   onUp);
}

export function initStripDropZone(): void {
  veStrip.addEventListener('dragover', (e) => {
    if (ve.drag?.type === 'library' || e.dataTransfer!.types.includes('Files')) {
      e.preventDefault();
      e.dataTransfer!.dropEffect = 'copy';
      veStrip.classList.add('ve-drag-active');
    }
  });
  veStrip.addEventListener('dragleave', (e) => {
    if (!veStrip.contains(e.relatedTarget as Node)) veStrip.classList.remove('ve-drag-active');
  });
}
