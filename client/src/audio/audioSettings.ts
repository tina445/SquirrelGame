export interface AudioSettings {
  musicMuted: boolean;
  musicVolume: number;
  sfxMuted: boolean;
  sfxVolume: number;
}

export const audioSettingsStorageKey = 'squirrel-heist-audio-settings';
export const defaultAudioSettings: AudioSettings = {
  musicMuted: false,
  musicVolume: 0.35,
  sfxMuted: false,
  sfxVolume: 0.65
};

type AudioSettingsStorage = Pick<Storage, 'getItem' | 'setItem'>;

/** 저장소·수동 편집값이 오디오 graph에 잘못된 gain을 전달하지 않도록 설정을 기본 범위로 정규화한다. */
export function normalizeAudioSettings(value: Partial<AudioSettings> | null | undefined): AudioSettings {
  const volume = (candidate: unknown, fallback: number): number =>
    typeof candidate === 'number' && Number.isFinite(candidate) ? Math.min(1, Math.max(0, candidate)) : fallback;
  return {
    musicMuted: typeof value?.musicMuted === 'boolean' ? value.musicMuted : defaultAudioSettings.musicMuted,
    musicVolume: volume(value?.musicVolume, defaultAudioSettings.musicVolume),
    sfxMuted: typeof value?.sfxMuted === 'boolean' ? value.sfxMuted : defaultAudioSettings.sfxMuted,
    sfxVolume: volume(value?.sfxVolume, defaultAudioSettings.sfxVolume)
  };
}

/** 브라우저 저장소가 막혔거나 손상돼도 기본 사운드 설정으로 안전하게 시작한다. */
export function loadAudioSettings(storage: Pick<AudioSettingsStorage, 'getItem'> | null): AudioSettings {
  if (!storage) return { ...defaultAudioSettings };
  try {
    const saved = storage.getItem(audioSettingsStorageKey);
    return saved ? normalizeAudioSettings(JSON.parse(saved) as Partial<AudioSettings>) : { ...defaultAudioSettings };
  } catch {
    return { ...defaultAudioSettings };
  }
}

/** 사용자가 바꾼 두 채널의 음량·음소거 상태를 다음 방문에도 같은 값으로 유지한다. */
export function saveAudioSettings(storage: Pick<AudioSettingsStorage, 'setItem'> | null, settings: AudioSettings): void {
  if (!storage) return;
  try {
    storage.setItem(audioSettingsStorageKey, JSON.stringify(normalizeAudioSettings(settings)));
  } catch {
    // privacy mode 등의 저장 실패는 재생 기능을 막지 않는다.
  }
}
