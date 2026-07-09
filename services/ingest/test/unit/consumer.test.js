import { jest } from '@jest/globals';

const sqsBatchTimerEnd = jest.fn();
const metrics = {
  eventsInserted: { inc: jest.fn() },
  eventsRejected: { inc: jest.fn() },
  sqsMessagesProcessed: { inc: jest.fn() },
  sqsBatchDurationSeconds: { startTimer: jest.fn(() => sqsBatchTimerEnd) },
};

jest.unstable_mockModule('../../src/metrics.js', () => ({
  metrics,
}));

const {
  processMessages,
  deleteProcessedMessages,
  handleSqsMessages,
} = await import('../../src/consumer.js');

// Test helpers keep individual cases focused on SQS behavior instead of payload boilerplate.

/**
 * Build a valid PM event body for SQS tests.
 *
 * @param {string} entityId Telecom entity identifier to include in the event.
 * @returns {string} JSON-encoded event body.
 */
function validEventBody(entityId) {
  return JSON.stringify({
    event_time: '2026-01-01T00:00:00Z',
    entity_id: entityId,
    metrics: { dl_prb_util_pct: 12.3 },
  });
}

describe('processMessages', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('normalizes valid SQS messages and inserts them in database batches', async () => {
    const insertBatch = jest.fn(async (events) => ({
      insertedCount: events.length,
      attemptedCount: events.length,
    }));

    const result = await processMessages([
      {
        messageId: 'message-1',
        receiptHandle: 'receipt-1',
        body: validEventBody('cell-1'),
      },
      {
        messageId: 'message-2',
        receiptHandle: 'receipt-2',
        body: validEventBody('cell-2'),
      },
    ], {
      batchSize: 1,
      insertBatch,
      logger: { info: jest.fn(), warn: jest.fn() },
    });

    expect(insertBatch).toHaveBeenCalledTimes(2);
    expect(metrics.eventsInserted.inc).toHaveBeenCalledWith({ path: 'sqs' }, 2);
    expect(metrics.eventsRejected.inc).toHaveBeenCalledWith({ path: 'sqs', reason: 'duplicate' }, 0);
    expect(metrics.sqsMessagesProcessed.inc).toHaveBeenCalledWith({ result: 'valid' }, 2);
    expect(result).toEqual({
      receiptHandlesToDelete: ['receipt-1', 'receipt-2'],
      insertedCount: 2,
      invalidCount: 0,
    });
  });

  it('distinguishes json parse and validation failures when rejecting SQS messages', async () => {
    const logger = { info: jest.fn(), warn: jest.fn() };
    const insertBatch = jest.fn(async (events) => ({
      insertedCount: events.length,
      attemptedCount: events.length,
    }));

    const result = await processMessages([
      {
        messageId: 'message-1',
        receiptHandle: 'receipt-1',
        body: 'not-json',
      },
      {
        messageId: 'message-2',
        receiptHandle: 'receipt-2',
        body: JSON.stringify({
          event_time: '2026-01-01T00:00:00Z',
          entity_id: 'cell-1',
          metrics: [],
        }),
      },
      {
        messageId: 'message-3',
        receiptHandle: 'receipt-3',
        body: validEventBody('cell-2'),
      },
    ], {
      batchSize: 100,
      insertBatch,
      logger,
    });

    expect(insertBatch).toHaveBeenCalledTimes(1);
    expect(metrics.eventsRejected.inc).toHaveBeenCalledWith({ path: 'sqs', reason: 'json_parse' });
    expect(metrics.eventsRejected.inc).toHaveBeenCalledWith({ path: 'sqs', reason: 'validation' });
    expect(metrics.eventsRejected.inc).toHaveBeenCalledWith({ path: 'sqs', reason: 'duplicate' }, 0);
    expect(metrics.sqsMessagesProcessed.inc).toHaveBeenCalledWith({ result: 'valid' }, 1);
    expect(metrics.sqsMessagesProcessed.inc).toHaveBeenCalledWith({ result: 'invalid' });
    expect(logger.warn).toHaveBeenCalledTimes(2);
    expect(logger.warn).toHaveBeenNthCalledWith(1, 'Skipping invalid SQS message', expect.objectContaining({
      messageId: 'message-1',
      reason: 'json_parse',
    }));
    expect(logger.warn).toHaveBeenNthCalledWith(2, 'Skipping invalid SQS message', expect.objectContaining({
      messageId: 'message-2',
      reason: 'validation',
    }));
    expect(result).toEqual({
      receiptHandlesToDelete: ['receipt-1', 'receipt-2', 'receipt-3'],
      insertedCount: 1,
      invalidCount: 2,
    });
  });
});

describe('deleteProcessedMessages', () => {
  it('deletes receipt handles in SQS API-sized batches', async () => {
    const sqsClient = {
      send: jest.fn(async () => ({})),
    };
    const receiptHandles = Array.from({ length: 11 }, (_, index) => `receipt-${index}`);

    await deleteProcessedMessages(sqsClient, 'https://sqs.example/queue', receiptHandles);

    expect(sqsClient.send).toHaveBeenCalledTimes(2);
    expect(sqsClient.send.mock.calls[0][0].input).toEqual({
      QueueUrl: 'https://sqs.example/queue',
      Entries: expect.arrayContaining([
        { Id: '0', ReceiptHandle: 'receipt-0' },
        { Id: '9', ReceiptHandle: 'receipt-9' },
      ]),
    });
    expect(sqsClient.send.mock.calls[1][0].input).toEqual({
      QueueUrl: 'https://sqs.example/queue',
      Entries: [
        { Id: '0', ReceiptHandle: 'receipt-10' },
      ],
    });
  });

  it('throws when SQS reports partial delete failures', async () => {
    const sqsClient = {
      send: jest.fn(async () => ({
        Failed: [
          { Id: '0', Code: 'ReceiptHandleIsInvalid' },
        ],
      })),
    };

    await expect(deleteProcessedMessages(sqsClient, 'https://sqs.example/queue', [
      'receipt-1',
    ])).rejects.toThrow('Failed to delete 1 SQS messages');
  });
});

describe('handleSqsMessages', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('measures and acknowledges one complete SQS receive batch', async () => {
    const insertBatch = jest.fn(async (events) => ({
      insertedCount: events.length,
      attemptedCount: events.length,
    }));
    const sqsClient = {
      send: jest.fn(async () => ({})),
    };
    const logger = { info: jest.fn(), warn: jest.fn() };

    await handleSqsMessages([
      {
        MessageId: 'message-1',
        ReceiptHandle: 'receipt-1',
        Body: validEventBody('cell-1'),
      },
      {
        MessageId: 'message-2',
        ReceiptHandle: 'receipt-2',
        Body: 'not-json',
      },
    ], {
      batchSize: 100,
      insertBatch,
      sqsClient,
      queueUrl: 'https://sqs.example/queue',
      logger,
    });

    expect(metrics.sqsBatchDurationSeconds.startTimer).toHaveBeenCalledTimes(1);
    expect(sqsBatchTimerEnd).toHaveBeenCalledTimes(1);
    expect(sqsClient.send).toHaveBeenCalledTimes(1);
    expect(sqsClient.send.mock.calls[0][0].input).toEqual({
      QueueUrl: 'https://sqs.example/queue',
      Entries: [
        { Id: '0', ReceiptHandle: 'receipt-2' },
        { Id: '1', ReceiptHandle: 'receipt-1' },
      ],
    });
  });

  it('does not acknowledge messages when persistence fails', async () => {
    const insertError = new Error('database unavailable');
    const insertBatch = jest.fn(async () => {
      throw insertError;
    });
    const sqsClient = {
      send: jest.fn(async () => ({})),
    };
    const logger = { info: jest.fn(), warn: jest.fn() };

    await expect(handleSqsMessages([
      {
        MessageId: 'message-1',
        ReceiptHandle: 'receipt-1',
        Body: validEventBody('cell-1'),
      },
    ], {
      batchSize: 100,
      insertBatch,
      sqsClient,
      queueUrl: 'https://sqs.example/queue',
      logger,
    })).rejects.toThrow('database unavailable');

    expect(sqsClient.send).not.toHaveBeenCalled();
    expect(sqsBatchTimerEnd).toHaveBeenCalledTimes(1);
  });
});
