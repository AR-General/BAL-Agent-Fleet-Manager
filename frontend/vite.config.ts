import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

const ocControllerRoot = fileURLToPath(new URL("..", import.meta.url));
const devVrmRoot = process.env.DEV_VRM_ROOT
  ? path.resolve(process.env.DEV_VRM_ROOT)
  : fileURLToPath(new URL("../../dev-vrm", import.meta.url));
const voiceKitSrc = path.join(devVrmRoot, "packages/voice-kit/src");
const characterKitSrc = path.join(devVrmRoot, "packages/character-kit/src/index.ts");
const playgroundAssets = path.join(devVrmRoot, "apps/playground/public/assets");

function serveDevVrmAssets(): Plugin {
  return {
    name: "dev-vrm-assets",
    configureServer(server) {
      server.middlewares.use("/dev-vrm-assets", (req, res, next) => {
        const rel = decodeURIComponent((req.url || "/").split("?")[0] || "/").replace(/^\//, "");
        const file = path.normalize(path.join(playgroundAssets, rel));
        if (!file.startsWith(playgroundAssets) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
          next();
          return;
        }
        if (file.endsWith(".vrm") || file.endsWith(".vrma")) {
          res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        } else {
          res.setHeader("Cache-Control", "public, max-age=3600");
        }
        if (file.endsWith(".vrm")) res.setHeader("Content-Type", "model/gltf-binary");
        fs.createReadStream(file).pipe(res);
      });
    },
    closeBundle() {
      if (!fs.existsSync(playgroundAssets)) return;
      const dest = path.join(ocControllerRoot, "frontend/dist/dev-vrm-assets");
      fs.mkdirSync(dest, { recursive: true });
      fs.cpSync(playgroundAssets, dest, { recursive: true });
    },
  };
}

export default defineConfig({
  plugins: [react(), serveDevVrmAssets()],
  // wlipsync (via three-vrm-lip-sync) uses top-level await; default Vite targets reject it.
  esbuild: {
    target: "esnext",
  },
  optimizeDeps: {
    // Barrel-importing Whisper pulls transformers.js; prebundling it mid-session full-reloads the tab.
    exclude: ["@huggingface/transformers"],
    esbuildOptions: {
      target: "esnext",
    },
  },
  resolve: {
    alias: {
      // Directory alias so TTS can import pcm-player / tts-fish without evaluating Whisper.
      "@openclaw/voice-kit": voiceKitSrc,
      "@openclaw/character-kit": characterKitSrc,
    },
  },
  server: {
    port: 3080,
    fs: {
      // `".."` is only oc-controller. Aliases and pnpm deps live under ../../dev-vrm;
      // without that, a restart 403s voice-kit and the browser does a full reload.
      allow: [ocControllerRoot, devVrmRoot],
    },
    watch: {
      ignored: [
        "**/*.tsbuildinfo",
        "**/migration_docs/**",
        "**/packages/character-kit/tsconfig.json",
        "**/packages/voice-kit/tsconfig.json",
        "**/packages/character-kit/dist/**",
        "**/packages/voice-kit/dist/**",
      ],
    },
    warmup: {
      clientFiles: ["./src/hooks/useStreamingTts.ts", "./src/components/chat/SceneVoiceDock.tsx"],
    },
    proxy: {
      "/api/speaches": {
        target: process.env.SPEACHES_URL || "http://127.0.0.1:8090",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api\/speaches/, ""),
      },
      "/api": { target: "http://127.0.0.1:3800", changeOrigin: true, ws: true },
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "esnext",
  },
});
