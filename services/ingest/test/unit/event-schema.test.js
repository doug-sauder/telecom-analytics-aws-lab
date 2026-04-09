import { normalizeEvent } from '../../src/event-schema.js';

describe('normalizeEvent', () => {
  it('normalizes a valid event payload', () => {
    const event = normalizeEvent({
      event_time: '2026-01-01T00:00:00Z',
      entity_id: 'cell-1',
      metrics: { dl_prb_util_pct: 12.3 },
    });

    expect(event).toEqual({
      event_id: undefined,
      schema_version: 1,
      source: 'ingest',
      event_time: '2026-01-01T00:00:00.000Z',
      entity_type: 'cell',
      entity_id: 'cell-1',
      metrics: { dl_prb_util_pct: 12.3 },
    });
  });

  it('rejects missing required fields', () => {
    expect(() => normalizeEvent({})).toThrow('event_time, entity_id, and metrics are required');
  });

  it('rejects non-object metrics', () => {
    expect(() => normalizeEvent({
      event_time: '2026-01-01T00:00:00Z',
      entity_id: 'cell-1',
      metrics: [],
    })).toThrow('metrics must be an object');
  });
});
