import "./nodeGlobals";
import * as Tone from "tone";
import AudioEngine, { DEFAULT_VOLUMES } from "./lib/engine/AudioEngine";

class NodeStorage {
  private volumes: Record<string, number> = { ...DEFAULT_VOLUMES };
  private mode: string = "MUSIC";

  getVolumes(): Record<string, number> {
    return { ...this.volumes };
  }
  setVolumes(volumes: Record<string, number>): void {
    this.volumes = { ...volumes };
  }
  getAutoDJMode(): string {
    return this.mode;
  }
  setAutoDJMode(mode: string): void {
    this.mode = mode;
  }
}

const storage = new NodeStorage();
const events = {
  emit(name: string, detail?: any): void {
    console.log(`[event] ${name}`, detail !== undefined ? detail : "");
  },
};

const engine = new AudioEngine({ storage, events });

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

async function main(): Promise<void> {
  console.log("LoFi Engine CLI");
  console.log("Loading samples...");

  const deadline = Date.now() + 60000;
  while (!engine.ready && Date.now() < deadline) {
    await sleep(100);
  }
  if (!engine.ready) {
    console.error("Timed out waiting for samples to load.");
    process.exit(1);
  }
  console.log("Samples loaded. Starting audio...");

  try {
    await Tone.start();
  } catch (err) {
    console.warn("Tone.start() warning:", err);
  }
  engine.start();

  console.log("Playing. Controls: Space toggle, n new progression, +/- volume, q quit");

  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
  }
  process.stdin.resume();
  process.stdin.setEncoding("utf8");

  let shutdownCalled = false;
  const shutdown = () => {
    if (shutdownCalled) return;
    shutdownCalled = true;
    console.log("\nShutting down...");
    try {
      engine.stop();
    } catch (e) {
      // ignore
    }
    try {
      engine.dispose();
    } catch (e) {
      // ignore
    }
    if (process.stdin.isTTY) {
      try {
        process.stdin.setRawMode(false);
      } catch (e) {
        // ignore
      }
    }
    process.exit(0);
  };

  process.stdin.on("data", (key: string) => {
    if (key === "q" || key === "Q") {
      shutdown();
      return;
    }
    if (key === "\u0003") {
      shutdown();
      return;
    }
    if (key === " ") {
      engine.toggle();
      console.log(engine.isPlaying ? "Playing" : "Paused");
      return;
    }
    if (key === "n" || key === "N") {
      engine.generateProgression();
      console.log("Generated new progression (key " + engine.key + ")");
      return;
    }
    if (key === "+" || key === "=") {
      const next = clamp(engine.volume + 0.1, 0, 1);
      engine.volume = next;
      console.log(`Volume: ${Math.round(next * 100)}%`);
      return;
    }
    if (key === "-" || key === "_") {
      const next = clamp(engine.volume - 0.1, 0, 1);
      engine.volume = next;
      console.log(`Volume: ${Math.round(next * 100)}%`);
      return;
    }
  });

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("CLI failed:", err);
  process.exit(1);
});
