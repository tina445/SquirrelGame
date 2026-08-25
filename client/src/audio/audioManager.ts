import * as Tone from 'tone';
import type { GameEvent, PlayerId, Team } from '@squirrel-heist/shared';
import { soundEffectForGameEvent, type SoundEffect } from './audioEvents.js';
import { loadAudioSettings, normalizeAudioSettings, saveAudioSettings, type AudioSettings } from './audioSettings.js';

type ChargeOscillator = Tone.Oscillator;

/** BGM·효과음 bus와 브라우저 autoplay 제약을 한 경계에서 관리해 게임 권위 코드와 분리한다. */
export class AudioManager {
  private settings = loadAudioSettings(typeof localStorage === 'undefined' ? null : localStorage);
  private initialized = false;
  private activation: Promise<void> | null = null;
  private musicGain: Tone.Gain | null = null;
  private sfxGain: Tone.Gain | null = null;
  private melody: Tone.PluckSynth | null = null;
  private bass: Tone.Synth | null = null;
  private bell: Tone.FMSynth | null = null;
  private effect: Tone.Synth | null = null;
  private noise: Tone.NoiseSynth | null = null;
  private readonly chargeOscillators = new Map<string, ChargeOscillator>();
  onSettingsChanged: (settings: AudioSettings) => void = () => undefined;

  getSettings(): AudioSettings { return { ...this.settings }; }

  /** 제어 패널의 부분 변경을 즉시 gain에 반영하고, 다음 방문을 위해 영속화한다. */
  updateSettings(next: Partial<AudioSettings>): void {
    this.settings = normalizeAudioSettings({ ...this.settings, ...next });
    saveAudioSettings(typeof localStorage === 'undefined' ? null : localStorage, this.settings);
    this.applySettings();
    this.onSettingsChanged(this.getSettings());
  }

  /** 실제 사용자 입력에서만 AudioContext를 깨우고, 최초 성공 뒤에 loop를 한 번만 구성한다. */
  activate(): Promise<void> {
    if (this.initialized) return Promise.resolve();
    this.activation ??= Tone.start().then(() => {
      this.buildGraph();
      this.initialized = true;
      Tone.getTransport().start();
    }).catch(() => undefined).finally(() => { this.activation = null; });
    return this.activation;
  }

  /** 문서 수준의 실제 클릭·키 입력으로 autoplay를 해제하고, 모든 활성 버튼에 한 번의 클릭음을 준다. */
  bindDocument(documentNode: Document): void {
    const activate = (event: Event) => {
      if (event.isTrusted) void this.activate();
    };
    documentNode.addEventListener('pointerdown', activate, { capture: true });
    documentNode.addEventListener('keydown', activate, { capture: true });
    documentNode.addEventListener('click', (event) => {
      if (!event.isTrusted) return;
      const button = event.target instanceof Element ? event.target.closest('button') : null;
      if (button instanceof HTMLButtonElement && !button.disabled) this.playUiClick();
    });
    documentNode.addEventListener('visibilitychange', () => {
      if (!this.initialized) return;
      if (documentNode.hidden) Tone.getTransport().pause();
      else Tone.getTransport().start();
    });
  }

  /** dedupe가 끝난 서버 event만 받아 현재 플레이어에 관련된 효과음을 결정한다. */
  playGameEvent(event: GameEvent, localId: PlayerId | null, localTeam: Team | null): void {
    const effect = soundEffectForGameEvent(event, localId, localTeam);
    if (!effect || !this.initialized) return;
    this.play(effect, event.payload);
  }

  private buildGraph(): void {
    this.musicGain = new Tone.Gain().toDestination();
    this.sfxGain = new Tone.Gain().toDestination();
    this.melody = new Tone.PluckSynth({ attackNoise: 0.4, dampening: 3_200, resonance: 0.82 }).connect(this.musicGain);
    this.bass = new Tone.Synth({ oscillator: { type: 'triangle' }, envelope: { attack: 0.02, decay: 0.18, sustain: 0.28, release: 0.6 } }).connect(this.musicGain);
    this.bell = new Tone.FMSynth({ harmonicity: 3, envelope: { attack: 0.01, decay: 0.12, sustain: 0.04, release: 0.35 } }).connect(this.sfxGain);
    this.effect = new Tone.Synth({ oscillator: { type: 'triangle' }, envelope: { attack: 0.005, decay: 0.1, sustain: 0.02, release: 0.18 } }).connect(this.sfxGain);
    this.noise = new Tone.NoiseSynth({ noise: { type: 'white' }, envelope: { attack: 0.002, decay: 0.08, sustain: 0 } }).connect(this.sfxGain);
    this.applySettings();
    this.createForestLoop();
  }

  /** 112 BPM 4마디 C장조 펜타토닉을 반복해 가볍고 자극적이지 않은 숲속 BGM을 만든다. */
  private createForestLoop(): void {
    const transport = Tone.getTransport();
    transport.bpm.value = 112;
    const notes = ['C5', null, 'E5', 'G5', 'A5', null, 'G5', 'E5', 'D5', null, 'E5', 'G5', 'A5', 'G5', 'E5', null];
    new Tone.Sequence((time, note) => { if (note) this.melody?.triggerAttackRelease(note, '16n', time, 0.36); }, notes, '8n').start(0);
    const bassNotes = ['C3', null, 'A2', null, 'F2', null, 'G2', null];
    new Tone.Sequence((time, note) => { if (note) this.bass?.triggerAttackRelease(note, '8n', time, 0.22); }, bassNotes, '2n').start(0);
  }

  private applySettings(): void {
    this.musicGain?.gain.rampTo(this.settings.musicMuted ? 0 : this.settings.musicVolume, 0.04);
    this.sfxGain?.gain.rampTo(this.settings.sfxMuted ? 0 : this.settings.sfxVolume, 0.04);
  }

  private playUiClick(): void {
    if (!this.initialized) {
      void this.activate().then(() => this.play('uiClick', {}));
      return;
    }
    this.play('uiClick', {});
  }

  private play(sound: SoundEffect, payload: Record<string, unknown>): void {
    const now = Tone.now();
    switch (sound) {
      case 'uiClick': this.effect?.triggerAttackRelease('C5', '32n', now, 0.2); break;
      case 'berryPickup':
        this.bell?.triggerAttackRelease('C6', '32n', now, 0.32);
        this.bell?.triggerAttackRelease('E6', '32n', now + 0.07, 0.25);
        this.bell?.triggerAttackRelease('G6', '16n', now + 0.14, 0.22);
        break;
      case 'acornPickup': this.melody?.triggerAttackRelease('G4', '16n', now, 0.42); break;
      case 'acornDrop': this.effect?.triggerAttackRelease('C3', '16n', now, 0.35); break;
      case 'acornReturned': this.melody?.triggerAttackRelease('C5', '8n', now, 0.38); break;
      case 'acornSecured':
        this.bell?.triggerAttackRelease('C5', '16n', now, 0.3);
        this.bell?.triggerAttackRelease('G5', '16n', now + 0.1, 0.3);
        break;
      case 'acornStolen': this.effect?.triggerAttackRelease('D3', '8n', now, 0.38); break;
      case 'thunderChargeStart': this.startCharge(String(payload.playerId)); break;
      case 'thunderChargeStop': this.stopCharge(String(payload.playerId)); break;
      case 'thunderFire':
        this.stopCharge(String(payload.playerId));
        this.noise?.triggerAttackRelease('16n', now, 0.4);
        this.effect?.triggerAttackRelease('A5', '16n', now, 0.36);
        break;
      case 'thunderHit': this.effect?.triggerAttackRelease('C3', '8n', now, 0.46); break;
      case 'thunderWall': this.noise?.triggerAttackRelease('32n', now, 0.2); break;
      case 'arrest': this.effect?.triggerAttackRelease('D4', '8n', now, 0.32); break;
      case 'rescue':
        this.bell?.triggerAttackRelease('E5', '16n', now, 0.34);
        this.bell?.triggerAttackRelease('A5', '8n', now + 0.12, 0.32);
        break;
      case 'victory':
        for (const [index, note] of ['C5', 'E5', 'G5', 'C6'].entries()) this.bell?.triggerAttackRelease(note, '8n', now + index * 0.13, 0.4);
        break;
      case 'defeat':
        this.effect?.triggerAttackRelease('E4', '8n', now, 0.35);
        this.effect?.triggerAttackRelease('C4', '4n', now + 0.18, 0.3);
        break;
    }
  }

  private startCharge(playerId: string): void {
    this.stopCharge(playerId);
    if (!this.sfxGain) return;
    const oscillator = new Tone.Oscillator('A2', 'sine').connect(this.sfxGain);
    oscillator.volume.value = -26;
    oscillator.start();
    this.chargeOscillators.set(playerId, oscillator);
  }

  private stopCharge(playerId: string): void {
    const oscillator = this.chargeOscillators.get(playerId);
    if (!oscillator) return;
    oscillator.stop();
    oscillator.dispose();
    this.chargeOscillators.delete(playerId);
  }
}
