import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { Meta } from './classify.ts'
import type { FileState } from './transcript.ts'

export type Cache = {
  version: 1
  files: Record<string, FileState>
  metas: Record<string, Meta>
  /** Session id to the path of its lead transcript. */
  leads: Record<string, string>
}

export function emptyCache(): Cache {
  return { version: 1, files: {}, metas: {}, leads: {} }
}

export function loadCache(path: string): Cache {
  try {
    const data = JSON.parse(readFileSync(path, 'utf8')) as Partial<Cache>
    return data.version === 1 && data.files && data.metas && data.leads ? (data as Cache) : emptyCache()
  } catch {
    return emptyCache()
  }
}

export function saveCache(path: string, cache: Cache): void {
  mkdirSync(dirname(path), { recursive: true })
  // A rename replaces the file whole, so a reader never sees half of it.
  const tmp = `${path}.${process.pid}.tmp`
  writeFileSync(tmp, JSON.stringify(cache))
  renameSync(tmp, path)
}
