interface MenuItem {
  label: string;
  action: () => void;
}

let activeContextMenu: HTMLElement | null = null;

export function showContextMenu(e: MouseEvent, items: MenuItem[]): void {
  closeContextMenu();
  const menu = document.createElement('div');
  menu.className = 've-context-menu';

  items.forEach(({ label, action }) => {
    const item = document.createElement('div');
    item.className = 've-context-item';
    item.textContent = label;
    item.addEventListener('mousedown', (ev) => {
      ev.stopPropagation();
      closeContextMenu();
      action();
    });
    menu.appendChild(item);
  });

  document.body.appendChild(menu);
  const r = menu.getBoundingClientRect();
  menu.style.left = `${Math.min(e.clientX, window.innerWidth  - r.width  - 6)}px`;
  menu.style.top  = `${Math.min(e.clientY, window.innerHeight - r.height - 6)}px`;
  activeContextMenu = menu;
}

export function closeContextMenu(): void {
  if (activeContextMenu) { activeContextMenu.remove(); activeContextMenu = null; }
}

export function initContextMenu(): void {
  document.addEventListener('mousedown', closeContextMenu);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeContextMenu(); });
}
