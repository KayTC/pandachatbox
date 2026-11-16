const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const dotenv = require('dotenv');
const express = require('express');
const multer = require('multer');
const mammoth = require('mammoth');
const XLSX = require('xlsx');
const JSZip = require('jszip');
const { PDFParse } = require('pdf-parse');
const store = require('./lib/store');
const auth = require('./lib/auth');
const guest = require('./lib/guest');

const ENV_PATH = path.join(__dirname, '.env');
const PROMPT_PATH = path.join(__dirname, 'prompts', 'system.md');

dotenv.config({ path: ENV_PATH });

const app = express();
const PORT = process.env.PORT || 3000;
const IS_CLOUD =
  Boolean(process.env.RENDER || process.env.RAILWAY_ENVIRONMENT || process.env.FLY_APP_NAME) ||
  process.env.NODE_ENV === 'production';
const HOST = process.env.HOST || (IS_CLOUD ? '0.0.0.0' : '127.0.0.1');

const DEFAULT_SYSTEM_PROMPT =
  'Bạn là Panda, trợ lý AI thân thiện, trả lời ngắn gọn, chính xác bằng ngôn ngữ của người dùng.';

const MAX_FILES = 8;
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_TEXT_PER_FILE = 60000;
const MAX_TOTAL_REQUEST_CHARS = 400000;
const MAX_IMAGES_PER_REQUEST = 6;
const MAX_IMAGE_DATAURL_CHARS = 12 * 1024 * 1024;

const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const TEXT_EXTENSIONS = new Set([
  '.txt',
  '.md',
  '.markdown',
  '.csv',
  '.json',
  '.js',
  '.ts',
  '.html',
  '.htm',
  '.xml',
  '.css',
  '.log',
  '.yml',
  '.yaml',
  '.tsv',
]);
const IMAGE_DATA_RE = /^data:image\/(png|jpe?g|webp|gif);base64,/i;

function decodeFilename(name) {
  if (!name) return 'tệp';
  try {
    const decoded = Buffer.from(name, 'latin1').toString('utf8');
    if (decoded.includes('\uFFFD')) return name;
    return decoded;
  } catch {
    return name;
  }
}

let fileSystemPrompt = '';
function loadPromptFile() {
  try {
    fileSystemPrompt = fs.readFileSync(PROMPT_PATH, 'utf8').trim();
  } catch {
    fileSystemPrompt = '';
  }
}
loadPromptFile();

function getConfig() {
  const baseUrl = (process.env.AI_BASE_URL || '').trim().replace(/\/+$/, '');
  const apiKey = (process.env.AI_API_KEY || '').trim();
  const model = (process.env.AI_MODEL || 'gpt-4o-mini').trim();
  const systemPrompt =
    (process.env.AI_SYSTEM_PROMPT || '').trim() || fileSystemPrompt || DEFAULT_SYSTEM_PROMPT;

  let extraHeaders = {};
  try {
    extraHeaders = JSON.parse(process.env.AI_EXTRA_HEADERS || '{}');
  } catch {
    extraHeaders = {};
  }

  let extraBody = {};
  try {
    extraBody = JSON.parse(process.env.AI_EXTRA_BODY || '{}');
  } catch {
    extraBody = {};
  }

  return {
    baseUrl,
    apiKey,
    model,
    systemPrompt,
    extraHeaders,
    extraBody,
    configured: Boolean(baseUrl && apiKey && !apiKey.includes('thay-bang-key')),
  };
}

function chatEndpoint(baseUrl) {
  if (!baseUrl) return '';
  if (/\/chat\/completions$/.test(baseUrl)) return baseUrl;
  return `${baseUrl}/chat/completions`;
}

/* ---------------- File extraction ---------------- */

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_BYTES, files: MAX_FILES },
});

function cleanText(text) {
  return String(text)
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function decodeEntities(text) {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&amp;/g, '&');
}

function htmlToText(html) {
  return decodeEntities(
    html
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|li|tr|h[1-6])>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
  );
}

async function extractPdf(buffer) {
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText();
    return (result.text || '').replace(/^-- \d+ of \d+ --$/gm, '');
  } finally {
    await parser.destroy().catch(() => {});
  }
}

async function extractDocx(buffer) {
  const result = await mammoth.extractRawText({ buffer });
  let text = result.value || '';

  if (!text.trim()) {
    const zip = await JSZip.loadAsync(buffer);
    const xmlFiles = Object.keys(zip.files).filter((name) =>
      /^word\/(document|header\d*|footer\d*|footnotes|endnotes|comments)\.xml$/.test(name)
    );
    const chunks = [];
    for (const name of xmlFiles) {
      const xml = await zip.file(name).async('string');
      const nodes = [...xml.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)].map((m) => decodeEntities(m[1]));
      if (nodes.length) chunks.push(nodes.join(' '));
    }
    text = chunks.join('\n');
  }

  if (!text.trim()) {
    throw new Error('Tệp DOCX không có văn bản trích xuất được (có thể chỉ chứa ảnh hoặc nội dung nhúng).');
  }
  return text;
}

function extractSpreadsheet(buffer, ext) {
  const workbook =
    ext === '.csv'
      ? XLSX.read(buffer.toString('utf8'), { type: 'string' })
      : XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const parts = [];
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;
    const csv = XLSX.utils.sheet_to_csv(sheet, { blankrows: false }).trim();
    if (csv) parts.push(`### Trang tính: ${sheetName}\n${csv}`);
  }
  if (!parts.length) {
    throw new Error('Bảng tính không có dữ liệu văn bản/số để trích xuất.');
  }
  return parts.join('\n\n');
}

async function extractOdf(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const contentFile = zip.file('content.xml');
  if (!contentFile) throw new Error('Tệp ODF không hợp lệ (thiếu content.xml).');
  const xml = await contentFile.async('string');
  const texts = [...xml.matchAll(/>([^<>]+)</g)].map((m) => decodeEntities(m[1]));
  const text = cleanText(texts.join('\n'));
  if (!text.trim()) {
    throw new Error('Tệp ODF không có văn bản trích xuất được (có thể chỉ chứa ảnh).');
  }
  return text;
}

async function extractPptx(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const slideFiles = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => {
      const na = Number(a.match(/slide(\d+)\.xml/)?.[1] || 0);
      const nb = Number(b.match(/slide(\d+)\.xml/)?.[1] || 0);
      return na - nb;
    });

  const readTextNodes = (xml) =>
    [...xml.matchAll(/<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/g)].map((m) => decodeEntities(m[1]));

  const parts = [];
  for (const name of slideFiles) {
    const xml = await zip.file(name).async('string');
    const content = cleanText(readTextNodes(xml).join('\n'));
    if (content) {
      const index = Number(name.match(/slide(\d+)\.xml/)?.[1] || 0);
      parts.push(`--- Slide ${index} ---\n${content}`);
    }
  }

  if (!parts.length) {
    const otherXml = Object.keys(zip.files).filter(
      (name) => /^ppt\/(notesSlides|charts|diagrams|slideLayouts|slideMasters)\/.*\.xml$/.test(name) && !zip.files[name].dir
    );
    for (const name of otherXml) {
      const xml = await zip.file(name).async('string');
      const content = cleanText(readTextNodes(xml).join('\n'));
      if (content) parts.push(content);
    }
  }

  if (!parts.length) {
    throw new Error('Tệp PPTX không có văn bản trích xuất được (có thể chỉ chứa ảnh hoặc video).');
  }

  return parts.join('\n\n');
}

function decodeTextBuffer(buffer) {
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return buffer.subarray(3).toString('utf8');
  }
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return buffer.subarray(2).toString('utf16le');
  }
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    const swapped = Buffer.from(buffer.subarray(2));
    swapped.swap16();
    return swapped.toString('utf16le');
  }
  const utf8 = buffer.toString('utf8');
  const badChars = (utf8.match(/\uFFFD/g) || []).length;
  if (badChars > Math.max(2, utf8.length * 0.02)) {
    try {
      const alt = new TextDecoder('windows-1258').decode(buffer);
      if ((alt.match(/\uFFFD/g) || []).length < badChars) return alt;
    } catch {}
  }

  const sample = buffer.subarray(0, Math.min(buffer.length, 2000));
  let zerosEven = 0;
  let zerosOdd = 0;
  for (let i = 0; i < sample.length; i++) {
    if (sample[i] === 0) {
      if (i % 2 === 0) zerosEven += 1;
      else zerosOdd += 1;
    }
  }
  if (zerosOdd > sample.length * 0.2 && zerosEven < sample.length * 0.05) {
    return buffer.toString('utf16le');
  }
  return utf8;
}

async function processUploadedFile(file) {
  const name = decodeFilename(file.originalname);
  const size = file.size ?? file.buffer?.length ?? 0;
  const ext = path.extname(name).toLowerCase();
  const mime = file.mimetype || '';

  if (!file.buffer || file.buffer.length === 0) {
    throw new Error('Tệp rỗng (0 byte).');
  }

  if (IMAGE_TYPES.has(mime) || ['.png', '.jpg', '.jpeg', '.webp', '.gif'].includes(ext)) {
    if (size > MAX_IMAGE_BYTES) throw new Error('Ảnh vượt quá 8MB.');
    const imageMime = IMAGE_TYPES.has(mime) ? mime : `image/${ext.slice(1) === 'jpg' ? 'jpeg' : ext.slice(1)}`;
    return {
      id: crypto.randomUUID(),
      name,
      size,
      mime: imageMime,
      kind: 'image',
      dataUrl: `data:${imageMime};base64,${file.buffer.toString('base64')}`,
    };
  }

  let text = '';

  if (ext === '.pdf') {
    text = await extractPdf(file.buffer);
    if (text.trim().length < 40) {
      throw new Error('Không đọc được chữ trong PDF (có thể là bản scan/ảnh). Hãy gửi ảnh hoặc PDF có lớp văn bản.');
    }
  } else if (['.docx', '.docm', '.dotx', '.dotm'].includes(ext)) {
    text = await extractDocx(file.buffer);
  } else if (['.xlsx', '.xlsm', '.xltx', '.xltm', '.xls', '.csv'].includes(ext)) {
    text = extractSpreadsheet(file.buffer, ext);
  } else if (['.pptx', '.pptm', '.potx', '.potm'].includes(ext)) {
    text = await extractPptx(file.buffer);
  } else if (['.odt', '.ods', '.odp'].includes(ext)) {
    text = await extractOdf(file.buffer);
  } else if (TEXT_EXTENSIONS.has(ext)) {
    const raw = decodeTextBuffer(file.buffer);
    text = ['.html', '.htm', '.xml'].includes(ext) ? htmlToText(raw) : raw;
  } else if (['.doc', '.ppt'].includes(ext)) {
    throw new Error(`Định dạng ${ext} cũ chưa hỗ trợ. Hãy lưu lại thành ${ext === '.doc' ? '.docx' : '.pptx'}.`);
  } else {
    throw new Error(
      'Định dạng chưa hỗ trợ. Hỗ trợ: ảnh, PDF, DOCX/DOCM, XLSX/XLSM/XLS, CSV, PPTX/PPTM, ODT/ODS/ODP, TXT, MD, JSON.'
    );
  }

  text = cleanText(text).replace(/\u0000/g, '');
  if (!text) {
    throw new Error(
      ext === '.pdf'
        ? 'PDF không có lớp văn bản (có thể là bản scan). Hãy gửi ảnh trang đó để AI đọc.'
        : `Tệp .${ext.replace('.', '') || '?'} rỗng hoặc chỉ chứa khoảng trắng (${size} byte), không có nội dung để đọc.`
    );
  }

  const truncated = text.length > MAX_TEXT_PER_FILE;
  if (truncated) {
    text = `${text.slice(0, MAX_TEXT_PER_FILE)}\n\n[... nội dung tệp đã được rút gọn để tiết kiệm ngữ cảnh ...]`;
  }

  return { id: crypto.randomUUID(), name, size, mime, kind: 'text', text, truncated };
}

app.post('/api/upload', (req, res) => {
  upload.array('files', MAX_FILES)(req, res, async (err) => {
    if (err) {
      const message =
        err.code === 'LIMIT_FILE_SIZE'
          ? 'Tệp vượt quá 25MB.'
          : err.code === 'LIMIT_FILE_COUNT'
            ? `Tối đa ${MAX_FILES} tệp mỗi lần.`
            : `Không nhận được tệp: ${err.message}`;
      return res.status(400).json({ error: message });
    }

    const files = req.files || [];
    if (!files.length) return res.status(400).json({ error: 'Không có tệp nào được gửi lên.' });

    const attachments = [];
    for (const file of files) {
      try {
        const processed = await processUploadedFile(file);
        attachments.push(processed);
        console.log(
          `  + Tệp "${processed.name}" (${Math.round(processed.size / 1024)}KB): ${
            processed.kind === 'text' ? `${processed.text.length} ký tự` : 'ảnh'
          }${processed.truncated ? ' [đã rút gọn]' : ''}`
        );
      } catch (e) {
        const message = e.message || 'Không đọc được tệp.';
        attachments.push({ name: file.originalname, error: message });
        console.log(`  ⚠ Không xử lý được "${file.originalname}" (${Math.round(file.size / 1024)}KB): ${message}`);
      }
    }
    res.json({ attachments });
  });
});

/* ---------------- Payload helpers ---------------- */

function normalizeContent(content) {
  if (typeof content === 'string') return content.trim() ? content : '';
  if (!Array.isArray(content)) return '';

  const parts = [];
  let images = 0;
  for (const part of content) {
    if (!part || typeof part !== 'object') continue;
    if (part.type === 'text' && typeof part.text === 'string' && part.text.trim()) {
      const text =
        part.text.length > 200000
          ? `${part.text.slice(0, 200000)}\n[... nội dung đã được rút gọn ...]`
          : part.text;
      parts.push({ type: 'text', text });
    } else if (
      part.type === 'image_url' &&
      typeof part.image_url?.url === 'string' &&
      IMAGE_DATA_RE.test(part.image_url.url) &&
      part.image_url.url.length <= MAX_IMAGE_DATAURL_CHARS &&
      images < MAX_IMAGES_PER_REQUEST
    ) {
      parts.push({ type: 'image_url', image_url: { url: part.image_url.url } });
      images += 1;
    }
  }
  return parts.length ? parts : '';
}

function contentSize(content) {
  if (typeof content === 'string') return content.length;
  if (!Array.isArray(content)) return 0;
  return content.reduce((sum, p) => sum + (p.type === 'text' ? p.text.length : 4000), 0);
}

function optimizeMessages(messages) {
  const result = messages.map((m) => ({
    role: m.role,
    content: Array.isArray(m.content) ? m.content.map((p) => ({ ...p })) : m.content,
  }));

  let imageCount = 0;
  for (let i = result.length - 1; i >= 0; i--) {
    const content = result[i].content;
    if (!Array.isArray(content)) continue;
    result[i].content = content.map((part) => {
      if (part.type !== 'image_url') return part;
      if (imageCount < MAX_IMAGES_PER_REQUEST) {
        imageCount += 1;
        return part;
      }
      return { type: 'text', text: '[Ảnh cũ đã lược bỏ để tiết kiệm ngữ cảnh]' };
    });
  }

  const userIndexes = result.map((m, i) => (m.role === 'user' ? i : -1)).filter((i) => i >= 0);
  const keepFull = new Set(userIndexes.slice(-2));

  let total = result.reduce((sum, m) => sum + contentSize(m.content), 0);
  for (let i = 0; i < result.length && total > MAX_TOTAL_REQUEST_CHARS; i++) {
    if (keepFull.has(i)) continue;
    const content = result[i].content;
    if (Array.isArray(content)) {
      result[i].content = content.map((part) => {
        if (part.type === 'text' && part.text.length > 4000) {
          return { type: 'text', text: `${part.text.slice(0, 4000)}\n[... nội dung cũ đã lược bớt ...]` };
        }
        return part;
      });
    } else if (typeof content === 'string' && content.length > 6000) {
      result[i].content = `${content.slice(0, 6000)}\n[... nội dung cũ đã lược bớt ...]`;
    }
    total = result.reduce((sum, m) => sum + contentSize(m.content), 0);
  }

  while (total > MAX_TOTAL_REQUEST_CHARS && result.length > 4) {
    result.shift();
    total = result.reduce((sum, m) => sum + contentSize(m.content), 0);
  }

  return result;
}

/* ---------------- Routes ---------------- */

app.use(express.json({ limit: '45mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/healthz', (req, res) => {
  res.json({ ok: true });
});

app.get('/api/config', (req, res) => {
  const cfg = getConfig();
  res.json({ configured: cfg.configured, auth: true, storage: store.driver });
});

/* ---------------- Auth & sync ---------------- */

const authAttempts = new Map();
const AUTH_WINDOW_MS = 10 * 60 * 1000;
const AUTH_MAX_ATTEMPTS = 20;

function authRateLimit(req, res, next) {
  const ip = req.ip || req.socket?.remoteAddress || 'unknown';
  const now = Date.now();
  const entry = authAttempts.get(ip) || { count: 0, resetAt: now + AUTH_WINDOW_MS };
  if (now > entry.resetAt) {
    entry.count = 0;
    entry.resetAt = now + AUTH_WINDOW_MS;
  }
  entry.count += 1;
  authAttempts.set(ip, entry);
  if (entry.count > AUTH_MAX_ATTEMPTS) {
    return res.status(429).json({ error: 'Quá nhiều lần thử. Vui lòng đợi vài phút.' });
  }
  next();
}

setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of authAttempts) {
    if (now > entry.resetAt) authAttempts.delete(ip);
  }
}, 5 * 60 * 1000).unref?.();

app.post('/api/auth/register', (req, res) => {
  res.status(403).json({ error: 'Hệ thống chỉ cho phép đăng nhập bằng tài khoản có sẵn.' });
});

app.post('/api/auth/login', authRateLimit, async (req, res) => {
  try {
    const { username, email, password } = req.body || {};
    const user = auth.verifyCredentials({ username, email, password });
    const token = await auth.createSession(user.id);
    res.json({ token, user: auth.publicUser(user) });
  } catch (err) {
    res.status(401).json({ error: err.message || 'Đăng nhập thất bại.' });
  }
});

app.get('/api/auth/me', auth.authenticate, (req, res) => {
  res.json({ user: req.user });
});

app.post('/api/auth/logout', async (req, res) => {
  const header = req.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  await auth.destroySession(token).catch(() => {});
  res.json({ ok: true });
});

const MAX_CONVERSATIONS = 300;
const MAX_CONVERSATION_BYTES = 1200000;
const MAX_SYNC_BYTES = 8 * 1024 * 1024;

app.get('/api/conversations', auth.authenticate, async (req, res) => {
  try {
    const data = (await store.getJson(`conv:${req.user.id}`)) || { conversations: [], updatedAt: 0 };
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: `Không đọc được dữ liệu: ${err.message}` });
  }
});

app.put('/api/conversations', auth.authenticate, async (req, res) => {
  try {
    const { conversations, updatedAt } = req.body || {};
    if (!Array.isArray(conversations)) {
      return res.status(400).json({ error: 'Dữ liệu không hợp lệ.' });
    }
    if (conversations.length > MAX_CONVERSATIONS) {
      return res.status(400).json({ error: `Tối đa ${MAX_CONVERSATIONS} cuộc trò chuyện.` });
    }

    const current = await store.getJson(`conv:${req.user.id}`);
    const currentUpdatedAt = current?.updatedAt || 0;
    if (currentUpdatedAt && typeof updatedAt === 'number' && updatedAt < currentUpdatedAt) {
      return res.json({ ok: true, skipped: true, conversations: current.conversations, updatedAt: currentUpdatedAt });
    }

    const clean = conversations
      .filter((c) => c && typeof c.id === 'string' && Array.isArray(c.messages))
      .map((c) => ({
        id: c.id,
        title: typeof c.title === 'string' ? c.title.slice(0, 200) : 'Cuộc trò chuyện',
        createdAt: Number(c.createdAt) || Date.now(),
        updatedAt: Number(c.updatedAt) || Date.now(),
        messages: c.messages.slice(-200).map((m) => ({
          role: m.role === 'assistant' ? 'assistant' : 'user',
          content: typeof m.content === 'string' ? m.content : '',
          ts: Number(m.ts) || Date.now(),
          attachments: Array.isArray(m.attachments)
            ? m.attachments.slice(0, 8).map((a) => ({
                id: a.id,
                name: a.name,
                size: a.size,
                mime: a.mime,
                kind: a.kind,
                text: typeof a.text === 'string' ? a.text : undefined,
                dataUrl: typeof a.dataUrl === 'string' ? a.dataUrl : undefined,
                truncated: Boolean(a.truncated),
              }))
            : undefined,
        })),
      }));

    const payload = { conversations: clean, updatedAt: Date.now() };
    const size = Buffer.byteLength(JSON.stringify(payload), 'utf8');
    if (size > MAX_SYNC_BYTES) {
      return res.status(413).json({
        error: 'Dữ liệu quá lớn để đồng bộ. Hãy xóa bớt hội thoại hoặc ảnh/tệp cũ.',
      });
    }

    const perConversation = clean.find((c) => Buffer.byteLength(JSON.stringify(c), 'utf8') > MAX_CONVERSATION_BYTES);
    if (perConversation) {
      return res.status(413).json({
        error: `Cuộc trò chuyện "${perConversation.title}" quá lớn để đồng bộ.`,
      });
    }

    await store.setJson(`conv:${req.user.id}`, payload);
    res.json({ ok: true, updatedAt: payload.updatedAt });
  } catch (err) {
    res.status(500).json({ error: `Không lưu được dữ liệu: ${err.message}` });
  }
});

const REQUIRE_LOGIN = String(process.env.REQUIRE_LOGIN || '').toLowerCase() === 'true';

async function optionalUser(req) {
  const header = req.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) return null;
  return auth.userFromToken(token).catch(() => null);
}

app.get('/api/guest-status', async (req, res) => {
  try {
    const data = await guest.status(req, res);
    res.json({ ...data, requireLogin: REQUIRE_LOGIN });
  } catch {
    res.json({ limit: guest.LIMIT, used: 0, remaining: guest.LIMIT, allowed: true, requireLogin: REQUIRE_LOGIN });
  }
});

app.post('/api/chat', async (req, res) => {
  const cfg = getConfig();
  const { messages } = req.body || {};
  const user = await optionalUser(req);

  if (REQUIRE_LOGIN && !user) {
    return res.status(401).json({
      error: 'Vui lòng đăng nhập để trò chuyện.',
      code: 'LOGIN_REQUIRED',
    });
  }

  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'Thiếu nội dung tin nhắn.' });
  }
  if (!cfg.configured) {
    return res.status(500).json({
      error:
        'Chưa cấu hình nhà cung cấp AI. Hãy mở file .env và điền AI_BASE_URL, AI_API_KEY, AI_MODEL.',
    });
  }

  const cleanMessages = messages
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant'))
    .map((m) => ({ role: m.role, content: normalizeContent(m.content) }))
    .filter((m) => m.content && contentSize(m.content) > 0)
    .slice(-40);

  if (!cleanMessages.length) {
    return res.status(400).json({ error: 'Nội dung tin nhắn không hợp lệ.' });
  }

  if (!user) {
    const quota = await guest.consume(req, res).catch(() => ({ ok: true, limit: guest.LIMIT, remaining: 1 }));
    if (!quota.ok) {
      const message =
        quota.reason === 'ip'
          ? 'Thiết bị/mạng này đã dùng quá nhiều câu hỏi miễn phí. Đăng nhập để tiếp tục.'
          : `Bạn đã dùng hết ${quota.limit} câu hỏi miễn phí. Đăng nhập để tiếp tục trò chuyện.`;
      return res.status(401).json({
        error: message,
        code: 'GUEST_LIMIT',
        limit: quota.limit,
        used: quota.used,
        remaining: 0,
      });
    }
    res.setHeader('X-Guest-Remaining', String(quota.remaining));
    res.setHeader('X-Guest-Limit', String(quota.limit));
  }

  const optimizedMessages = optimizeMessages(cleanMessages);

  const payload = {
    ...cfg.extraBody,
    model: cfg.model,
    stream: true,
    messages: [{ role: 'system', content: cfg.systemPrompt }, ...optimizedMessages],
  };

  const controller = new AbortController();
  res.on('close', () => {
    if (!res.writableEnded) controller.abort();
  });

  let upstream;
  try {
    upstream = await fetch(chatEndpoint(cfg.baseUrl), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.apiKey}`,
        ...cfg.extraHeaders,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } catch (err) {
    if (controller.signal.aborted) {
      if (!res.writableEnded) res.end();
      return;
    }
    return res.status(502).json({ error: `Không kết nối được tới nhà cung cấp AI: ${err.message}` });
  }

  if (!upstream.ok) {
    let detail = '';
    try {
      const text = await upstream.text();
      try {
        const json = JSON.parse(text);
        detail = json.error?.message || json.message || text;
      } catch {
        detail = text;
      }
    } catch {}
    return res.status(upstream.status).json({
      error: `Nhà cung cấp AI trả về lỗi ${upstream.status}${detail ? `: ${detail.slice(0, 500)}` : ''}`,
    });
  }

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  const contentType = upstream.headers.get('content-type') || '';

  if (!contentType.includes('text/event-stream') || !upstream.body) {
    try {
      const json = await upstream.json();
      const text =
        json.choices?.[0]?.message?.content ||
        json.choices?.[0]?.text ||
        json.content?.[0]?.text ||
        '';
      res.write(`data: ${JSON.stringify({ delta: text })}\n\n`);
      res.write('data: [DONE]\n\n');
    } catch (err) {
      res.write(`data: ${JSON.stringify({ error: 'Không đọc được phản hồi từ nhà cung cấp AI.' })}\n\n`);
    }
    return res.end();
  }

  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(decoder.decode(value, { stream: true }));
    }
  } catch (err) {
    if (!controller.signal.aborted) {
      res.write(`data: ${JSON.stringify({ error: 'Kết nối tới AI bị gián đoạn.' })}\n\n`);
    }
  } finally {
    res.end();
  }
});

app.get('*', (req, res) => {
  if (req.path.startsWith('/api/') || req.path === '/healthz') {
    return res.status(404).json({ error: 'Không tìm thấy endpoint.' });
  }
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

/* ---------------- Hot reload config ---------------- */

let envReloadTimer = null;
try {
  fs.watchFile(ENV_PATH, { interval: 1000 }, () => {
    clearTimeout(envReloadTimer);
    envReloadTimer = setTimeout(() => {
      const result = dotenv.config({ path: ENV_PATH, override: true });
      if (result.error) {
        console.log(`  ⚠ Không đọc được .env: ${result.error.message}`);
      } else {
        console.log(`  ↻ Đã nạp lại .env (model: ${getConfig().model})`);
      }
    }, 150);
  });
} catch {}

try {
  fs.watchFile(PROMPT_PATH, { interval: 1000 }, () => {
    loadPromptFile();
    console.log('  ↻ Đã nạp lại prompts/system.md');
  });
} catch {}

app.listen(PORT, HOST, () => {
  const cfg = getConfig();
  console.log(`\n  Panda Chat Box đang chạy tại http://${HOST}:${PORT}\n`);
  if (!cfg.configured) {
    console.log('  ⚠ Chưa cấu hình .env (AI_BASE_URL / AI_API_KEY / AI_MODEL)\n');
  } else {
    console.log(`  Model: ${cfg.model}\n`);
    console.log('  Tự động nạp lại .env và prompts/system.md khi bạn lưu file.\n');
  }
});
