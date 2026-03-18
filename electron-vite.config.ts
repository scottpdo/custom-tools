import { defineConfig } from 'electron-vite';
import { resolve } from 'path';

export default defineConfig({
  main: {
    entry: { index: resolve('electron/main.ts') },
  },
  preload: {
    entry: { index: resolve('electron/preload.ts') },
  },
  renderer: {
    root: resolve('src'),
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/index.html'),
        },
      },
    },
  },
});
