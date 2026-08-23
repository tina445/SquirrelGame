export class EventAudio {
  private context: AudioContext | null = null;
  play(type: string): void {
    if (!['ACORN_PICKED_UP', 'ACORN_STOLEN', 'ACORN_SECURED', 'ARREST_COMPLETED', 'RESCUE_COMPLETED', 'THUNDER_FIRED', 'THUNDER_HIT', 'MATCH_FINISHED'].includes(type)) return;
    this.context ??= new AudioContext();
    if (this.context.state === 'suspended') void this.context.resume();
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.frequency.value = type === 'THUNDER_HIT' ? 180 : type === 'MATCH_FINISHED' ? 660 : 420;
    gain.gain.setValueAtTime(0.06, this.context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, this.context.currentTime + 0.14);
    oscillator.connect(gain).connect(this.context.destination);
    oscillator.start(); oscillator.stop(this.context.currentTime + 0.15);
  }
}
