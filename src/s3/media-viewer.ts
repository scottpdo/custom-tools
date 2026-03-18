export async function openMediaViewer(bucket: string, key: string, type: 'video' | 'audio'): Promise<void> {
  const overlay = document.createElement('div');
  overlay.className = 's3-media-overlay';

  const label = key.split('/').filter(Boolean).at(-1) ?? key;

  overlay.innerHTML = `
    <div class="s3-media-dialog">
      <div class="s3-media-header">
        <span class="s3-media-title">${label}</span>
        <button class="s3-media-close" title="Close (Esc)">×</button>
      </div>
      <div class="s3-media-body">
        <div class="s3-media-loading">Loading…</div>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const body    = overlay.querySelector('.s3-media-body') as HTMLElement;
  const loading = overlay.querySelector('.s3-media-loading') as HTMLElement;

  const result = await window.api.s3.getPresignedUrl({ bucket, key, expiresIn: 3600 });
  if (!result.ok) {
    loading.textContent = `Error: ${result.error}`;
    return;
  }

  loading.style.display = 'none';

  if (type === 'video') {
    const video = document.createElement('video');
    video.className  = 's3-media-video';
    video.controls   = true;
    video.autoplay   = true;
    video.src        = result.url;
    video.onerror    = () => { body.textContent = 'Failed to load video.'; };
    body.appendChild(video);
  } else {
    const audio = document.createElement('audio');
    audio.className  = 's3-media-audio';
    audio.controls   = true;
    audio.autoplay   = true;
    audio.src        = result.url;
    audio.onerror    = () => { body.textContent = 'Failed to load audio.'; };
    body.appendChild(audio);
  }

  const close = (): void => {
    // Pause before removing so the browser doesn't keep buffering
    const media = overlay.querySelector<HTMLMediaElement>('video, audio');
    if (media) { media.pause(); media.src = ''; }
    overlay.remove();
    document.removeEventListener('keydown', onKeyDown);
  };

  const onKeyDown = (e: KeyboardEvent): void => { if (e.key === 'Escape') close(); };

  (overlay.querySelector('.s3-media-close') as HTMLElement).addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  document.addEventListener('keydown', onKeyDown);
}
