import {
  DeleteMessageBatchCommand,
  ReceiveMessageCommand,
  SQSClient,
} from '@aws-sdk/client-sqs';
import { insertEventsBatch } from './db.js';
import { normalizeEvent } from './event-schema.js';
import { metrics } from './metrics.js';

// Shared batching helpers keep SQS receive/delete limits separate from database insert sizing.

/**
 * Split an array into evenly sized chunks for batched database writes or SQS deletes.
 *
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
 * Pause the polling loop after empty receives or retryable failures.
 *
 * @param {number} delayMs Number of milliseconds to wait.
 * @returns {Promise<void>} Resolves after the delay.
 */
function sleep(delayMs) {
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}

// Message processing validates SQS bodies and leaves acknowledgement decisions to the caller.

/**
 * Parse, validate, and batch-insert SQS messages.
 *
 * @param {Array} messages SQS messages represented as `{ messageId, receiptHandle, body }`.
 * @param {object} options Processing configuration.
 * @param {number} options.batchSize Maximum number of events per DB insert.
 * @param {Function} options.insertBatch Async function that persists a batch of normalized events.
 * @param {object} [options.logger=console] Logger used for invalid-payload warnings.
 * @returns {Promise<object>} Process result containing receipt handles to delete and message counts.
 * @throws {Error} Propagates database insert failures so SQS can redeliver messages.
 */
async function processMessages(messages, { batchSize, insertBatch, logger = console } = {}) {
  const validMessages = [];
  const receiptHandlesToDelete = [];
  let invalidCount = 0;

  for (const message of messages) {
    try {
      const payload = JSON.parse(message.body);
      const event = normalizeEvent(payload);
      validMessages.push({ ...message, event });
    } catch (err) {
      // Bad payloads are acknowledged after the batch succeeds so one poison message does not loop forever.
      invalidCount += 1;
      const reason = err instanceof SyntaxError ? 'json_parse' : 'validation';
      metrics.eventsRejected.inc({ path: 'sqs', reason });
      metrics.sqsMessagesProcessed.inc({ result: 'invalid' });
      receiptHandlesToDelete.push(message.receiptHandle);
      logger.warn('Skipping invalid SQS message', {
        messageId: message.messageId,
        reason,
        error: err.message,
      });
    }
  }

  let attemptedCount = 0;
  let insertedCount = 0;

  for (const batch of chunk(validMessages, batchSize)) {
    const result = await insertBatch(batch.map((message) => message.event));
    attemptedCount += result.attemptedCount;
    insertedCount += result.insertedCount;
  }

  for (const message of validMessages) {
    receiptHandlesToDelete.push(message.receiptHandle);
  }

  metrics.eventsInserted.inc({ path: 'sqs' }, insertedCount);
  metrics.eventsRejected.inc({ path: 'sqs', reason: 'duplicate' }, attemptedCount - insertedCount);
  metrics.sqsMessagesProcessed.inc({ result: 'valid' }, validMessages.length);

  return {
    receiptHandlesToDelete,
    insertedCount,
    invalidCount,
  };
}

// SQS acknowledgement deletes messages only after persistence and validation handling completes.

/**
 * Delete processed SQS messages in API-sized batches.
 *
 * @param {object} sqsClient AWS SDK SQS client.
 * @param {string} queueUrl Queue URL containing processed messages.
 * @param {string[]} receiptHandles Receipt handles that should be acknowledged.
 * @returns {Promise<void>} Resolves after all delete requests finish.
 */
async function deleteProcessedMessages(sqsClient, queueUrl, receiptHandles) {
  const deleteBatches = chunk(receiptHandles, 10);

  for (const deleteBatch of deleteBatches) {
    const entries = deleteBatch.map((receiptHandle, index) => ({
      Id: String(index),
      ReceiptHandle: receiptHandle,
    }));

    const deleteResult = await sqsClient.send(new DeleteMessageBatchCommand({
      QueueUrl: queueUrl,
      Entries: entries,
    }));

    if (deleteResult.Failed && deleteResult.Failed.length > 0) {
      throw new Error(`Failed to delete ${deleteResult.Failed.length} SQS messages`);
    }
  }
}

/**
 * Process one SQS receive result and delete messages only after successful persistence.
 *
 * @param {Array} sqsMessages Raw messages returned by `ReceiveMessage`.
 * @param {object} dependencies Services and configuration needed to process the receive result.
 * @param {number} dependencies.batchSize Maximum number of normalized events per DB insert.
 * @param {Function} dependencies.insertBatch Async function that persists a batch of normalized events.
 * @param {object} dependencies.sqsClient AWS SDK SQS client.
 * @param {string} dependencies.queueUrl Queue URL containing the messages.
 * @param {object} [dependencies.logger=console] Logger for receive processing output.
 * @returns {Promise<void>} Resolves after the messages have been processed and acknowledged.
 */
async function handleSqsMessages(
  sqsMessages,
  { batchSize, insertBatch, sqsClient, queueUrl, logger = console },
) {
  if (sqsMessages.length === 0) {
    return;
  }

  const endTimer = metrics.sqsBatchDurationSeconds.startTimer();

  try {
    const messages = sqsMessages.map((message) => ({
      messageId: message.MessageId,
      receiptHandle: message.ReceiptHandle,
      body: message.Body,
    }));

    const { receiptHandlesToDelete, insertedCount, invalidCount } = await processMessages(messages, {
      batchSize,
      insertBatch,
      logger,
    });

    await deleteProcessedMessages(sqsClient, queueUrl, receiptHandlesToDelete);

    logger.info('Processed SQS messages', {
      queueUrl,
      messageCount: messages.length,
      insertedCount,
      invalidCount,
    });
  } finally {
    endTimer();
  }
}

// Polling lifecycle owns long-poll receive calls and exposes a disconnect method for server shutdown.

/**
 * Start the long-running SQS poller for the ingest service.
 *
 * @param {object} options Consumer configuration, defaulting to environment variables.
 * @param {string} [options.queueUrl] SQS queue URL to poll.
 * @param {string} [options.region] AWS region for the SQS client.
 * @param {string} [options.endpoint] Optional SQS endpoint override for local AWS-compatible services.
 * @param {number} [options.batchSize] Maximum number of normalized events per DB insert.
 * @param {number} [options.maxMessages] Maximum SQS messages per receive call, up to 10.
 * @param {number} [options.waitTimeSeconds] SQS long-poll wait time in seconds.
 * @param {number} [options.pollIntervalMs] Delay after empty receives or retryable failures.
 * @param {object} [options.logger=console] Logger for poller output.
 * @returns {Promise<object>} Running consumer handle; call `disconnect()` during shutdown.
 * @throws {Error} When no queue URL is configured.
 */
async function startConsumer({
  queueUrl = process.env.SQS_QUEUE_URL,
  region = process.env.AWS_REGION || 'us-east-1',
  endpoint = process.env.SQS_ENDPOINT,
  batchSize = Number(process.env.BATCH_SIZE || 100),
  maxMessages = Number(process.env.SQS_MAX_MESSAGES || 10),
  waitTimeSeconds = Number(process.env.SQS_WAIT_TIME_SECONDS || 20),
  pollIntervalMs = Number(process.env.POLL_INTERVAL_MS || 500),
  logger = console,
} = {}) {
  if (!queueUrl) {
    throw new Error('SQS_QUEUE_URL is required to start the ingest consumer');
  }

  const sqsClient = new SQSClient({
    region,
    endpoint,
  });

  let running = true;
  let activeAbortController = null;

  const pollLoop = async () => {
    while (running) {
      activeAbortController = new AbortController();

      try {
        const receiveResult = await sqsClient.send(new ReceiveMessageCommand({
          QueueUrl: queueUrl,
          MaxNumberOfMessages: Math.min(Math.max(maxMessages, 1), 10),
          WaitTimeSeconds: Math.min(Math.max(waitTimeSeconds, 0), 20),
        }), {
          abortSignal: activeAbortController.signal,
        });

        const messages = receiveResult.Messages || [];
        await handleSqsMessages(messages, {
          batchSize,
          insertBatch: insertEventsBatch,
          sqsClient,
          queueUrl,
          logger,
        });

        if (messages.length === 0) {
          await sleep(pollIntervalMs);
        }
      } catch (err) {
        if (!running) {
          return;
        }

        logger.error('SQS poll failed', {
          queueUrl,
          error: err.message,
        });
        await sleep(pollIntervalMs);
      } finally {
        activeAbortController = null;
      }
    }
  };

  const loopPromise = pollLoop();
  logger.info(`SQS consumer polling ${queueUrl}`);

  return {
    disconnect: async () => {
      running = false;

      if (activeAbortController) {
        activeAbortController.abort();
      }

      await loopPromise;
      sqsClient.destroy();
    },
  };
}

export { processMessages, deleteProcessedMessages, handleSqsMessages, startConsumer };

export default {
  processMessages,
  deleteProcessedMessages,
  handleSqsMessages,
  startConsumer,
};
