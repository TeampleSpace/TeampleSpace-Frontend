import { readdirSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import type { Plugin } from 'vite'

// 문자 매핑, 기본 글꼴, 디코더를 앱과 같은 출처에서 제공한다
export function pdfAssets(): Plugin {
  const root = dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json'))
  const assets = new Map<string, Buffer>()
  for (const folder of ['cmaps', 'standard_fonts', 'wasm']) {
    for (const entry of readdirSync(join(root, folder), { withFileTypes: true })) {
      if (entry.isFile()) assets.set(folder + '/' + entry.name, readFileSync(join(root, folder, entry.name)))
    }
  }
  let prefix = '/pdfjs/'
  return {
    name: 'teamplespace-pdf-assets',
    configResolved(config) { prefix = new URL(config.base, 'http://vite.local').pathname + 'pdfjs/' },
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const pathname = new URL(request.url ?? '/', 'http://vite.local').pathname
        if (!pathname.startsWith(prefix)) { next(); return }
        const source = assets.get(pathname.slice(prefix.length))
        if (!source) { next(); return }
        response.setHeader('Content-Type', pathname.endsWith('.wasm') ? 'application/wasm' : 'application/octet-stream')
        response.end(source)
      })
    },
    generateBundle() {
      for (const [name, source] of assets) this.emitFile({ type: 'asset', fileName: 'pdfjs/' + name, source })
    },
  }
}
