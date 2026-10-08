import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

const shared = resolve(__dirname, 'src/shared')

export default defineConfig({
  main: {
    resolve: { alias: { '@shared': shared } },
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/index.ts'),
          // Runs under plain Node when an agent's hook fires; must not import electron.
          'perch-hook': resolve(__dirname, 'src/cli/perch-hook.ts'),
        },
      },
    },
  },
  preload: {
    resolve: { alias: { '@shared': shared } },
  },
  renderer: {
    resolve: {
      alias: {
        '@shared': shared,
        '@renderer': resolve(__dirname, 'src/renderer/src'),
      },
    },
    plugins: [react()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/renderer/index.html'),
          // The phone page, served to paired phones by the phone link (src/main/phone).
          phone: resolve(__dirname, 'src/renderer/phone.html'),
        },
      },
    },
  },
})
