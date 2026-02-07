/**
 * 情绪趋势拐点：从 history 推断「连续长时间某状态」「Flow/专注被打断」等
 */

import type { EmotionState, EmotionHistory } from '../types/emotion'

export type InflectionPoint =
  | { type: 'prolonged'; timestamp: number; state: EmotionState; durationMin: number }
  | { type: 'interrupted'; timestamp: number; fromState: EmotionState; toState: EmotionState }
  | { type: 'intervention'; timestamp: number }

const PROLONGED_THRESHOLD_MS = 12 * 60 * 1000
const FLOW_STATES: EmotionState[] = ['flow', 'focused']
const NEGATIVE_STATES: EmotionState[] = ['frustrated', 'stressed', 'tired']

export function computeInflectionPoints(history: EmotionHistory[]): InflectionPoint[] {
  if (history.length < 2) return []
  const points: InflectionPoint[] = []
  const sorted = [...history].sort((a, b) => a.timestamp - b.timestamp)

  let runStart = sorted[0].timestamp
  let runState = sorted[0].state
  for (let i = 1; i < sorted.length; i++) {
    const h = sorted[i]
    if (h.state === runState) {
      const duration = h.timestamp - runStart
      if (duration >= PROLONGED_THRESHOLD_MS) {
        const durationMin = Math.round(duration / 60000)
        points.push({ type: 'prolonged', timestamp: runStart + duration / 2, state: runState, durationMin })
        runStart = h.timestamp
      }
    } else {
      runStart = h.timestamp
      runState = h.state
    }
  }

  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]
    const curr = sorted[i]
    if (FLOW_STATES.includes(prev.state) && NEGATIVE_STATES.includes(curr.state)) {
      points.push({ type: 'interrupted', timestamp: curr.timestamp, fromState: prev.state, toState: curr.state })
    }
  }

  return points
}
