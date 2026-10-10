import { randomUUID } from 'node:crypto'
import { lstatSync, mkdirSync, readFileSync, renameSync, writeFileSync, type Stats } from 'node:fs'
import { dirname } from 'node:path'
import type { Meta } from './classify.ts'
import type { FileState } from './transcript.ts'

export type Cache = {
  /** Bumped when FileState changes shape, so an old cache is read from scratch. */
  version: 2
  files: Record<string, FileState>
  metas: Record<string, Meta>
  /** Session id to the path of its lead transcript. */
  leads: Record<string, string>
}

export function emptyCache(): Cache {
  return { version: 2, files: {}, metas: {}, leads: {} }
}

/** The cache folder may sit in a shared tmp, so only a real folder of ours that no one else can write to is trusted. */
export function isPrivateDir(st: Pick<Stats, 'isDirectory' | 'uid' | 'mode'>, uid: number | undefined): boolean {
  if (!st.isDirectory()) return false
  // Windows has no owner ids, and its mode bits say nothing about who may write.
  return uid === undefined || (st.uid === uid && (st.mode & 0o022) === 0)
}

// Which side of the optional call runs depends on the platform, so no one run covers both.
/* node:coverage ignore next */
const currentUid = (): number | undefined => process.getuid?.()

const ownsDir = (dir: string): boolean => isPrivateDir(lstatSync(dir), currentUid())

export function loadCache(path: string): Cache {
  try {
    if (!ownsDir(dirname(path))) return emptyCache()
    const data = JSON.parse(readFileSync(path, 'utf8')) as Partial<Cache>
    return data.version === 2 && data.files && data.metas && data.leads ? (data as Cache) : emptyCache()
  } catch {
    return emptyCache()
  }
}

export function saveCache(path: string, cache: Cache, suffix: () => string = randomUUID): void {
  const dir = dirname(path)
  try {
    mkdirSync(dir, { recursive: true, mode: 0o700 })
  } catch {
    // Something that is not a folder sits at the path; like any untrusted folder, it gets no cache.
    return
  }
  if (!ownsDir(dir)) return
  // A rename replaces the file whole, so a reader never sees half of it. 'wx' fails on an existing
  // name instead of following a link planted there.
  const tmp = `${path}.${suffix()}.tmp`
  writeFileSync(tmp, JSON.stringify(cache), { flag: 'wx', mode: 0o600 })
  renameSync(tmp, path)
}
