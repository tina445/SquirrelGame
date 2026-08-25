export type Brand<T, Name extends string> = T & { readonly __brand: Name };
export type PlayerId = Brand<string, 'PlayerId'>;
export type AcornId = Brand<string, 'AcornId'>;
export type BerryId = Brand<string, 'BerryId'>;
export type ThunderEffectId = Brand<string, 'ThunderEffectId'>;
export type StorageId = Brand<string, 'StorageId'>;

export type Team = 'POLICE' | 'THIEF';
export type RolePreference = Team | 'RANDOM';
export type JoinRoomMode = 'QUICK_MATCH' | 'CREATE_ROOM' | 'JOIN_ROOM';
export type LobbyKind = 'QUICK_MATCH' | 'FRIEND_ROOM';
export type MapLayoutKind = 'LINE' | 'H' | 'RING' | 'GRAPH' | 'CROSS' | 'DIAMOND' | 'COURTYARD';
export type MatchPhase = 'LOBBY' | 'GENERATING' | 'COUNTDOWN' | 'PLAYING' | 'FINISHED' | 'CLOSED';
export type MatchEndReason = 'THIEF_SECURED_ALL' | 'ALL_THIEVES_JAILED' | 'TIME_EXPIRED';
export type PlayerMode = 'NORMAL' | 'CHARGING' | 'STUNNED' | 'JAILED';
export type PlayerControl = 'HUMAN' | 'BOT';

/** 서버가 특정 팀의 연결에만 전달하는 전술 알림의 종류다. */
export const TeamNotificationKind = {
  THIEF_ARRESTED: 'THIEF_ARRESTED',
  ACORN_SECURED: 'ACORN_SECURED',
  POLICE_ACORN_STOLEN: 'POLICE_ACORN_STOLEN',
  POLICE_CARRIED_ACORN_STOLEN: 'POLICE_CARRIED_ACORN_STOLEN',
  THIEF_ESCAPED: 'THIEF_ESCAPED'
} as const;
export type TeamNotificationKind = typeof TeamNotificationKind[keyof typeof TeamNotificationKind];

export interface Vec2 { x: number; y: number }
export interface Aabb { min: Vec2; max: Vec2 }
export interface ZoneDefinition { id: string; center: Vec2; radius: number }
export interface StorageDefinition extends ZoneDefinition { id: StorageId; slotPositions: Vec2[] }
export interface JailDefinition extends ZoneDefinition { slots: Vec2[]; escapePoints: Vec2[] }
export interface PathMetadata { from: string; to: string; points: Vec2[]; length: number }
/** 생성기가 주요 거점 사이 route에서 파생한 순수 표현용 흙길 polyline이다. */
export interface DirtPathDefinition { id: string; points: Vec2[]; width: number }
export interface TreeDefinition { id: string; center: Vec2; trunkRadius: number; canopyRadius: number }
/** 독립된 원형 장애물은 렌더러 장식과 서버·예측 충돌/시야 차단에 같은 중심·반지름을 사용한다. */
export interface RockPileDefinition { id: string; center: Vec2; radius: number }
export interface BushDefinition { id: string; center: Vec2; radius: number }

export interface MapDefinition {
  id: string;
  seed: string;
  generatorVersion: number;
  balanceVersion: number;
  layoutKind: MapLayoutKind;
  width: number;
  height: number;
  bounds: Aabb;
  playableArea: Vec2[];
  playableHoles: Vec2[][];
  teamSpawns: Record<Team, Vec2[]>;
  thiefBase: ZoneDefinition;
  jail: JailDefinition;
  storages: StorageDefinition[];
  staticColliders: Aabb[];
  occluders: Aabb[];
  trees: TreeDefinition[];
  rockPiles: RockPileDefinition[];
  bushes: BushDefinition[];
  paths: PathMetadata[];
  dirtPaths: DirtPathDefinition[];
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
  control: PlayerControl;
  team: Team | null;
  rolePreference: RolePreference | null;
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
  assetsReady: boolean;
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
export interface ThunderEffectState {
  id: ThunderEffectId;
  ownerId: PlayerId;
  team: Team;
  start: Vec2;
  end: Vec2;
  spawnedAtTick: number;
  expiresAtMs: number;
  hitPlayerId: PlayerId | null;
}

export interface GameEvent { eventId: string; type: string; tick: number; payload: Record<string, unknown> }
export type PlayerSnapshot = Omit<PlayerState, 'connectionId' | 'reconnectToken' | 'lastValidInput' | 'control'>;
export interface WorldSnapshot {
  serverTick: number;
  serverTimeMs: number;
  phase: MatchPhase;
  remainingMs: number;
  hostPlayerId: PlayerId | null;
  players: PlayerSnapshot[];
  acorns: AcornState[];
  berries: BerryState[];
  thunderEffects: ThunderEffectState[];
  interactions: Array<{ playerId: PlayerId; state: InteractionState }>;
  thiefSecuredCount: number;
  stateHash?: string;
}
