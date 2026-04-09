// Load environment variables from .env file
import 'dotenv/config.js';
import express from 'express';
import eventsRouter from './routes/events.js';
import { ping, initialize } from './db.js';

// Initialize Express app and middleware
const app = express();
app.use(express.json({ limit: '1mb' }));

// Health check endpoint (kubernetes-style `/healthz`)
app.get('/healthz', (req, res) => res.sendStatus(200));

app.get('/readyz', async (req, res) => {
  try {
    await ping();
    res.sendStatus(200);
  } catch {
    res.sendStatus(503);
  }
});

// Mount event ingestion routes
app.use('/v1/events', eventsRouter);

const port = process.env.PORT || 3000;

/**
 * Initialize the database, start the HTTP health server, and launch the Kafka consumer loop.
 * @returns {Promise<void>} Resolves after startup completes; the process remains alive until shutdown.
 * @throws {Error} When startup fails before the service is fully initialized.
 */
async function start() {
  await initialize();
  const server = app.listen(port, () => console.log(`Ingest service listening on ${port}`));
  const { startConsumer } = await import('./consumer.js');
  // Keep health endpoints available while the consumer loop runs in the same process.
  const consumer = await startConsumer();

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

export default app;
