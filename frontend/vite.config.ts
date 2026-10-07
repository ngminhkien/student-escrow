import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

const proxy = {
  "/api": { target: "http://localhost:5180", changeOrigin: true },
  "/rpc": { target: "http://127.0.0.1:8545", changeOrigin: true, rewrite: (path: string) => path.replace(/^\/rpc/, "") || "/" }
};
export default defineConfig({
  plugins: [react()],
  server: { host: "127.0.0.1", port: 5173, strictPort: true, proxy,
    fs: { allow: [fileURLToPath(new URL(".", import.meta.url)), fileURLToPath(new URL("../blockchain/deployment/Escrow.abi.json", import.meta.url))] } },
  preview: { host: "127.0.0.1", port: 5173, strictPort: true, proxy }
});
