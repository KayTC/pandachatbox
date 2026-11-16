const crypto = require('crypto');
const store = require('./store');

const LIMIT = Math.max(1, Number(process.env.GUEST_QUESTION_LIMIT) || 3);
const IP_LIMIT = Math.max(LIMIT, Number(process.env.GUEST_IP_LIMIT) || 20);
const TTL_SECONDS = 60 * 60 * 24 * 30;
const COOKIE_NAME = 'panda_gid';

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of String(header).split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    const key = part.slice(0, index).trim();
    if (!key) continue;
    try {
      out[key] = decodeURIComponent(part.slice(index + 1).trim());
    } catch {
      out[key] = part.slice(index + 1).trim();
    }
  }
  return out;
}

function clientIp(req) {
  const forwarded = req.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

function ensureGuestId(req, res) {
  const cookies = parseCookies(req.get('cookie'));
  const existing = cookies[COOKIE_NAME];
  if (existing && /^[a-f0-9]{16,64}$/.test(existing)) return existing;

  const id = crypto.randomBytes(16).toString('hex');
  res.cookie(COOKIE_NAME, id, {
    httpOnly: true,
    sameSite: 'lax',
    secure: Boolean(process.env.RENDER || process.env.NODE_ENV === 'production'),
    maxAge: TTL_SECONDS * 1000,
    path: '/',
  });
  return id;
}

function scope(req, res) {
  const guestId = ensureGuestId(req, res);
  const ip = clientIp(req);
  return {
    guestKey: `guest:${guestId}`,
    ipKey: `guest:ip:${crypto.createHash('sha256').update(ip).digest('hex').slice(0, 24)}`,
  };
}

async function readCount(key) {
  const value = await store.get(key).catch(() => null);
  return Number(value) || 0;
}

async function status(req, res) {
  const { guestKey } = scope(req, res);
  const used = await readCount(guestKey);
  return { limit: LIMIT, used, remaining: Math.max(0, LIMIT - used), allowed: used < LIMIT };
}

async function consume(req, res) {
  const { guestKey, ipKey } = scope(req, res);
  const [used, ipUsed] = await Promise.all([readCount(guestKey), readCount(ipKey)]);

  if (used >= LIMIT) {
    return { ok: false, reason: 'guest', limit: LIMIT, used, remaining: 0 };
  }
  if (ipUsed >= IP_LIMIT) {
    return { ok: false, reason: 'ip', limit: LIMIT, used, remaining: Math.max(0, LIMIT - used) };
  }

  const next = used + 1;
  await Promise.all([
    store.set(guestKey, String(next), TTL_SECONDS).catch(() => {}),
    store.set(ipKey, String(ipUsed + 1), 60 * 60 * 24).catch(() => {}),
  ]);

  return { ok: true, limit: LIMIT, used: next, remaining: Math.max(0, LIMIT - next) };
}

module.exports = { IP_LIMIT, LIMIT, consume, status };
