export const guestNameStorageKey = 'squirrel-heist-display-name';

/** 브라우저 암호 난수로 세션마다 네 자리 게스트 닉네임을 균등하게 생성한다. */
export function generateGuestName(cryptoSource: Pick<Crypto, 'getRandomValues'> = crypto): string {
  const value = new Uint32Array(1);
  const limit = Math.floor(0x1_0000_0000 / 10_000) * 10_000;
  do cryptoSource.getRandomValues(value); while (value[0]! >= limit);
  return `다람쥐${String(value[0]! % 10_000).padStart(4, '0')}`;
}

/** 현재 탭 세션의 닉네임을 복원하고 없을 때만 새 기본값을 생성한다. */
export function sessionDisplayName(storage: Pick<Storage, 'getItem' | 'setItem'> = sessionStorage): string {
  const existing = storage.getItem(guestNameStorageKey)?.trim();
  if (existing) return existing;
  const generated = generateGuestName();
  storage.setItem(guestNameStorageKey, generated);
  return generated;
}

/** 사용자가 확정한 이름을 장기 저장하지 않고 현재 탭과 재접속에만 공유한다. */
export function saveSessionDisplayName(name: string, storage: Pick<Storage, 'setItem'> = sessionStorage): void {
  storage.setItem(guestNameStorageKey, name);
}
