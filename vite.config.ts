import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import wasm from "vite-plugin-wasm";
import topLevelAwait from "vite-plugin-top-level-await";
import path from "path";

const host = process.env.VITE_DEV_HOST;

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const gmailClientId = env.GMAIL_OAUTH_CLIENT_ID || process.env.GMAIL_OAUTH_CLIENT_ID || "";
  const gmailClientSecret = env.GMAIL_OAUTH_CLIENT_SECRET || process.env.GMAIL_OAUTH_CLIENT_SECRET || "";

  return {
    envPrefix: ["VITE_", "GMAIL_"],
    define: {
      "import.meta.env.GMAIL_OAUTH_CLIENT_ID": JSON.stringify(gmailClientId),
      "import.meta.env.GMAIL_OAUTH_CLIENT_SECRET": JSON.stringify(gmailClientSecret),
    },
    plugins: [wasm(), react(), tailwindcss()],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
    build: {
      target: "esnext",
      rollupOptions: {
        input: {
          main: path.resolve(__dirname, "index.html"),
        },
      },
    },
    clearScreen: false,
    server: {
      port: 1420,
      strictPort: true,
      host: host || "127.0.0.1",
      hmr: host
        ? {
            protocol: "ws",
            host,
            port: 1421,
          }
        : undefined,
      watch: {
        ignored: ["**/crates/**"],
      },
    },
  };
});
