import { Kafka, logLevel } from 'kafkajs';
import { insertEventsBatch } from './db.js';
import { normalizeEvent } from './event-schema.js';

/**
 * Split an array into evenly sized chunks for batched database writes.
 * @param {Array} items Items to split.
 * @param {number} size Maximum number of items per chunk.
 * @returns {Array[]} Array of chunks preserving input order.
 */
function chunk(items, size) {
  const batches = [];

  for (let index = 0; index < items.length; index += size) {
    batches.push(items.slice(index, index + size));
  }

  return batches;
}

/**
 * Parse, validate, and batch-insert Kafka messages.
 * @param {Array} messages Kafka messages represented as `{ topic, partition, offset, value }`.
 * @param {object} options Processing configuration.
 * @param {number} options.batchSize Maximum number of events per DB insert.
 * @param {Function} options.insertBatch Async function that persists a batch of normalized events.
 * @param {object} [options.logger=console] Logger used for invalid-payload warnings.
 * @returns {Promise<object>} Process result containing processed offsets, inserted row count, and invalid message count.
 * @throws {Error} Propagates database insert failures so the caller can avoid committing offsets.
 */
async function processMessages(messages, { batchSize, insertBatch, logger = console } = {}) {
  const validMessages = [];
  let invalidCount = 0;

  for (const message of messages) {
    try {
      const payload = JSON.parse(message.value.toString('utf8'));
      const event = normalizeEvent(payload);
      validMessages.push({ ...message, event });
    } catch (err) {
      // Bad payloads are logged and skipped so one poison message does not stall the partition.
      invalidCount += 1;
      logger.warn('Skipping invalid Kafka message', {
        topic: message.topic,
        partition: message.partition,
        offset: message.offset,
        error: err.message,
      });
    }
  }

  let insertedCount = 0;

  for (const batch of chunk(validMessages, batchSize)) {
    const result = await insertBatch(batch.map((message) => message.event));
    insertedCount += result.insertedCount;
  }

  return {
    processedOffsets: validMessages.map((message) => message.offset),
    insertedCount,
    invalidCount,
  };
}

/**
 * Start the long-running Kafka consumer for the ingest service.
 * @param {object} options Consumer configuration, defaulting to environment variables.
 * @param {string} [options.brokerUrl] Comma-separated Kafka broker list.
 * @param {string} [options.topic] Topic to subscribe to.
 * @param {string} [options.groupId] Consumer group id for ingest.
 * @param {number} [options.batchSize] Maximum number of normalized events per DB insert.
 * @param {number} [options.pollIntervalMs] Kafka fetch wait time in milliseconds.
 * @param {object} [options.logger=console] Logger for batch processing output.
 * @returns {Promise<object>} Connected Kafka consumer instance; call `disconnect()` during shutdown.
 * @throws {Error} When the consumer cannot connect, subscribe, or process a batch successfully.
 */
async function startConsumer({
  brokerUrl = process.env.BROKER_URL || 'localhost:9092',
  topic = process.env.TOPIC_NAME || 'pm.events',
  groupId = process.env.CONSUMER_GROUP_ID || 'ingest',
  batchSize = Number(process.env.BATCH_SIZE || 100),
  pollIntervalMs = Number(process.env.POLL_INTERVAL_MS || 500),
  logger = console,
} = {}) {
  const kafka = new Kafka({
    clientId: 'ingest',
    brokers: brokerUrl.split(',').map((broker) => broker.trim()).filter(Boolean),
    logLevel: logLevel.NOTHING,
  });

  const consumer = kafka.consumer({
    groupId,
    maxWaitTimeInMs: pollIntervalMs,
  });

  await consumer.connect();
  await consumer.subscribe({ topic, fromBeginning: false });

  await consumer.run({
    autoCommit: false,
    eachBatchAutoResolve: false,
    eachBatch: async ({ batch, resolveOffset, heartbeat, commitOffsetsIfNecessary, isRunning, isStale }) => {
      if (!isRunning() || isStale()) {
        return;
      }

      // Keep the Kafka metadata we need for logging/commits while normalizing payloads for the DB.
      const messages = batch.messages.map((message) => ({
        topic: batch.topic,
        partition: batch.partition,
        offset: message.offset,
        value: message.value,
      }));

      const { processedOffsets, insertedCount, invalidCount } = await processMessages(messages, {
        batchSize,
        insertBatch: insertEventsBatch,
        logger,
      });

      // Offsets are committed only after the batch insert succeeds.
      for (const offset of processedOffsets) {
        resolveOffset(offset);
      }

      for (const message of messages) {
        if (!processedOffsets.includes(message.offset)) {
          resolveOffset(message.offset);
        }
      }

      await heartbeat();
      await commitOffsetsIfNecessary();

      logger.info('Processed Kafka batch', {
        topic: batch.topic,
        partition: batch.partition,
        messageCount: batch.messages.length,
        insertedCount,
        invalidCount,
      });
    },
  });

  logger.info(`Kafka consumer subscribed to ${topic} via ${brokerUrl}`);

  return consumer;
}

export { processMessages, startConsumer };

export default {
  processMessages,
  startConsumer,
};
