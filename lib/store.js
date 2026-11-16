const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const FILE_PATH = path.join(DATA_DIR, 'store.json');

const UPSTASH_URL = (process.env.UPSTASH_REDIS_REST_URL || '').trim().replace(/\/+$/, '');
const UPSTASH_TOKEN = (process.env.UPSTASH_REDIS_REST_TOKEN || '').trim();
const USE_UPSTASH = Boolean(UPSTASH_URL && UPSTASH_TOKEN);

let cache = null;
let writeTimer = null;

function loadFile() {
  if (cache) return cache;
  try {
    const raw = fs.readFileSync(FILE_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    cache = parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    cache = {};
  }
  return cache;
}

function persist() {
  clearTimeout(writeTimer);
  writeTimer = setTimeout(() => {
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      const tmp = `${FILE_PATH}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(cache));
      fs.renameSync(tmp, FILE_PATH);
    } catch (err) {
      console.log(`  ⚠ Không ghi được data/store.json: ${err.message}`);
    }
  }, 120);
}

async function upstashCommand(args) {
  const res = await fetch(UPSTASH_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${UPSTASH_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(args),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`KV ${res.status}${text ? `: ${text.slice(0, 160)}` : ''}`);
  }
  const json = await res.json();
  if (json && json.error) throw new Error(`KV: ${json.error}`);
  return json ? json.result : null;
}

async function get(key) {
  if (USE_UPSTASH) {
    const value = await upstashCommand(['GET', key]);
    return value == null ? null : value;
  }
  const store = loadFile();
  const entry = store[key];
  if (!entry) return null;
  if (entry.exp && entry.exp < Date.now()) {
    delete store[key];
    persist();
    return null;
  }
  return entry.v;
}

async function set(key, value, ttlSeconds) {
  if (USE_UPSTASH) {
    const args = ['SET', key, value];
    if (ttlSeconds) args.push('EX', String(ttlSeconds));
    await upstashCommand(args);
    return;
  }
  const store = loadFile();
  store[key] = { v: value, exp: ttlSeconds ? Date.now() + ttlSeconds * 1000 : null };
  persist();
}

async function del(key) {
  if (USE_UPSTASH) {
    await upstashCommand(['DEL', key]);
    return;
  }
  const store = loadFile();
  delete store[key];
  persist();
}

async function getJson(key) {
  const raw = await get(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function setJson(key, obj, ttlSeconds) {
  await set(key, JSON.stringify(obj), ttlSeconds);
}

module.exports = {
  enabled: true,
  driver: USE_UPSTASH ? 'upstash' : 'file',
  get,
  set,
  del,
  getJson,
  setJson,
};
