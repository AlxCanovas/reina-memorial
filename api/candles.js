import { kv } from '@vercel/kv';

const CANDLES_KEY = 'memorial:candles';
const MAX_CANDLES = 2000;
const RATE_WINDOW = 86400; // 24 hours

function getCorsOrigin(req) {
  const origin = req.headers.origin || '';
  if (origin === 'https://forreina.com' || origin === 'https://www.forreina.com') return origin;
  if (origin === 'https://reina-memorial.vercel.app') return origin;
  if (origin.startsWith('https://reina-memorial-') && origin.endsWith('-justcheech.vercel.app')) return origin;
  return 'https://forreina.com';
}

function escapeHtml(str) {
  return str.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', getCorsOrigin(req));
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    if (req.method === 'GET') {
      const raw = await kv.lrange(CANDLES_KEY, 0, -1) || [];
      const candles = raw.map(c => typeof c === 'string' ? JSON.parse(c) : c);
      return res.status(200).json({ candles });
    }

    if (req.method === 'POST') {
      const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 'unknown';
      const rateKey = `ratelimit:candle:${ip}`;
      const existing = await kv.get(rateKey);
      if (existing) {
        return res.status(429).json({ error: 'You already lit a candle today. Come back tomorrow to light another.' });
      }

      const { name } = req.body;
      if (!name || typeof name !== 'string') {
        return res.status(400).json({ error: 'Name is required' });
      }
      if (name.length > 50) {
        return res.status(400).json({ error: 'Name too long' });
      }

      const clean = escapeHtml(name.trim());
      const candle = {
        name: clean,
        timestamp: Date.now()
      };

      await kv.lpush(CANDLES_KEY, JSON.stringify(candle));
      await kv.ltrim(CANDLES_KEY, 0, MAX_CANDLES - 1);
      await kv.set(rateKey, 1, { ex: RATE_WINDOW });

      return res.status(201).json({ success: true, candle });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('Candles API error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
