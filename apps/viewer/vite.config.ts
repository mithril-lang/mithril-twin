import babel from '@rolldown/plugin-babel'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import type { Plugin } from 'vite'
import { defineConfig } from 'vitest/config'
import { enterpriseFiles } from './src/twin/scale/generate'

/**
 * The enterprise-scale 北極星 sample (~50k synthetic people, ~70k devices) is not committed.
 * A seeded generator produces the same chunked .mith pack on every build (emitted into
 * dist/data/polaris-enterprise/) and serves it from memory in dev.
 */
function polarisEnterprisePack(): Plugin {
  const base = '/data/polaris-enterprise/'
  let files: Map<string, string> | null = null
  const get = () => (files ??= enterpriseFiles())
  return {
    name: 'polaris-enterprise-pack',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith(base)) return next()
        const body = get().get(req.url.slice(base.length).split('?')[0] ?? '')
        if (body == null) {
          res.statusCode = 404
          res.end()
          return
        }
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        res.end(body)
      })
    },
    generateBundle() {
      for (const [path, source] of get()) {
        this.emitFile({ type: 'asset', fileName: `data/polaris-enterprise/${path}`, source })
      }
    },
  }
}

export default defineConfig({
  plugins: [react(), babel({ presets: [reactCompilerPreset()] }), polarisEnterprisePack()],
  test: { environment: 'jsdom' },
})
