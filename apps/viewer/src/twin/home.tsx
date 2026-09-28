import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ThemeProvider } from './themes/ThemeContext'
import type {
  AttackScenario,
  GraphItem,
  LayerData,
  SelectMode,
  TwinLayer,
  ViewMode,
} from './data/types'
import ThemeSwitcher from './components/ThemeSwitcher'
import GitHubLink from './components/GitHubLink'
import ViewToggle from './components/ViewToggle'
import ModePicker from './components/ModePicker'
import AttackScenarioPicker from './components/AttackScenarioPicker'
import Inspector from './components/Inspector'
import TopologyGraph from './components/TopologyGraph'
import GridOverview from './views/GridOverview'
import MakeGrid from './views/MakeGrid'
import ScaleGrid from './views/ScaleGrid'
import { importLocalFiles, readLocalFiles } from './mith/io'
import {
  hypothesisToScenario,
  loadSampleMith,
  mithLayerItems,
  SAMPLE_DOCS,
  sampleDocFromSearch,
} from './mith/load'
import type { MithDocument } from './mith/types'
import './design-tokens.css'
import './twin-polaris.css'

const LAYERS: { id: TwinLayer; label: string }[] = [
  { id: 'organization', label: 'Organization' },
  { id: 'network', label: 'Network' },
  { id: 'firewall', label: 'Firewall' },
  { id: 'node', label: 'Node' },
  { id: 'server', label: 'Server' },
]

function TwinApp() {
  const [view, setView] = useState<ViewMode>('make')
  const [sampleId, setSampleId] = useState(
    () => sampleDocFromSearch(typeof window === 'undefined' ? '' : window.location.search).id,
  )
  const [doc, setDoc] = useState<MithDocument | null>(null)
  const [source, setSource] = useState<'mith' | 'file'>('mith')
  const [packageId, setPackageId] = useState<string | null>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const [fileNote, setFileNote] = useState<string | null>(null)
  const [docEpoch, setDocEpoch] = useState(0)
  const loadGen = useRef(0)
  const [focusPlaneId, setFocusPlaneId] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [hypothesisId, setHypothesisId] = useState<string | null>(null)
  const [drillLayer, setDrillLayer] = useState<TwinLayer>('organization')
  const [drillData, setDrillData] = useState<LayerData | null>(null)
  const [selectMode, setSelectMode] = useState<SelectMode>('explore')
  const [selectedItem, setSelectedItem] = useState<GraphItem | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    document.title = 'Mithril Twin | twin.mithril.fund'
  }, [])

  useEffect(() => {
    const prevent = (event: DragEvent) => {
      if ([...(event.dataTransfer?.types ?? [])].includes('Files')) event.preventDefault()
    }
    window.addEventListener('dragover', prevent)
    window.addEventListener('drop', prevent)
    return () => {
      window.removeEventListener('dragover', prevent)
      window.removeEventListener('drop', prevent)
    }
  }, [])

  const applyDoc = useCallback((next: MithDocument, src: 'mith' | 'file', pkg: string | null) => {
    setDoc(next)
    setSource(src)
    setPackageId(pkg)
    setFocusPlaneId(next.diagram.camera.focusPlane)
    setSelectedId(next.diagram.selection)
    setHypothesisId(null)
    setSelectedItem(null)
    setError('')
    setDocEpoch((n) => n + 1)
  }, [])

  const sample = SAMPLE_DOCS.find((d) => d.id === sampleId) ?? SAMPLE_DOCS[0]!
  const fileOpen = fileName != null
  const isPack = !fileOpen && !!sample.pack

  const loadMith = useCallback(async () => {
    // The enterprise pack is generated inside ScaleGrid (Web Worker, seeded; chunks on drill-down).
    // A local file stays on screen until the sample picker replaces it.
    if (sample.pack || fileOpen) return
    const gen = ++loadGen.current
    setLoading(true)
    setError('')
    try {
      const loaded = await loadSampleMith(fetch, sample.url)
      if (gen !== loadGen.current) return
      setFileName(null)
      setFileNote(null)
      applyDoc(loaded.doc, 'mith', loaded.packageId)
    } catch (err) {
      if (gen !== loadGen.current) return
      setError(`Could not load .mith: ${err instanceof Error ? err.message : 'unknown'}`)
    } finally {
      if (gen === loadGen.current) setLoading(false)
    }
  }, [applyDoc, fileOpen, sample])

  useEffect(() => {
    // Load the sample once on mount. loadMith sets loading/error state by design.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadMith()
  }, [loadMith])

  const onImportFiles = useCallback(async (files: File[]) => {
    const gen = ++loadGen.current
    setError('')
    try {
      const sources = await readLocalFiles(files)
      if (gen !== loadGen.current) return
      const result = importLocalFiles(sources)
      if (!result.ok) {
        setError(result.message)
        return
      }
      setFileName(result.filename)
      setFileNote(result.note)
      setLoading(false)
      applyDoc(result.doc, 'file', result.packageId)
    } catch (err) {
      if (gen !== loadGen.current) return
      setError(err instanceof Error ? err.message : 'Could not read that file.')
    }
  }, [applyDoc])

  useEffect(() => {
    if (view !== 'drill' || !doc) return
    let cancelled = false
    async function run() {
      setLoading(true)
      setError('')
      try {
        const response = await fetch(`${import.meta.env.BASE_URL}data/layers/${drillLayer}.json`)
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const data = (await response.json()) as LayerData
        if (!cancelled) setDrillData(data)
      } catch (err) {
        if (cancelled || !doc) return
        const items = mithLayerItems(doc, drillLayer)
        setDrillData({
          layer: drillLayer,
          dataset_kind: doc.dataset_kind,
          generated_at: doc.generated_at,
          elements: items,
        })
        setError(
          items.nodes.length
            ? ''
            : `Layer JSON unavailable (${err instanceof Error ? err.message : 'unknown'}).`,
        )
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [view, drillLayer, doc])

  const org = useMemo(
    () => (doc ? mithLayerItems(doc, 'organization') : { nodes: [] as GraphItem[], edges: [] as GraphItem[] }),
    [doc],
  )

  const scenarios = useMemo(
    () => (doc?.inference.hypotheses ?? []).map(hypothesisToScenario),
    [doc],
  )
  const activeScenario: AttackScenario | null = useMemo(
    () => scenarios.find((s) => s.id === hypothesisId) ?? null,
    [scenarios, hypothesisId],
  )

  const onScenarioChange = (id: string | null) => {
    setHypothesisId(id)
    if (id) setSelectMode('attackPath')
    else if (selectMode === 'attackPath') setSelectMode('explore')
  }

  const onSelectMode = (mode: SelectMode) => {
    setSelectMode(mode)
    if (mode !== 'attackPath') setHypothesisId(null)
    else if (!hypothesisId && scenarios[0]) setHypothesisId(scenarios[0].id)
  }

  const onOpenLayer = (layer: TwinLayer) => {
    setDrillLayer(layer)
    setView('drill')
    setSelectedItem(null)
  }

  const pickSample = useCallback((id: string) => {
    setFileName(null)
    setFileNote(null)
    setSampleId(id)
    const url = new URL(window.location.href)
    url.searchParams.set('doc', id)
    window.history.replaceState(window.history.state, '', url)
  }, [])

  const personLabel = useCallback(
    (id: string) => org.nodes.find((n) => n.data.id === id)?.data.label ?? id,
    [org],
  )

  if (view === 'make' && isPack) {
    return (
      <ScaleGrid
        seed={sample.seed ?? 20260927}
        sampleId={sample.id}
        onPickSample={pickSample}
        onImportFiles={(files) => void onImportFiles(files)}
      />
    )
  }

  if (view === 'make') {
    return (
      <MakeGrid
        doc={doc}
        loading={loading}
        error={error}
        source={source}
        packageId={packageId}
        sampleId={sampleId}
        onPickSample={pickSample}
        focusPlaneId={focusPlaneId}
        selectedId={selectedId}
        hypothesisId={hypothesisId}
        onFocusPlane={setFocusPlaneId}
        onSelect={setSelectedId}
        onHypothesis={setHypothesisId}
        onOpenLayer={onOpenLayer}
        onOpenBoard={() => setView('board')}
        fileName={fileName}
        fileNote={fileNote}
        docEpoch={docEpoch}
        onImportFiles={(files) => void onImportFiles(files)}
      />
    )
  }

  const layerLabel = LAYERS.find((l) => l.id === drillLayer)?.label ?? drillLayer

  return (
    <main className="twin-polaris app-shell">
      <header className="header">
        <div>
          <div className="eyebrow">Topology twin</div>
          <h1>{doc?.title ?? '北極星 FI'}</h1>
          <p className="subtitle">
            {view === 'board'
              ? 'Secondary flat board for the same synthetic-demo model.'
              : `${layerLabel} drill-in. Grid remains the main overview.`}
          </p>
        </div>
        <div className="badges">
          <span className="badge">{doc?.dataset_kind ?? 'synthetic-demo'}</span>
          <span className="badge warn">non-prod</span>
          <span className="badge">no-runners</span>
          <GitHubLink className="badge" />
        </div>
      </header>

      <div className="chrome-bar">
        <ThemeSwitcher />
        <ViewToggle view={view} onChange={setView} />
        <ModePicker mode={selectMode} onChange={onSelectMode} />
      </div>

      {(selectMode === 'attackPath' || hypothesisId) && (
        <div className="chrome-bar attack-chrome">
          <AttackScenarioPicker
            scenarios={scenarios}
            activeId={hypothesisId}
            onChange={onScenarioChange}
            disabled={!doc}
          />
        </div>
      )}

      {view === 'drill' && (
        <nav className="tabs" aria-label="Topology layers">
          {LAYERS.map((layer) => (
            <button
              key={layer.id}
              type="button"
              className={`tab ${drillLayer === layer.id ? 'active' : ''}`}
              onClick={() => setDrillLayer(layer.id)}
            >
              {layer.label}
            </button>
          ))}
        </nav>
      )}

      <section className="workspace">
        <div className="card graph-card">
          <div className="graph-toolbar">
            <span className="layer-name">
              {view === 'board' && 'Board · flat zones'}
              {view === 'drill' && `${layerLabel} · drill-in`}
            </span>
            <span className="meta">
              {loading && 'loading…'}
              {!loading && view === 'board' && `${org.nodes.length} org nodes`}
              {!loading && view === 'drill' && drillData &&
                `${drillData.elements.nodes.length} nodes · ${drillData.elements.edges.length} edges`}
              {activeScenario && ` · path: ${activeScenario.label}`}
            </span>
          </div>

          {error && <div className="error">{error}</div>}

          {!error && view === 'board' && doc && (
            <GridOverview
              orgNodes={org.nodes}
              orgEdges={org.edges}
              selectMode={selectMode}
              selectedId={selectedItem?.data.id ?? null}
              onSelect={setSelectedItem}
              onOpenBoard={() => onOpenLayer('organization')}
              attackScenario={activeScenario}
            />
          )}

          {!error && view === 'drill' && drillData && (
            <TopologyGraph
              elements={drillData.elements}
              selectMode={selectMode}
              onSelect={setSelectedItem}
              attackScenario={activeScenario}
            />
          )}
        </div>

        <Inspector
          selected={selectedItem}
          attackScenario={activeScenario}
          personLabel={personLabel}
        />
      </section>

      <footer className="footer">
        Fictional institution. Local synthetic-demo content. Attack paths are hypothesis overlays
        (observation_count=0), visualization only.
      </footer>
    </main>
  )
}

/** Viewer root: Polaris synthetic-demo twin. */
export function TwinHome() {
  return (
    <ThemeProvider>
      <TwinApp />
    </ThemeProvider>
  )
}
