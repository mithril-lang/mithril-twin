import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TwinHome } from './home'
import { TwinLocaleProvider } from '../locale'
import { labelLines } from './components/TokenNode'
import { orthoPath } from './components/ortho'
import { twinSymbol } from './themes/symbols'
import { readMith, readMithRaw } from './mith/twin'

const tinyMith = {
  mith: '0.1',
  kind: 'document',
  id: 'polaris-fi-synthetic',
  title: '北極星 FI',
  dataset_kind: 'synthetic-demo',
  generated_at: '2026-09-27T18:00:00+09:00',
  disclaimer: 'Fictional. Viz only.',
  model: {
    citations: [{ source: 'synthetic-demo' }],
    entities: [
      {
        id: 'org:holdings',
        label: 'Holdings',
        type: 'HoldingCompany',
        layer: 'organization',
        citations: [],
        attrs: {},
      },
      {
        id: 'net:core',
        label: 'Core VLAN',
        type: 'CorpVLAN',
        layer: 'network',
        citations: [],
        attrs: {},
      },
    ],
    edges: [{ id: 'e1', source: 'org:holdings', target: 'net:core', kind: 'contains' }],
  },
  diagram: {
    arrangement: 'coplanar',
    camera: { mode: 'iso', tilt: 54, yaw: -28, zoom: 1, focusPlane: 'plane:network' },
    selection: 'net:core',
    planes: [
      {
        id: 'plane:organization',
        layer: 'organization',
        label: 'Holding',
        transform: { x: 0, y: 0, z: 0, tilt: 54, yaw: -28 },
        placements: [{ entity: 'org:holdings', x: 0.4, y: 0.4, tone: 'accent', showLabel: true }],
      },
      {
        id: 'plane:network',
        layer: 'network',
        label: 'Polaris Core',
        transform: { x: 320, y: 16, z: 0, tilt: 54, yaw: -28 },
        placements: [{ entity: 'net:core', x: 0.5, y: 0.5, tone: 'info', showLabel: true }],
      },
    ],
    crossLinks: [{ id: 'xl1', from: 'org:holdings', to: 'net:core', kind: 'shared-ref' }],
  },
  inference: {
    viz_only: true,
    no_runners: true,
    hypotheses: [],
  },
}

const orgMith = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '../../public/data/polaris-org.mith'),
  'utf8',
)

const tinyPackage = {
  mithril: '0.1',
  kind: 'package',
  id: 'polaris-fi-synthetic',
  dataset_kind: 'synthetic-demo',
  documents: ['polaris-fi.mith'],
  attachments: [],
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  document.cookie = 'mf_locale=;Path=/;Max-Age=0'
})

const setDoc = (id: string) => window.history.replaceState(null, '', `/twin?doc=${id}`)

beforeEach(() => {
  localStorage.clear()
  setDoc('polaris-fi')
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('.mithril')) {
        return new Response(JSON.stringify(tinyPackage), { status: 200 })
      }
      if (url.includes('.mith')) {
        return new Response(JSON.stringify(tinyMith), { status: 200 })
      }
      return new Response(
        JSON.stringify({
          layer: 'organization',
          dataset_kind: 'synthetic-demo',
          generated_at: '2026-09-27T15:52:36+09:00',
          elements: { nodes: [], edges: [] },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    }),
  )
})

describe('Twin Polaris surface', () => {
  it('translates viewer controls while preserving labels loaded from a .mith document', async () => {
    window.history.replaceState(null, '', '/twin?doc=polaris-fi&lang=ja')
    render(<TwinLocaleProvider><TwinHome /></TwinLocaleProvider>)
    await waitFor(() => expect(screen.getByRole('heading', { name: '北極星 FI' })).toBeTruthy())
    expect(screen.getByText('非本番')).toBeTruthy()
    expect(screen.getByRole('button', { name: '詳細' })).toBeTruthy()
    expect(screen.getByRole('tab', { name: /オブジェクト/ })).toBeTruthy()
    expect(screen.getAllByText('Core VLAN').length).toBeGreaterThan(0)
  })

  it('renders synthetic-demo labels and the Polaris title from .mith', async () => {
    render(<TwinHome />)
    expect(screen.getAllByText('synthetic-demo').length).toBeGreaterThan(0)
    expect(screen.getByText('non-prod')).toBeTruthy()
    expect(screen.getByText('no-runners')).toBeTruthy()
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: '北極星 FI' })).toBeTruthy()
      expect(document.title).toBe('Mithril Twin | twin.mithril.fund')
      expect(screen.getByText('Mithril Twin')).toBeTruthy()
    })
    expect(document.querySelector('.make-app')).toBeTruthy()
    expect(document.querySelector('.make-app')?.getAttribute('data-source')).toBe('mith')
    const gh = screen.getByRole('link', { name: /GitHub repository/ })
    expect(gh.getAttribute('href')).toBe('https://github.com/mithril-lang/mithril-twin')
    expect(gh.getAttribute('target')).toBe('_blank')
    expect(gh.getAttribute('rel')).toBe('noopener noreferrer')
  })

  it('reveals the detail panel when an object is selected and lets mobile users close it', async () => {
    render(<TwinHome />)
    await waitFor(() => expect(document.querySelector('[data-entity="org:holdings"]')).toBeTruthy())

    const detail = screen.getByRole('complementary', { name: 'Object detail' })
    const toggle = screen.getByRole('button', { name: 'Details' })
    expect(detail.className).not.toContain('is-mobile-open')
    expect(toggle.getAttribute('aria-expanded')).toBe('false')

    fireEvent.click(document.querySelector('[data-entity="org:holdings"]')!)
    expect(detail.className).toContain('is-mobile-open')
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(detail.querySelector('h2')?.textContent).toBe('Holdings')

    fireEvent.click(screen.getByRole('button', { name: 'Close details' }))
    expect(detail.className).not.toContain('is-mobile-open')
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(toggle)
    expect(detail.className).toContain('is-mobile-open')
  })

  it('defaults to the lilac Make grid and keeps the flat board secondary', async () => {
    localStorage.setItem('polaris-twin-theme', 'make-light')
    render(<TwinHome />)
    expect(document.documentElement.getAttribute('data-theme')).toBe('make')
    expect(screen.getByRole('button', { name: 'Make' }).className).toMatch(/active/)

    await waitFor(() => {
      expect(document.querySelector('.make-app')?.getAttribute('data-focus-plane')).toBe('plane:network')
    })
    expect(document.querySelector('.make-app')?.getAttribute('data-arrangement')).toBe('coplanar')
    expect(document.querySelectorAll('[data-plane-card]')).toHaveLength(2)
    expect([...document.querySelectorAll('[data-board-tag]')].map((t) => t.textContent)).toEqual(['Holding', 'Polaris Core'])
    expect(document.querySelectorAll('.make-mod .make-node3d[data-shape]')).toHaveLength(2)
    // A file without org boundaries keeps the layer boards and shows no lens switcher.
    expect(document.querySelector('.make-app')?.getAttribute('data-lens')).toBe('layers')
    expect(screen.queryByRole('group', { name: 'Lens' })).toBeNull()
    expect(document.querySelector('.strategy-canvas')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Stack layers' }))
    expect(document.querySelector('.make-app')?.getAttribute('data-arrangement')).toBe('stacked')
    fireEvent.click(screen.getByRole('button', { name: 'Stack layers' }))
    expect(document.querySelector('.make-app')?.getAttribute('data-arrangement')).toBe('coplanar')

    fireEvent.change(screen.getByLabelText('Select Layer'), { target: { value: 'plane:organization' } })
    expect(document.querySelector('.make-app')?.getAttribute('data-focus-plane')).toBe('plane:organization')
    expect(document.querySelector('.make-crumb')?.textContent).toBe('CorpVLAN / Polaris Core')

    fireEvent.click(screen.getByRole('button', { name: 'Board' }))
    await waitFor(() => {
      expect(document.querySelector('.strategy-canvas')).toBeTruthy()
    })
    expect(document.querySelector('.make-app')).toBeNull()
  })
})

describe('Twin lenses', () => {
  it('opens an org document on the Org lens and switches to Impersonation and Layers', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url.includes('.mithril')) return new Response(JSON.stringify(tinyPackage), { status: 200 })
        return new Response(orgMith, { status: 200 })
      }),
    )
    setDoc('polaris-org')
    render(<TwinHome />)
    await waitFor(() => {
      expect(document.querySelector('.make-app')?.getAttribute('data-lens')).toBe('org')
    })
    const app = () => document.querySelector('.make-app')!
    expect(app().getAttribute('data-frame-dim')).toBe('org')
    expect(document.querySelector('[data-frame-kind="company"]')).toBeTruthy()
    expect(document.querySelector('[data-frame-kind="team"]')).toBeTruthy()
    expect(document.querySelectorAll('[data-frame-kind="shadow"]')).toHaveLength(3)

    const lens = screen.getByRole('group', { name: 'Lens' })
    fireEvent.click(lens.querySelector('button:nth-child(4)')!)
    expect(app().getAttribute('data-lens')).toBe('impersonation')
    expect(document.querySelector('[data-lens-panel="impersonation"]')?.textContent).toMatch(/7 unverified of 15 paths/)
    expect(document.querySelector('[data-frame-kind="external"]')).toBeTruthy()

    fireEvent.click(screen.getByRole('group', { name: 'Frame the grid by' }).querySelector('button:last-child')!)
    expect(app().getAttribute('data-frame-dim')).toBe('network')

    fireEvent.click(lens.querySelector('button:last-child')!)
    expect(app().getAttribute('data-lens')).toBe('layers')
    expect(document.querySelectorAll('[data-plane-card]')).toHaveLength(3)
    fireEvent.click(screen.getByRole('button', { name: 'Stack layers' }))
    expect(app().getAttribute('data-arrangement')).toBe('stacked')
  })
})

describe('Enterprise-scale pack', () => {
  it('uses the selected locale for the default pack controls and keeps generated labels as source data', async () => {
    window.history.replaceState(null, '', '/twin?lang=ja')
    render(<TwinLocaleProvider><TwinHome /></TwinLocaleProvider>)
    await waitFor(() => expect(document.querySelector('.make-app')?.getAttribute('data-scale-ready')).toBe('true'))
    expect(screen.getByRole('button', { name: '詳細' })).toBeTruthy()
    expect(screen.getByLabelText('データ件数')).toBeTruthy()
    expect(screen.getByRole('group', { name: 'レンズ' })).toBeTruthy()
    expect(screen.getByText('組織 レンズ')).toBeTruthy()
    expect(screen.getByText(/子会社を業種別にまとめ/)).toBeTruthy()
    expect(screen.getByText('このブラウザでの測定値')).toBeTruthy()
    expect(screen.queryByText('Measured in this browser')).toBeNull()
    expect(screen.getAllByText(/北極星/).length).toBeGreaterThan(0)
  })

  it('generates the 北極星 pack in the browser, drills company → department → team, and ranks exposure', async () => {
    const fetchMock = vi.fn(async () => new Response('', { status: 404 }))
    vi.stubGlobal('fetch', fetchMock)
    window.history.replaceState(null, '', '/twin')
    render(<TwinHome />)
    const app = () => document.querySelector('.make-app')!
    await waitFor(() => {
      expect(app().getAttribute('data-scale-ready')).toBe('true')
      expect(app().getAttribute('data-analysis')).toBe('ready')
    })
    expect(app().getAttribute('data-scale-level')).toBe('group')
    expect(app().getAttribute('data-lens')).toBe('org')
    const details = screen.getByRole('button', { name: 'Details' })
    const detailPanel = screen.getByRole('complementary', { name: 'Lens detail' })
    expect(details.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(details)
    expect(details.getAttribute('aria-expanded')).toBe('true')
    expect(detailPanel.className).toContain('is-mobile-open')
    fireEvent.click(screen.getByRole('button', { name: 'Close details' }))
    expect(detailPanel.className).not.toContain('is-mobile-open')
    const gh = screen.getByRole('link', { name: /GitHub repository mithril-lang\/mithril-twin/ })
    expect(gh.getAttribute('href')).toBe('https://github.com/mithril-lang/mithril-twin')
    expect(gh.closest('.make-top-actions')).toBeTruthy()
    // 300 subsidiary tiles, never one DOM node per person or device.
    expect(document.querySelectorAll('[data-tile-kind="company"]')).toHaveLength(300)
    expect(document.querySelectorAll('[data-scale-tile]').length).toBeLessThan(500)
    expect(screen.getByLabelText('Dataset counts').textContent).toMatch(/50,000/)
    // Generated in the browser: nothing is fetched for the pack.
    expect(fetchMock).not.toHaveBeenCalled()

    fireEvent.click(document.querySelector('[data-scale-tile="b:s002"]')!)
    await waitFor(() => expect(app().getAttribute('data-scale-level')).toBe('company'))
    // Network lens at company level: zones plus zone→zone reach edges.
    const lensGroup = screen.getByRole('group', { name: 'Lens' })
    fireEvent.click(lensGroup.querySelector('button:nth-child(2)')!)
    expect(app().getAttribute('data-lens')).toBe('network')
    expect(Number(document.querySelector('[data-reach-links]')?.getAttribute('data-reach-links'))).toBeGreaterThan(5)
    expect(document.querySelector('[data-reach="blocked"]')).toBeTruthy()
    fireEvent.click(lensGroup.querySelector('button:nth-child(1)')!)
    expect(fetchMock).not.toHaveBeenCalled()
    const dept = document.querySelector('[data-tile-kind="department"]')!
    fireEvent.click(dept)
    await waitFor(() => expect(app().getAttribute('data-scale-level')).toBe('department'))
    expect(document.querySelectorAll('[data-tile-kind="team"]').length).toBeGreaterThan(0)
    expect(document.querySelectorAll('canvas.scale-canvas').length).toBeGreaterThan(0)
    fireEvent.click(document.querySelector('[data-tile-kind="team"]')!)
    await waitFor(() => expect(app().getAttribute('data-scale-level')).toBe('team'))
    expect(document.querySelector('[data-vlist-rows]')).toBeTruthy()

    const lens = screen.getByRole('group', { name: 'Lens' })
    fireEvent.click(lens.querySelector('button:nth-child(4)')!)
    expect(app().getAttribute('data-lens')).toBe('impersonation')
    expect(screen.getByRole('table', { name: 'Roles ranked by exposure' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '北極星 Group' }))
    await waitFor(() => expect(app().getAttribute('data-scale-level')).toBe('group'))
    expect(document.querySelector('[data-lens-panel="impersonation"]')?.textContent).toMatch(/unverified of [\d,]+ paths/)
    fireEvent.click(lens.querySelector('button:nth-child(5)')!)
    expect(document.querySelectorAll('[data-tile-kind="shadow"]').length).toBeGreaterThan(50)
  })
})

describe('.mith import and export', () => {
  it('imports a local .mith from the picker and from a drop, then round-trips export', async () => {
    render(<TwinHome />)
    await waitFor(() => expect(screen.getByRole('heading', { name: '北極星 FI' })).toBeTruthy())
    expect(screen.queryByRole('button', { name: 'Import JSON' })).toBeNull()

    const custom = {
      ...tinyMith,
      title: 'Imported Floor',
      id: 'imported-floor',
      dataset_kind: 'workshop-export',
    }
    const file = new File([JSON.stringify(custom)], 'imported-floor.mith', {
      type: 'application/vnd.mithril.mith+json',
    })
    fireEvent.change(screen.getByLabelText('Import .mith file'), { target: { files: [file] } })
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Imported Floor' })).toBeTruthy())
    const app = () => document.querySelector('.make-app')!
    expect(app().getAttribute('data-source')).toBe('file')
    expect(app().getAttribute('data-dataset-kind')).toBe('workshop-export')
    expect(screen.getByText('workshop-export')).toBeTruthy()

    const blobs: Blob[] = []
    const createUrl = vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
      blobs.push(blob as Blob)
      return 'blob:mith'
    })
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    fireEvent.click(screen.getByRole('button', { name: 'Export' }))
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/Exported imported-floor\.mith/))
    // workshop-export is in the upstream closed datasetKind set, so export is twin Form with lens / frame.
    expect(blobs[0]?.type).toBe('application/vnd.mithril.form')
    const text = await blobs[0]!.text()
    expect(text.startsWith('(mithril/twin-document')).toBe(true)
    const round = readMith(text).doc
    expect(round.title).toBe('Imported Floor')
    expect(round.dataset_kind).toBe('workshop-export')
    expect(round.diagram.lens).toBe('layers')

    const again = new File([text], 'imported-floor.mith', { type: 'application/vnd.mithril.mith+json' })
    fireEvent.change(screen.getByLabelText('Import .mith file'), { target: { files: [again] } })
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Imported Floor' })).toBeTruthy())
    expect(app().getAttribute('data-dataset-kind')).toBe('workshop-export')

    const dropped = { ...custom, title: 'Dropped Floor' }
    fireEvent.drop(app(), {
      dataTransfer: {
        files: [new File([JSON.stringify(dropped)], 'dropped.mith', { type: 'application/vnd.mithril.mith+json' })],
        types: ['Files'],
      },
    })
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Dropped Floor' })).toBeTruthy())

    createUrl.mockRestore()
    revoke.mockRestore()
    click.mockRestore()
  })

  it('imports a Form .mith, exports upstream Form, and re-imports the export', async () => {
    render(<TwinHome />)
    await waitFor(() => expect(screen.getByLabelText('Import .mith file')).toBeTruthy())
    const title = readMith(orgMith).doc.title
    fireEvent.change(screen.getByLabelText('Import .mith file'), {
      target: { files: [new File([orgMith], 'polaris-org.mith', { type: 'application/vnd.mithril.form' })] },
    })
    await waitFor(() => expect(screen.getByRole('heading', { name: title })).toBeTruthy())
    const blobs: Blob[] = []
    const createUrl = vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
      blobs.push(blob as Blob)
      return 'blob:mith'
    })
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    fireEvent.click(screen.getByRole('button', { name: 'Export' }))
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/Mithril Form/))
    expect(blobs[0]?.type).toBe('application/vnd.mithril.form')
    const text = await blobs[0]!.text()
    expect(text.startsWith('(mithril/twin-document')).toBe(true)
    expect(readMith(text).doc.model).toEqual(readMith(orgMith).doc.model)
    fireEvent.change(screen.getByLabelText('Import .mith file'), {
      target: { files: [new File([text], 'again.mith', { type: 'application/vnd.mithril.form' })] },
    })
    await waitFor(() => expect(document.querySelector('.make-app')?.getAttribute('data-source')).toBe('file'))
    expect(screen.getByRole('heading', { name: title })).toBeTruthy()
    createUrl.mockRestore()
    revoke.mockRestore()
    click.mockRestore()
  })

  it('says so when a .mithril package has no member files', async () => {
    render(<TwinHome />)
    await waitFor(() => expect(screen.getByLabelText('Import .mith file')).toBeTruthy())
    const pack = new File(
      [JSON.stringify({
        mithril: '0.1',
        kind: 'package',
        id: 'local-pack',
        dataset_kind: 'synthetic-demo',
        documents: ['missing-member.mith'],
        attachments: [],
      })],
      'local-pack.mithril',
      { type: 'application/vnd.mithril.mithril+json' },
    )
    fireEvent.change(screen.getByLabelText('Import .mith file'), { target: { files: [pack] } })
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/missing-member\.mith/))
    expect(screen.getByRole('alert').textContent).toMatch(/were not included/)
    expect(screen.getByRole('heading', { name: '北極星 FI' })).toBeTruthy()
  })

  it('restores diagram.lens from an imported org document', async () => {
    render(<TwinHome />)
    await waitFor(() => expect(screen.getByLabelText('Import .mith file')).toBeTruthy())
    // Legacy v0 JSON still carries diagram.lens / diagram.frame (twin Form has no terms for them).
    const raw = readMithRaw(orgMith) as { diagram: Record<string, unknown> }
    const org = { ...raw, diagram: { ...raw.diagram, lens: 'shadow', frame: 'network' } }
    fireEvent.change(screen.getByLabelText('Import .mith file'), {
      target: {
        files: [new File([JSON.stringify(org)], 'polaris-org.mith', { type: 'application/vnd.mithril.mith+json' })],
      },
    })
    await waitFor(() => expect(document.querySelector('.make-app')?.getAttribute('data-lens')).toBe('shadow'))
    expect(document.querySelector('.make-app')?.getAttribute('data-frame-dim')).toBe('network')
  })
})

describe('flat board helpers', () => {
  it('keeps connectors orthogonal and labels upright chunks', () => {
    expect(orthoPath(0, 0, 40, 10)).toContain('L 20 0')
    expect(orthoPath(0, 0, 40, 10)).not.toContain('Q ')
    expect(labelLines('北極星フィナンシャル・グループ')).toHaveLength(2)
    expect(twinSymbol('fw')).toBe('firewall')
    expect(twinSymbol('server')).toBe('server')
    expect(twinSymbol('transit')).toBe('network')
    expect(twinSymbol('holding')).toBe('org')
    expect(twinSymbol('cloud')).toBe('node')
  })
})
