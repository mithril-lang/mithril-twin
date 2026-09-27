import { useState, type DragEvent } from 'react'
import { MITH_ACCEPT } from '../mith/io'

type Props = {
  onFiles: (files: File[]) => void
  onExport: () => void
  exportDisabled?: boolean
  exportTitle?: string
}

/** Import and export controls. The file input reads locally; nothing is uploaded. */
export function MithFileActions({ onFiles, onExport, exportDisabled, exportTitle }: Props) {
  return (
    <div className="make-file-actions">
      <label className="make-text-btn">
        Import
        <input
          className="mith-file-input"
          type="file"
          accept={MITH_ACCEPT}
          multiple
          aria-label="Import .mith file"
          onChange={(event) => {
            const list = [...(event.target.files ?? [])]
            event.target.value = ''
            if (list.length) onFiles(list)
          }}
        />
      </label>
      <button type="button" className="make-text-btn" onClick={onExport} disabled={exportDisabled} title={exportTitle}>
        Export
      </button>
    </div>
  )
}

function hasFiles(event: DragEvent) {
  return [...(event.dataTransfer?.types ?? [])].includes('Files')
}

/** Drag-drop onto the grid. Callers pass the handlers to the surface that should accept the file. */
export function useMithFileDrop(onFiles: (files: File[]) => void) {
  const [over, setOver] = useState(false)
  const handlers = {
    onDragEnter: (event: DragEvent) => {
      if (!hasFiles(event)) return
      event.preventDefault()
      setOver(true)
    },
    onDragOver: (event: DragEvent) => {
      if (!hasFiles(event)) return
      event.preventDefault()
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
      setOver(true)
    },
    onDragLeave: (event: DragEvent) => {
      if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
      setOver(false)
    },
    onDrop: (event: DragEvent) => {
      if (!hasFiles(event)) return
      event.preventDefault()
      setOver(false)
      const files = [...(event.dataTransfer?.files ?? [])]
      if (files.length) onFiles(files)
    },
  }
  return { over, handlers }
}
