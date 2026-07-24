import { kv } from '@vercel/kv';

const MESSAGES_KEY = 'memorial:messages';
const MAX_MESSAGES = 500;
const DISPLAY_LIMIT = 50;
const EDIT_WINDOW_MS = 5 * 60 * 1000;

const BLOCKED_WORDS = [
  'fuck','shit','damn','ass','bitch','bastard','dick','cock','pussy','cunt',
  'whore','slut','fag','nigger','nigga','retard','stfu','gtfo','lmao','lmfao',
  'wtf','idiot','stupid','dumb','loser','trash','garbage','pathetic','disgusting',
  'hate','haha','lol','jaja','troll','spam','scam','fake',
  'puta','mierda','coño','pendejo','cabron','cabrón','chinga','verga','culo',
  'maricón','maricon','estupido','estúpido','idiota','basura','odio',
  'joder','hijo de puta','malparido','gonorrea','hp','ctm','ptm'
];

const BLOCKED_PATTERNS = [
  /(.)\1{4,}/,
  /^[^a-záéíóúñ]+$/i,
  /https?:\/\//i,
  /www\./i,
  /\.com|\.net|\.org/i,
];

function isClean(text) {
  const lower = text.toLowerCase().replace(/[^a-záéíóúñü\s]/g, '');
  const words = lower.split(/\s+/);
  for (const word of words) {
    if (BLOCKED_WORDS.includes(word)) return false;
  }
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(text)) return false;
  }
  return true;
}

function makeId() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(200).json({});
  }

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
      const { name, message } = req.body;

      if (!name || !message) {
        return res.status(400).json({ error: 'Name and message are required' });
      }
      if (name.length > 100 || message.length > 2000) {
        return res.status(400).json({ error: 'Name or message too long' });
      }
      if (!isClean(name) || !isClean(message)) {
        return res.status(400).json({ error: 'inappropriate' });
      }

      const id = makeId();
      const editToken = makeId();

      const entry = {
        id,
        editToken,
        name: name.trim(),
        message: message.trim(),
        timestamp: Date.now(),
      };

      await kv.lpush(MESSAGES_KEY, JSON.stringify(entry));
      await kv.ltrim(MESSAGES_KEY, 0, MAX_MESSAGES - 1);

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
      if (!isClean(message)) {
        return res.status(400).json({ error: 'inappropriate' });
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

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('API error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
