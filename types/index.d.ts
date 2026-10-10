// Placeholder state shapes; later tasks replace them with the real ones.
export type RunState = { percent: number }
export type ContextState = { percent: number }
export type AgentState = { running: number }
export type ModelState = { names: string[] }
export type UiState = { open: boolean }

declare module 'claude-code' {
  interface PluginState {
    supermod: {
      run: RunState | null
      context: ContextState
      agents: AgentState
      models: ModelState
      ui: UiState
    }
  }
}
