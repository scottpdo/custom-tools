import { el } from '../utils/dom';
import { ve } from './state';
import type { RenderState } from '../types/models';

const veRenderPanel  = el('ve-render-panel');
const veRenderLabel  = el('ve-render-label');
const veRenderFill   = el<HTMLElement>('ve-render-fill');
const veRenderPct    = el('ve-render-pct');
const veExportBtn    = el<HTMLButtonElement>('ve-export-btn');
const veCancelRender = el<HTMLButtonElement>('ve-cancel-render-btn');

export function setRenderUI(state: RenderState, pct = 0, timemark?: string | null, detail?: string): void {
  if (state === 'idle') {
    veRenderPanel.classList.add('ve-hidden');
    veRenderPanel.classList.remove('ve-render-done', 've-render-error');
    veExportBtn.disabled = false;
    return;
  }

  veRenderPanel.classList.remove('ve-hidden', 've-render-done', 've-render-error');
  veExportBtn.disabled = true;

  if (state === 'rendering') {
    veRenderLabel.textContent    = timemark ? `Rendering… ${timemark}` : 'Rendering…';
    veRenderFill.style.width     = `${pct}%`;
    veRenderPct.textContent      = `${pct}%`;
    veCancelRender.style.display = '';
  } else if (state === 'done') {
    veRenderPanel.classList.add('ve-render-done');
    veRenderLabel.textContent    = `Exported → ${detail}`;
    veRenderFill.style.width     = '100%';
    veRenderPct.textContent      = '100%';
    veCancelRender.style.display = 'none';
    veExportBtn.disabled         = false;
  } else if (state === 'error') {
    veRenderPanel.classList.add('ve-render-error');
    veRenderLabel.textContent    = `Error: ${detail}`;
    veRenderFill.style.width     = '0%';
    veRenderPct.textContent      = '';
    veCancelRender.style.display = 'none';
    veExportBtn.disabled         = false;
  }
}

async function startExport(): Promise<void> {
  if (ve.strip.length === 0) {
    alert('Add some clips to the timeline before exporting.');
    return;
  }
  const notReady = ve.strip.filter((c) => c.downloading || !c.localPath);
  if (notReady.length > 0) {
    alert(`${notReady.length} clip(s) are still downloading. Please wait and try again.`);
    return;
  }

  const saveResult = await window.api.video.showSaveDialog({ defaultName: ve.project?.name });
  if (!saveResult.path) return;

  const clips = ve.strip.map((c) => ({
    localPath:   c.localPath,
    trimIn:      c.trimIn,
    trimOut:     c.trimOut,
    transitions: c.transitions,
    duration:    c.duration,
  }));

  setRenderUI('rendering', 0);

  window.api.video.onRenderProgress(({ pct, timemark }) => {
    setRenderUI('rendering', pct, timemark);
  });

  const result = await window.api.video.render({
    clips,
    outputPath: saveResult.path,
    settings:   ve.manifest?.settings,
  });

  window.api.video.offRenderProgress();

  if (result.ok) {
    setRenderUI('done', 100, null, saveResult.path);
  } else if ('cancelled' in result && result.cancelled) {
    setRenderUI('idle');
  } else {
    setRenderUI('error', 0, null, result.error);
  }
}

export function initExport(): void {
  veExportBtn.addEventListener('click', startExport);
  veCancelRender.addEventListener('click', async () => {
    await window.api.video.cancelRender();
  });
}
