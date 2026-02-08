import { QueueProcessor } from './queue-processor';

const globalForInit = globalThis as unknown as { __queueProcessorStarted?: boolean };

export function initializeServer() {
  if (globalForInit.__queueProcessorStarted) return;
  globalForInit.__queueProcessorStarted = true;

  QueueProcessor.start();
  console.log('[Init] Server-side initialization complete');
}
