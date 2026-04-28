export const soundList: Record<string, string> = {
  notification: '/ping.mp3',
  incomingCall: '/ringtone.mp3',
};

export class SoundPlayer {
  private audioContext: AudioContext;
  private sounds: Record<string, AudioBuffer>;
  private soundPaths: Record<string, string>;
  public preloadPromise: Promise<void>;
  public isReady: boolean;

  constructor(soundsRaw: Record<string, string> = soundList) {
    this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    this.sounds = {};
    this.soundPaths = {...soundsRaw};
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
      try {
        const response = await fetch(soundPath);
        if (!response.ok) return;
        const buffer = await response.arrayBuffer();
        const audioBuffer = await this.audioContext.decodeAudioData(buffer);
        this.sounds[soundName] = audioBuffer;
      } catch {
        // fallback to HTMLAudioElement in play()
      }
    });

    await Promise.allSettled(tasks);
    this.isReady = true;
  }

  public async play(soundName: string, volumeRaw: number = 1): Promise<void> {
    if (!this.isReady) return;
    const volume = Number.isFinite(volumeRaw)
      ? Math.min(1, Math.max(0, Number(volumeRaw)))
      : 1;

    const sound = this.sounds[soundName];
    if (sound) {
      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume();
      }

      const gainNode = this.audioContext.createGain();
      const sourceNode = this.audioContext.createBufferSource();
      sourceNode.connect(gainNode);
      sourceNode.buffer = sound;
      gainNode.gain.value = volume;
      gainNode.connect(this.audioContext.destination);
      sourceNode.start();
      return;
    }

    const fallbackPath = String(this.soundPaths[soundName] || '').trim();
    if (!fallbackPath) return;
    const audio = new Audio(fallbackPath);
    audio.preload = 'auto';
    audio.volume = volume;
    await audio.play();
  }

  public async dispose(): Promise<void> {
    this.sounds = {};
    this.soundPaths = {};
    this.isReady = false;
    if (this.audioContext.state !== 'closed') {
      await this.audioContext.close();
    }
  }
}
