import { jest } from '@jest/globals';

const kafkaBatchTimerEnd = jest.fn();
const metrics = {
  eventsInserted: { inc: jest.fn() },
  eventsRejected: { inc: jest.fn() },
  kafkaMessagesProcessed: { inc: jest.fn() },
  kafkaBatchDurationSeconds: { startTimer: jest.fn(() => kafkaBatchTimerEnd) },
  consumerLag: { set: jest.fn() },
};

jest.unstable_mockModule('../../src/metrics.js', () => ({
  metrics,
}));

const { calculateConsumerLag, processMessages, handleConsumerBatch } = await import('../../src/consumer.js');

describe('calculateConsumerLag', () => {
  it('uses the KafkaJS offsetLag helper when it is available', () => {
    const result = calculateConsumerLag({
      offsetLag: () => '7',
    });

    expect(result).toBe(7);
  });

  it('falls back to high watermark and last offset metadata', () => {
    const result = calculateConsumerLag({
      highWatermark: '10',
      lastOffset: () => '6',
    });

    expect(result).toBe(3);
  });
});

describe('processMessages', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

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
    expect(metrics.eventsInserted.inc).toHaveBeenCalledWith({ path: 'kafka' }, 2);
    expect(metrics.eventsRejected.inc).toHaveBeenCalledWith({ path: 'kafka', reason: 'duplicate' }, 0);
    expect(metrics.kafkaMessagesProcessed.inc).toHaveBeenCalledWith({ result: 'valid' }, 2);
    expect(metrics.kafkaMessagesProcessed.inc).toHaveBeenCalledWith({ result: 'invalid' }, 0);
    expect(result).toEqual({
      processedOffsets: ['1', '2'],
      insertedCount: 2,
      invalidCount: 0,
    });
  });

  it('distinguishes json parse and validation failures when rejecting Kafka messages', async () => {
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
          metrics: [],
        })),
      },
      {
        topic: 'pm.events',
        partition: 0,
        offset: '3',
        value: Buffer.from(JSON.stringify({
          event_time: '2026-01-01T00:00:02Z',
          entity_id: 'cell-2',
          metrics: { dl_prb_util_pct: 12.3 },
        })),
      },
    ], {
      batchSize: 100,
      insertBatch,
      logger,
    });

    expect(insertBatch).toHaveBeenCalledTimes(1);
    expect(metrics.eventsRejected.inc).toHaveBeenCalledWith({ path: 'kafka', reason: 'json_parse' });
    expect(metrics.eventsRejected.inc).toHaveBeenCalledWith({ path: 'kafka', reason: 'validation' });
    expect(metrics.eventsRejected.inc).toHaveBeenCalledWith({ path: 'kafka', reason: 'duplicate' }, 0);
    expect(metrics.kafkaMessagesProcessed.inc).toHaveBeenCalledWith({ result: 'valid' }, 1);
    expect(metrics.kafkaMessagesProcessed.inc).toHaveBeenCalledWith({ result: 'invalid' }, 2);
    expect(logger.warn).toHaveBeenCalledTimes(2);
    expect(logger.warn).toHaveBeenNthCalledWith(1, 'Skipping invalid Kafka message', expect.objectContaining({
      offset: '1',
      reason: 'json_parse',
    }));
    expect(logger.warn).toHaveBeenNthCalledWith(2, 'Skipping invalid Kafka message', expect.objectContaining({
      offset: '2',
      reason: 'validation',
    }));
    expect(result).toEqual({
      processedOffsets: ['3'],
      insertedCount: 1,
      invalidCount: 2,
    });
  });

  it('measures one complete Kafka consumer batch in handleConsumerBatch', async () => {
    const insertBatch = jest.fn(async (events) => ({
      insertedCount: events.length,
      attemptedCount: events.length,
    }));
    const resolveOffset = jest.fn();
    const heartbeat = jest.fn(async () => {});
    const commitOffsetsIfNecessary = jest.fn(async () => {});
    const logger = { info: jest.fn(), warn: jest.fn() };

    await handleConsumerBatch({
      batch: {
        topic: 'pm.events',
        partition: 0,
        highWatermark: '5',
        lastOffset: () => '2',
        messages: [
          {
            offset: '1',
            value: Buffer.from(JSON.stringify({
              event_time: '2026-01-01T00:00:00Z',
              entity_id: 'cell-1',
              metrics: { dl_prb_util_pct: 12.3 },
            })),
          },
          {
            offset: '2',
            value: Buffer.from('not-json'),
          },
        ],
      },
      resolveOffset,
      heartbeat,
      commitOffsetsIfNecessary,
      isRunning: () => true,
      isStale: () => false,
    }, {
      batchSize: 100,
      insertBatch,
      logger,
    });

    expect(metrics.kafkaBatchDurationSeconds.startTimer).toHaveBeenCalledTimes(1);
    expect(kafkaBatchTimerEnd).toHaveBeenCalledTimes(1);
    expect(metrics.consumerLag.set).toHaveBeenCalledWith({
      topic: 'pm.events',
      partition: '0',
    }, 2);
    expect(resolveOffset).toHaveBeenCalledWith('1');
    expect(resolveOffset).toHaveBeenCalledWith('2');
    expect(heartbeat).toHaveBeenCalledTimes(1);
    expect(commitOffsetsIfNecessary).toHaveBeenCalledTimes(1);
  });
});
