/** Starts the server: `npx tsx server/main.ts`. HOST and PORT override config/tambat.json server.host and server.port. */
import { config } from '../src/config.js';
import { buildApp } from './app.js';

const app = buildApp({ logger: true });
const port = Number(process.env.PORT ?? config.server.port);
await app.listen({ host: process.env.HOST ?? config.server.host, port });
