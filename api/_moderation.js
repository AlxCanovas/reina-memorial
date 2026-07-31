// Shared content moderation for anything a visitor can submit.
//
// This lived as two separate copies — one in messages.js, a shorter one in
// photos.js — which is how they drifted apart. One list, one place.
//
// Files in /api beginning with "_" are not routed by Vercel.

// Slurs and hard profanity only.
//
// Shipped bug: the guestbook list also held 'hate', 'haha', 'lol', 'jaja',
// 'idiot', 'stupid', 'dumb', 'trash', 'odio', 'basura' — plus a pattern
// rejecting any run of 5+ repeated characters, and another rejecting messages
// containing no Latin letters. On a memorial guestbook that refused real
// condolences:
//
//   "I hate that she's gone."
//   "Siempre nos hacía reír, jaja."
//   "She never once made me feel stupid."
//   "Noooooo te olvidamos."
//   an all-emoji message
//
// ...and told the visitor their memory was "inappropriate", with no reason
// given. Turning away a grieving person is a much worse failure than letting a
// crude word through, which a human can delete afterwards.
export const BLOCKED_WORDS = [
  'fuck', 'shit', 'bitch', 'bastard', 'dick', 'cock', 'pussy', 'cunt',
  'whore', 'slut', 'fag', 'faggot', 'nigger', 'nigga', 'retard', 'tranny',
  'puta', 'mierda', 'coño', 'pendejo', 'cabron', 'cabrón', 'chinga',
  'verga', 'culo', 'maricón', 'maricon', 'joder', 'malparido', 'gonorrea',
];

// Public guestbooks attract link spam, so links stay blocked — but the visitor
// is now told that specifically rather than being called inappropriate.
const LINK_PATTERNS = [/https?:\/\//i, /www\./i, /\.(com|net|org)\b/i];

export const REJECTION = {
  language:
    "We couldn't post this because of a word it contains. Please reword it and try again.",
  link: "Messages can't include links. Please remove it and try again.",
};

// Returns null when the text is publishable, otherwise a key into REJECTION.
export function checkText(text) {
  if (typeof text !== 'string') return null;
  const lower = text.toLowerCase().replace(/[^a-záéíóúñü\s]/g, '');
  if (lower.split(/\s+/).some((w) => BLOCKED_WORDS.includes(w))) return 'language';
  if (LINK_PATTERNS.some((p) => p.test(text))) return 'link';
  return null;
}
