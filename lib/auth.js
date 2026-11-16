const crypto = require('crypto');
const store = require('./store');

const SESSION_TTL = 60 * 60 * 24 * 30;

const DEFAULT_USERS = [
  { username: 'admin', password: 'admin123', name: 'Admin' },
  { username: 'panda', password: '140905', name: 'Panda' },
];

function normalizePassword(value) {
  if (typeof value !== 'string') return '';
  return value.replace(/[\u200b-\u200d\ufeff]/g, '').trim();
}

function hashPassword(password, salt) {
  return crypto.scryptSync(normalizePassword(password), salt, 64).toString('hex');
}

function safeEqual(a, b) {
  const bufA = Buffer.from(String(a), 'hex');
  const bufB = Buffer.from(String(b), 'hex');
  if (bufA.length !== bufB.length || bufA.length === 0) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function loadUsers() {
  let list = DEFAULT_USERS;
  const raw = process.env.AUTH_USERS;
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length) {
        list = parsed
          .filter((u) => u && u.username && typeof u.password === 'string')
          .map((u) => ({
            username: String(u.username).trim().toLowerCase(),
            password: u.password,
            name: String(u.name || u.username).slice(0, 60),
          }));
      }
    } catch {
      list = DEFAULT_USERS;
    }
  }

  return list.map((u) => {
    const salt = crypto.createHash('sha256').update(`panda:${u.username}`).digest('hex').slice(0, 32);
    return {
      id: u.username,
      username: u.username,
      name: u.name,
      salt,
      hash: hashPassword(u.password, salt),
    };
  });
}

const USERS = loadUsers();
const USER_MAP = new Map(USERS.map((u) => [u.username, u]));

function publicUser(user) {
  return { id: user.id, username: user.username, name: user.name, email: `${user.username}@panda.local` };
}

function findUser(identifier) {
  const key = String(identifier || '')
    .trim()
    .toLowerCase()
    .replace(/@panda\.local$/, '');
  if (!key) return null;
  return USER_MAP.get(key) || null;
}

function verifyCredentials({ username, email, password }) {
  const identifier = username || email;
  const user = findUser(identifier);
  const notValid = 'Tài khoản hoặc mật khẩu không đúng.';
  if (!user) throw new Error(notValid);
  const candidate = hashPassword(password, user.salt);
  if (!safeEqual(candidate, user.hash)) throw new Error(notValid);
  return user;
}

async function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  await store.set(`session:${token}`, userId, SESSION_TTL);
  return token;
}

async function userFromToken(token) {
  if (!token) return null;
  const userId = await store.get(`session:${token}`);
  if (!userId) return null;
  const user = USER_MAP.get(String(userId).toLowerCase());
  return user ? publicUser(user) : null;
}

async function destroySession(token) {
  if (token) await store.del(`session:${token}`);
}

async function authenticate(req, res, next) {
  const header = req.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  const user = await userFromToken(token).catch(() => null);
  if (!user) return res.status(401).json({ error: 'Chưa đăng nhập.' });
  req.user = user;
  req.token = token;
  next();
}

module.exports = {
  authenticate,
  createSession,
  destroySession,
  publicUser,
  userFromToken,
  verifyCredentials,
};
