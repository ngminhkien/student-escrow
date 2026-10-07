import { createServer } from "vite";

// Own the Vite server directly instead of leaving an npm.cmd process tree on Windows.
export default async function setup() {
  const server = await createServer({ server: { port: 5174, strictPort: true } });
  await server.listen();
  return async () => { await server.close(); };
}
