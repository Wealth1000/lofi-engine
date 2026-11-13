import "./nodeGlobals";
import { spawn } from "node:child_process";
import { AudioEngine } from "./lib/engine/AudioEngine";
import { AmbientAudioManager } from "./lib/ambient/AmbientAudioManager";

// ---------- arg parsing ----------
const args = process.argv.slice(2);
const opts = {
  autoDj: "MUSIC" as string,
  effects: [] as string[],
  tracks: [] as number[],
  volume: 1,
  noCava: false,
  build: false,
  help: false,
};

function showHelp() {
  console.log(`lofi-engine — terminal lo-fi player (procedural, never repeating)

Usage:
  lofi-engine [options]

Options:
  -h, --help            Show this help
  --auto-dj <mode>      AutoDJ mode: MUSIC (default), ATMOSPHERE, WORLD, MANUAL
  --effects <list>      Comma-separated effects to enable on start:
                        rain,thunder,jungle,campfire
  --tracks <list>       Comma-separated ambient track ids to enable on start (1-9)
  --volume <0-1>        Main volume (default 1)
  --no-cava             Run engine only, do not spawn cava
  --build               Rebuild CLI bundle before running

Ambience:
  Effects/tracks can be seeded at startup with --effects/--tracks.
  AutoDJ (ATMOSPHERE/WORLD) automatically toggles effects/tracks over time.
  MUSIC mode keeps the procedural track only.

Examples:
  lofi-engine
  lofi-engine --auto-dj WORLD
  lofi-engine --effects rain,thunder --tracks 1,3 --volume 0.8
`);
}

for (let i = 0; i < args.length; i++) {
  const a = args[i];
  switch (a) {
    case "-h":
    case "--help":
      opts.help = true;
      break;
    case "--auto-dj":
      opts.autoDj = (args[++i] || "MUSIC").toUpperCase();
      break;
    case "--effects":
      opts.effects = (args[++i] || "").split(",").map((s) => s.trim()).filter(Boolean);
      break;
    case "--tracks":
      opts.tracks = (args[++i] || "").split(",").map((s) => parseInt(s.trim(), 10)).filter((n) => Number.isFinite(n));
      break;
    case "--volume":
      opts.volume = Math.max(0, Math.min(1, parseFloat(args[++i] || "1")));
      break;
    case "--no-cava":
      opts.noCava = true;
      break;
    case "--build":
      opts.build = true;
      break;
    default:
      console.error("Unknown option: " + a);
      showHelp();
      process.exit(2);
  }
}

if (opts.help) {
  showHelp();
  process.exit(0);
}

// ---------- engine ----------
const engine = new AudioEngine(
  {
    storage: {
      getVolumes: () => ({ rain: 1, thunder: 1, campfire: 1, jungle: 1, main_track: opts.volume }),
      setVolumes: () => {},
      getAutoDJMode: () => opts.autoDj,
      setAutoDJMode: () => {},
    },
    events: {
      emit: (event: string, detail?: any) => {
        if (event.startsWith("lofi-toggle-")) {
          const name = event.replace("lofi-toggle-", "");
          if (name === "track") {
            ambient?.toggleTrack(detail?.id);
          } else {
            // map campfire/fire naming: engine emits campfire
            ambient?.toggleEffect(name === "campfire" ? "campfire" : name);
          }
        }
      },
    },
  },
);

const ambient = new AmbientAudioManager();

let cava: any = null;
let cavaExited = false;
let finishing = false;

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
  try { ambient.dispose(); } catch {}
  try { engine.dispose(); } catch {}
  setTimeout(() => {
    if (!cavaExited && cava && !cava.killed) {
      try { cava.kill("SIGKILL"); } catch {}
    }
    process.exit(code);
  }, 1500);
}

async function main() {
  console.log("LoFi Engine CLI");
  console.log("Loading samples...");
  const waitForReady = () =>
    new Promise<void>((resolve) => {
      const check = () => {
        if (engine.ready && ambient.ready) resolve();
        else setTimeout(check, 100);
      };
      check();
    });
  await waitForReady();
  console.log("Samples loaded. Starting audio...");
  engine.volume = opts.volume;
  engine.autoDJMode = opts.autoDj;
  engine.start();

  // seed effects/tracks
  for (const e of opts.effects) ambient.toggleEffect(e);
  for (const t of opts.tracks) ambient.toggleTrack(t);

  if (opts.noCava) {
    console.log("Running without cava. Press Ctrl+C to quit.");
  } else {
    console.log("Playing. cava visualises. Press Ctrl+C to quit.");
    cava = spawn("cava", [], { stdio: "inherit" });
    cava.on("exit", () => {
      cavaExited = true;
      finish(0);
    });
    cava.on("error", (err: any) => {
      console.error("cava failed to start:", err?.message || err);
      finish(1);
    });
  }

  process.on("SIGINT", () => finish(0));
  process.on("SIGTERM", () => finish(0));
}

main().catch((err) => {
  console.error(err);
  finish(1);
});
