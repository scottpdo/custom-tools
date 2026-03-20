export interface PreviewEntry {
  bucket: string;
  key: string;
  type: 'image' | 'video' | 'audio';
}

export function openPreviewViewer(entries: PreviewEntry[], startIndex: number): void {
  let idx = startIndex;

  const overlay = document.createElement('div');
  overlay.className = 's3-preview-overlay';
  overlay.innerHTML = `
    <div class="s3-preview-header">
      <span class="s3-preview-title"></span>
      <span class="s3-preview-counter"></span>
      <button class="s3-preview-close" title="Close (Esc)">×</button>
    </div>
    <div class="s3-preview-content">
      <button class="s3-preview-nav s3-preview-prev" title="Previous (←)">‹</button>
      <div class="s3-preview-media"></div>
      <button class="s3-preview-nav s3-preview-next" title="Next (→)">›</button>
    </div>
    <div class="s3-preview-hint"></div>
  `;
  document.body.appendChild(overlay);

  const titleEl   = overlay.querySelector('.s3-preview-title')   as HTMLElement;
  const counterEl = overlay.querySelector('.s3-preview-counter') as HTMLElement;
  const mediaEl   = overlay.querySelector('.s3-preview-media')   as HTMLElement;
  const hintEl    = overlay.querySelector('.s3-preview-hint')    as HTMLElement;
  const prevBtn   = overlay.querySelector('.s3-preview-prev')    as HTMLButtonElement;
  const nextBtn   = overlay.querySelector('.s3-preview-next')    as HTMLButtonElement;

  // Per-entry teardown (image wheel/drag listeners)
  let cleanupEntry: () => void = () => {};

  function updateNav(): void {
    prevBtn.disabled = idx === 0;
    nextBtn.disabled = idx === entries.length - 1;
    counterEl.textContent = entries.length > 1 ? `${idx + 1} / ${entries.length}` : '';
  }

  async function loadEntry(entry: PreviewEntry): Promise<void> {
    // Teardown previous entry
    const prevMedia = mediaEl.querySelector<HTMLMediaElement>('video, audio');
    if (prevMedia) { prevMedia.pause(); prevMedia.src = ''; }
    cleanupEntry();
    cleanupEntry = () => {};

    const label = entry.key.split('/').filter(Boolean).at(-1) ?? entry.key;
    titleEl.textContent  = label;
    mediaEl.innerHTML    = '<div class="s3-preview-loading">Loading…</div>';
    mediaEl.className    = `s3-preview-media${entry.type === 'image' ? ' s3-preview-media-image' : ''}`;
    hintEl.textContent   = entry.type === 'image'
      ? 'Scroll to zoom · Drag to pan · ← → to navigate · Esc to close'
      : '← → to navigate · Esc to close';

    const result = await window.api.s3.getPresignedUrl({ bucket: entry.bucket, key: entry.key, expiresIn: 3600 });
    if (!result.ok) {
      mediaEl.innerHTML = `<div class="s3-preview-loading">Error: ${result.error}</div>`;
      return;
    }

    mediaEl.innerHTML = '';

    if (entry.type === 'image') {
      const img = document.createElement('img');
      img.className = 's3-preview-img';
      img.draggable = false;
      img.alt       = '';
      mediaEl.appendChild(img);

      let tx = 0, ty = 0, zoom = 1;
      let dragging = false, dragX0 = 0, dragY0 = 0, tx0 = 0, ty0 = 0;

      const applyTransform = (): void => {
        img.style.transform = `translate(${tx}px,${ty}px) scale(${zoom})`;
      };

      img.onload = () => {
        const cw = mediaEl.clientWidth,  ch = mediaEl.clientHeight;
        const iw = img.naturalWidth,     ih = img.naturalHeight;
        zoom = Math.min(cw / iw, ch / ih);
        tx   = (cw - iw * zoom) / 2;
        ty   = (ch - ih * zoom) / 2;
        applyTransform();
      };
      img.onerror = () => { mediaEl.innerHTML = '<div class="s3-preview-loading">Failed to load image.</div>'; };
      img.src = result.url;

      const onWheel = (e: WheelEvent): void => {
        e.preventDefault();
        const factor  = e.deltaY < 0 ? 1.15 : 1 / 1.15;
        const newZoom = Math.max(0.05, Math.min(40, zoom * factor));
        const f       = newZoom / zoom;
        const rect    = mediaEl.getBoundingClientRect();
        tx   = (e.clientX - rect.left) - ((e.clientX - rect.left) - tx) * f;
        ty   = (e.clientY - rect.top)  - ((e.clientY - rect.top)  - ty) * f;
        zoom = newZoom;
        applyTransform();
      };
      const onMouseDown = (e: MouseEvent): void => {
        if (e.button !== 0) return;
        dragging = true;
        dragX0 = e.clientX; dragY0 = e.clientY; tx0 = tx; ty0 = ty;
        mediaEl.style.cursor = 'grabbing';
      };
      const onMouseMove = (e: MouseEvent): void => {
        if (!dragging) return;
        tx = tx0 + (e.clientX - dragX0);
        ty = ty0 + (e.clientY - dragY0);
        applyTransform();
      };
      const onMouseUp = (): void => {
        if (!dragging) return;
        dragging = false;
        mediaEl.style.cursor = '';
      };

      mediaEl.addEventListener('wheel', onWheel, { passive: false });
      mediaEl.addEventListener('mousedown', onMouseDown);
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);

      cleanupEntry = (): void => {
        mediaEl.removeEventListener('wheel', onWheel);
        mediaEl.removeEventListener('mousedown', onMouseDown);
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
      };
    } else {
      const media = document.createElement(entry.type);
      media.className = entry.type === 'video' ? 's3-preview-video' : 's3-preview-audio';
      media.controls  = true;
      media.autoplay  = true;
      media.src       = result.url;
      media.onerror   = () => {
        mediaEl.innerHTML = `<div class="s3-preview-loading">Failed to load ${entry.type}.</div>`;
      };
      mediaEl.appendChild(media);
    }
  }

  function navigate(delta: number): void {
    const next = idx + delta;
    if (next < 0 || next >= entries.length) return;
    idx = next;
    updateNav();
    loadEntry(entries[idx]);
  }

  const close = (): void => {
    const media = overlay.querySelector<HTMLMediaElement>('video, audio');
    if (media) { media.pause(); media.src = ''; }
    cleanupEntry();
    overlay.remove();
    document.removeEventListener('keydown', onKeyDown);
  };

  const onKeyDown = (e: KeyboardEvent): void => {
    if      (e.key === 'Escape')     close();
    else if (e.key === 'ArrowLeft')  navigate(-1);
    else if (e.key === 'ArrowRight') navigate(+1);
  };

  prevBtn.addEventListener('click', () => navigate(-1));
  nextBtn.addEventListener('click', () => navigate(+1));
  (overlay.querySelector('.s3-preview-close') as HTMLElement).addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  document.addEventListener('keydown', onKeyDown);

  updateNav();
  loadEntry(entries[idx]);
}
