import { jest } from '@jest/globals';

const startConsumer = jest.fn(async () => ({
  disconnect: jest.fn(async () => {}),
}));

jest.unstable_mockModule('../../src/db.js', () => ({
  initialize: jest.fn(async () => {}),
  ping: jest.fn(async () => {}),
}));

jest.unstable_mockModule('../../src/metrics.js', () => ({
  register: {
    contentType: 'text/plain',
    metrics: jest.fn(async () => ''),
  },
}));

jest.unstable_mockModule('../../src/consumer.js', () => ({
  startConsumer,
}));

const { startConfiguredConsumer } = await import('../../src/server.js');

// Startup transport tests verify that AWS SQS mode is additive to the HTTP route.

describe('startConfiguredConsumer', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('uses HTTP-only mode by default without starting SQS', async () => {
    const logger = { info: jest.fn() };

    const consumer = await startConfiguredConsumer({ logger });
    await consumer.disconnect();

    expect(startConsumer).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith('EVENT_TRANSPORT not set to sqs; running HTTP ingestion only');
  });

  it('starts the SQS consumer when EVENT_TRANSPORT is sqs', async () => {
    const logger = { info: jest.fn() };

    await startConfiguredConsumer({
      eventTransport: 'sqs',
      logger,
    });

    expect(startConsumer).toHaveBeenCalledWith({ logger });
  });

  it('rejects unsupported event transports with a clear error', async () => {
    await expect(startConfiguredConsumer({
      eventTransport: 'kafka',
    })).rejects.toThrow('Unsupported EVENT_TRANSPORT "kafka"');
  });
});
