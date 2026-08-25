import assert from 'node:assert/strict';
import test from 'node:test';
import handler from './check-official-updates.js';

function responseRecorder() {
  return {
    headers: {},
    statusCode: null,
    body: null,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

test('cron endpoint rejects unsupported methods before loading backend dependencies', async () => {
  const response = responseRecorder();
  await handler({ method: 'POST', headers: {} }, response);
  assert.equal(response.statusCode, 405);
  assert.equal(response.headers.Allow, 'GET');
});

test('cron endpoint rejects a missing or invalid bearer secret', async () => {
  const previous = process.env.CRON_SECRET;
  process.env.CRON_SECRET = 'test-secret-value';
  try {
    const missing = responseRecorder();
    await handler({ method: 'GET', headers: {} }, missing);
    assert.equal(missing.statusCode, 401);
    const invalid = responseRecorder();
    await handler({ method: 'GET', headers: { authorization: 'Bearer wrong-secret' } }, invalid);
    assert.equal(invalid.statusCode, 401);
  } finally {
    if (previous === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = previous;
  }
});
