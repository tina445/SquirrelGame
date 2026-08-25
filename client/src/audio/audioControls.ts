import type { AudioManager } from './audioManager.js';
import type { AudioSettings } from './audioSettings.js';

const element = <T extends HTMLElement>(id: string): T => document.querySelector<T>(`#${id}`)!;

/** 두 오디오 bus를 독립 제어하되, 월드 포인터 입력을 가로채지 않는 작은 접근성 패널이다. */
export class AudioControls {
  constructor(private readonly audio: AudioManager) {
    const toggle = element<HTMLButtonElement>('audio-toggle');
    const panel = element('audio-panel');
    toggle.addEventListener('click', () => {
      const open = panel.hidden;
      panel.hidden = !open;
      toggle.setAttribute('aria-expanded', String(open));
    });
    element<HTMLButtonElement>('music-mute').addEventListener('click', () => this.audio.updateSettings({ musicMuted: !this.audio.getSettings().musicMuted }));
    element<HTMLButtonElement>('sfx-mute').addEventListener('click', () => this.audio.updateSettings({ sfxMuted: !this.audio.getSettings().sfxMuted }));
    element<HTMLInputElement>('music-volume').addEventListener('input', (event) => this.audio.updateSettings({ musicVolume: Number((event.target as HTMLInputElement).value) / 100 }));
    element<HTMLInputElement>('sfx-volume').addEventListener('input', (event) => this.audio.updateSettings({ sfxVolume: Number((event.target as HTMLInputElement).value) / 100 }));
    this.audio.onSettingsChanged = (settings) => this.render(settings);
    this.render(this.audio.getSettings());
  }

  private render(settings: AudioSettings): void {
    const renderChannel = (channel: 'music' | 'sfx', muted: boolean, volume: number, label: string) => {
      const button = element<HTMLButtonElement>(`${channel}-mute`);
      const slider = element<HTMLInputElement>(`${channel}-volume`);
      const value = element(`${channel}-volume-value`);
      button.textContent = muted ? `${label} 켜기` : `${label} 끄기`;
      button.setAttribute('aria-pressed', String(muted));
      slider.value = String(Math.round(volume * 100));
      value.textContent = muted ? '음소거' : `${Math.round(volume * 100)}%`;
    };
    renderChannel('music', settings.musicMuted, settings.musicVolume, 'BGM');
    renderChannel('sfx', settings.sfxMuted, settings.sfxVolume, '효과음');
  }
}
