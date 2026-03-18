export async function openImageViewer(bucket: string, key: string): Promise<void> {
  const overlay = document.createElement('div');
  overlay.className = 's3-img-overlay';
  overlay.innerHTML = `
    <button class="s3-img-close" title="Close (Esc)">×</button>
    <div class="s3-img-loading">Loading…</div>
    <div class="s3-img-wrap">
      <img class="s3-img-el" draggable="false" alt="" />
    </div>
    <div class="s3-img-hint">Scroll to zoom · Drag to pan · Esc to close</div>
  `;
  document.body.appendChild(overlay);

  const wrap    = overlay.querySelector('.s3-img-wrap') as HTMLElement;
  const img     = overlay.querySelector('.s3-img-el') as HTMLImageElement;
  const loading = overlay.querySelector('.s3-img-loading') as HTMLElement;

  let tx = 0, ty = 0, zoom = 1;
  let dragging = false, dragX0 = 0, dragY0 = 0, tx0 = 0, ty0 = 0;

  const applyTransform = (): void => {
    img.style.transform = `translate(${tx}px, ${ty}px) scale(${zoom})`;
  };

  const result = await window.api.s3.getPresignedUrl({ bucket, key, expiresIn: 3600 });
  if (!result.ok) {
    loading.textContent = `Error: ${result.error}`;
    return;
  }

  img.src = result.url;
  img.onload = () => {
    loading.style.display = 'none';
    const cw = wrap.clientWidth, ch = wrap.clientHeight;
    const iw = img.naturalWidth,  ih = img.naturalHeight;
    zoom = Math.min(cw / iw, ch / ih);
    tx   = (cw - iw * zoom) / 2;
    ty   = (ch - ih * zoom) / 2;
    applyTransform();
  };
  img.onerror = () => { loading.textContent = 'Failed to load image.'; };

  wrap.addEventListener('wheel', (e) => {
    e.preventDefault();
    const factor  = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    const newZoom = Math.max(0.05, Math.min(40, zoom * factor));
    const f       = newZoom / zoom;
    const rect    = wrap.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    tx   = cx - (cx - tx) * f;
    ty   = cy - (cy - ty) * f;
    zoom = newZoom;
    applyTransform();
  }, { passive: false });

  wrap.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    dragging = true;
    dragX0 = e.clientX; dragY0 = e.clientY;
    tx0 = tx; ty0 = ty;
    wrap.style.cursor = 'grabbing';
  });

  const onMouseMove = (e: MouseEvent): void => {
    if (!dragging) return;
    tx = tx0 + (e.clientX - dragX0);
    ty = ty0 + (e.clientY - dragY0);
    applyTransform();
  };
  const onMouseUp = (): void => {
    if (!dragging) return;
    dragging = false;
    wrap.style.cursor = '';
  };
  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mouseup',   onMouseUp);

  const close = (): void => {
    overlay.remove();
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup',   onMouseUp);
    document.removeEventListener('keydown',   onKeyDown);
  };
  const onKeyDown = (e: KeyboardEvent): void => { if (e.key === 'Escape') close(); };

  (overlay.querySelector('.s3-img-close') as HTMLElement).addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  document.addEventListener('keydown', onKeyDown);
}
