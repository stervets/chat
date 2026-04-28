export const soundList: Record<string, string> = {
  notification: '/ping.mp3',
  incomingCall: '/ringtone.mp3',
  callOn: '/callon.mp3',
  callOff: '/calloff.mp3',
};

export class SoundPlayer {
  private audioContext: AudioContext;
  private sounds: Record<string, AudioBuffer>;
  private soundPaths: Record<string, string>;
  private activeLoops: Record<string, {
    sourceNode: AudioBufferSourceNode | null;
    gainNode: GainNode | null;
    audio: HTMLAudioElement | null;
  }>;
  public preloadPromise: Promise<void>;
  public isReady: boolean;

  constructor(soundsRaw: Record<string, string> = soundList) {
    this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    this.sounds = {};
    this.soundPaths = {...soundsRaw};
    this.activeLoops = {};
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

  public async playLoop(soundName: string, volumeRaw: number = 1): Promise<void> {
    if (!this.isReady) return;
    if (this.activeLoops[soundName]) return;
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
      sourceNode.loop = true;
      gainNode.gain.value = volume;
      gainNode.connect(this.audioContext.destination);
      sourceNode.start();
      this.activeLoops[soundName] = {
        sourceNode,
        gainNode,
        audio: null,
      };
      return;
    }

    const fallbackPath = String(this.soundPaths[soundName] || '').trim();
    if (!fallbackPath) return;
    const audio = new Audio(fallbackPath);
    audio.preload = 'auto';
    audio.loop = true;
    audio.volume = volume;
    this.activeLoops[soundName] = {
      sourceNode: null,
      gainNode: null,
      audio,
    };
    try {
      await audio.play();
    } catch (error) {
      delete this.activeLoops[soundName];
      throw error;
    }
  }

  public stopLoop(soundName: string) {
    const active = this.activeLoops[soundName];
    if (!active) return;

    if (active.sourceNode) {
      try {
        active.sourceNode.stop();
      } catch {}
      try {
        active.sourceNode.disconnect();
      } catch {}
    }
    if (active.gainNode) {
      try {
        active.gainNode.disconnect();
      } catch {}
    }
    if (active.audio) {
      try {
        active.audio.pause();
      } catch {}
      try {
        active.audio.currentTime = 0;
      } catch {}
      active.audio.src = '';
    }

    delete this.activeLoops[soundName];
  }

  public stopAllLoops() {
    Object.keys(this.activeLoops).forEach((soundName) => this.stopLoop(soundName));
  }

  public async dispose(): Promise<void> {
    this.stopAllLoops();
    this.sounds = {};
    this.soundPaths = {};
    this.activeLoops = {};
    this.isReady = false;
    if (this.audioContext.state !== 'closed') {
      await this.audioContext.close();
    }
  }
}
