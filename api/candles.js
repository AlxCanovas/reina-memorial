import { kv } from '@vercel/kv';
import { notifyTelegram } from './notify.js';
import { isAdmin, denyAdmin } from './_auth.js';

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
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-key');

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

      notifyTelegram(`🕯 ${clean} lit a candle for Reina`);
      return res.status(201).json({ success: true, candle });
    }

    if (req.method === 'DELETE') {
      if (!isAdmin(req)) return denyAdmin(res);

      // Candles carry no id, so deletion used to match on name alone and
      // removed whichever one came first. Two people named Maria light two
      // candles; removing the spam one silently removes hers instead. The
      // timestamp is already on every candle the client renders, so require
      // both and match exactly.
      const { name, timestamp } = req.body || {};
      if (!name || typeof timestamp !== 'number') {
        return res.status(400).json({ error: 'Name and timestamp required' });
      }
      const raw = await kv.lrange(CANDLES_KEY, 0, -1) || [];
      const candles = raw.map(c => typeof c === 'string' ? JSON.parse(c) : c);
      const idx = candles.findIndex(c => c.name === name && c.timestamp === timestamp);
      if (idx === -1) return res.status(404).json({ error: 'Not found' });
      const placeholder = '__DELETED__';
      await kv.lset(CANDLES_KEY, idx, placeholder);
      await kv.lrem(CANDLES_KEY, 1, placeholder);
      return res.status(200).json({ success: true, deleted: name });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('Candles API error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
