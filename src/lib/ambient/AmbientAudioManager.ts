import * as Tone from "tone";

function clamp01(value: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function linearToDb(value: number): number {
  const v = clamp01(value);
  return v <= 0 ? -Infinity : 20 * Math.log10(v);
}

interface EffectDef {
  id: string;
  url: string;
}

interface TrackDef {
  id: number;
  url: string;
}

const EFFECTS: EffectDef[] = [
  { id: "rain", url: "assets/engine/effects/rain.mp3" },
  { id: "thunder", url: "assets/engine/effects/thunder.mp3" },
  { id: "jungle", url: "assets/engine/effects/jungle.mp3" },
  { id: "campfire", url: "assets/engine/effects/fire.mp3" },
];

const TRACKS: TrackDef[] = [
  { id: 1, url: "assets/engine/tracks/Wind-Mark_DiAngelo-1940285615.mp3" },
  { id: 2, url: "assets/engine/tracks/small-waves-onto-the-sand-143040.mp3" },
  { id: 3, url: "assets/engine/tracks/night-ambience-17064.mp3" },
  { id: 4, url: "assets/engine/tracks/urban-seagulls-30068.mp3" },
  { id: 5, url: "assets/engine/tracks/office-ambience-6322.mp3" },
  { id: 6, url: "assets/engine/tracks/city-ambience-9272.mp3" },
  { id: 7, url: "assets/engine/tracks/old-server-turning-on-and-off-24540.mp3" },
  { id: 8, url: "assets/engine/tracks/train-to-munich-germany.mp3" },
  { id: 9, url: "assets/engine/tracks/underwater-white-noise-46423.mp3" },
];

// Allow a couple of convenient aliases (e.g. "fire" for "campfire").
const EFFECT_ALIASES: Record<string, string> = {
  fire: "campfire",
};

interface EffectState {
  id: string;
  url: string;
  player: any;
  active: boolean;
  volume: number;
  loaded: boolean;
  failed: boolean;
  pendingStart: boolean;
}

interface TrackState {
  id: number;
  url: string;
  player: any;
  active: boolean;
  volume: number;
  loaded: boolean;
  failed: boolean;
  pendingStart: boolean;
}

function applyVolume(player: any, volume: number) {
  if (!player) return;
  const db = linearToDb(volume);
  try {
    if (player.volume && typeof player.volume === "object") {
      player.volume.value = db;
    } else {
      player.volume = db;
    }
  } catch (e) {
    // ignore
  }
}

export class AmbientAudioManager {
  private effects = new Map<string, EffectState>();
  private tracks = new Map<number, TrackState>();
  private disposed = false;

  constructor() {
    for (const def of EFFECTS) {
      this.createEffect(def.id, def.url);
    }
    for (const def of TRACKS) {
      this.createTrack(def.id, def.url);
    }

    this.toggleEffect = this.toggleEffect.bind(this);
    this.toggleTrack = this.toggleTrack.bind(this);
    this.stopAllTracks = this.stopAllTracks.bind(this);
    this.setEffectVolume = this.setEffectVolume.bind(this);
    this.setTrackVolume = this.setTrackVolume.bind(this);
    this.dispose = this.dispose.bind(this);
  }

  private createEffect(id: string, url: string): void {
    const state: EffectState = {
      id,
      url,
      player: null,
      active: false,
      volume: 1,
      loaded: false,
      failed: false,
      pendingStart: false,
    };

    try {
      const player = new (Tone as any).Player({
        url,
        loop: true,
        onload: () => {
          state.loaded = true;
          if (this.disposed) return;
          if (state.pendingStart && state.active) {
            state.pendingStart = false;
            this.startPlayer(player, state.volume);
          }
        },
        onerror: (err: any) => {
          state.failed = true;
          state.pendingStart = false;
          // eslint-disable-next-line no-console
          console.warn(
            `[AmbientAudioManager] failed to load effect "${id}":`,
            err && err.message ? err.message : err,
          );
        },
      });
      try {
        player.loop = true;
      } catch (e) {
        // ignore
      }
      try {
        player.toDestination();
      } catch (e) {
        // ignore
      }
      state.player = player;
    } catch (err: any) {
      state.failed = true;
      // eslint-disable-next-line no-console
      console.warn(
        `[AmbientAudioManager] failed to create effect "${id}":`,
        err && err.message ? err.message : err,
      );
    }

    this.effects.set(id, state);
  }

  private createTrack(id: number, url: string): void {
    const state: TrackState = {
      id,
      url,
      player: null,
      active: false,
      volume: 1,
      loaded: false,
      failed: false,
      pendingStart: false,
    };

    try {
      const player = new (Tone as any).Player({
        url,
        loop: true,
        onload: () => {
          state.loaded = true;
          if (this.disposed) return;
          if (state.pendingStart && state.active) {
            state.pendingStart = false;
            this.startPlayer(player, state.volume);
          }
        },
        onerror: (err: any) => {
          state.failed = true;
          state.pendingStart = false;
          // eslint-disable-next-line no-console
          console.warn(
            `[AmbientAudioManager] failed to load track ${id}:`,
            err && err.message ? err.message : err,
          );
        },
      });
      try {
        player.loop = true;
      } catch (e) {
        // ignore
      }
      try {
        player.toDestination();
      } catch (e) {
        // ignore
      }
      state.player = player;
    } catch (err: any) {
      state.failed = true;
      // eslint-disable-next-line no-console
      console.warn(
        `[AmbientAudioManager] failed to create track ${id}:`,
        err && err.message ? err.message : err,
      );
    }

    this.tracks.set(id, state);
  }

  private canonicalEffectId(id: string): string {
    const key = String(id);
    return EFFECT_ALIASES[key] ?? key;
  }

  private startPlayer(player: any, volume: number): void {
    if (!player || this.disposed) return;
    try {
      applyVolume(player, volume);
      try {
        player.loop = true;
      } catch (e) {
        // ignore
      }
      try {
        if (typeof (Tone as any).start === "function") {
          void (Tone as any).start();
        }
      } catch (e) {
        // ignore
      }
      player.start();
    } catch (err: any) {
      // eslint-disable-next-line no-console
      console.warn(
        "[AmbientAudioManager] failed to start player:",
        err && err.message ? err.message : err,
      );
    }
  }

  private stopPlayer(player: any): void {
    if (!player) return;
    try {
      player.stop();
    } catch (e) {
      // ignore
    }
  }

  toggleEffect(id: string): boolean {
    if (this.disposed) return false;
    const key = this.canonicalEffectId(id);
    const state = this.effects.get(key);
    if (!state || state.failed) return false;

    if (state.active) {
      state.active = false;
      state.pendingStart = false;
      this.stopPlayer(state.player);
      return false;
    }

    state.active = true;
    if (state.player) {
      if (state.player.loaded) {
        this.startPlayer(state.player, state.volume);
      } else {
        state.pendingStart = true;
        applyVolume(state.player, state.volume);
      }
    }
    return true;
  }

  toggleTrack(id: string | number): boolean {
    if (this.disposed) return false;
    const key = Number(id);
    if (!Number.isFinite(key)) return false;
    const state = this.tracks.get(key);
    if (!state || state.failed) return false;

    if (state.active) {
      state.active = false;
      state.pendingStart = false;
      this.stopPlayer(state.player);
      return false;
    }

    state.active = true;
    if (state.player) {
      if (state.player.loaded) {
        this.startPlayer(state.player, state.volume);
      } else {
        state.pendingStart = true;
        applyVolume(state.player, state.volume);
      }
    }
    return true;
  }

  stopAllTracks(): void {
    if (this.disposed) return;
    for (const state of this.tracks.values()) {
      if (state.active) {
        state.active = false;
        state.pendingStart = false;
        this.stopPlayer(state.player);
      }
    }
  }

  setEffectVolume(id: string, v: number): void {
    if (this.disposed) return;
    const key = this.canonicalEffectId(id);
    const state = this.effects.get(key);
    if (!state) return;
    const vol = clamp01(v);
    state.volume = vol;
    applyVolume(state.player, vol);
  }

  setTrackVolume(id: string | number, v: number): void {
    if (this.disposed) return;
    const key = Number(id);
    if (!Number.isFinite(key)) return;
    const state = this.tracks.get(key);
    if (!state) return;
    const vol = clamp01(v);
    state.volume = vol;
    applyVolume(state.player, vol);
  }

  isEffectActive(id: string): boolean {
    const key = this.canonicalEffectId(id);
    const state = this.effects.get(key);
    return !!state && state.active;
  }

  isTrackActive(id: string | number): boolean {
    const key = Number(id);
    const state = this.tracks.get(key);
    return !!state && state.active;
  }

  get ready(): boolean {
    for (const s of this.effects.values()) {
      if (!s.loaded && !s.failed) return false;
    }
    for (const s of this.tracks.values()) {
      if (!s.loaded && !s.failed) return false;
    }
    return true;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    const disposePlayer = (player: any) => {
      if (!player) return;
      try {
        player.stop();
      } catch (e) {
        // ignore
      }
      try {
        player.dispose();
      } catch (e) {
        // ignore
      }
    };

    for (const state of this.effects.values()) {
      state.active = false;
      state.pendingStart = false;
      disposePlayer(state.player);
      state.player = null;
    }
    for (const state of this.tracks.values()) {
      state.active = false;
      state.pendingStart = false;
      disposePlayer(state.player);
      state.player = null;
    }

    this.effects.clear();
    this.tracks.clear();
  }
}

export default AmbientAudioManager;
