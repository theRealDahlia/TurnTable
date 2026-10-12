import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'

const shared = resolve(__dirname, 'src/shared')

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: { '@shared': shared } }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: { '@shared': shared } },
    // Sandboxed preload scripts must be CommonJS, even though the package itself is ESM, and must be a
    // single standalone file (a sandboxed preload cannot require a second file).
    build: { rollupOptions: { output: { format: 'cjs', entryFileNames: '[name].cjs' } } }
  },
  renderer: {
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/renderer/index.html'),
          'spotify-player': resolve(__dirname, 'src/renderer/spotify-player.html'),
          'youtube-player': resolve(__dirname, 'src/renderer/youtube-player.html'),
          'soundcloud-player': resolve(__dirname, 'src/renderer/soundcloud-player.html')
        }
      }
    },
    plugins: [react()],
    resolve: { alias: { '@shared': shared } }
  }
})
