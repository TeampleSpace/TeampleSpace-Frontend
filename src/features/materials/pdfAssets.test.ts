import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { expect, test } from 'vitest'
import { build, createServer } from 'vite'
import { pdfAssets } from '../../../build/pdf-assets.ts'

const root = dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json'))
const mapping = 'cmaps/Adobe-Korea1-UCS2.bcmap'

test('중첩 배포 경로의 개발 서버가 실제 한글 CMap 파일을 제공한다', async () => {
  const server = await createServer({ configFile: false, base: '/verification/', plugins: [pdfAssets()], logLevel: 'silent',
    server: { host: '127.0.0.1', port: 0 } })
  try {
    await server.listen()
    const address = server.httpServer?.address()
    if (!address || typeof address === 'string') throw new Error('검증 서버 주소 없음')
    const response = await fetch('http://127.0.0.1:' + address.port + '/verification/pdfjs/' + mapping)
    expect(response.status).toBe(200)
    expect(Buffer.from(await response.arrayBuffer())).toEqual(readFileSync(join(root, mapping)))
  } finally { await server.close() }
})

test('배포 결과에 한글 CMap과 라이선스 및 PDF 디코더를 포함한다', async () => {
  const result = await build({ configFile: false, logLevel: 'silent',
    plugins: [pdfAssets(), { name: 'verification-entry',
      resolveId(id) { if (id === 'verification-entry') return id },
      load(id) { if (id === 'verification-entry') return 'export {}' },
    }],
    build: { write: false, rollupOptions: { input: 'verification-entry' } },
  })
  const output = Array.isArray(result) ? result[0] : result
  if (!('output' in output)) throw new Error('검증 빌드 결과 없음')
  const asset = output.output.find((item) => item.fileName === 'pdfjs/' + mapping)
  if (!asset || asset.type !== 'asset') throw new Error('한글 CMap 누락')
  expect(Buffer.from(asset.source)).toEqual(readFileSync(join(root, mapping)))
  expect(output.output.some((item) => item.fileName.startsWith('pdfjs/cmaps/') && /license/i.test(item.fileName))).toBe(true)
  expect(output.output.some((item) => item.fileName.startsWith('pdfjs/standard_fonts/'))).toBe(true)
  expect(output.output.some((item) => item.fileName.startsWith('pdfjs/wasm/') && item.fileName.endsWith('.wasm'))).toBe(true)
})
