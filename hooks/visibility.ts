// When the band shows (spec §4.1). Pure; the band and the timers share it.

import type { ContextState, RunState, UiOptions, UiState } from '../types'

export type VisibilityState = { run: RunState; context: ContextState; ui: Pick<UiState, 'isHidden'> }

/** A Superpowers skill was seen this session, or a path was referenced and a run found. */
export function isRunActive(run: RunState): boolean {
  return run.skillsSeen.some(s => s.startsWith('superpowers:')) || (run.referenced.length > 0 && run.files !== null)
}

/** The band shows while a run is active or the main context is at the warning threshold, unless hidden. */
export function isBandVisible(state: VisibilityState, options: Pick<UiOptions, 'warnPercent'>): boolean {
  if (state.ui.isHidden) return false
  const last = state.context.ring[state.context.ring.length - 1]
  const isHigh = last !== undefined && last.percent !== null && last.percent >= options.warnPercent
  return isRunActive(state.run) || isHigh
}
