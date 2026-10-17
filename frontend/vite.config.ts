import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, fileURLToPath(new URL(".", import.meta.url)), "");
  const proxy = {
    "/api": { target: env.API_PROXY_TARGET || "http://localhost:5180", changeOrigin: true },
    "/rpc": { target: env.RPC_PROXY_TARGET || "http://127.0.0.1:8545", changeOrigin: true, rewrite: (path: string) => path.replace(/^\/rpc/, "") || "/" }
  };
  return {
    plugins: [react()],
    server: { host: "127.0.0.1", port: 5173, strictPort: true, proxy,
      fs: { allow: [fileURLToPath(new URL(".", import.meta.url)), fileURLToPath(new URL("../blockchain/deployment/Escrow.abi.json", import.meta.url))] } },
    preview: { host: "127.0.0.1", port: 5173, strictPort: true, proxy }
  };
});
