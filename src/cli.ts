import "./nodeGlobals";
import * as readline from "node:readline";
import { spawn } from "node:child_process";
import { AudioEngine, DEFAULT_VOLUMES } from "./lib/engine/AudioEngine";
import AmbientAudioManager from "./lib/ambient/AmbientAudioManager";

const SMOKE = process.argv.includes("--smoke");

const storage = {
  getVolumes: () => ({ ...DEFAULT_VOLUMES }),
  setVolumes: () => {},
  getAutoDJMode: () => "MUSIC",
  setAutoDJMode: () => {},
};

const ambient = new AmbientAudioManager();

const engine = new AudioEngine({
  storage,
  events: {
    emit: (event: string, detail?: any) => {
      console.log("[event]", event, detail ?? "");
      if (event === "lofi-toggle-rain") ambient.toggleEffect("rain");
      else if (event === "lofi-toggle-thunder") ambient.toggleEffect("thunder");
      else if (event === "lofi-toggle-jungle") ambient.toggleEffect("jungle");
      else if (event === "lofi-toggle-campfire") ambient.toggleEffect("campfire");
      else if (event === "lofi-toggle-track") ambient.toggleTrack(detail?.id);
    },
  },
});

const initialVolumes = storage.getVolumes() || DEFAULT_VOLUMES;
for (const id of ["rain", "thunder", "jungle", "campfire"]) {
  ambient.setEffectVolume(id, (initialVolumes as any)[id] ?? 1);
}
for (let i = 1; i <= 9; i++) {
  ambient.setTrackVolume(i, (initialVolumes as any).main_track ?? 1);
}

const originalEngineStop = engine.stop.bind(engine);
engine.stop = () => {
  originalEngineStop();
  try { ambient.stopAllTracks(); } catch {}
};

let cava: any = null;
let cavaExited = false;
let finishing = false;
let rawModeSet = false;

function restoreTty() {
  if (rawModeSet && process.stdin.isTTY) {
    try { process.stdin.setRawMode(false); } catch {}
    rawModeSet = false;
  }
  try { process.stdin.pause(); } catch {}
}

function killCava() {
  if (cava && !cava.killed && !cavaExited) {
    try { cava.kill("SIGTERM"); } catch {}
  }
}

function finish(code = 0) {
  if (finishing) return;
  finishing = true;
  killCava();
  try { engine.stop(); } catch {}
  try { ambient.stopAllTracks(); } catch {}
  try { engine.dispose?.(); } catch {}
  try { ambient.dispose?.(); } catch {}
  restoreTty();
  setTimeout(() => {
    if (!cavaExited && cava && !cava.killed) {
      try { cava.kill("SIGKILL"); } catch {}
    }
    process.exit(code);
  }, 1500);
}

function setupKeys() {
  if (!process.stdin.isTTY) return;
  process.stdin.setRawMode(true);
  rawModeSet = true;
  process.stdin.resume();
  process.stdin.on("data", (buf: Buffer) => {
    const key = buf.toString();
    if (key === "\u0003") {
      finish(0);
      return;
    }
    if (key === " ") {
      engine.toggle();
      return;
    }
    if (key === "n" || key === "N") {
      engine.generateProgression();
      console.log("[action] new progression");
      return;
    }
    if (key === "+" || key === "=") {
      engine.volume = Math.min(1, engine.volume + 0.1);
      console.log("[volume]", engine.volume.toFixed(2));
      return;
    }
    if (key === "-" || key === "_") {
      engine.volume = Math.max(0, engine.volume - 0.1);
      console.log("[volume]", engine.volume.toFixed(2));
      return;
    }
    if (key === "q" || key === "Q") {
      finish(0);
      return;
    }
  });
}

async function main() {
  console.log("LoFi Engine CLI");
  console.log("Loading samples...");
  const waitForReady = () => new Promise<void>((resolve) => {
    const check = () => {
      if (engine.ready && ambient.ready) resolve();
      else setTimeout(check, 100);
    };
    check();
  });
  await waitForReady();
  console.log("Samples loaded. Starting audio...");
  engine.start();
  if (SMOKE) {
    console.log("Smoke mode: exiting in 2s");
    await new Promise((r) => setTimeout(r, 2000));
    finish(0);
    return;
  }

  console.log("Playing. Audio running; cava visualises. Press Ctrl+C to quit.");

  cava = spawn("cava", [], { stdio: "inherit" });
  cava.on("exit", () => {
    cavaExited = true;
    finish(0);
  });
  cava.on("error", (err: any) => {
    console.error("cava failed to start:", err?.message || err);
    finish(1);
  });

  process.on("SIGINT", () => finish(0));
  process.on("SIGTERM", () => finish(0));
}

main().catch((err) => {
  console.error(err);
  finish(1);
});