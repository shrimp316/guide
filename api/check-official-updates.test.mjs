import assert from 'node:assert/strict';
import test from 'node:test';
import handler, { formatFailure, manualAnnouncementAllowed } from './check-official-updates.js';

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

test('manual announcement rejects versions outside the one-time 2.5.8 allowlist', async () => {
  const previous = process.env.CRON_SECRET;
  process.env.CRON_SECRET = 'test-secret-value';
  try {
    for (const announceVersion of [
      '2.5', '2.5.9', '02.5.8', '2.05.8', '2.5.08',
      '22222222222222222222.5.8', '2.5.8<script>', ['2.5.8', '2.5.9'],
    ]) {
      const response = responseRecorder();
      await handler({
        method: 'GET',
        headers: { authorization: 'Bearer test-secret-value' },
        query: { announceVersion },
      }, response);
      assert.equal(response.statusCode, 400);
      assert.equal(response.body.error, 'invalid-announce-version');
    }
  } finally {
    if (previous === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = previous;
  }
});

test('manual announcement allowlist contains only 2.5.8 while cron remains available', () => {
  assert.equal(manualAnnouncementAllowed(undefined), true);
  assert.equal(manualAnnouncementAllowed('2.5.8'), true);
  assert.equal(manualAnnouncementAllowed('2.5.9'), false);
  assert.equal(manualAnnouncementAllowed('02.5.8'), false);
});

test('authenticated failure payload is bounded without exposing a stack', () => {
  const payload = formatFailure(new Error('x'.repeat(500)));
  assert.equal(payload.error, 'official-update-check-failed');
  assert.equal(payload.detail, 'x'.repeat(300));
  assert.equal('stack' in payload, false);
});
