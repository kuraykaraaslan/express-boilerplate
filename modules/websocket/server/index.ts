import 'reflect-metadata';
import 'dotenv/config';
import Logger from '@kuraykaraaslan-labs/logger';
import { runWsProcess } from './websocket.process';

/**
 * Entry point of `npm run ws:start` and the `ws` image — all wiring lives in `gateway.ts`; `websocket.process.ts` decides
 * whether this process is the gateway or, with PROC_WS_ENABLED=true, the supervisor of gateway children (07 task 7).
 */
runWsProcess().catch((err) => {
  Logger.error(`[websocket] fatal: ${err}`);
  process.exit(1);
});
