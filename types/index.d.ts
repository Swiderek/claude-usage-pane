/** `eff` is everything; `subEff` the part its sessions' agents used. */
export type UsageProject = { label: string; path: string; eff: number; subEff: number }

export type UsageSession = {
  title: string
  project: string
  eff: number
  subEff: number
  agents: number
}

/**
 * What scripts/usage.py prints: effective tokens (each kind weighted by its
 * cost against a plain input token) counted since `since`.
 */
export type UsageReport = {
  since: string
  isRolling: boolean
  generatedAt: number
  total: number
  subTotal: number
  sessions: number
  agents: number
  sessionsWithAgents: number
  projects: UsageProject[]
  topSessions: UsageSession[]
  models: { model: string; eff: number }[]
}

/** One rate-limit window as the engine reports it (`five_hour`, `seven_day`). */
export type Limit = { kind: string; percentUsed: number; resetsAt?: string }

export type RefreshStatus = { isLoading: boolean; error?: string }

declare module 'claude-code' {
  interface PluginState {
    'usage-pane': {
      report: Shaped<UsageReport | null>
      limits: Shaped<Limit[]>
      status: Shaped<RefreshStatus>
    }
  }
}
