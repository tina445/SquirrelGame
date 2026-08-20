export type Brand<T, Name extends string> = T & { readonly __brand: Name };
export type PlayerId = Brand<string, 'PlayerId'>;
export type AcornId = Brand<string, 'AcornId'>;
export type BerryId = Brand<string, 'BerryId'>;
export type ProjectileId = Brand<string, 'ProjectileId'>;
export type StorageId = Brand<string, 'StorageId'>;

export type Team = 'POLICE' | 'THIEF';
export type MatchPhase = 'LOBBY' | 'GENERATING' | 'COUNTDOWN' | 'PLAYING' | 'FINISHED' | 'CLOSED';
export type MatchEndReason = 'THIEF_SECURED_ALL' | 'ALL_THIEVES_JAILED' | 'TIME_EXPIRED';
export type PlayerMode = 'NORMAL' | 'STUNNED' | 'JAILED';

export interface Vec2 { x: number; y: number }
export interface Aabb { min: Vec2; max: Vec2 }
export interface ZoneDefinition { id: string; center: Vec2; radius: number }
export interface StorageDefinition extends ZoneDefinition { id: StorageId; slotPositions: Vec2[] }
export interface JailDefinition extends ZoneDefinition { slots: Vec2[]; escapePoints: Vec2[] }
export interface PathMetadata { from: string; to: string; points: Vec2[]; length: number }

export interface MapDefinition {
  id: string;
  seed: string;
  generatorVersion: number;
  balanceVersion: number;
  width: number;
  height: number;
  bounds: Aabb;
  teamSpawns: Record<Team, Vec2[]>;
  thiefBase: ZoneDefinition;
  jail: JailDefinition;
  storages: StorageDefinition[];
  staticColliders: Aabb[];
  occluders: Aabb[];
  paths: PathMetadata[];
  berrySpawnPoints: Vec2[];
  decorativeSockets: Vec2[];
  hash: string;
}

export interface InputCommand {
  sequence: number;
  clientTick: number;
  moveX: number;
  moveY: number;
  aimX: number;
  aimY: number;
  buttons: number;
}

export const InputButton = { INTERACT: 1, ACORN: 2, FIRE: 4 } as const;

export interface PlayerState {
  id: PlayerId;
  connectionId: string | null;
  reconnectToken: string;
  displayName: string;
  team: Team;
  position: Vec2;
  velocity: Vec2;
  facing: Vec2;
  mode: PlayerMode;
  heldAcornId: AcornId | null;
  hasThunder: boolean;
  stunUntilMs: number;
  arrestImmuneUntilMs: number;
  jailedAtMs: number | null;
  disconnectedAtMs: number | null;
  ready: boolean;
  lastProcessedInputSequence: number;
  lastValidInput: InputCommand;
}

export type InteractionState =
  | { kind: 'NONE' }
  | { kind: 'ARREST' | 'RESCUE'; actorId: PlayerId; targetId: PlayerId; startedAtTick: number; progressMs: number };

export type AcornLocation =
  | { kind: 'POLICE_STORAGE'; storageId: StorageId; slot: number }
  | { kind: 'GROUND'; position: Vec2 }
  | { kind: 'CARRIED'; carrierId: PlayerId }
  | { kind: 'SECURED'; slot: number };

export interface AcornState { id: AcornId; location: AcornLocation }
export interface BerryState { id: BerryId; position: Vec2; spawnedAtTick: number }
export interface ThunderProjectileState {
  id: ProjectileId;
  ownerId: PlayerId;
  team: Team;
  position: Vec2;
  direction: Vec2;
  remainingRange: number;
  spawnedAtTick: number;
}

export interface GameEvent { eventId: string; type: string; tick: number; payload: Record<string, unknown> }
export type PlayerSnapshot = Omit<PlayerState, 'reconnectToken' | 'lastValidInput'>;
export interface WorldSnapshot {
  serverTick: number;
  serverTimeMs: number;
  ackInputSequence: number;
  phase: MatchPhase;
  remainingMs: number;
  players: PlayerSnapshot[];
  acorns: AcornState[];
  berries: BerryState[];
  projectiles: ThunderProjectileState[];
  interactions: Array<{ playerId: PlayerId; state: InteractionState }>;
  thiefSecuredCount: number;
  stateHash?: string;
}
