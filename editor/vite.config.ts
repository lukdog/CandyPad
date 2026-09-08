import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// Relative base: the Pages site lives under a /CandyPad/ subpath and there is no router.
export default defineConfig({
  base: './',
  build: { target: 'es2022' },
  resolve: {
    alias: {
      '@board': fileURLToPath(new URL('../keyboards/binepad/candypad/keyboard.json', import.meta.url)),
      '@keymap': fileURLToPath(
        new URL('../keyboards/binepad/candypad/keymaps/candypad_keymap/keymap.json', import.meta.url),
      ),
    },
  },
  server: { fs: { allow: ['..'] } },
  define: { __COMMIT__: JSON.stringify(process.env.VITE_COMMIT ?? 'dev') },
});
