import { jest } from '@jest/globals';

const register = {
  contentType: 'text/plain; version=0.0.4; charset=utf-8',
  metrics: jest.fn(async () => 'ingest_events_inserted_total{path="kafka"} 3\n'),
};

jest.unstable_mockModule('../../src/db.js', () => ({
  pool: {},
  initialize: jest.fn(async () => {}),
  ping: jest.fn(async () => {}),
  insertEvent: jest.fn(async () => ({ event_id: '11111111-1111-1111-1111-111111111111', inserted: true })),
}));

jest.unstable_mockModule('../../src/metrics.js', () => ({
  register,
  metrics: {},
}));

const app = (await import('../../src/server.js')).default;

function findRouteHandler(path, method) {
  const layer = app._router.stack.find((entry) => entry.route?.path === path);
  return layer.route.stack.find((entry) => entry.method === method).handle;
}

describe('GET /metrics', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns Prometheus text from the metrics registry', async () => {
    const handler = findRouteHandler('/metrics', 'get');
    const res = {
      set: jest.fn(),
      end: jest.fn(),
      sendStatus: jest.fn(),
    };

    await handler({}, res);

    expect(register.metrics).toHaveBeenCalledTimes(1);
    expect(res.set).toHaveBeenCalledWith('Content-Type', register.contentType);
    expect(res.end).toHaveBeenCalledWith('ingest_events_inserted_total{path="kafka"} 3\n');
    expect(res.sendStatus).not.toHaveBeenCalled();
  });
});
