import promClient from 'prom-client';

const register = new promClient.Registry();

promClient.collectDefaultMetrics({
  prefix: 'ingest_',
  register,
});

const metrics = {

  eventsInserted: new promClient.Counter({
    name: 'ingest_events_inserted_total',
    help: 'Total number of events inserted into Postgres',
    labelNames: ['path'],
    registers: [register],
  }),

  eventsRejected: new promClient.Counter({
    name: 'ingest_events_rejected_total',
    help: 'Total number of events rejected before insert',
    labelNames: ['path', 'reason'],
    registers: [register],
  }),

  kafkaMessagesProcessed: new promClient.Counter({
    name: 'ingest_kafka_messages_processed_total',
    help: 'Total number of Kafka messages processed',
    labelNames: ['result'],
    registers: [register],
  }),

  kafkaBatchDurationSeconds: new promClient.Histogram({
    name: 'ingest_kafka_batch_duration_seconds',
    help: 'Time spent processing a Kafka batch',
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5],
    registers: [register],
  }),
};

export { register, metrics };

export default {
  register,
  metrics,
};
