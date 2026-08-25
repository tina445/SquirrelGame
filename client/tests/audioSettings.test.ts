import { describe, expect, it } from 'vitest';
import { audioSettingsStorageKey, defaultAudioSettings, loadAudioSettings, normalizeAudioSettings, saveAudioSettings } from '../src/audio/audioSettings.js';

function memoryStorage(initial: string | null = null): Storage {
  let value = initial;
  return {
    getItem: () => value,
    setItem: (_key, next) => { value = next; }
  } as Storage;
}

describe('audio settings', () => {
  it('uses the specified separate default BGM and SFX levels', () => {
    expect(defaultAudioSettings).toEqual({ musicMuted: false, musicVolume: 0.35, sfxMuted: false, sfxVolume: 0.65 });
  });

  it('clamps malformed volume settings without discarding valid channel state', () => {
    expect(normalizeAudioSettings({ musicVolume: 3, sfxVolume: -1, sfxMuted: true })).toEqual({ musicMuted: false, musicVolume: 1, sfxMuted: true, sfxVolume: 0 });
    expect(normalizeAudioSettings({ musicVolume: Number.NaN })).toEqual(defaultAudioSettings);
  });

  it('persists and restores independent channel preferences', () => {
    const storage = memoryStorage();
    saveAudioSettings(storage, { musicMuted: true, musicVolume: 0.2, sfxMuted: false, sfxVolume: 0.8 });
    expect(storage.getItem(audioSettingsStorageKey)).toContain('"musicMuted":true');
    expect(loadAudioSettings(storage)).toEqual({ musicMuted: true, musicVolume: 0.2, sfxMuted: false, sfxVolume: 0.8 });
  });

  it('falls back to defaults for corrupt saved JSON', () => {
    expect(loadAudioSettings(memoryStorage('{invalid'))).toEqual(defaultAudioSettings);
  });
});
