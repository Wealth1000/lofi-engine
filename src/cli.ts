import "./nodeGlobals";
import * as readline from "node:readline";
import { spawn } from "node:child_process";
import { AudioEngine } from "./lib/engine/AudioEngine";

const SMOKE = process.argv.includes("--smoke");

const engine = new AudioEngine({
  getVolumes: () => ({ rain: 1, thunder: 1, campfire: 1, jungle: 1, main_track: 1 }),
  setVolumes: () => {},
  getAutoDJMode: () => "MUSIC",
  setAutoDJMode: () => {},
}, {
  emit: (event: string, detail?: any) => {
    console.log("[event]", event, detail ?? "");
  },
});

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
  try { engine.dispose?.(); } catch {}
  restoreTty();
  // escalate if cava ignores SIGTERM
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
    if (key === "\u0003") { // Ctrl+C
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
  // wait for samples
  const waitForReady = () => new Promise<void>((resolve) => {
    const check = () => {
      if (engine.ready) resolve();
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

  setupKeys();
  console.log("Playing. Controls: Space play/pause, n new progression, +/- volume, q quit. cava visualises (Ctrl+C to quit).");

  cava = spawn("cava", [], { stdio: ["ignore", "inherit", "inherit"] });
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