export type SpawnLog = { teammateAt: number | null; recent: number[] }

export const EMPTY_LOG: SpawnLog = { teammateAt: null, recent: [] }

// A teammate after this long a silence starts a new run or generation.
export const TEAM_GAP_MS = 600_000
// This many spawns inside the window count as a swarm.
export const BURST = 3
export const BURST_MS = 30_000

export function onSpawn(log: SpawnLog, at: number, isTeammate: boolean): { log: SpawnLog; shouldOpen: boolean } {
  const recent = [...log.recent.filter((t) => at - t < BURST_MS), at]
  const isNewRun = isTeammate && (log.teammateAt === null || at - log.teammateAt > TEAM_GAP_MS)
  return {
    log: { teammateAt: isTeammate ? at : log.teammateAt, recent },
    shouldOpen: isNewRun || recent.length >= BURST,
  }
}
