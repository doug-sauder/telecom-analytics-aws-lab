// Database module for Postgres connection and event insertion
import { Pool } from 'pg';
import { randomUUID } from 'crypto';

/**
 * Build the Postgres TLS configuration from the standard `PGSSLMODE` environment variable.
 *
 * @returns {object|undefined} Node-postgres SSL options, or undefined for default non-TLS behavior.
 */
function buildSslConfig() {
  const sslMode = (process.env.PGSSLMODE || '').trim().toLowerCase();

  if (sslMode === 'require') {
    return { rejectUnauthorized: false };
  }

  return undefined;
}

// Initialize Postgres connection pool from environment variables
const pool = new Pool({
  host: process.env.PGHOST || 'localhost',
  port: process.env.PGPORT ? Number(process.env.PGPORT) : 5432,
  user: process.env.PGUSER || 'telecom',
  password: process.env.PGPASSWORD || 'telecom',
  database: process.env.PGDATABASE || 'telecom',
  connectionTimeoutMillis: 5000,
  ssl: buildSslConfig(),
});

/**
 * Verify the Postgres connection pool can acquire a client and execute a query.
 * @returns {Promise<void>} Resolves when the connectivity check succeeds.
 * @throws {Error} When Postgres is unavailable or authentication fails.
 */
async function initialize() {
  const client = await pool.connect();
  try {
    await client.query('SELECT 1');
  } finally {
    client.release();
  }
}

/**
 * Run a lightweight readiness query against Postgres.
 * @returns {Promise<void>} Resolves when the database responds successfully.
 * @throws {Error} When the database is not ready.
 */
async function ping() {
  await pool.query('SELECT 1');
}

/**
 * Insert a single PM event into `analytics.pm_events`.
 * @param {object} event Event fields matching the database schema.
 * @param {string} [event.event_id] Optional event id; a UUID is generated when omitted.
 * @param {number} [event.schema_version=1] Schema version recorded with the event.
 * @param {string} [event.source='ingest'] Logical source name for the event.
 * @param {string} event.event_time ISO timestamp for the event.
 * @param {string} [event.entity_type='cell'] Telecom entity type for the event.
 * @param {string} event.entity_id Entity identifier for the event.
 * @param {object} event.metrics Metrics payload stored as JSONB.
 * @returns {Promise<object>} `{ event_id, inserted }`, where `inserted` is `false` for duplicates.
 * @throws {Error} When the database insert fails.
 */
async function insertEvent({
  event_id,
  schema_version = 1,
  source = 'ingest',
  event_time,
  entity_type = 'cell',
  entity_id,
  metrics,
}) {
  const id = event_id || randomUUID();

  const q = `
    INSERT INTO analytics.pm_events
      (event_id, schema_version, source, event_time, entity_type, entity_id, metrics)
      VALUES ($1,$2,$3,$4,$5,$6,$7)
      ON CONFLICT (event_id) DO NOTHING
      RETURNING event_id
  `;

  const params = [id, schema_version, source, event_time, entity_type, entity_id, metrics];
  const result = await pool.query(q, params);

  return {
    event_id: id,
    inserted: result.rowCount === 1,
  };
}

/**
 * Insert multiple PM events in one SQL statement using idempotent conflict handling.
 * @param {object[]} events Normalized events ready for persistence.
 * @returns {Promise<object>} `{ insertedCount, attemptedCount }` summarizing the batch write.
 * @throws {Error} When Postgres rejects the batch insert.
 */
async function insertEventsBatch(events) {
  if (events.length === 0) {
    return {
      insertedCount: 0,
      attemptedCount: 0,
    };
  }

  const values = [];
  // Build a single parameterized INSERT so queue batches map to one DB round-trip.
  const placeholders = events.map((event, index) => {
    const base = index * 7;
    values.push(
      event.event_id || randomUUID(),
      event.schema_version ?? 1,
      event.source ?? 'ingest',
      event.event_time,
      event.entity_type ?? 'cell',
      event.entity_id,
      event.metrics,
    );

    return `($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6},$${base + 7})`;
  });

  const q = `
    INSERT INTO analytics.pm_events
      (event_id, schema_version, source, event_time, entity_type, entity_id, metrics)
      VALUES ${placeholders.join(',')}
      ON CONFLICT (event_id) DO NOTHING
      RETURNING event_id
  `;

  const result = await pool.query(q, values);

  return {
    insertedCount: result.rowCount,
    attemptedCount: events.length,
  };
}

export {
  pool,
  initialize,
  ping,
  insertEvent,
  insertEventsBatch,
};

export default {
  pool,
  initialize,
  ping,
  insertEvent,
  insertEventsBatch,
};
