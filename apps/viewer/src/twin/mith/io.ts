import { COPLANAR_BOARD_H, COPLANAR_BOARD_W } from './geometry'
import { MithParseError, parseMith, parseMithrilPackage } from './parse'
import { readMith, toTwinForm } from './twin'
import type {
  DiagramFrame,
  DiagramLens,
  MithArrangement,
  MithCamera,
  MithDocument,
  MithPlane,
} from './types'

/** MIME for a legacy v0 .mith document (JSON, deprecated). */
export const MITH_MIME = 'application/vnd.mithril.mith+json'
/** MIME for a .mith document written as upstream Mithril Form, `(mithril/twin-document …)`. */
export const MITH_FORM_MIME = 'application/vnd.mithril.form'
/** MIME for a .mithril package manifest (JSON, not a zip). */
export const MITHRIL_MIME = 'application/vnd.mithril.mithril+json'

export const MITH_ACCEPT = '.mith,.mithril,application/vnd.mithril.form,application/vnd.mithril.mith+json,application/vnd.mithril.mithril+json'

/** One file, read locally. Larger drops are refused so parsing cannot freeze the page. */
export const MAX_MITH_IMPORT_BYTES = 12 * 1024 * 1024

export type MithViewState = {
  arrangement: MithArrangement
  camera: MithCamera
  selection: string | null
  lens?: DiagramLens
  frame?: DiagramFrame
}

export type MithFile = {
  filename: string
  mime: typeof MITH_FORM_MIME | typeof MITH_MIME
  /** `form` is upstream-conformant `(mithril/twin-document …)`; `legacy-v0` only for labels Form cannot carry. */
  format: 'form' | 'legacy-v0'
  body: string
  bytes: number
  note: string | null
}

export type LocalMithSource = { name: string; text: string }

export type ImportedMith =
  | {
      ok: true
      doc: MithDocument
      filename: string
      packageId: string | null
      note: string | null
    }
  | { ok: false; message: string }

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

export function mithDownloadName(id: string): string {
  const safe = id.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'document'
  return safe.toLowerCase().endsWith('.mith') ? safe : `${safe}.mith`
}

function modelIds(doc: MithDocument): Set<string> {
  const ids = new Set(doc.model.entities.map((e) => e.id))
  for (const list of [
    doc.model.boundaries,
    doc.model.roles,
    doc.model.grants,
    doc.model.actors,
    doc.model.channels,
    doc.model.reach,
  ]) {
    for (const item of list ?? []) ids.add(item.id)
  }
  return ids
}

function sameNumber(a: number, b: number) {
  return Math.abs(a - b) < 0.001
}

function rectsOverlap(a: MithPlane, b: MithPlane) {
  return (
    a.transform.x < b.transform.x + COPLANAR_BOARD_W &&
    b.transform.x < a.transform.x + COPLANAR_BOARD_W &&
    a.transform.y < b.transform.y + COPLANAR_BOARD_H &&
    b.transform.y < a.transform.y + COPLANAR_BOARD_H
  )
}

function anyOverlap(planes: MithPlane[]) {
  for (let i = 0; i < planes.length; i++) {
    for (let j = i + 1; j < planes.length; j++) {
      if (rectsOverlap(planes[i]!, planes[j]!)) return true
    }
  }
  return false
}

function zValuesDistinct(planes: MithPlane[]) {
  const seen = new Set(planes.map((p) => p.transform.z.toFixed(3)))
  return seen.size === planes.length
}

/**
 * Board positions stay as stored when that arrangement already parses.
 * A stacked view of a shared-z floor gets a distinct z per board (x/y unchanged).
 * A coplanar view of an overlapping stair is spread on x/y so the 280×176 boards do not intersect.
 */
export function planesForArrangement(planes: MithPlane[], arrangement: MithArrangement): MithPlane[] {
  if (planes.length <= 1) return planes.map((p) => ({ ...p, transform: { ...p.transform } }))
  if (arrangement === 'stacked') {
    if (zValuesDistinct(planes)) return planes.map((p) => ({ ...p, transform: { ...p.transform } }))
    const mid = Math.floor((planes.length - 1) / 2) * 90
    return planes.map((p, i) => ({
      ...p,
      transform: { ...p.transform, z: (planes.length - 1 - i) * 90 - mid },
    }))
  }
  const z0 = planes[0]!.transform.z
  const shared = planes.every((p) => sameNumber(p.transform.z, z0))
  const z = shared ? z0 : 0
  const flattened = planes.map((p) => ({ ...p, transform: { ...p.transform, z } }))
  if (!anyOverlap(flattened)) return flattened
  const columns = 3
  const gapX = 40
  const gapY = 48
  return flattened.map((p, i) => ({
    ...p,
    transform: {
      ...p.transform,
      x: (i % columns) * (COPLANAR_BOARD_W + gapX),
      y: Math.floor(i / columns) * (COPLANAR_BOARD_H + gapY),
      z,
    },
  }))
}

/** Copy `doc` with the grid's current diagram view. Model and inference are unchanged. */
export function applyDiagramView(doc: MithDocument, view: MithViewState): MithDocument {
  const planes = planesForArrangement(doc.diagram.planes, view.arrangement)
  const ids = modelIds(doc)
  const selection = view.selection && ids.has(view.selection) ? view.selection : null
  const focus = planes.some((p) => p.id === view.camera.focusPlane)
    ? view.camera.focusPlane
    : doc.diagram.camera.focusPlane
  return {
    ...doc,
    diagram: {
      arrangement: view.arrangement,
      camera: {
        mode: view.camera.mode,
        tilt: view.camera.tilt,
        yaw: view.camera.yaw,
        zoom: view.camera.zoom,
        focusPlane: focus,
      },
      selection,
      planes,
      crossLinks: doc.diagram.crossLinks,
      ...(view.lens ? { lens: view.lens } : {}),
      ...(view.frame ? { frame: view.frame } : {}),
    },
  }
}

/**
 * Canonical text for a document. Runs `parseMith` first, so runner / executor / payload / secret
 * keys fail here the same way they fail on import.
 *
 * Synthetic documents are written as upstream Mithril Form, `(mithril/twin-document …)`, the only
 * spelling the twin context admits. Upstream twin Form has no `diagram.lens` / `diagram.frame` terms
 * and only admits `dataset_kind` `synthetic-demo`, so:
 * - `lens` and `frame` are not written (the next open picks Org or Layers from the content);
 * - a document that declares another label is written as deprecated legacy v0 JSON so the label
 *   is kept rather than silently relabelled.
 */
export function serializeMith(doc: MithDocument): { body: string; format: 'form' | 'legacy-v0' } {
  const parsed = parseMith(JSON.parse(JSON.stringify(doc)))
  if (parsed.dataset_kind === 'synthetic-demo') return { body: toTwinForm(parsed), format: 'form' }
  return { body: `${JSON.stringify(parsed, null, 2)}\n`, format: 'legacy-v0' }
}

export function buildMithDownload(doc: MithDocument, view: MithViewState): MithFile {
  const { body, format } = serializeMith(applyDiagramView(doc, view))
  const bytes = new TextEncoder().encode(body).length
  return {
    filename: mithDownloadName(doc.id),
    mime: format === 'form' ? MITH_FORM_MIME : MITH_MIME,
    format,
    body,
    bytes,
    note:
      format === 'form'
        ? null
        : `Written as legacy v0 JSON because Mithril twin Form only admits dataset_kind synthetic-demo and this file declares ${JSON.stringify(doc.dataset_kind)}.`,
  }
}

/** Trigger a browser download. The blob never leaves the machine. */
export function saveMithFile(file: MithFile) {
  const blob = new Blob([file.body], { type: file.mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = file.filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

export async function readLocalFiles(files: File[]): Promise<LocalMithSource[]> {
  if (files.length === 0) throw new Error('Choose a .mith file.')
  const out: LocalMithSource[] = []
  for (const file of files) {
    if (file.size > MAX_MITH_IMPORT_BYTES) {
      throw new Error(
        `${file.name} is ${formatBytes(file.size)}. Import reads each file in this browser and stops at ${formatBytes(MAX_MITH_IMPORT_BYTES)} so the page stays responsive.`,
      )
    }
    out.push({ name: file.name, text: await file.text() })
  }
  return out
}

function extOf(name: string) {
  const base = name.split(/[/\\]/).pop() ?? name
  const i = base.lastIndexOf('.')
  return i >= 0 ? base.slice(i).toLowerCase() : ''
}

function basename(name: string) {
  const parts = name.split(/[/\\]/)
  return parts[parts.length - 1] || name
}

function isRemote(name: string) {
  return /^[a-z][a-z0-9+.-]*:/i.test(name) || name.startsWith('//')
}

function parseJson(text: string, filename: string): unknown {
  try {
    return JSON.parse(text) as unknown
  } catch {
    throw new MithParseError(`${filename} is not valid JSON. A .mithril package is one JSON manifest.`)
  }
}

const LEGACY_NOTE = 'This file is legacy v0 JSON (deprecated). Export writes (mithril/twin-document …) Form.'

/** Form, twin JSON-LD, or legacy v0 JSON; errors name the file. */
function readDoc(file: LocalMithSource) {
  try {
    return readMith(file.text)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'could not read it'
    throw new MithParseError(`${file.name}: ${message}`)
  }
}

function listNames(names: string[]) {
  return names.join(', ')
}

/**
 * Open local .mith documents and .mithril manifests.
 * Member files are taken only from `files`. Nothing is fetched.
 */
export function importLocalFiles(files: LocalMithSource[]): ImportedMith {
  if (files.length === 0) return { ok: false, message: 'Choose a .mith file.' }
  const mith = files.filter((f) => extOf(f.name) === '.mith')
  const packs = files.filter((f) => extOf(f.name) === '.mithril')
  const other = files.filter((f) => extOf(f.name) !== '.mith' && extOf(f.name) !== '.mithril')

  if (packs.length > 1) {
    return {
      ok: false,
      message: `Dropped more than one .mithril package (${listNames(packs.map((f) => f.name))}). Open one package at a time.`,
    }
  }

  try {
    if (packs.length === 1) {
      const packFile = packs[0]!
      const pkg = parseMithrilPackage(parseJson(packFile.text, packFile.name))
      const byName = new Map<string, LocalMithSource>()
      for (const file of mith) byName.set(file.name, file)
      const remote = pkg.documents.filter(isRemote)
      const localNames = pkg.documents.filter((name) => !isRemote(name))
      const found: { listed: string; file: LocalMithSource }[] = []
      const missing: string[] = []
      for (const listed of localNames) {
        const file = byName.get(listed) ?? byName.get(basename(listed))
        if (file) found.push({ listed, file })
        else missing.push(listed)
      }
      if (found.length === 0) {
        const remoteNote = remote.length
          ? ` ${listNames(remote)} ${remote.length === 1 ? 'is a URL' : 'are URLs'}; this viewer does not fetch URLs.`
          : ''
        return {
          ok: false,
          message: `${packFile.name} lists ${listNames(pkg.documents)}. Those member files were not included.${remoteNote} Drop the package together with its .mith files, or open a member .mith file directly. Files stay in this browser.`,
        }
      }
      const first = found[0]!
      const read = readDoc(first.file)
      const doc = read.doc
      const notes: string[] = [`Opened ${first.file.name} from package ${pkg.id}.`]
      if (read.deprecated) notes.push(LEGACY_NOTE)
      if (doc.dataset_kind !== 'synthetic-demo') {
        notes.push(`Dataset label from the file: ${doc.dataset_kind}.`)
      }
      const extra = found.slice(1).map((f) => f.file.name)
      if (extra.length) notes.push(`Also in this drop, left unopened: ${listNames(extra)}.`)
      if (missing.length) notes.push(`Not included: ${listNames(missing)}.`)
      if (remote.length) notes.push(`Did not fetch ${listNames(remote)}.`)
      return {
        ok: true,
        doc,
        filename: first.file.name,
        packageId: pkg.id,
        note: notes.join(' '),
      }
    }

    if (mith.length === 0) {
      const names = other.map((f) => f.name).join(', ') || 'That file'
      return {
        ok: false,
        message: `${names} is not a .mith file. Import opens a .mith document, or a .mithril package together with its member .mith files.`,
      }
    }

    const file = mith[0]!
    const read = readDoc(file)
    const doc = read.doc
    const notes: string[] = []
    if (read.deprecated) notes.push(LEGACY_NOTE)
    if (doc.dataset_kind !== 'synthetic-demo') notes.push(`Dataset label from the file: ${doc.dataset_kind}.`)
    const rest = mith.slice(1).map((f) => f.name)
    if (rest.length) notes.push(`Opened ${file.name}. Left unopened: ${listNames(rest)}.`)
    if (other.length) {
      notes.push(`Ignored ${listNames(other.map((f) => f.name))}. Import reads .mith documents and .mithril packages.`)
    }
    return {
      ok: true,
      doc,
      filename: file.name,
      packageId: null,
      note: notes.length ? notes.join(' ') : null,
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Could not read that file.'
    return { ok: false, message }
  }
}
