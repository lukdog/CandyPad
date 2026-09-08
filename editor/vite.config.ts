import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// Relative base: the Pages site lives under a /CandyPad/ subpath and there is no router.
export default defineConfig({
  base: './',
  build: { target: 'es2022' },
  resolve: {
    alias: {
      // Vendored under editor/ rather than in keyboards/: QMK's overlay_dir would otherwise
      // consume it and shadow the pinned fork's own copy, re-creating the fork-by-accident risk.
      '@board': fileURLToPath(new URL('./src/data/keyboard.json', import.meta.url)),
      '@keymap': fileURLToPath(
        new URL('../keyboards/binepad/candypad/keymaps/candypad_keymap/keymap.json', import.meta.url),
      ),
    },
  },
  server: { fs: { allow: ['..'] } },
  define: { __COMMIT__: JSON.stringify(process.env.VITE_COMMIT ?? 'dev') },
});
