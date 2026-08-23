import { describe, expect, it } from 'vitest';
import { clientKeyFor, isMetricsAuthorized } from '../src/gateway/webSocketGateway.js';
import { JoinRateLimiter, publicAccessPolicy } from '../src/gateway/publicAccessPolicy.js';
import type { IncomingMessage } from 'node:http';

describe('public test access policy', () => {
  it('reads explicit public capacity and proxy settings without changing local defaults', () => {
    expect(publicAccessPolicy({ MAX_PUBLIC_PLAYERS: '24', JOIN_ATTEMPTS_PER_MINUTE: '6', METRICS_TOKEN: 'token', TRUST_PROXY: 'true' })).toMatchObject({
      maxPlayers: 24, joinAttemptsPerMinute: 6, metricsToken: 'token', trustProxy: true
    });
    expect(publicAccessPolicy({}).maxPlayers).toBe(Number.POSITIVE_INFINITY);
  });

  it('limits new joins in a one-minute sliding window and permits a later retry', () => {
    const limiter = new JoinRateLimiter(2);
    expect(limiter.allow('client', 0)).toBe(true);
    expect(limiter.allow('client', 1)).toBe(true);
    expect(limiter.allow('client', 2)).toBe(false);
    expect(limiter.allow('client', 60_001)).toBe(true);
  });

  it('uses a Cloud Run forwarded client key only when proxy trust is enabled', () => {
    const request = { headers: { 'x-forwarded-for': '203.0.113.12, 10.0.0.1' }, socket: { remoteAddress: '10.0.0.2' } } as unknown as IncomingMessage;
    expect(clientKeyFor(request, true)).toBe('forwarded:203.0.113.12');
    expect(clientKeyFor(request, false)).toBe('socket:10.0.0.2');
  });

  it('requires the configured bearer token for public metrics', () => {
    expect(isMetricsAuthorized(undefined, 'secret')).toBe(false);
    expect(isMetricsAuthorized('Bearer wrong', 'secret')).toBe(false);
    expect(isMetricsAuthorized('Bearer secret', 'secret')).toBe(true);
    expect(isMetricsAuthorized(undefined, null)).toBe(true);
  });
});
