import "./nodeGlobals";
import * as Tone from "tone";
import { spawn, execSync } from "child_process";
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

// Save tty settings for restoration on exit (lofi-relay style).
let savedTty = "";
if (process.stdin.isTTY) {
  try {
    savedTty = execSync("stty -g", { encoding: "utf8", stdio: ["inherit", "pipe", "pipe"] }).trim();
  } catch (e) {
    savedTty = "";
  }
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

  console.log("Playing. cava visualiser owns the terminal; Ctrl+C to quit.");

  // Spawn cava as the foreground child process. The engine keeps running in
  // this (background) process.
  let cava: any;
  try {
    cava = spawn("cava", [], { stdio: "inherit" });
  } catch (err) {
    console.error("Failed to spawn cava:", err);
    try { engine.stop(); } catch {}
    try { engine.dispose(); } catch {}
    process.exit(1);
  }

  if (!cava.pid) {
    console.error("Failed to spawn cava: no pid");
    try { engine.stop(); } catch {}
    try { engine.dispose(); } catch {}
    process.exit(1);
  }

  const cavaPid = cava.pid;
  let enginePid = process.pid;

  let shuttingDown = false;
  const teardown = (exitCode: number) => {
    if (shuttingDown) return;
    shuttingDown = true;

    // Terminate the cava child if still alive.
    try {
      if (cava && cava.exitCode === null && cava.signalCode === null) {
        cava.kill("SIGTERM");
      }
    } catch (e) {
      // ignore
    }

    // Terminate engine (stop playback + dispose).
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

    // Clean up tracked PIDs.
    void cavaPid;
    void enginePid;

    const finish = () => {
      // Restore tty.
      if (savedTty) {
        try {
          execSync(`stty ${savedTty}`, { stdio: "inherit" });
        } catch (e) {
          // ignore
        }
      } else if (process.stdin.isTTY) {
        try {
          process.stdin.setRawMode(false);
        } catch (e) {
          // ignore
        }
      }
      process.exit(exitCode);
    };

    if (cava.exitCode !== null || cava.signalCode !== null) {
      finish();
    } else {
      const timer = setTimeout(finish, 2000);
      cava.once("exit", () => {
        clearTimeout(timer);
        finish();
      });
    }
  };

  cava.on("error", (err) => {
    console.error("cava error:", err);
    teardown(1);
  });

  cava.on("exit", (code, signal) => {
    teardown(code === null ? 0 : code);
  });

  process.on("SIGINT", () => teardown(0));
  process.on("SIGTERM", () => teardown(0));
}

main().catch((err) => {
  console.error("CLI failed:", err);
  process.exit(1);
});
