import { timingSafeEqual } from 'node:crypto';

function authorized(header, secret) {
  if (typeof header !== 'string' || !secret) return false;
  const received = Buffer.from(header);
  const expected = Buffer.from(`Bearer ${secret}`);
  return received.length === expected.length && timingSafeEqual(received, expected);
}

export function manualAnnouncementAllowed(version) {
  return version === undefined || version === '2.5.8';
}

export function formatFailure(error) {
  const detail = error instanceof Error ? error.message : String(error);
  return {
    ok: false,
    error: 'official-update-check-failed',
    detail: detail.slice(0, 300),
  };
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
  const announceVersion = request.query?.announceVersion;
  if (!manualAnnouncementAllowed(announceVersion)) {
    return response.status(400).json({ ok: false, error: 'invalid-announce-version' });
  }
  try {
    const { checkOfficialUpdates } = await import('../server/official-update-monitor.js');
    return response.status(200).json(await checkOfficialUpdates({ announceVersion }));
  } catch (error) {
    console.error('Official update check failed:', error);
    return response.status(500).json(formatFailure(error));
  }
}
