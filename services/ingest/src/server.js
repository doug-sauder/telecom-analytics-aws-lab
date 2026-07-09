// Load environment variables from .env file
import 'dotenv/config.js';
import express from 'express';
import eventsRouter from './routes/events.js';
import { ping, initialize } from './db.js';
import { register } from './metrics.js';

// Initialize Express app and middleware
const app = express();
app.use(express.json({ limit: '1mb' }));

// Health check endpoint (kubernetes-style `/healthz`)
app.get('/healthz', (req, res) => res.sendStatus(200));

// Readiness check endpoint (kubernetes-style `/readyz`)
app.get('/readyz', async (req, res) => {
  try {
    await ping();
    res.sendStatus(200);
  } catch {
    res.sendStatus(503);
  }
});

// Metrics endpoint for Prometheus scraping
app.get('/metrics', async (req, res) => {
  try {
    res.set('Content-Type', register.contentType);
    res.end(await register.metrics());
  } catch (err) {
    console.error('Failed to collect metrics', err);
    res.sendStatus(500);
  }
});

// Mount event ingestion routes (legacy alternative to SQS)
app.use('/v1/events', eventsRouter);

const port = process.env.PORT || 3000;

/**
 * Build a shutdown handle for modes that do not need a background event consumer.
 *
 * @returns {object} Consumer-compatible handle with a no-op disconnect method.
 */
function createNoopConsumer() {
  return {
    disconnect: async () => {},
  };
}

/**
 * Start the configured background event consumer when the runtime mode needs one.
 *
 * @param {object} options Runtime selection and logging dependencies.
 * @param {string} [options.eventTransport] Event transport selected by `EVENT_TRANSPORT`.
 * @param {object} [options.logger=console] Logger for startup messages.
 * @returns {Promise<object>} Consumer handle with a `disconnect` method for shutdown.
 * @throws {Error} When `EVENT_TRANSPORT` names an unsupported background consumer.
 */
async function startConfiguredConsumer({
  eventTransport = process.env.EVENT_TRANSPORT,
  logger = console,
} = {}) {
  const normalizedTransport = (eventTransport || 'http').trim().toLowerCase();

  if (normalizedTransport === 'sqs') {
    const { startConsumer } = await import('./consumer.js');
    // Keep health endpoints available while the SQS loop runs in the same process.
    return startConsumer({ logger });
  }

  if (normalizedTransport === 'http') {
    logger.info('EVENT_TRANSPORT not set to sqs; running HTTP ingestion only');
    return createNoopConsumer();
  }

  throw new Error(`Unsupported EVENT_TRANSPORT "${eventTransport}"`);
}

/**
 * Initialize the database, start the HTTP health server, and launch the configured event consumer.
 * 
 * @returns {Promise<void>} Resolves after startup completes; the process remains alive until shutdown.
 * @throws {Error} When startup fails before the service is fully initialized.
 */
async function start() {
  await initialize();
  const server = app.listen(port, () => console.log(`Ingest service listening on ${port}`));
  const consumer = await startConfiguredConsumer();

  const shutdown = async (signal) => {
    console.log(`Received ${signal}, shutting down ingest service`);
    await consumer.disconnect();
    server.close(() => process.exit(0));
  };

  process.once('SIGINT', () => shutdown('SIGINT').catch((err) => {
    console.error('Failed to shut down cleanly', err);
    process.exit(1);
  }));
  process.once('SIGTERM', () => shutdown('SIGTERM').catch((err) => {
    console.error('Failed to shut down cleanly', err);
    process.exit(1);
  }));
}

// Only start server if this module is run directly (not imported for testing)
if (import.meta.url === `file://${process.argv[1]}`) {
  start().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

export { startConfiguredConsumer };

export default app;
