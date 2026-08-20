export const gameBalance = {
  matchDurationMs: 360_000,
  teamSize: 4,
  storageCount: 3,
  acornsPerStorage: 3,
  maxCarryAcorns: 1,
  carrySpeedMultiplier: 0.85,
  arrestHoldMs: 600,
  rescueHoldMs: 3_000,
  rescueArrestImmunityMs: 1_000,
  allJailedConfirmMs: 1_000,
  thunderStunMs: 1_500,
  maxActiveBerries: 2,
  berrySpawnMinMs: 15_000,
  berrySpawnMaxMs: 25_000,
  serverTickRate: 20,
  snapshotRate: 20,
  mapWidth: 64,
  mapHeight: 48,
  playerSpeed: 7,
  playerRadius: 0.45,
  interactionRadius: 1.25,
  berryPickupRadius: 0.75,
  projectileSpeed: 18,
  projectileRange: 15,
  projectileRadius: 0.16,
  interpolationDelayMs: 100,
  reconnectGraceMs: 10_000,
  maxMessageBytes: 8_192,
  maxInputsPerSecond: 60
} as const;

export const totalAcorns = gameBalance.storageCount * gameBalance.acornsPerStorage;
export const fixedDeltaMs = 1_000 / gameBalance.serverTickRate;
