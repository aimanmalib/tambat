/** Local ports for end-to-end tests (kept away from ports other local tools commonly use). */
const port = Number(process.env.E2E_PORT ?? 4310);
const relayPort = Number(process.env.E2E_RELAY_PORT ?? 4311);

export const E2E = {
  port,
  relayPort,
  origin: `http://127.0.0.1:${port}`,
  relayUrl: `ws://127.0.0.1:${relayPort}`,
};
