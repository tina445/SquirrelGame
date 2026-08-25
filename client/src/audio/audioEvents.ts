import type { GameEvent, PlayerId, Team } from '@squirrel-heist/shared';

export type SoundEffect =
  | 'uiClick' | 'berryPickup' | 'acornPickup' | 'acornDrop' | 'acornReturned' | 'acornSecured' | 'acornStolen'
  | 'thunderChargeStart' | 'thunderChargeStop' | 'thunderFire' | 'thunderHit' | 'thunderWall'
  | 'arrest' | 'rescue' | 'victory' | 'defeat';

function isLocalPlayer(payload: Record<string, unknown>, field: string, localId: PlayerId | null): boolean {
  return localId !== null && payload[field] === localId;
}

/** 권위 event를 소리 종류로 축약하고, 반복이 잦은 개인 보상음은 로컬 당사자에게만 허용한다. */
export function soundEffectForGameEvent(event: GameEvent, localId: PlayerId | null, localTeam: Team | null): SoundEffect | null {
  switch (event.type) {
    case 'BERRY_PICKED_UP': return isLocalPlayer(event.payload, 'playerId', localId) ? 'berryPickup' : null;
    case 'ACORN_PICKED_UP': return isLocalPlayer(event.payload, 'playerId', localId) ? 'acornPickup' : null;
    case 'ACORN_DROPPED': return isLocalPlayer(event.payload, 'playerId', localId) ? 'acornDrop' : null;
    case 'ACORN_RETURNED': return isLocalPlayer(event.payload, 'playerId', localId) ? 'acornReturned' : null;
    case 'ACORN_SECURED': return isLocalPlayer(event.payload, 'playerId', localId) ? 'acornSecured' : null;
    case 'ACORN_STOLEN': return isLocalPlayer(event.payload, 'playerId', localId) || isLocalPlayer(event.payload, 'targetId', localId) ? 'acornStolen' : null;
    case 'THUNDER_CHARGE_STARTED': return isLocalPlayer(event.payload, 'playerId', localId) ? 'thunderChargeStart' : null;
    case 'THUNDER_CHARGE_CANCELLED': return isLocalPlayer(event.payload, 'playerId', localId) ? 'thunderChargeStop' : null;
    case 'THUNDER_FIRED': return isLocalPlayer(event.payload, 'playerId', localId) ? 'thunderFire' : null;
    case 'THUNDER_HIT': return 'thunderHit';
    case 'THUNDER_HIT_WALL': return 'thunderWall';
    case 'ARREST_COMPLETED': return 'arrest';
    case 'RESCUE_COMPLETED': return 'rescue';
    case 'MATCH_FINISHED':
      return localTeam !== null && event.payload.winner === localTeam ? 'victory' : localTeam !== null ? 'defeat' : null;
    default: return null;
  }
}
