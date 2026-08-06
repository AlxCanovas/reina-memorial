// Token check for the admin UI.
//
// The client calls this once when it picks a token out of the URL, so a wrong
// or revoked link says so immediately instead of rendering delete buttons that
// fail on click. It reads nothing and writes nothing — the only thing it can
// tell you is whether the token you already hold is the right one.

import { isAdmin, denyAdmin } from './_auth.js';

function getCorsOrigin(req) {
  const origin = req.headers.origin || '';
  if (origin === 'https://forreina.com' || origin === 'https://www.forreina.com') return origin;
  if (origin === 'https://reina-memorial.vercel.app') return origin;
  if (origin.startsWith('https://reina-memorial-') && origin.endsWith('-justcheech.vercel.app')) return origin;
  return 'https://forreina.com';
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', getCorsOrigin(req));
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-key');
  // A verified token must never be cached by a CDN or shared proxy.
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  if (!isAdmin(req)) return denyAdmin(res);
  return res.status(200).json({ ok: true });
}
