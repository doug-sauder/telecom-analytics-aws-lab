/**
 * Normalize and validate an incoming PM event payload for downstream storage.
 * @param {object} payload Raw event payload from HTTP or Kafka.
 * @returns {object} Normalized event with defaults applied and `event_time` converted to ISO format.
 * @throws {Error} When required fields are missing, `metrics` is not an object, or `event_time` is invalid.
 */
function normalizeEvent(payload = {}) {
  const {
    event_id,
    schema_version = 1,
    source = 'ingest',
    event_time,
    entity_type = 'cell',
    entity_id,
    metrics,
  } = payload;

  if (!event_time || !entity_id || metrics == null) {
    throw new Error('validation: event_time, entity_id, and metrics are required');
  }

  if (typeof metrics !== 'object' || Array.isArray(metrics)) {
    throw new Error('validation: metrics must be an object');
  }

  const ts = new Date(event_time);
  if (Number.isNaN(ts.getTime())) {
    throw new Error('validation: event_time must be a valid timestamp string');
  }

  return {
    event_id,
    schema_version,
    source,
    event_time: ts.toISOString(),
    entity_type,
    entity_id,
    metrics,
  };
}

export { normalizeEvent };

export default {
  normalizeEvent,
};
