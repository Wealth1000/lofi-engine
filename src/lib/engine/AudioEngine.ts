import * as Tone from "tone";

import ChordProgression from "./Chords/ChordProgression";
import intervalWeights from "./Chords/IntervalWeights";
import Keys from "./Chords/Keys";
import { fiveToFive } from "./Chords/MajorScale";
import Hat from "./Drums/Hat";
import Kick from "./Drums/Kick";
import Noise from "./Drums/Noise";
import Snare from "./Drums/Snare";
import Piano from "./Piano/Piano";

export const DEFAULT_VOLUMES = {
  rain: 1,
  thunder: 1,
  campfire: 1,
  jungle: 1,
  main_track: 1,
};

export interface VolumeMap {
  [key: string]: number;
}

export interface StorageAdapter {
  getVolumes(): VolumeMap | null;
  setVolumes(volumes: VolumeMap): void;
  getAutoDJMode(): string | null;
  setAutoDJMode(mode: string): void;
}

export interface EventSink {
  emit(name: string, detail?: any): void;
}

const NOOP_STORAGE: StorageAdapter = {
  getVolumes: () => null,
  setVolumes: () => {},
  getAutoDJMode: () => null,
  setAutoDJMode: () => {},
};

const NOOP_EVENTS: EventSink = {
  emit: () => {},
};

function linearToDb(value: number): number {
  return value === 0 ? -Infinity : 20 * Math.log10(value);
}

export class AudioEngine {
  // Adapters
  public storage: StorageAdapter;
  public events: EventSink;

  // State
  public key: string = "C";
  public progression: any[] = [];
  public scale: any[] = [];
  public progress: number = 0;
  public scalePos: number = 0;

  public pianoLoaded: boolean = false;
  public kickLoaded: boolean = false;
  public snareLoaded: boolean = false;
  public hatLoaded: boolean = false;

  public contextStarted: boolean = false;
  public genChordsOnce: boolean = false;

  public kickOff: boolean = false;
  public snareOff: boolean = false;
  public hatOff: boolean = false;
  public melodyDensity: number = 0.33;
  public melodyOff: boolean = false;

  public isPlaying: boolean = false;

  private _autoDJMode: string = "MUSIC";

  public barCount: number = 0;
  public sectionBarLength: number = 32;
  public isTransitioning: boolean = false;

  public dotPatterns: number[][] = [
    [],
    [5],
    [1, 9],
    [1, 5, 9],
    [1, 3, 7, 9],
    [1, 3, 5, 7, 9],
    [1, 3, 4, 6, 7, 9],
    [1, 3, 4, 5, 6, 7, 9],
  ];

  // Audio chain
  private cmp: any;
  private lpf: any;
  private vol: any;

  // Instruments
  private pn: any;
  private kick: any;
  private snare: any;
  private hat: any;
  private noise: any;

  // Sequences
  private chords: any;
  private melody: any;
  private kickLoop: any;
  private snareLoop: any;
  private hatLoop: any;

  private volumeInterval: any = null;

  constructor(options?: { storage?: StorageAdapter; events?: EventSink }) {
    this.storage = options?.storage || NOOP_STORAGE;
    this.events = options?.events || NOOP_EVENTS;

    // Audio chain
    const volumes = this.storage.getVolumes() || DEFAULT_VOLUMES;
    this.cmp = new Tone.Compressor({ threshold: -6, ratio: 3, attack: 0.5, release: 0.1 });
    this.lpf = new Tone.Filter(2000, "lowpass");
    this.vol = new Tone.Volume(linearToDb(volumes.main_track ?? 1));
    Tone.Master.chain(this.cmp, this.lpf, this.vol);
    Tone.Transport.bpm.value = 156;
    Tone.Transport.swing = 1;

    this._autoDJMode = this.storage.getAutoDJMode() || "MUSIC";

    // Instruments
    this.pn = new Piano(() => {
      this.pianoLoaded = true;
      this.checkSamplesLoaded();
    }).sampler;
    this.kick = new Kick(() => {
      this.kickLoaded = true;
      this.checkSamplesLoaded();
    }).sampler;
    this.snare = new Snare(() => {
      this.snareLoaded = true;
      this.checkSamplesLoaded();
    }).sampler;
    this.hat = new Hat(() => {
      this.hatLoaded = true;
      this.checkSamplesLoaded();
    }).sampler;
    this.noise = Noise;

    // Sequences
    this.chords = new Tone.Sequence(
      (time: any, note: any) => {
        this.playChord();
      },
      [""],
      "1n",
    );
    this.melody = new Tone.Sequence(
      (time: any, note: any) => {
        this.playMelody();
      },
      [""],
      "8n",
    );
    this.kickLoop = new Tone.Sequence(
      (time: any, note: any) => {
        if (!this.kickOff) {
          if (note === "C4" && Math.random() < 0.9) {
            this.kick.triggerAttack(note);
          } else if (note === "." && Math.random() < 0.1) {
            this.kick.triggerAttack("C4");
          }
        }
      },
      ["C4", "", "", "", "", "", "", "C4", "C4", "", ".", "", "", "", "", ""],
      "8n",
    );
    this.snareLoop = new Tone.Sequence(
      (time: any, note: any) => {
        if (!this.snareOff) {
          if (note !== "" && Math.random() < 0.8) {
            this.snare.triggerAttack(note);
          }
        }
      },
      ["", "C4"],
      "2n",
    );
    this.hatLoop = new Tone.Sequence(
      (time: any, note: any) => {
        if (!this.hatOff) {
          if (note !== "" && Math.random() < 0.8) {
            this.hat.triggerAttack(note);
          }
        }
      },
      ["C4", "C4", "C4", "C4", "C4", "C4", "C4", "C4"],
      "4n",
    );

    this.chords.humanize = true;
    this.melody.humanize = true;
    this.kickLoop.humanize = true;
    this.snareLoop.humanize = true;
    this.hatLoop.humanize = true;

    // Volume polling
    this.volumeInterval = setInterval(() => {
      const updated = this.storage.getVolumes() || DEFAULT_VOLUMES;
      this.vol.volume.value = linearToDb(updated.main_track ?? 1);
    }, 100);
  }

  // Readiness
  get allSamplesLoaded(): boolean {
    return this.pianoLoaded && this.kickLoaded && this.snareLoaded && this.hatLoaded;
  }
  get samplesLoaded(): boolean {
    return this.allSamplesLoaded;
  }
  get ready(): boolean {
    return this.allSamplesLoaded;
  }
  get isReady(): boolean {
    return this.allSamplesLoaded;
  }

  get autoDJMode(): string {
    return this._autoDJMode;
  }
  set autoDJMode(mode: string) {
    this._autoDJMode = mode;
    try {
      this.storage.setAutoDJMode(mode);
    } catch (e) {
      // ignore
    }
  }

  get activeProgressionIndex(): number {
    return (this.progress + 7) % 8;
  }

  get volume(): number {
    const v = this.storage.getVolumes();
    return (v && typeof v.main_track === "number") ? v.main_track : (DEFAULT_VOLUMES.main_track);
  }
  set volume(value: number) {
    const base = this.storage.getVolumes() || { ...DEFAULT_VOLUMES };
    base.main_track = value;
    this.storage.setVolumes(base);
    this.vol.volume.value = linearToDb(value);
  }

  rampVolume(linearValue: number, seconds: number) {
    this.vol.volume.rampTo(linearToDb(linearValue), seconds);
  }

  getVolume(): number {
    return this.volume;
  }
  setVolume(value: number): void {
    this.volume = value;
  }

  getAutoDJMode(): string {
    return this.autoDJMode;
  }
  setAutoDJMode(mode: string): void {
    this.autoDJMode = mode;
  }

  private checkSamplesLoaded() {
    if (this.allSamplesLoaded && !this.contextStarted) {
      this.startAudioContext();
      this.generateProgression();
    }
  }

  startAudioContext() {
    Tone.start();
    this.contextStarted = true;
  }

  generateProgression() {
    const _scale = fiveToFive;
    const newKey = Keys[Math.floor(Math.random() * Keys.length)];
    const newScale = Tone.Frequency(newKey + "5")
      .harmonize(_scale)
      .map((f: any) => Tone.Frequency(f).toNote());
    const newProgression = ChordProgression.generate(8);
    const newScalePos = Math.floor(Math.random() * _scale.length);

    this.key = newKey;
    this.progress = 0;
    this.progression = newProgression;
    this.scale = newScale;
    this.genChordsOnce = true;
    this.scalePos = newScalePos;
  }

  nextChord() {
    const nextProgress = this.progress === this.progression.length - 1 ? 0 : this.progress + 1;
    const nextKickOff = Math.random() < 0.15;
    const nextSnareOff = Math.random() < 0.2;
    const nextHatOff = Math.random() < 0.25;
    const nextMelodyDensity = Math.random() * 0.3 + 0.2;
    const nextMelodyOff = Math.random() < 0.25;

    if (this.progress === 4) {
      this.progress = nextProgress;
      this.kickOff = nextKickOff;
      this.snareOff = nextSnareOff;
      this.hatOff = nextHatOff;
    } else if (this.progress === 0) {
      this.progress = nextProgress;
      this.kickOff = nextKickOff;
      this.snareOff = nextSnareOff;
      this.hatOff = nextHatOff;
      this.melodyDensity = nextMelodyDensity;
      this.melodyOff = nextMelodyOff;
    } else {
      this.progress = nextProgress;
    }
    this.barCount++;
    if (this.barCount >= this.sectionBarLength) {
      this.barCount = 0;
      this.autoDJTransition();
      const barLengthOptions = [16, 20, 24, 28, 32, 48];
      this.sectionBarLength = barLengthOptions[Math.floor(Math.random() * barLengthOptions.length)];
    }
  }

  autoDJTransition() {
    if (this.isTransitioning) return;
    if (this.autoDJMode === "MANUAL") return;

    this.isTransitioning = true;

    this.generateProgression();

    this.melodyDensity = 0.2 + Math.random() * 0.5;
    this.kickOff = Math.random() < 0.13;
    this.snareOff = Math.random() < 0.17;
    this.hatOff = Math.random() < 0.22;
    this.melodyOff = Math.random() < 0.25;

    if (this.autoDJMode === "ATMOSPHERE" || this.autoDJMode === "WORLD") {
      const effects = ["rain", "thunder", "jungle", "campfire"];
      if (Math.random() < 0.3) {
        const effect = effects[Math.floor(Math.random() * effects.length)];
        this.events.emit(`lofi-toggle-${effect}`);
      }
    }

    if (this.autoDJMode === "WORLD") {
      if (Math.random() < 0.2) {
        const trackId = Math.floor(Math.random() * 9) + 1;
        this.events.emit("lofi-toggle-track", { id: trackId });
      }
    }

    this.lpf.frequency.linearRampTo(300, 2);
    setTimeout(() => {
      this.lpf.frequency.linearRampTo(1200, 2);
      setTimeout(() => {
        this.isTransitioning = false;
      }, 2000);
    }, 2000);
  }

  playChord() {
    const chord = this.progression[this.progress];
    const root = Tone.Frequency(this.key + "3").transpose(chord.semitoneDist);
    const size = 4;
    const voicing = chord.generateVoicing(size);
    const notes = Tone.Frequency(root)
      .harmonize(voicing)
      .map((f: any) => Tone.Frequency(f).toNote());
    this.pn.triggerAttackRelease(notes, "1n");
    this.nextChord();
  }

  playMelody() {
    if (this.melodyOff || !(Math.random() < this.melodyDensity)) {
      return;
    }

    const descendRange = Math.min(this.scalePos, 7) + 1;
    const ascendRange = Math.min(this.scale.length - this.scalePos, 7);

    let descend = descendRange > 1;
    let ascend = ascendRange > 1;

    if (descend && ascend) {
      if (Math.random() > 0.5) {
        ascend = !descend;
      } else {
        descend = !ascend;
      }
    }

    let weights = descend
      ? intervalWeights.slice(0, descendRange)
      : intervalWeights.slice(0, ascendRange);

    const sum = weights.reduce((prev: number, curr: number) => prev + curr, 0);
    weights = weights.map((w: number) => w / sum);
    for (let i = 1; i < weights.length; i++) {
      weights[i] += weights[i - 1];
    }

    const randomWeight = Math.random();
    let scaleDist = 0;
    let found = false;
    while (!found) {
      if (randomWeight <= weights[scaleDist]) {
        found = true;
      } else {
        scaleDist++;
      }
    }

    const scalePosChange = descend ? -scaleDist : scaleDist;
    const newScalePos = this.scalePos + scalePosChange;

    this.scalePos = newScalePos;
    this.pn.triggerAttackRelease(this.scale[newScalePos], "2n");
  }

  toggle() {
    this.progress = 0;
    if (Tone.Transport.state === "started") {
      this.noise.stop();
      Tone.Transport.stop();
      this.isPlaying = false;
    } else {
      Tone.start();
      Tone.Transport.start();
      this.noise.start(0);
      this.chords.start(0);
      this.melody.start(0);
      this.kickLoop.start(0);
      this.snareLoop.start(0);
      this.hatLoop.start(0);
      this.isPlaying = true;
      if (!this.contextStarted) this.contextStarted = true;
      if (!this.genChordsOnce) this.generateProgression();
    }
    this.events.emit("lofi-play-state-changed", { isPlaying: this.isPlaying });
  }

  start() {
    if (!this.contextStarted) this.startAudioContext();
    if (!this.genChordsOnce) this.generateProgression();
    if (!this.isPlaying) this.toggle();
  }

  stop() {
    if (this.isPlaying || Tone.Transport.state === "started") {
      this.progress = 0;
      this.noise.stop();
      Tone.Transport.stop();
      this.isPlaying = false;
      this.events.emit("lofi-play-state-changed", { isPlaying: false });
    }
  }

  dispose() {
    if (this.volumeInterval) {
      clearInterval(this.volumeInterval);
      this.volumeInterval = null;
    }
  }
}

export default AudioEngine;
