import { initContextMenu } from './context-menu';
import { initPlayer } from './player';
import { initLibrary } from './library';
import { initUpload } from './upload';
import { initProjects, loadProjects } from './projects';
import { initExport } from './export';

export function initVideoEditor(): void {
  initContextMenu();
  initPlayer();
  initLibrary();
  initUpload();
  initProjects();
  initExport();
}

export { loadProjects as loadVideoEditor };
