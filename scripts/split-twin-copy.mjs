/* global process, console */
/** Keep lazy Twin locale chunks synchronized with the reviewed source dictionary. */
import fs from 'node:fs'
import path from 'node:path'

const sourcePath = path.resolve(import.meta.dirname, '../apps/viewer/src/twin/twin-copy.json')
const outputDir = path.resolve(import.meta.dirname, '../apps/viewer/src/twin/twin-copy-locales')
const source = JSON.parse(fs.readFileSync(sourcePath, 'utf8')).copy
const locales = Object.keys(source).sort()
let stale = false
if (!process.argv.includes('--check')) fs.mkdirSync(outputDir, { recursive: true })
for (const locale of locales) {
  const outputPath = path.join(outputDir, `${locale}.json`)
  const expected = `${JSON.stringify(source[locale], null, 2)}\n`
  if (process.argv.includes('--check')) {
    if (!fs.existsSync(outputPath) || fs.readFileSync(outputPath, 'utf8') !== expected) {
      console.error(`Twin locale chunk is stale: ${locale}`)
      stale = true
    }
  } else fs.writeFileSync(outputPath, expected)
}
const extra = fs.existsSync(outputDir) ? fs.readdirSync(outputDir).filter((name) => name.endsWith('.json') && !locales.includes(name.slice(0, -5))) : []
if (extra.length) {
  console.error(`Unexpected Twin locale chunks: ${extra.join(', ')}`)
  stale = true
}
if (stale) process.exitCode = 1
else console.log(`Twin locale chunks: ${locales.length} current`)
