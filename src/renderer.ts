import { initS3Browser, loadBuckets, listObjects } from './s3/index';
import { initVideoEditor } from './video/index';
import { initSettings, loadSettingsForm, checkConnection } from './settings/index';

// ── Panel navigation ───────────────────────────────────────────────────────────

const navItems = document.querySelectorAll<HTMLElement>('.nav-item[data-tool]');
const panels   = document.querySelectorAll<HTMLElement>('.panel');

function showPanel(toolName: string): void {
  panels.forEach((p) => p.classList.remove('active'));
  navItems.forEach((n) => n.classList.remove('active'));

  const panel = document.getElementById(`panel-${toolName}`);
  const nav   = document.querySelector<HTMLElement>(`.nav-item[data-tool="${toolName}"]`);
  if (panel) panel.classList.add('active');
  if (nav)   nav.classList.add('active');

  if (toolName === 's3-browser') listObjects();
}

navItems.forEach((btn) => {
  btn.addEventListener('click', () => showPanel(btn.dataset.tool!));
});

// ── Init ───────────────────────────────────────────────────────────────────────

(async function init(): Promise<void> {
  initSettings();
  initS3Browser();
  initVideoEditor();

  await Promise.all([
    checkConnection(),
    loadSettingsForm(),
    loadBuckets(),
  ]);

  if (document.querySelector('.panel.active')?.id === 'panel-s3-browser') {
    listObjects();
  }
})();
