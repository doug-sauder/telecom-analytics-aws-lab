// events.js
import express from 'express';
import * as db from '../db.js';
import { normalizeEvent } from '../event-schema.js';

const router = express.Router();

/**
 * Accept one PM event over HTTP and persist it immediately.
 * @param {import('express').Request} req Express request whose body contains the event payload.
 * @param {import('express').Response} res Express response used to report validation, duplicate, or server errors.
 * @returns {Promise<void>} Sends an HTTP response with the insert result.
 * @throws {Error} Internal errors are caught and translated into a `500` response inside the handler.
 */
router.post('/', async (req, res) => {
  try {
    const event = normalizeEvent(req.body);

    const { event_id: id, inserted } = await db.insertEvent({
      ...event,
    });

    if (!inserted) {
      return res.status(409).json({ error: 'duplicate_event', event_id: id });
    }

    return res.status(201).json({ event_id: id });
  } catch (err) {
    if (err.message === 'event_time, entity_id, and metrics are required' ||
        err.message === 'metrics must be an object' ||
        err.message === 'event_time must be a valid timestamp string') {
      return res.status(400).json({ error: err.message });
    }

    console.error('Failed to insert event', err);
    return res.status(500).json({ error: 'internal_server_error' });
  }
});

export default router;
