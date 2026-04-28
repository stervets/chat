export const soundList: Record<string, string> = {
  notification: '/ping.mp3',
};

export class SoundPlayer {
  private audioContext: AudioContext;
  private sounds: Record<string, AudioBuffer>;
  public preloadPromise: Promise<void>;
  public isReady: boolean;

  constructor(soundsRaw: Record<string, string> = soundList) {
    this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    this.sounds = {};
    this.isReady = false;
    this.preloadPromise = this.preloadSounds(soundsRaw);
  }

  private async preloadSounds(soundsRaw: Record<string, string>): Promise<void> {
    const entries = Object.entries(soundsRaw);
    if (!entries.length) {
      this.isReady = true;
      return;
    }

    const tasks = entries.map(async ([soundName, soundPath]) => {
      const response = await fetch(soundPath);
      const buffer = await response.arrayBuffer();
      const audioBuffer = await this.audioContext.decodeAudioData(buffer);
      this.sounds[soundName] = audioBuffer;
    });

    await Promise.all(tasks);
    this.isReady = true;
  }

  public async play(soundName: string, volumeRaw: number = 1): Promise<void> {
    if (!this.isReady) return;
    if (this.audioContext.state === 'suspended') {
      await this.audioContext.resume();
    }

    const sound = this.sounds[soundName];
    if (!sound) return;

    const volume = Number.isFinite(volumeRaw)
      ? Math.min(1, Math.max(0, Number(volumeRaw)))
      : 1;
    const gainNode = this.audioContext.createGain();
    const sourceNode = this.audioContext.createBufferSource();
    sourceNode.connect(gainNode);
    sourceNode.buffer = sound;
    gainNode.gain.value = volume;
    gainNode.connect(this.audioContext.destination);
    sourceNode.start();
  }

  public async dispose(): Promise<void> {
    this.sounds = {};
    this.isReady = false;
    if (this.audioContext.state !== 'closed') {
      await this.audioContext.close();
    }
  }
}
