import { QueueProcessor } from './queue-processor';
import { assertSecureConfig } from './env';

const globalForInit = globalThis as unknown as { __queueProcessorStarted?: boolean };

export function initializeServer() {
  if (globalForInit.__queueProcessorStarted) return;
  globalForInit.__queueProcessorStarted = true;

  // Refuse to run with default secrets / credentials in production.
  assertSecureConfig();

  QueueProcessor.start();
  console.log('[Init] Server-side initialization complete');
}
