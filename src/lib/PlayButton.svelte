<script lang="ts">
  import {
      IconLoader,
      IconPlayerPauseFilled,
      IconPlayerPlayFilled,
      IconRefresh,
  } from "@tabler/icons-svelte";
  import { onDestroy, onMount } from "svelte";
  import { isEditableTarget } from "./keyboard";
  import { t } from "./locales/store";
  import { zen } from "./focus/store";
// @ts-ignore
  import * as Tone from "tone";
  import Visualizer from "../lib/components/Visualizer/index.svelte";
  import AudioEngine, { DEFAULT_VOLUMES } from "./engine/AudioEngine";

  const STORAGE_KEY = "Volumes";

  // Browser adapters
  const storage = {
    getVolumes() {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return null;
        return JSON.parse(raw);
      } catch (e) {
        return null;
      }
    },
    setVolumes(volumes: any) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(volumes));
      } catch (e) {
        // ignore
      }
    },
    getAutoDJMode() {
      try {
        return localStorage.getItem("AutoDJMode");
      } catch (e) {
        return null;
      }
    },
    setAutoDJMode(mode: string) {
      try {
        localStorage.setItem("AutoDJMode", mode);
      } catch (e) {
        // ignore
      }
    },
  };

  const events = {
    emit(name: string, detail?: any) {
      try {
        window.dispatchEvent(new CustomEvent(name, { detail }));
      } catch (e) {
        // ignore
      }
    },
  };

  const engine = new AudioEngine({ storage, events });

  // Convert linear volume (0 to 1) to dB
  const linearToDb = (value: number) =>
    value === 0 ? -Infinity : 20 * Math.log10(value);

  // Reactive local state mirrored from engine
  let allSamplesLoaded = engine.allSamplesLoaded;
  let contextStarted = engine.contextStarted;
  let genChordsOnce = engine.genChordsOnce;
  let isPlaying = engine.isPlaying;
  let key = engine.key;
  let progression: any[] = engine.progression;
  let progress = engine.progress;
  let autoDJMode = engine.autoDJMode;

  function sync() {
    allSamplesLoaded = engine.allSamplesLoaded;
    contextStarted = engine.contextStarted;
    genChordsOnce = engine.genChordsOnce;
    isPlaying = engine.isPlaying;
    key = engine.key;
    progression = engine.progression;
    progress = engine.progress;
    autoDJMode = engine.autoDJMode;
  }

  // Wrap engine methods to keep GUI state in sync
  const wrap = (method: string) => {
    const original = (engine as any)[method].bind(engine);
    (engine as any)[method] = (...args: any[]) => {
      const result = original(...args);
      sync();
      return result;
    };
  };
  [
    "toggle",
    "start",
    "stop",
    "startAudioContext",
    "generateProgression",
    "autoDJTransition",
    "nextChord",
  ].forEach(wrap);

  // Hook sample-load readiness
  const originalCheck = (engine as any).checkSamplesLoaded.bind(engine);
  (engine as any).checkSamplesLoaded = () => {
    originalCheck();
    sync();
  };

  const dotPatterns = engine.dotPatterns;

  onMount(() => {
    // Listen for spacebar press
    const handleKeydown = (e: any) => {
      if (isEditableTarget(e.target)) return;

      if (e.code === "Space") {
        e.preventDefault();
        engine.toggle();
        sync();
      }
    };

    const handleCustomToggle = () => {
      handleButtonAction();
    };

    const handleAutoDJModeChange = (e: any) => {
      engine.autoDJMode = e.detail.mode;
      sync();
    };

    // Pomodoro breaks soften the existing generator instead of creating a second audio path.
    const handleFocusPhase = (e: any) => {
      const isBreak =
        e.detail?.phase === "shortBreak" || e.detail?.phase === "longBreak";
      const saved = storage.getVolumes() || DEFAULT_VOLUMES;
      const vol = (engine as any).vol;
      vol.volume.rampTo(
        linearToDb((saved.main_track ?? 1) * (isBreak ? 0.7 : 1)),
        0.35,
      );
    };

    window.addEventListener("keydown", handleKeydown);
    window.addEventListener("lofi-toggle-play", handleCustomToggle);
    window.addEventListener("auto-dj-mode-changed", handleAutoDJModeChange);
    window.addEventListener("lofi-focus-phase", handleFocusPhase);

    return () => {
      window.removeEventListener("keydown", handleKeydown);
      window.removeEventListener("lofi-toggle-play", handleCustomToggle);
      window.removeEventListener("auto-dj-mode-changed", handleAutoDJModeChange);
      window.removeEventListener("lofi-focus-phase", handleFocusPhase);
    };
  });

  onDestroy(() => {
    if (Tone.Transport.state === "started") {
      try {
        (engine as any).noise.stop();
      } catch (e) {
        // ignore
      }
      Tone.Transport.stop();
    }
    engine.dispose();
  });

  $: activeProgressionIndex = (progress + 7) % 8;

  function handleButtonAction() {
    if (!engine.allSamplesLoaded) {
      // Do nothing, button is disabled
      return;
    } else if (!engine.contextStarted) {
      // Initialize audio context
      engine.startAudioContext();
    } else if (!engine.genChordsOnce) {
      // Chords not generated yet, can't play
      return;
    } else {
      // Normal play/pause functionality
      engine.toggle();
    }
    sync();
  }
</script>

<div>
  {#if !$zen}
  <div class="controls">
    <button
      class="play-button"
      on:click={handleButtonAction}
      disabled={!allSamplesLoaded}
    >
      {#if !allSamplesLoaded}
        <IconLoader size={30} class="spinning" />
      {:else if !contextStarted}
        <span class="context-text">Initialize Audio</span>
      {:else if !genChordsOnce}
        <IconPlayerPlayFilled size={30} class="disabled" />
      {:else if isPlaying}
        <IconPlayerPauseFilled size={30} />
      {:else}
        <IconPlayerPlayFilled size={30} />
      {/if}
    </button>
  </div>
  {/if}

  {#if !$zen && allSamplesLoaded && contextStarted}
    {#if genChordsOnce}
      <ol class="progressionList glass">
        <li class="key">{key}</li>
        {#each progression as chord, idx}
          <li class:live={idx === activeProgressionIndex}>
            <span
              class="chord-dots"
              role="img"
              aria-label={String(chord.degree)}
            >
              {#each dotPatterns[chord.degree] as cell}
                <span
                  class="chord-dot"
                  aria-hidden="true"
                  style={`grid-row: ${Math.ceil(cell / 3)}; grid-column: ${(cell - 1) % 3 + 1}`}
                ></span>
              {/each}
            </span>
          </li>
        {/each}
        <li class="generate-slot">
          <button
            class="generateBtn"
            data-tooltip={$t.focus.shuffle_notes}
            aria-label={$t.focus.shuffle_notes}
            on:click={() => {
              engine.generateProgression();
              sync();
            }}
          >
            <IconRefresh size={16} />
          </button>
        </li>
      </ol>
    {/if}
  {/if}
  {#if !$zen && Tone.Transport.state === "started"}
    <div class="visualizer-container">
      <Visualizer audio={Tone.Master} />
    </div>
  {/if}
</div>

<style>
  .controls {
    position: fixed;
    bottom: 70px;
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    flex-direction: column-reverse;
    justify-content: center;
    align-items: center;
    gap: 5px;
  }

  .play-button {
    width: 70px;
    height: 70px;
    border-radius: 50%;
    background-color: white;
    color: black;
    display: flex;
    justify-content: center;
    align-items: center;
    z-index: 10;
    border: none;
    cursor: pointer;
    box-shadow: 0 4px 8px rgba(0, 0, 0, 0.2);
  }

  .play-button:hover {
    box-shadow: 0 0 10px 0 rgba(0, 0, 0, 0.5);
  }

  .generateBtn {
    color: white;
    border: none;
    border-radius: 50%;
    width: 28px;
    height: 28px;
    padding: 0;
    display: flex;
    justify-content: center;
    align-items: center;
    outline: none;
  }

  .generateBtn:hover {
    background: rgba(255, 255, 255, 0.15);
  }

  .progressionList .generate-slot {
    position: relative;
    padding-inline-start: 8px;
    margin-inline-start: 4px;
  }

  .generate-slot::before {
    content: "";
    position: absolute;
    inset-inline-start: 0;
    top: 6px;
    bottom: 6px;
    width: 1px;
    background: rgba(255, 255, 255, 0.16);
  }

  .progressionList {
    position: fixed;
    bottom: 16px;
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    align-items: center;
    gap: 4px;
    list-style: none;
    margin: 0;
    padding: 5px;
    border-radius: 12px;
    z-index: 1;
  }

  .progressionList li {
    display: grid;
    place-items: center;
    min-width: 26px;
    height: 28px;
    border-radius: 6px;
    color: rgba(255, 255, 255, 0.45);
    font-size: 12px;
    font-variant-numeric: tabular-nums;
  }

  .chord-dots {
    display: grid;
    grid-template-columns: repeat(3, 3px);
    grid-template-rows: repeat(3, 3px);
    gap: 3px;
    width: 15px;
    height: 15px;
    flex: 0 0 15px;
  }

  .chord-dot {
    width: 3px;
    height: 3px;
    min-width: 3px;
    min-height: 3px;
    aspect-ratio: 1;
    border-radius: 50%;
    background: currentColor;
  }

  .progressionList .key {
    position: relative;
    padding-inline: 4px 12px;
    margin-inline-end: 4px;
    color: rgba(255, 255, 255, 0.9);
    font-weight: 600;
  }

  .progressionList .key::after {
    content: "";
    position: absolute;
    inset-inline-end: 0;
    top: 6px;
    bottom: 6px;
    width: 1px;
    background: rgba(255, 255, 255, 0.16);
  }

  .progressionList li.live {
    color: white;
  }

  .visualizer-container {
    position: absolute;
    left: 30px;
    bottom: 18px;
    height: 180px;
    overflow: hidden;
    margin-top: 10px;
  }

  @media only screen and (max-width: 600px) {
    .play-button {
      margin-bottom: 40px;
    }
    .progressionList {
      bottom: 50px;
      gap: 2px;
      padding: 3px;
    }
    .visualizer-container {
      display: none;
    }
  }
</style>
