import { jest } from '@jest/globals';
import { processMessages } from '../../src/consumer.js';

describe('processMessages', () => {
  it('normalizes valid Kafka messages and inserts them in batches', async () => {
    const insertBatch = jest.fn(async (events) => ({
      insertedCount: events.length,
      attemptedCount: events.length,
    }));

    const result = await processMessages([
      {
        topic: 'pm.events',
        partition: 0,
        offset: '1',
        value: Buffer.from(JSON.stringify({
          event_id: '11111111-1111-1111-1111-111111111111',
          event_time: '2026-01-01T00:00:00Z',
          entity_id: 'cell-1',
          metrics: { dl_prb_util_pct: 12.3 },
        })),
      },
      {
        topic: 'pm.events',
        partition: 0,
        offset: '2',
        value: Buffer.from(JSON.stringify({
          event_id: '22222222-2222-2222-2222-222222222222',
          event_time: '2026-01-01T00:00:01Z',
          entity_id: 'cell-2',
          metrics: { dl_prb_util_pct: 14.1 },
        })),
      },
    ], {
      batchSize: 1,
      insertBatch,
      logger: { info: jest.fn(), warn: jest.fn() },
    });

    expect(insertBatch).toHaveBeenCalledTimes(2);
    expect(result).toEqual({
      processedOffsets: ['1', '2'],
      insertedCount: 2,
      invalidCount: 0,
    });
  });

  it('skips invalid Kafka messages and only inserts valid records', async () => {
    const logger = { info: jest.fn(), warn: jest.fn() };
    const insertBatch = jest.fn(async (events) => ({
      insertedCount: events.length,
      attemptedCount: events.length,
    }));

    const result = await processMessages([
      {
        topic: 'pm.events',
        partition: 0,
        offset: '1',
        value: Buffer.from('not-json'),
      },
      {
        topic: 'pm.events',
        partition: 0,
        offset: '2',
        value: Buffer.from(JSON.stringify({
          event_time: '2026-01-01T00:00:00Z',
          entity_id: 'cell-1',
          metrics: { dl_prb_util_pct: 12.3 },
        })),
      },
    ], {
      batchSize: 100,
      insertBatch,
      logger,
    });

    expect(insertBatch).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      processedOffsets: ['2'],
      insertedCount: 1,
      invalidCount: 1,
    });
  });
});
