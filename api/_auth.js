// Shared admin authentication for every destructive endpoint.
//
// This replaces four copies of `adminKey !== process.env.ADMIN_KEY`, which had
// two problems.
//
// It failed OPEN. If ADMIN_KEY were ever unset — a new deployment, a typo'd
// variable name, a second site provisioned from this repo — then
// process.env.ADMIN_KEY is undefined, a caller who simply omits the header is
// also undefined, and `undefined !== undefined` is false. The guard passes and
// the request deletes. The one configuration you are most likely to get wrong
// on a fresh deploy was the one that disabled the lock entirely.
//
// It compared with !==, which short-circuits on the first differing byte and
// leaks the token a character at a time to anyone willing to measure. Small
// risk over the public internet, free to remove.
//
// Files in /api beginning with "_" are not routed by Vercel.

import { createHash, timingSafeEqual } from 'crypto';

// Hashing both sides first means timingSafeEqual always gets two equal-length
// buffers, so the comparison cannot throw and the token's length does not leak.
function digest(value) {
  return createHash('sha256').update(String(value), 'utf8').digest();
}

export function isAdmin(req) {
  const expected = process.env.ADMIN_KEY;

  // Fail closed. No configured token means no one is an admin — not everyone.
  if (typeof expected !== 'string' || expected.length === 0) return false;

  // Header only. The old handlers read the key out of the JSON body, where it
  // is far more likely to be captured by request logging or an error reporter.
  const presented = req.headers['x-admin-key'];
  if (typeof presented !== 'string' || presented.length === 0) return false;

  return timingSafeEqual(digest(presented), digest(expected));
}

// Every admin-gated branch answers identically whether the token was wrong,
// missing, or unset, so probing cannot distinguish "no such site" from
// "wrong key".
export function denyAdmin(res) {
  return res.status(401).json({ error: 'Unauthorized' });
}
