import { kv } from '@vercel/kv';

const GFM_URL = 'https://www.gofundme.com/f/honoring-my-mom-and-chichis-memory';
const CACHE_KEY = 'memorial:campaign';
const CACHE_TTL = 300; // 5 minutes

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

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

    // Try __NEXT_DATA__ JSON
    const nextDataMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    if (nextDataMatch) {
      try {
        const nextData = JSON.parse(nextDataMatch[1]);
        const campaign = nextData?.props?.pageProps?.campaign;
        if (campaign) {
          raised = campaign.current_amount || campaign.money_raised?.amount || 0;
          goal = campaign.goal_amount || campaign.goal?.amount || goal;
        }
      } catch (e) {}
    }

    // Fallback: look for amounts in meta tags or common patterns
    if (raised === 0) {
      const raisedMatch = html.match(/\"current_amount\"\s*:\s*([\d.]+)/);
      if (raisedMatch) raised = parseFloat(raisedMatch[1]);

      const goalMatch = html.match(/\"goal_amount\"\s*:\s*([\d.]+)/);
      if (goalMatch) goal = parseFloat(goalMatch[1]);
    }

    // Another fallback: og:description often has "X raised of Y goal"
    if (raised === 0) {
      const ogMatch = html.match(/\$([\d,]+)\s*raised/i);
      if (ogMatch) raised = parseFloat(ogMatch[1].replace(/,/g, ''));
    }

    const data = {
      raised: raised,
      goal: goal,
      percent: goal > 0 ? Math.min(100, Math.round((raised / goal) * 100)) : 0,
      updatedAt: Date.now(),
    };

    await kv.set(CACHE_KEY, data, { ex: CACHE_TTL });

    return res.status(200).json(data);
  } catch (err) {
    console.error('Campaign API error:', err);
    return res.status(200).json({ raised: 0, goal: 11000, percent: 0, error: true });
  }
}
