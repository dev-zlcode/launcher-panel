import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { handleApi, withThemeBootstrap } from './api.mjs'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const DIST = path.join(ROOT, 'dist')
const PORT = Number(process.env.PORT ?? 5178)

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
}

if (!fs.existsSync(path.join(DIST, 'index.html'))) {
  console.error('[launcher] dist/ 不存在，请先执行 npm run build')
  process.exit(1)
}

http
  .createServer((req, res) => {
    if (req.url?.startsWith('/api/')) {
      handleApi(req, res).catch((err) => {
        res.statusCode = 500
        res.end(JSON.stringify({ error: String(err?.message ?? err) }))
      })
      return
    }
    // decodeURIComponent throws on bad escapes ('%ZZ'), and this callback is sync — outside
    // handleApi's async catch, an uncaught URIError takes down the whole server.
    let rel = '/'
    try {
      rel = decodeURIComponent(new URL(req.url ?? '/', 'http://local').pathname)
    } catch {}
    // resolve(), then a separator-anchored prefix: startsWith(DIST) alone lets a sibling
    // dist-backup/ through.
    const file = path.resolve(DIST, '.' + rel)
    const target =
      rel !== '/' && file.startsWith(DIST + path.sep) && fs.existsSync(file) && fs.statSync(file).isFile()
        ? file
        : path.join(DIST, 'index.html')
    const type = MIME[path.extname(target)] ?? 'application/octet-stream'
    res.setHeader('Content-Type', type)
    // HTML leaves as one string, not a stream: the theme bootstrap has to be in it before first paint.
    if (type === MIME['.html']) res.end(withThemeBootstrap(fs.readFileSync(target, 'utf8')))
    else fs.createReadStream(target).pipe(res)
  })
  .listen(PORT, '127.0.0.1', () => {
    console.log(`[launcher] http://127.0.0.1:${PORT}`)
  })
