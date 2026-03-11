import { useMemo, useState } from 'react'

import type {
  AdjudicationActionType,
  AdjudicationCase,
  SpecialistKind,
} from '@renderer/agent/types/taskExecution'

interface ResolveAdjudicationInput {
  action: AdjudicationActionType
  selectedFiles?: string[]
  targetSpecialist?: SpecialistKind
}

interface AdjudicationPanelProps {
  adjudicationCase?: AdjudicationCase | null
  availableSpecialists?: SpecialistKind[]
  onResolve?: (resolution: ResolveAdjudicationInput) => void
}

const FALLBACK_SPECIALISTS: SpecialistKind[] = ['frontend', 'logic', 'verifier', 'reviewer']

export function AdjudicationPanel({ adjudicationCase, availableSpecialists, onResolve }: AdjudicationPanelProps) {
  const selectableSpecialists = useMemo(
    () => (availableSpecialists && availableSpecialists.length > 0 ? availableSpecialists : FALLBACK_SPECIALISTS),
    [availableSpecialists],
  )
  const [selectedFiles, setSelectedFiles] = useState<string[]>([])
  const [targetSpecialist, setTargetSpecialist] = useState<SpecialistKind>(selectableSpecialists[0] || 'logic')

  if (!adjudicationCase) {
    return null
  }

  const toggleFile = (file: string) => {
    setSelectedFiles((current) => current.includes(file)
      ? current.filter((item) => item !== file)
      : [...current, file])
  }

  const resolvedSummary = adjudicationCase.resolution
    ? `Resolved via ${adjudicationCase.resolution.action}`
    : null

  return (
    <aside className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 space-y-4">
      <div>
        <div className="text-xs uppercase tracking-wide text-text-muted">Adjudication</div>
        <h3 className="text-sm font-semibold text-text-primary mt-1">{adjudicationCase.reason}</h3>
      </div>

      <div className="text-xs text-text-secondary">Recommended action: <span className="text-text-primary">{adjudicationCase.recommendedAction}</span></div>

      {resolvedSummary ? (
        <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-2 text-xs text-emerald-200">
          {resolvedSummary}
        </div>
      ) : null}

      {adjudicationCase.changedFiles.length > 0 ? (
        <div className="space-y-2">
          <div className="text-xs uppercase tracking-wide text-text-muted">Changed Files</div>
          <ul className="space-y-1 text-xs text-text-primary">
            {adjudicationCase.changedFiles.map((file) => (
              <li key={file} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={selectedFiles.includes(file)}
                  onChange={() => toggleFile(file)}
                    />
                <span>{file}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="text-xs text-text-muted">No file list attached.</div>
      )}

      {adjudicationCase.status === 'open' ? (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => onResolve?.({ action: 'accept-all' })} disabled={!onResolve} className="rounded-lg border border-border px-3 py-1.5 text-xs text-text-primary disabled:opacity-50">Accept all</button>
            <button type="button" onClick={() => onResolve?.({ action: 'accept-partial', selectedFiles })} disabled={!onResolve || selectedFiles.length === 0} className="rounded-lg border border-border px-3 py-1.5 text-xs text-text-primary disabled:opacity-50">Accept selected</button>
            <button type="button" onClick={() => onResolve?.({ action: 'return-for-rework' })} disabled={!onResolve} className="rounded-lg border border-border px-3 py-1.5 text-xs text-text-primary disabled:opacity-50">Return for rework</button>
            <button type="button" onClick={() => onResolve?.({ action: 'require-verification' })} disabled={!onResolve} className="rounded-lg border border-border px-3 py-1.5 text-xs text-text-primary disabled:opacity-50">Require verification</button>
            <button type="button" onClick={() => onResolve?.({ action: 'rollback' })} disabled={!onResolve} className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-1.5 text-xs text-red-200 disabled:opacity-50">Rollback</button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select
              value={targetSpecialist}
              onChange={(event) => setTargetSpecialist(event.target.value as SpecialistKind)}
              className="rounded-lg border border-border bg-background/50 px-2 py-1.5 text-xs text-text-primary"
            >
              {selectableSpecialists.map((specialist) => (
                <option key={specialist} value={specialist}>{specialist}</option>
              ))}
            </select>
            <button type="button" onClick={() => onResolve?.({ action: 'reassign-specialist', targetSpecialist })} disabled={!onResolve} className="rounded-lg border border-border px-3 py-1.5 text-xs text-text-primary disabled:opacity-50">Reassign</button>
          </div>
        </div>
      ) : null}
    </aside>
  )
}

export default AdjudicationPanel
