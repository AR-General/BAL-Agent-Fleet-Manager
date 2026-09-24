import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

const ocControllerRoot = fileURLToPath(new URL("..", import.meta.url));
const frontendRoot = fileURLToPath(new URL(".", import.meta.url));
const threePkg = path.join(frontendRoot, "node_modules/three");
const devVrmRoot = process.env.DEV_VRM_ROOT
  ? path.resolve(process.env.DEV_VRM_ROOT)
  : fileURLToPath(new URL("../../dev-vrm", import.meta.url));
const voiceKitSrc = path.join(devVrmRoot, "packages/voice-kit/src");
const characterKitSrc = path.join(devVrmRoot, "packages/character-kit/src/index.ts");
const sceneKitSrc = path.join(devVrmRoot, "packages/scene-kit/src/index.ts");
const objectsKitSrc = path.join(devVrmRoot, "packages/objects-kit/src/index.ts");
const robotsKitSrc = path.join(devVrmRoot, "packages/robots-kit/src/index.ts");
const agentToolsKitSrc = path.join(devVrmRoot, "packages/agent-tools-kit/src/index.ts");
const playgroundAssets = path.join(devVrmRoot, "apps/playground/public/assets");
const skillsRoot = path.join(ocControllerRoot, "skills");

function serveStaticTree(urlPrefix: string, rootDir: string, name: string): Plugin {
  return {
    name,
    configureServer(server) {
      server.middlewares.use(urlPrefix, (req, res, next) => {
        const rel = decodeURIComponent((req.url || "/").split("?")[0] || "/").replace(/^\//, "");
        const file = path.normalize(path.join(rootDir, rel));
        if (!file.startsWith(rootDir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
          next();
          return;
        }
        if (file.endsWith(".md")) res.setHeader("Content-Type", "text/markdown; charset=utf-8");
        else if (file.endsWith(".vrm")) res.setHeader("Content-Type", "model/gltf-binary");
        if (file.endsWith(".vrm") || file.endsWith(".vrma")) {
          res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        } else {
          res.setHeader("Cache-Control", "public, max-age=3600");
        }
        fs.createReadStream(file).pipe(res);
      });
    },
    closeBundle() {
      if (!fs.existsSync(rootDir)) return;
      const dest = path.join(ocControllerRoot, "frontend/dist", urlPrefix.replace(/^\//, ""));
      fs.mkdirSync(dest, { recursive: true });
      fs.cpSync(rootDir, dest, { recursive: true });
    },
  };
}

export default defineConfig({
  plugins: [
    react(),
    serveStaticTree("/dev-vrm-assets", playgroundAssets, "dev-vrm-assets"),
    serveStaticTree("/skills", skillsRoot, "oc-skills"),
  ],
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
    // Kits live outside frontend/; peer `three` must resolve to this app's install.
    dedupe: ["three"],
    alias: {
      three: threePkg,
      // Directory alias so TTS can import pcm-player / tts-fish without evaluating Whisper.
      "@nexus/voice-kit": voiceKitSrc,
      "@nexus/character-kit": characterKitSrc,
      "@nexus/scene-kit": sceneKitSrc,
      "@nexus/objects-kit": objectsKitSrc,
      "@nexus/robots-kit": robotsKitSrc,
      "@nexus/agent-tools-kit": agentToolsKitSrc,
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
        "**/packages/scene-kit/tsconfig.json",
        "**/packages/objects-kit/tsconfig.json",
        "**/packages/robots-kit/tsconfig.json",
        "**/packages/agent-tools-kit/tsconfig.json",
        "**/packages/character-kit/dist/**",
        "**/packages/voice-kit/dist/**",
        "**/packages/scene-kit/dist/**",
        "**/packages/objects-kit/dist/**",
        "**/packages/robots-kit/dist/**",
        "**/packages/agent-tools-kit/dist/**",
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
