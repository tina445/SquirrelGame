import { describe, expect, it } from 'vitest';
import { generateGuestName, guestNameStorageKey, saveSessionDisplayName, sessionDisplayName } from '../src/ui/guestName.js';

const fakeCrypto = (value: number): Pick<Crypto, 'getRandomValues'> => ({
  getRandomValues: <T extends ArrayBufferView | null>(array: T): T => {
    (array as Uint32Array)[0] = value;
    return array;
  }
});

describe('guest session display names', () => {
  it('generates a four-digit squirrel name including leading zeroes', () => {
    expect(generateGuestName(fakeCrypto(7))).toBe('다람쥐0007');
    expect(generateGuestName(fakeCrypto(10_042))).toBe('다람쥐0042');
  });

  it('reuses and updates only the current session value', () => {
    const values = new Map<string, string>();
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
    values.set(guestNameStorageKey, '다람쥐1234');
    expect(sessionDisplayName(storage)).toBe('다람쥐1234');
    saveSessionDisplayName('밤톨', storage);
    expect(values.get(guestNameStorageKey)).toBe('밤톨');
  });
});
