import { timingSafeEqual } from 'node:crypto';

function authorized(header, secret) {
  if (typeof header !== 'string' || !secret) return false;
  const received = Buffer.from(header);
  const expected = Buffer.from(`Bearer ${secret}`);
  return received.length === expected.length && timingSafeEqual(received, expected);
}

export default async function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store');
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET');
    return response.status(405).json({ ok: false, error: 'method-not-allowed' });
  }
  if (!authorized(request.headers.authorization, process.env.CRON_SECRET)) {
    return response.status(401).json({ ok: false, error: 'unauthorized' });
  }
  try {
    const { checkOfficialUpdates } = await import('../server/official-update-monitor.js');
    return response.status(200).json(await checkOfficialUpdates());
  } catch (error) {
    console.error('Official update check failed:', error);
    return response.status(500).json({ ok: false, error: 'official-update-check-failed' });
  }
}
