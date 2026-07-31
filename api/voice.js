import { kv } from '@vercel/kv';
import { notifyTelegram } from './notify.js';

const VOICE_KEY = 'memorial:voices';
const MAX_VOICES = 100;
const RATE_WINDOW = 86400;
const MAX_SIZE = 250000; // ~250KB base64, ~60s at 32kbps

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
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    if (req.method === 'GET') {
      const raw = await kv.lrange(VOICE_KEY, 0, -1) || [];
      const voices = raw.map(v => {
        const entry = typeof v === 'string' ? JSON.parse(v) : v;
        return { id: entry.id, name: entry.name, title: entry.title, duration: entry.duration, audio: entry.audio, timestamp: entry.timestamp };
      });
      return res.status(200).json({ voices });
    }

    if (req.method === 'POST') {
      const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 'unknown';
      const rateKey = `ratelimit:voice:${ip}`;
      const existing = await kv.get(rateKey);
      if (existing) {
        return res.status(429).json({ error: 'You already left a voice memory today. Come back tomorrow.' });
      }

      const { name, title, audio, duration } = req.body;

      if (!name || typeof name !== 'string' || name.length > 100) {
        return res.status(400).json({ error: 'Valid name required (max 100 chars)' });
      }
      if (!title || typeof title !== 'string' || title.length > 200) {
        return res.status(400).json({ error: 'Valid title required (max 200 chars)' });
      }
      if (!audio || typeof audio !== 'string') {
        return res.status(400).json({ error: 'Audio data required' });
      }
      if (audio.length > MAX_SIZE) {
        return res.status(400).json({ error: 'Recording too long' });
      }
      if (!audio.startsWith('data:audio/')) {
        return res.status(400).json({ error: 'Invalid audio format' });
      }
      if (typeof duration !== 'number' || duration < 1 || duration > 65) {
        return res.status(400).json({ error: 'Invalid duration' });
      }

      const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      const entry = {
        id,
        name: escapeHtml(name.trim()),
        title: escapeHtml(title.trim()),
        audio,
        duration: Math.round(duration),
        timestamp: Date.now()
      };

      await kv.lpush(VOICE_KEY, JSON.stringify(entry));
      await kv.ltrim(VOICE_KEY, 0, MAX_VOICES - 1);
      await kv.set(rateKey, 1, { ex: RATE_WINDOW });

      notifyTelegram(`🎙 ${entry.name} left a voice memory: "${entry.title}" (${entry.duration}s)`);

      const { audio: _, ...safe } = entry;
      return res.status(201).json({ success: true, voice: safe });
    }

    if (req.method === 'DELETE') {
      const { id, adminKey } = req.body || {};
      if (!id || adminKey !== process.env.ADMIN_KEY) {
        return res.status(403).json({ error: 'Forbidden' });
      }
      const all = await kv.lrange(VOICE_KEY, 0, -1) || [];
      for (let i = 0; i < all.length; i++) {
        const entry = typeof all[i] === 'string' ? JSON.parse(all[i]) : all[i];
        if (entry.id === id) {
          await kv.lrem(VOICE_KEY, 1, all[i]);
          return res.status(200).json({ success: true });
        }
      }
      return res.status(404).json({ error: 'Voice not found' });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('Voice API error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
