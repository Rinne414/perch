import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { PhoneApi } from '../services/phoneApi'

const MAX_BODY_BYTES = 64 * 1024
const ASSET_NAME = /^\/assets\/[A-Za-z0-9_.-]+\.(js|css|woff2?|png|svg)$/
const TYPES: Readonly<Record<string, string>> = {
  html: 'text/html; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8',
  json: 'application/json; charset=utf-8',
  webmanifest: 'application/manifest+json; charset=utf-8',
  png: 'image/png',
  svg: 'image/svg+xml',
  woff: 'font/woff',
  woff2: 'font/woff2',
}
/** Fixed files of the phone page; anything else under / is not found. */
const PAGES: Readonly<Record<string, string>> = {
  '/': 'phone.html',
  '/index.html': 'phone.html',
  '/sw.js': 'sw.js',
  '/manifest.webmanifest': 'manifest.webmanifest',
}
const ICONS: Readonly<Record<string, number>> = { '/icon-192.png': 192, '/icon-512.png': 512 }

/** Same as the page's own meta tag, plus what a meta tag cannot say (framing). */
const CSP =
  "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; manifest-src 'self'; " +
  "worker-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Content-Security-Policy': CSP,
}
/** Only the owner's phones and this computer can reach the server; these limits keep a stuck client from piling up. */
const HEADERS_TIMEOUT_MS = 10_000
const REQUEST_TIMEOUT_MS = 15_000
const MAX_CONNECTIONS = 32

export interface PhoneServerOptions {
  readonly port: number
  readonly api: PhoneApi
  /** The built renderer folder holding phone.html, sw.js, manifest.webmanifest and assets/. */
  readonly rendererDir: string
  icon(size: number): Buffer | null
  logError(message: string, err: unknown): void
}

/**
 * Requests reach Perch through `tailscale serve` (Host: <name>.ts.net) or from this computer.
 * Any other Host is refused, so a web page cannot rebind a domain of its own onto 127.0.0.1.
 */
export function allowedHost(host: string | undefined): boolean {
  const name = (host ?? '').replace(/:\d+$/, '').toLowerCase()
  return name === 'localhost' || name === '127.0.0.1' || /^[a-z0-9-]+(\.[a-z0-9-]+)*\.ts\.net$/.test(name)
}

const typeOf = (file: string): string => TYPES[file.slice(file.lastIndexOf('.') + 1)] ?? 'application/octet-stream'

function send(res: ServerResponse, status: number, type: string, body: string | Buffer, cache = 'no-store'): void {
  res.writeHead(status, { ...SECURITY_HEADERS, 'Content-Type': type, 'Cache-Control': cache })
  res.end(body)
}

const sendJson = (res: ServerResponse, status: number, body: unknown): void =>
  send(res, status, TYPES['json'], JSON.stringify(body))

/** A request body over MAX_BODY_BYTES: answered with 413, then the connection is closed. */
class BodyTooLarge extends Error {}

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        req.removeAllListeners('data')
        reject(new BodyTooLarge())
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (size === 0) return resolve(null)
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown)
      } catch {
        resolve(null)
      }
    })
    req.on('error', reject)
  })
}

async function serveFile(res: ServerResponse, opts: PhoneServerOptions, path: string): Promise<void> {
  const size = ICONS[path]
  if (size) {
    const png = opts.icon(size)
    if (png) return send(res, 200, TYPES['png'], png, 'public, max-age=86400')
  }
  const page = PAGES[path]
  const file = page ?? (ASSET_NAME.test(path) ? path.slice(1) : null)
  if (!file) return send(res, 404, 'text/plain; charset=utf-8', 'Not found')
  try {
    const body = await readFile(join(opts.rendererDir, file))
    // Built assets carry a content hash in their names; the page and the worker must always be fresh.
    send(res, 200, typeOf(file), body, page ? 'no-store' : 'public, max-age=31536000, immutable')
  } catch {
    send(res, 404, 'text/plain; charset=utf-8', 'Not found')
  }
}

async function handle(req: IncomingMessage, res: ServerResponse, opts: PhoneServerOptions): Promise<void> {
  if (!allowedHost(req.headers.host)) return send(res, 421, 'text/plain; charset=utf-8', 'Unknown host')
  const path = new URL(req.url ?? '/', 'http://localhost').pathname
  if (path.startsWith('/api/')) {
    // Only JSON is accepted, so a web page cannot send a plain form or text post without a CORS preflight.
    if (req.method === 'POST' && !/^application\/json\b/i.test(req.headers['content-type'] ?? '')) {
      return sendJson(res, 415, { error: '只收 JSON' })
    }
    let body: unknown = null
    try {
      if (req.method === 'POST') body = await readBody(req)
    } catch (err) {
      if (!(err instanceof BodyTooLarge)) throw err
      res.on('finish', () => req.destroy())
      return sendJson(res, 413, { error: `太長了，最多 ${MAX_BODY_BYTES / 1024} KB` })
    }
    const result = await opts.api.handle({ method: req.method ?? 'GET', path, authorization: req.headers.authorization, body }, Date.now())
    return sendJson(res, result.status, result.body)
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'text/plain; charset=utf-8', 'Method not allowed')
  return serveFile(res, opts, path)
}

/** Starts listening on 127.0.0.1 only; rejects when the port is taken. */
export function startPhoneServer(opts: PhoneServerOptions): Promise<Server> {
  const server = createServer((req, res) => {
    handle(req, res, opts).catch((err: unknown) => {
      opts.logError('Phone server request failed', err)
      if (!res.headersSent) sendJson(res, 400, { error: '看不懂這個要求' })
      else res.end()
    })
  })
  server.headersTimeout = HEADERS_TIMEOUT_MS
  server.requestTimeout = REQUEST_TIMEOUT_MS
  server.maxConnections = MAX_CONNECTIONS
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(opts.port, '127.0.0.1', () => {
      server.off('error', reject)
      resolve(server)
    })
  })
}
