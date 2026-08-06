import { kv } from '@vercel/kv';
import { randomUUID } from 'crypto';
import { notifyTelegram } from './notify.js';
import { checkText } from './_moderation.js';
import { isAdmin, denyAdmin } from './_auth.js';

const MESSAGES_KEY = 'memorial:messages';
const MAX_MESSAGES = 500;
const DISPLAY_LIMIT = 50;
const EDIT_WINDOW_MS = 5 * 60 * 1000;
const RATE_LIMIT = 5;
const RATE_WINDOW = 3600;

async function checkRate(ip) {
  const key = `ratelimit:msg:${ip}`;
  const count = await kv.incr(key);
  if (count === 1) await kv.expire(key, RATE_WINDOW);
  return count <= RATE_LIMIT;
}


function makeId() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

function getCorsOrigin(req) {
  const origin = req.headers.origin || '';
  if (origin === 'https://forreina.com' || origin === 'https://www.forreina.com') return origin;
  if (origin === 'https://reina-memorial.vercel.app') return origin;
  if (origin.startsWith('https://reina-memorial-') && origin.endsWith('-justcheech.vercel.app')) return origin;
  return 'https://forreina.com';
}

const corsHeaders = {
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-admin-key',
};

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(200).json({});
  }

  res.setHeader('Access-Control-Allow-Origin', getCorsOrigin(req));
  Object.entries(corsHeaders).forEach(([k, v]) => res.setHeader(k, v));

  try {
    if (req.method === 'GET') {
      const raw = await kv.lrange(MESSAGES_KEY, 0, DISPLAY_LIMIT - 1) || [];
      const messages = raw.map(m => {
        const entry = typeof m === 'string' ? JSON.parse(m) : m;
        const { editToken, ...safe } = entry;
        return safe;
      });
      return res.status(200).json({ messages });
    }

    if (req.method === 'POST') {
      const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 'unknown';
      if (!(await checkRate(ip))) {
        return res.status(429).json({ error: 'Too many messages. Please try again later.' });
      }

      const { name, message, photoUrl, photoUrls } = req.body;

      if (!name || !message) {
        return res.status(400).json({ error: 'Name and message are required' });
      }
      if (name.length > 100 || message.length > 2000) {
        return res.status(400).json({ error: 'Name or message too long' });
      }
      const rejection = checkText(name) || checkText(message);
      if (rejection) {
        // `reason` lets the client pick its own translated wording; `error`
        // stays for any browser still running a cached copy of the old script.
        return res.status(400).json({ error: 'inappropriate', reason: rejection });
      }

      const id = makeId();
      const editToken = randomUUID();

      const entry = {
        id,
        editToken,
        name: name.trim(),
        message: message.trim(),
        timestamp: Date.now(),
      };

      if (Array.isArray(photoUrls) && photoUrls.length > 0) {
        entry.photoUrls = photoUrls.filter(u => typeof u === 'string' && u.includes('.public.blob.vercel-storage.com/')).slice(0, 5);
      } else if (photoUrl && typeof photoUrl === 'string' && photoUrl.includes('.public.blob.vercel-storage.com/')) {
        entry.photoUrls = [photoUrl];
      }

      await kv.lpush(MESSAGES_KEY, JSON.stringify(entry));
      await kv.ltrim(MESSAGES_KEY, 0, MAX_MESSAGES - 1);

      const preview = message.trim().slice(0, 120) + (message.trim().length > 120 ? '…' : '');
      notifyTelegram(`💌 ${name.trim()} left a message:\n"${preview}"`);

      const { editToken: _, ...safeEntry } = entry;
      return res.status(201).json({ success: true, entry: safeEntry, editToken });
    }

    if (req.method === 'PUT') {
      const { id, editToken, message } = req.body;

      if (!id || !editToken || !message) {
        return res.status(400).json({ error: 'Missing fields' });
      }
      if (message.length > 2000) {
        return res.status(400).json({ error: 'Message too long' });
      }
      const rejection = checkText(message);
      if (rejection) {
        return res.status(400).json({ error: 'inappropriate', reason: rejection });
      }

      const all = await kv.lrange(MESSAGES_KEY, 0, -1) || [];
      let found = false;

      for (let i = 0; i < all.length; i++) {
        const entry = typeof all[i] === 'string' ? JSON.parse(all[i]) : all[i];
        if (entry.id === id) {
          if (entry.editToken !== editToken) {
            return res.status(403).json({ error: 'Invalid token' });
          }
          if (Date.now() - entry.timestamp > EDIT_WINDOW_MS) {
            return res.status(403).json({ error: 'Edit window expired' });
          }
          entry.message = message.trim();
          entry.edited = true;
          await kv.lset(MESSAGES_KEY, i, JSON.stringify(entry));
          found = true;
          break;
        }
      }

      if (!found) {
        return res.status(404).json({ error: 'Message not found' });
      }

      return res.status(200).json({ success: true });
    }

    if (req.method === 'DELETE') {
      if (!isAdmin(req)) return denyAdmin(res);
      const { id } = req.body || {};
      if (!id) return res.status(400).json({ error: 'id required' });

      const all = await kv.lrange(MESSAGES_KEY, 0, -1) || [];
      for (let i = 0; i < all.length; i++) {
        const entry = typeof all[i] === 'string' ? JSON.parse(all[i]) : all[i];
        if (entry.id === id) {
          await kv.lrem(MESSAGES_KEY, 1, all[i]);
          return res.status(200).json({ success: true });
        }
      }
      return res.status(404).json({ error: 'Message not found' });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('API error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
