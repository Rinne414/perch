import { net, protocol } from 'electron'
import type { DatabaseSync } from 'node:sqlite'
import { pathToFileURL } from 'node:url'
import { CLIP_SCHEME } from '@shared/clips'
import { getClip } from './db/clips'
import { clipFilePath } from './services/clips'

const CLIP_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/** Must run before the app is ready, so `<img src="perch-clip://image/<id>">` can load. */
export function registerClipScheme(): void {
  protocol.registerSchemesAsPrivileged([{ scheme: CLIP_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } }])
}

/**
 * Serves 暫存 pictures by clip id only: the file comes from the database row and must lie inside
 * the clips folder, so a page can never ask this for any other file.
 */
export function serveClips(db: DatabaseSync, dir: string): void {
  protocol.handle(CLIP_SCHEME, (request) => {
    const { host, pathname } = new URL(request.url)
    const id = pathname.slice(1)
    const clip = host === 'image' && CLIP_ID.test(id) ? getClip(db, id) : null
    const file = clip ? clipFilePath(dir, clip) : null
    if (!file) return new Response('Not found', { status: 404 })
    return net.fetch(pathToFileURL(file).toString())
  })
}
