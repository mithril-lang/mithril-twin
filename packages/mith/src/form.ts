import { KEY_NAMES, NESTED_TAGS, PATH_TAGS, TOP_LEVEL_TAGS, TYPED_NODE_TAGS } from './formTables'

/**
 * Reader for upstream Mithril Form (application/vnd.mithril.form), the canonical `.mith` surface
 * defined by mithril-lang/mithril (`src/mithril/form.cljk`). Forms are inert data: this reads
 * exactly one EDN form and lowers it to the same JSON-LD document the upstream reader produces.
 * Nothing is evaluated and no host namespace is resolved. Error codes match upstream.
 */

export const FORM_MEDIA_TYPE = 'application/vnd.mithril.form'
export const V1_CONTEXT = 'https://mithril.fund/context/v1'
export const TWIN_CONTEXT = 'https://mithril.fund/context/twin/v1'

export class MithFormError extends Error {
  code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'MithFormError'
    this.code = code
  }
}
const fail = (code: string, detail: string): never => {
  throw new MithFormError(`mithril.form/${code}`, detail)
}

type Edn =
  | { t: 'list' | 'vec' | 'map' | 'set'; items: Edn[] }
  | { t: 'sym'; ns: string | null; name: string }
  | { t: 'kw'; ns: string | null; name: string }
  | { t: 'str'; v: string }
  | { t: 'int'; v: number }
  | { t: 'float' | 'char' | 'nil' }
  | { t: 'bool'; v: boolean }

/** Upstream `source?`: Form source starts with `(` after leading whitespace. */
export function isFormSource(text: string): boolean {
  return text.trimStart().startsWith('(')
}

// ---- EDN reader (the subset cljs.reader accepts; anything else is a read error) -------------
const WS = /[\s,]/
const DELIM = /[\s,()[\]{}";]/
const INT_RE = /^[-+]?(0|[1-9][0-9]*)N?$/
const FLOAT_RE = /^[-+]?[0-9]+(\.[0-9]*)?([eE][-+]?[0-9]+)?M?$|^[-+]?[0-9]+\/[0-9]+$|^[-+]?0[xX][0-9a-fA-F]+N?$/
const SYM_RE = /^(?:[A-Za-z*+!\-_?<>=$%&.][A-Za-z0-9*+!\-_?<>=$%&.:#']*)$/

// Fast ASCII paths (same classes as WS / DELIM; non-ASCII falls back to the regexes).
const isWs = (c: string) => {
  const k = c.charCodeAt(0)
  if (k < 128) return k === 32 || k === 44 || (k >= 9 && k <= 13)
  return WS.test(c)
}
const DELIM_ASCII = new Uint8Array(128)
for (const ch of ' \t\n\r\f\v,()[]{}";') DELIM_ASCII[ch.charCodeAt(0)] = 1
const isDelim = (s: string, i: number) => {
  const k = s.charCodeAt(i)
  return k < 128 ? DELIM_ASCII[k] === 1 : DELIM.test(s[i]!)
}

class Reader {
  i = 0
  private kwCache = new Map<string, Edn>()
  constructor(private s: string) {}
  err(msg: string): never {
    return fail('read-error', `${msg} at offset ${this.i}`)
  }
  skip() {
    const s = this.s
    for (;;) {
      const c = s[this.i]
      if (c === undefined) return
      if (isWs(c)) this.i++
      else if (c === ';') while (this.i < s.length && s[this.i] !== '\n') this.i++
      else if (c === '#' && s[this.i + 1] === '_') {
        this.i += 2
        this.read()
      } else return
    }
  }
  atEnd() {
    this.skip()
    return this.i >= this.s.length
  }
  read(): Edn {
    this.skip()
    const s = this.s
    const c = s[this.i]
    if (c === undefined) return this.err('EOF while reading')
    if (c === '(') return this.coll(')', 'list')
    if (c === '[') return this.coll(']', 'vec')
    if (c === '{') return this.coll('}', 'map')
    if (c === ')' || c === ']' || c === '}') return this.err(`unmatched delimiter ${c}`)
    if (c === '"') return this.string()
    if (c === '\\') {
      this.i++
      this.token()
      return { t: 'char' }
    }
    if (c === '#') {
      if (s[this.i + 1] === '{') {
        this.i++
        return this.coll('}', 'set')
      }
      return this.err('unsupported dispatch macro')
    }
    if (c === "'" || c === '`' || c === '~' || c === '@' || c === '^') return this.err(`unsupported macro character ${c}`)
    const tok = this.token()
    if (tok.startsWith(':')) return this.keyword(tok)
    if (INT_RE.test(tok)) {
      const v = Number(tok.replace(/N$/, ''))
      if (!Number.isSafeInteger(v)) return this.err(`integer out of range ${tok}`)
      return { t: 'int', v }
    }
    if (FLOAT_RE.test(tok)) return { t: 'float' }
    if (tok === 'nil') return { t: 'nil' }
    if (tok === 'true' || tok === 'false') return { t: 'bool', v: tok === 'true' }
    return this.symbol(tok)
  }
  token(): string {
    const start = this.i
    while (this.i < this.s.length && !isDelim(this.s, this.i)) this.i++
    return this.s.slice(start, this.i)
  }
  coll(close: string, t: 'list' | 'vec' | 'map' | 'set'): Edn {
    this.i++
    const items: Edn[] = []
    for (;;) {
      this.skip()
      if (this.i >= this.s.length) return this.err(`EOF while reading, expected ${close}`)
      if (this.s[this.i] === close) {
        this.i++
        break
      }
      items.push(this.read())
    }
    if ((t === 'map') && items.length % 2) return this.err('map literal must contain an even number of forms')
    return { t, items }
  }
  string(): Edn {
    const s = this.s
    this.i++
    let out = ''
    for (;;) {
      // Copy runs without escapes in one slice.
      let j = this.i
      while (j < s.length) {
        const k = s.charCodeAt(j)
        if (k === 34 || k === 92) break
        j++
      }
      if (j > this.i) {
        out += s.slice(this.i, j)
        this.i = j
      }
      const c = s[this.i]
      if (c === undefined) return this.err('EOF while reading string')
      this.i++
      if (c === '"') return { t: 'str', v: out }
      if (c !== '\\') {
        out += c
        continue
      }
      const e = s[this.i++]
      if (e === 'n') out += '\n'
      else if (e === 't') out += '\t'
      else if (e === 'r') out += '\r'
      else if (e === 'b') out += '\b'
      else if (e === 'f') out += '\f'
      else if (e === '"' || e === '\\') out += e
      else if (e === 'u') {
        const hex = s.slice(this.i, this.i + 4)
        if (!/^[0-9a-fA-F]{4}$/.test(hex)) return this.err('invalid unicode escape')
        out += String.fromCharCode(parseInt(hex, 16))
        this.i += 4
      } else return this.err(`unsupported escape character \\${e ?? ''}`)
    }
  }
  split(tok: string): { ns: string | null; name: string } | null {
    if (tok === '/') return { ns: null, name: '/' }
    const k = tok.indexOf('/')
    if (k < 0) return { ns: null, name: tok }
    const ns = tok.slice(0, k)
    const name = tok.slice(k + 1)
    if (!ns || !name || name.includes('/')) return null
    return { ns, name }
  }
  keyword(tok: string): Edn {
    const hit = this.kwCache.get(tok)
    if (hit) return hit
    const kw = this.keywordUncached(tok)
    this.kwCache.set(tok, kw)
    return kw
  }
  keywordUncached(tok: string): Edn {
    const body = tok.slice(1)
    if (!body || body.startsWith(':') || body.endsWith(':') || !SYM_RE.test(body.replace(/\//, 'x'))) return this.err(`invalid keyword ${tok}`)
    const parts = this.split(body)
    if (!parts) return this.err(`invalid keyword ${tok}`)
    return { t: 'kw', ...parts }
  }
  symbol(tok: string): Edn {
    if (!tok || tok.endsWith(':') || !SYM_RE.test(tok.replace(/\//, 'x')) || /^[-+.][0-9]/.test(tok)) return this.err(`invalid token ${tok}`)
    const parts = this.split(tok)
    if (!parts) return this.err(`invalid token ${tok}`)
    return { t: 'sym', ...parts }
  }
}

// ---- Lowering (mirrors mithril.form) --------------------------------------------------------
type JsonLd = null | boolean | number | string | JsonLd[] | { [k: string]: JsonLd }

const symName = (e: Edn) => (e.t === 'sym' ? (e.ns ? `${e.ns}/${e.name}` : e.name) : null)
const NOT_OWL2_RL = new Set(['owl:ReflexiveProperty', 'http://www.w3.org/2002/07/owl#ReflexiveProperty'])

function keyName(k: Edn): string {
  if (k.t !== 'kw') return fail('non-keyword-field', 'Mithril form fields must be keywords')
  const full = k.ns ? `${k.ns}/${k.name}` : k.name
  const mapped = KEY_NAMES[full]
  if (mapped != null) return mapped
  if (!k.ns) return k.name
  return fail('unknown-field', `unknown namespaced field: :${full}`)
}

function lowerValue(v: Edn): JsonLd {
  switch (v.t) {
    case 'list':
      return lowerForm(v)
    case 'vec':
      return v.items.map(lowerValue)
    case 'str':
      return v.v
    case 'int':
      return v.v
    case 'bool':
      return v.v
    case 'nil':
      return null
    default:
      return fail('unsupported-value', `unsupported Mithril form value: ${v.t === 'float' ? 'decimal (use rdf/literal … :datatype "xsd:decimal")' : v.t}`)
  }
}

function fields(xs: Edn[]): Record<string, JsonLd> {
  if (xs.length % 2) fail('field-arity', 'Mithril forms require keyword/value pairs')
  const out: Record<string, JsonLd> = {}
  const names: string[] = []
  for (let i = 0; i < xs.length; i += 2) names.push(keyName(xs[i]!))
  if (new Set(names).size !== names.length) fail('duplicate-field', 'Mithril form fields must be unique')
  for (let i = 0; i < xs.length; i += 2) out[names[i / 2]!] = lowerValue(xs[i + 1]!)
  return out
}

function lowerPath(p: Edn): JsonLd {
  if (p.t === 'str') return { '@id': p.v }
  const tag = p.t === 'list' ? symName(p.items[0] ?? { t: 'nil' }) : null
  if (tag && tag in PATH_TAGS) return lowerForm(p)
  return fail('invalid-path', 'a path is an IRI string or a path/... form')
}

function lowerPathForm(tag: string, args: Edn[]): JsonLd {
  const multi = tag === 'path/sequence' || tag === 'path/alternative'
  if (multi && args.length < 2) fail('path-arity', `${tag} takes at least two paths`)
  if (!multi && args.length !== 1) fail('path-arity', `${tag} takes exactly one path`)
  if (tag === 'path/sequence') return { '@list': args.map(lowerPath) }
  if (tag === 'path/alternative') return { shAlternativePath: args.map(lowerPath) }
  return { [PATH_TAGS[tag]!]: lowerPath(args[0]!) }
}

function lowerLiteral(args: Edn[]): JsonLd {
  const [lexical, ...opts] = args
  if (!lexical || lexical.t !== 'str') return fail('invalid-literal', 'rdf/literal takes a lexical string first')
  if (opts.length % 2) fail('field-arity', 'rdf/literal options are keyword/value pairs')
  const o: Record<string, Edn> = {}
  for (let i = 0; i < opts.length; i += 2) {
    const k = opts[i]!
    if (k.t !== 'kw' || k.ns || (k.name !== 'datatype' && k.name !== 'language')) fail('unknown-field', 'rdf/literal accepts only :datatype or :language')
    o[(k as { name: string }).name] = opts[i + 1]!
  }
  if (o.datatype && o.language) fail('invalid-literal', 'a literal has a datatype or a language, not both')
  for (const v of [o.datatype, o.language]) if (v && v.t !== 'str' && v.t !== 'nil') fail('invalid-literal', 'rdf/literal :datatype / :language are strings')
  const out: Record<string, JsonLd> = { '@value': lexical.v }
  if (o.datatype?.t === 'str') out['@type'] = o.datatype.v
  if (o.language?.t === 'str') out['@language'] = o.language.v
  return out
}

function mergeType(tagType: string, bodyType: JsonLd | undefined): JsonLd {
  const extra = bodyType == null ? [] : Array.isArray(bodyType) ? bodyType : [bodyType]
  const types = [...new Set([tagType, ...extra.map(String)])]
  return types.length === 1 ? types[0]! : types
}

const CONTEXT_OF: Record<string, string> = {
  'mithril/growth-decision': 'https://mithril.fund/context/growth-decision/v1',
  'mithril/jev-decision': 'https://mithril.fund/context/jev-decision/v2',
  'mithril/bot-checkpoint-semantic': 'https://mithril.fund/context/bot-checkpoint/v1',
  'mithril/twin-document': TWIN_CONTEXT,
}

function lowerForm(form: Edn): JsonLd {
  if (form.t !== 'list' || !form.items.length || form.items[0]!.t !== 'sym') {
    return fail('invalid-form', 'Mithril source must be one tagged S-expression')
  }
  const tag = symName(form.items[0]!)!
  const args = form.items.slice(1)
  if (tag in PATH_TAGS) return lowerPathForm(tag, args)
  if (tag === 'rdf/literal') return lowerLiteral(args)
  const body = fields(args)
  const t = body['@type']
  for (const x of Array.isArray(t) ? t : [t]) {
    if (typeof x === 'string' && NOT_OWL2_RL.has(x)) fail('not-owl2-rl', `${x} is outside the OWL 2 RL profile Mithril ontologies declare`)
  }
  if (tag in TOP_LEVEL_TAGS) return { ...body, '@context': CONTEXT_OF[tag] ?? V1_CONTEXT, '@type': TOP_LEVEL_TAGS[tag]! }
  if (tag === 'mithril/task') {
    const { '@id': id, toolProfileDigest, ...rest } = body
    return { ...rest, id: id ?? null, ...(toolProfileDigest !== undefined ? { 'tool-profile-digest': toolProfileDigest } : {}) }
  }
  if (NESTED_TAGS.has(tag)) return body
  if (tag in TYPED_NODE_TAGS) return { ...body, '@type': mergeType(TYPED_NODE_TAGS[tag]!, body['@type']) }
  return fail('unknown-tag', `unknown Mithril form tag: ${tag}`)
}

/** Read exactly one inert Mithril form and lower it to the JSON-LD document model. */
export function parseForm(text: string): Record<string, JsonLd> {
  const r = new Reader(text)
  const forms: Edn[] = []
  try {
    while (!r.atEnd()) forms.push(r.read())
  } catch (e) {
    if (e instanceof MithFormError) throw e
    throw new MithFormError('mithril.form/read-error', e instanceof Error ? e.message : 'invalid Mithril form')
  }
  if (forms.length !== 1) fail('form-count', 'Mithril source must contain exactly one form')
  const out = lowerForm(forms[0]!)
  if (!out || typeof out !== 'object' || Array.isArray(out)) return fail('invalid-form', 'Mithril source must be one tagged S-expression')
  return out
}
