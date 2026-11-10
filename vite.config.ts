import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import sveltePreprocess from "svelte-preprocess";

const cliBanner =
  "const __waa = require('web-audio-api'); if(!global.window) global.window = global; for (const __k of Object.keys(__waa)) { global[__k]=__waa[__k]; global.window[__k]=__waa[__k]; } var window = global;";

const cliConfig = {
  build: {
    target: "node20",
    ssr: true,
    outDir: "dist-cli",
    rollupOptions: {
      input: "src/cli.ts",
      output: {
        format: "cjs",
        entryFileNames: "cli.cjs",
        banner: cliBanner,
      },
    },
  },
  ssr: {
    noExternal: ["tone"],
  },
};

// https://vitejs.dev/config/
export default defineConfig(async ({ mode }) => {
  if (process.env.CLI_BUILD === "1" || mode === "cli") {
    return cliConfig;
  }

  return {
    base: "./",
    plugins: [
      svelte({
        preprocess: [
          sveltePreprocess({
            typescript: true,
          }),
        ],
      }),
    ],

    // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
    // prevent vite from obscuring rust errors
    clearScreen: false,
    // tauri expects a fixed port, fail if that port is not available
    server: {
      port: 1420,
      strictPort: true,
    },
    // to make use of `TAURI_DEBUG` and other env variables
    // https://tauri.studio/v1/api/config#buildconfig.beforedevcommand
    envPrefix: ["VITE_", "TAURI_"],
    build: {
      // Tauri supports es2021
      target: process.env.TAURI_PLATFORM == "windows" ? "chrome105" : "safari13",
      // don't minify for debug builds
      minify: !process.env.TAURI_DEBUG ? "esbuild" : false,
      // produce sourcemaps for debug builds
      sourcemap: !!process.env.TAURI_DEBUG,
    },
  };
});
