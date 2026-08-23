import { describe, expect, it } from 'vitest';
import { TeamNotificationKind, type GameEvent, type Team } from '@squirrel-heist/shared';
import { teamToastMessage } from '../src/ui/teamToast.js';

const notification = (kind: typeof TeamNotificationKind[keyof typeof TeamNotificationKind], recipientTeam: Team): GameEvent => ({
  eventId: `toast-${kind}`, type: 'TEAM_NOTIFICATION', tick: 1, payload: { kind, recipientTeam, actorId: 'actor' }
});

describe('team tactical toast text', () => {
  it('maps all four authoritative notifications to Korean HUD text', () => {
    expect(teamToastMessage(notification(TeamNotificationKind.THIEF_ARRESTED, 'POLICE'), 'POLICE')).toContain('감옥');
    expect(teamToastMessage(notification(TeamNotificationKind.ACORN_SECURED, 'THIEF'), 'THIEF')).toContain('기지');
    expect(teamToastMessage(notification(TeamNotificationKind.POLICE_ACORN_STOLEN, 'POLICE'), 'POLICE')).toContain('도토리');
    expect(teamToastMessage(notification(TeamNotificationKind.POLICE_CARRIED_ACORN_STOLEN, 'POLICE'), 'POLICE')).toContain('빼앗');
    expect(teamToastMessage(notification(TeamNotificationKind.THIEF_ESCAPED, 'POLICE'), 'POLICE')).toContain('탈출');
  });

  it('does not render a notification for another team or an ordinary event', () => {
    expect(teamToastMessage(notification(TeamNotificationKind.ACORN_SECURED, 'THIEF'), 'POLICE')).toBeNull();
    expect(teamToastMessage({ eventId: 'ordinary', type: 'ACORN_SECURED', tick: 1, payload: {} }, 'THIEF')).toBeNull();
  });
});
