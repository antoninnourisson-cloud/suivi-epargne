import { describe, it, expect } from 'vitest';
import { readWriteStamp, withWriteStamp, describeDevice, stampDevice, stampIsFromDevice } from './writeStamp';
import { canonicalize, migrate } from './schema';

const NOW = Date.parse('2026-10-14T09:30:00Z');

describe('signature d’écriture', () => {
  it('posée à l’écriture, retirée par migrate : elle ne change jamais la comparaison', () => {
    const data = { accounts: [], config: {} };
    const stamped = withWriteStamp(data, { at: '2026-10-14T09:30:00.000Z', device: 'Mac (Safari)', deviceId: 'abc' });
    expect(readWriteStamp(stamped)).toEqual({ at: '2026-10-14T09:30:00.000Z', device: 'Mac (Safari)', deviceId: 'abc' });
    expect((migrate(stamped) as unknown as Record<string, unknown>).lastWrite).toBeUndefined();
    expect(canonicalize(stamped)).toBe(canonicalize(data));
  });

  it('signature absente ou abîmée : null', () => {
    expect(readWriteStamp(null)).toBeNull();
    expect(readWriteStamp({ lastWrite: 'x' })).toBeNull();
    expect(readWriteStamp({ lastWrite: { at: 'pas une date' } })).toBeNull();
    expect(readWriteStamp({ lastWrite: { at: '2026-10-14T09:30:00Z', device: 42 } })).toEqual({ at: '2026-10-14T09:30:00Z', device: undefined, deviceId: undefined });
  });

  it('type d’appareil en clair', () => {
    expect(describeDevice('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36')).toBe('téléphone Android (Chrome)');
    expect(describeDevice('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1')).toBe('iPhone (Safari)');
    expect(describeDevice('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36 Edg/129.0')).toBe('ordinateur Windows (Edge)');
    expect(describeDevice('Mozilla/5.0 (Macintosh; Intel Mac OS X 14.5; rv:131.0) Gecko/20100101 Firefox/131.0')).toBe('Mac (Firefox)');
    expect(describeDevice('')).toBe('appareil');
  });

  it("l'appareil n'est affiché que si la signature date bien de cette écriture", () => {
    const stamp = { at: '2026-10-14T09:25:00Z', device: 'Mac (Safari)', deviceId: 'abc' };
    expect(stampDevice(stamp, '2026-10-14T09:25:02Z', NOW)).toBe('Mac (Safari)');
    // Recopiée telle quelle par une ancienne version de l'app, une heure plus tard : douteuse.
    expect(stampDevice(stamp, '2026-10-14T10:25:00Z', NOW)).toBeNull();
    // Date de Drive inconnue : comparée à maintenant.
    expect(stampDevice(stamp, null, NOW)).toBe('Mac (Safari)');
    expect(stampDevice({ at: stamp.at }, null, NOW)).toBeNull();
    expect(stampDevice(null, null, NOW)).toBeNull();
  });

  it('reconnaît une écriture de cet appareil', () => {
    const stamp = { at: '2026-10-14T09:25:00Z', device: 'Mac (Safari)', deviceId: 'abc' };
    expect(stampIsFromDevice(stamp, 'abc', null, NOW)).toBe(true);
    expect(stampIsFromDevice(stamp, 'autre', null, NOW)).toBe(false);
    expect(stampIsFromDevice(stamp, 'abc', '2026-10-15T09:25:00Z', NOW)).toBe(false);
  });
});
