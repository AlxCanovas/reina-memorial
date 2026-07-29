import { put, del } from '@vercel/blob';
import { kv } from '@vercel/kv';

const PHOTOS_KEY = 'memorial:photos';
const RATE_LIMIT = 15;
const RATE_WINDOW = 3600;

async function checkRate(ip) {
  const key = `ratelimit:photo:${ip}`;
  const count = await kv.incr(key);
  if (count === 1) await kv.expire(key, RATE_WINDOW);
  return count <= RATE_LIMIT;
}

export const config = {
  api: { bodyParser: { sizeLimit: '5mb' } }
};

const BLOCKED_WORDS = [
  'fuck','shit','damn','bitch','bastard','dick','cock','pussy','cunt',
  'whore','slut','nigger','nigga','retard','puta','mierda','coño',
  'pendejo','cabron','cabrón','verga','maricón','maricon'
];

function isClean(text) {
  const lower = text.toLowerCase().replace(/[^a-záéíóúñü\s]/g, '');
  return !lower.split(/\s+/).some(w => BLOCKED_WORDS.includes(w));
}

function getCorsOrigin(req) {
  const origin = req.headers.origin || '';
  if (origin === 'https://forreina.com' || origin === 'https://www.forreina.com') return origin;
  if (origin === 'https://reina-memorial.vercel.app') return origin;
  if (origin.startsWith('https://reina-memorial-') && origin.endsWith('-justcheech.vercel.app')) return origin;
  return 'https://forreina.com';
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', getCorsOrigin(req));
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    if (req.method === 'GET') {
      const photos = await kv.lrange(PHOTOS_KEY, 0, -1) || [];
      return res.status(200).json({ photos });
    }

    if (req.method === 'POST') {
      const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 'unknown';
      if (!(await checkRate(ip))) {
        return res.status(429).json({ error: 'Too many uploads. Please try again later.' });
      }

      const { image, name, caption } = req.body;

      if (!image || !name) {
        return res.status(400).json({ error: 'image and name required' });
      }
      if (typeof name !== 'string' || name.length > 100) {
        return res.status(400).json({ error: 'Name too long (max 100 characters)' });
      }
      if (caption && (typeof caption !== 'string' || caption.length > 500)) {
        return res.status(400).json({ error: 'Caption too long (max 500 characters)' });
      }
      if (!isClean(name) || (caption && !isClean(caption))) {
        return res.status(400).json({ error: 'Inappropriate content' });
      }

      const match = image.match(/^data:image\/(jpeg|png|webp);base64,(.+)$/);
      if (!match) {
        return res.status(400).json({ error: 'Invalid image format' });
      }

      const buffer = Buffer.from(match[2], 'base64');

      if (buffer.length > 3 * 1024 * 1024) {
        return res.status(400).json({ error: 'Image too large (max 3MB after compression)' });
      }

      const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      const ext = match[1] === 'jpeg' ? 'jpg' : match[1];

      const blob = await put(`photos/${id}.${ext}`, buffer, {
        access: 'public',
        contentType: `image/${match[1]}`
      });

      const photo = {
        id,
        url: blob.url,
        name: name.trim(),
        caption: (caption || '').trim(),
        timestamp: Date.now()
      };

      await kv.lpush(PHOTOS_KEY, photo);

      return res.status(200).json({ photo });
    }

    if (req.method === 'DELETE') {
      const { id, adminKey } = req.body || {};
      if (!id || adminKey !== process.env.ADMIN_KEY) {
        return res.status(403).json({ error: 'Forbidden' });
      }

      const all = await kv.lrange(PHOTOS_KEY, 0, -1) || [];
      for (let i = 0; i < all.length; i++) {
        const entry = typeof all[i] === 'string' ? JSON.parse(all[i]) : all[i];
        if (entry.id === id) {
          try { await del(entry.url); } catch (e) {}
          await kv.lrem(PHOTOS_KEY, 1, all[i]);
          return res.status(200).json({ success: true });
        }
      }
      return res.status(404).json({ error: 'Photo not found' });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('Photos API error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
