import { kv } from '@vercel/kv';

const GFM_URL = 'https://www.gofundme.com/f/honoring-my-mom-and-chichis-memory';
const CACHE_KEY = 'memorial:campaign:v2';
const CACHE_TTL = 300; // 5 minutes

export default async function handler(req, res) {
  const origin = req.headers.origin || '';
  const allowed = (origin === 'https://forreina.com' || origin.endsWith('.vercel.app')) ? origin : 'https://forreina.com';
  res.setHeader('Access-Control-Allow-Origin', allowed);
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=60');

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const cached = await kv.get(CACHE_KEY);
    if (cached) {
      return res.status(200).json(cached);
    }

    const response = await fetch(GFM_URL, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; memorial-site/1.0)',
        'Accept': 'text/html',
      },
    });

    if (!response.ok) {
      throw new Error('GoFundMe returned ' + response.status);
    }

    const html = await response.text();

    let raised = 0;
    let goal = 11000;
    let donorCount = 0;

    const nextDataMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    if (nextDataMatch) {
      try {
        const nextData = JSON.parse(nextDataMatch[1]);
        const apollo = nextData?.props?.pageProps?.['__APOLLO_STATE__'] || {};
        for (const key of Object.keys(apollo)) {
          if (key.startsWith('Fundraiser:')) {
            const f = apollo[key];
            if (f.currentAmount?.amount) raised = f.currentAmount.amount;
            if (f.goalAmount?.amount) goal = f.goalAmount.amount;
            if (f.donationCount) donorCount = f.donationCount;
            break;
          }
        }
      } catch (e) {}
    }

    if (raised === 0) {
      const ogMatch = html.match(/\$([\d,]+)\s*raised/i);
      if (ogMatch) raised = parseFloat(ogMatch[1].replace(/,/g, ''));
    }

    if (donorCount === 0) {
      const donorMatch = html.match(/([\d,]+)\s*donation/i);
      if (donorMatch) donorCount = parseInt(donorMatch[1].replace(/,/g, ''), 10) || 0;
    }

    const data = {
      raised: raised,
      goal: goal,
      percent: goal > 0 ? Math.min(100, Math.round((raised / goal) * 100)) : 0,
      donorCount: donorCount,
      updatedAt: Date.now(),
    };

    await kv.set(CACHE_KEY, data, { ex: CACHE_TTL });

    return res.status(200).json(data);
  } catch (err) {
    console.error('Campaign API error:', err);
    return res.status(200).json({ raised: 0, goal: 11000, percent: 0, error: true });
  }
}
