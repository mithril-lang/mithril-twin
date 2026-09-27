// Copy the canonical .mith / .mithril samples from packages/mith into the viewer's public/data.
import { copyFileSync, mkdirSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const from = join(here, '../../../packages/mith/samples')
const to = join(here, '../public/data')
mkdirSync(to, { recursive: true })
for (const name of readdirSync(from)) {
  if (name.endsWith('.mith') || name.endsWith('.mithril')) copyFileSync(join(from, name), join(to, name))
}
