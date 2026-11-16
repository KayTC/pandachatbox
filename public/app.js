(() => {
  'use strict';

  const STORAGE_KEY = 'panda.chats.v1';
  const THEME_KEY = 'panda.theme';
  const CURRENT_KEY = 'panda.currentId';
  const TOKEN_KEY = 'panda.token';
  const USER_KEY = 'panda.user';
  const SYNC_UPDATED_KEY = 'panda.syncUpdatedAt';

  function scopeSuffix() {
    return state.user?.id ? `:${state.user.id}` : '';
  }
  function chatsKey() {
    return `${STORAGE_KEY}${scopeSuffix()}`;
  }
  function currentIdKey() {
    return `${CURRENT_KEY}${scopeSuffix()}`;
  }
  function syncUpdatedKey() {
    return `${SYNC_UPDATED_KEY}${scopeSuffix()}`;
  }

  const $ = (sel) => document.querySelector(sel);
  const els = {
    app: $('#app'),
    sidebar: $('#sidebar'),
    sidebarClose: $('#sidebarClose'),
    sidebarBackdrop: $('#sidebarBackdrop'),
    menuBtn: $('#menuBtn'),
    newChat: $('#newChat'),
    chatList: $('#chatList'),
    themeToggle: $('#themeToggle'),
    statusDot: $('#statusDot'),
    statusTitle: $('#statusTitle'),
    statusModel: $('#statusModel'),
    topbarName: $('#topbarName'),
    topbarNew: $('#topbarNew'),
    clearChat: $('#clearChat'),
    chatScroll: $('#chatScroll'),
    chatInner: $('#chatInner'),
    messages: $('#messages'),
    welcome: $('#welcome'),
    suggestions: $('#suggestions'),
    composer: $('#composer'),
    composerBox: $('#composerBox'),
    attachBtn: $('#attachBtn'),
    attachPreview: $('#attachPreview'),
    fileInput: $('#fileInput'),
    lightbox: $('#lightbox'),
    lightboxImg: $('#lightboxImg'),
    input: $('#input'),
    sendBtn: $('#sendBtn'),
    stopBtn: $('#stopBtn'),
    toast: $('#toast'),
    accountBtn: $('#accountBtn'),
    accountAvatar: $('#accountAvatar'),
    accountName: $('#accountName'),
    accountSub: $('#accountSub'),
    syncDot: $('#syncDot'),
    authModal: $('#authModal'),
    authClose: $('#authClose'),
    authForm: $('#authForm'),
    authEmail: $('#authEmail'),
    authPassword: $('#authPassword'),
    authError: $('#authError'),
    authSubmit: $('#authSubmit'),
    authTitle: $('#authTitle'),
    authDesc: $('#authDesc'),
    guestBar: $('#guestBar'),
    guestText: $('#guestText'),
    guestLogin: $('#guestLogin'),
  };

  const state = {
    conversations: [],
    currentId: null,
    streaming: false,
    abortController: null,
    stickToBottom: true,
    pendingAttachments: [],
    quotaWarned: false,
    token: null,
    user: null,
    syncTimer: null,
    syncState: 'off',
    guest: { limit: 3, used: 0, remaining: 3, allowed: true, requireLogin: false },
  };

  const MAX_ATTACHMENTS = 6;
  const MAX_IMAGE_SOURCE_BYTES = 8 * 1024 * 1024;
  const MAX_DOC_BYTES = 25 * 1024 * 1024;
  const MAX_DOC_TEXT_PER_MESSAGE = 120000;
  const MAX_IMAGES_PER_MESSAGE = 6;
  const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif']);
  const DOC_EXTENSIONS = new Set([
    'pdf',
    'docx',
    'docm',
    'dotx',
    'dotm',
    'xlsx',
    'xlsm',
    'xltx',
    'xltm',
    'xls',
    'csv',
    'tsv',
    'pptx',
    'pptm',
    'potx',
    'potm',
    'odt',
    'ods',
    'odp',
    'txt',
    'md',
    'markdown',
    'json',
    'js',
    'ts',
    'html',
    'htm',
    'xml',
    'css',
    'log',
    'yml',
    'yaml',
  ]);

  /* ---------------- Storage ---------------- */

  function readChats(key) {
    try {
      const raw = localStorage.getItem(key);
      const list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list.filter((c) => c && c.id && Array.isArray(c.messages)) : [];
    } catch {
      return [];
    }
  }

  function loadConversations() {
    state.conversations = readChats(chatsKey());
    state.currentId = localStorage.getItem(currentIdKey());
    if (!state.conversations.some((c) => c.id === state.currentId)) {
      state.currentId = state.conversations[0]?.id || null;
    }
  }

  function adoptGuestChats(userId) {
    if (!userId) return;
    const userKey = `${STORAGE_KEY}:${userId}`;
    if (localStorage.getItem(userKey)) return;
    const guest = readChats(STORAGE_KEY);
    if (!guest.length) return;
    try {
      localStorage.setItem(userKey, JSON.stringify(guest));
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(CURRENT_KEY);
    } catch {}
  }

  function saveConversations() {
    saveLocalOnly();
    queueSync();
  }

  /* ---------------- Account & sync ---------------- */

  function apiFetch(path, options = {}) {
    const headers = { ...(options.headers || {}) };
    if (state.token) headers.Authorization = `Bearer ${state.token}`;
    if (options.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
    return fetch(path, { ...options, headers });
  }

  function initials(user) {
    const source = user?.name || user?.username || user?.email || '?';
    return source.trim().charAt(0).toUpperCase();
  }

  function userLabel(user) {
    return user?.name || user?.username || user?.email || '';
  }

  function userSubLabel(user) {
    if (!user) return '';
    if (user.username) return `@${user.username}`;
    return user.email || '';
  }

  function renderAccount() {
    const user = state.user;
    if (user) {
      els.accountAvatar.innerHTML = '';
      els.accountAvatar.textContent = initials(user);
      els.accountName.textContent = userLabel(user);
      els.accountSub.textContent = userSubLabel(user);
      els.accountBtn.title = 'Đã đăng nhập · Nhấn để đăng xuất';
    } else {
      els.accountAvatar.innerHTML =
        '<svg viewBox="0 0 24 24" width="16" height="16" fill="none"><circle cx="12" cy="9" r="3.6" stroke="currentColor" stroke-width="1.8"/><path d="M4.8 20c1-3.4 3.7-5.2 7.2-5.2s6.2 1.8 7.2 5.2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
      els.accountName.textContent = 'Đăng nhập';
      els.accountSub.textContent = 'Đồng bộ lịch sử';
      els.accountBtn.title = 'Đăng nhập để đồng bộ lịch sử';
    }
    renderSyncState();
  }

  function renderGuest() {
    if (state.user || state.token) {
      els.guestBar.hidden = true;
      return;
    }
    const { limit, remaining, allowed, requireLogin } = state.guest;
    els.guestBar.hidden = false;
    if (requireLogin) {
      els.guestBar.classList.add('limit');
      els.guestText.textContent = 'Cần đăng nhập để trò chuyện';
      els.guestLogin.textContent = 'Đăng nhập';
      return;
    }
    if (!allowed || remaining <= 0) {
      els.guestBar.classList.add('limit');
      els.guestText.textContent = `Đã hết ${limit} câu hỏi miễn phí`;
      els.guestLogin.textContent = 'Đăng nhập để tiếp tục';
    } else {
      els.guestBar.classList.remove('limit');
      els.guestText.textContent = `Còn ${remaining}/${limit} câu hỏi miễn phí`;
      els.guestLogin.textContent = 'Đăng nhập';
    }
  }

  async function loadGuestStatus() {
    if (state.user) return;
    try {
      const response = await fetch('/api/guest-status');
      if (!response.ok) return;
      const data = await response.json();
      state.guest = {
        limit: Number(data.limit) || 3,
        used: Number(data.used) || 0,
        remaining: Number(data.remaining) || 0,
        allowed: Boolean(data.allowed),
        requireLogin: Boolean(data.requireLogin),
      };
      renderGuest();
      updateComposer();
    } catch {}
  }

  function renderSyncState() {
    const map = {
      off: ['sync-dot off', 'Chưa đăng nhập'],
      idle: ['sync-dot ok', 'Đã đồng bộ'],
      syncing: ['sync-dot syncing', 'Đang đồng bộ…'],
      error: ['sync-dot error', 'Đồng bộ lỗi'],
    };
    const [cls, label] = map[state.syncState] || map.off;
    els.syncDot.className = cls;
    els.syncDot.title = label;
  }

  function setSyncState(next) {
    state.syncState = next;
    renderSyncState();
  }

  function queueSync() {
    if (!state.token) return;
    setSyncState('syncing');
    clearTimeout(state.syncTimer);
    state.syncTimer = setTimeout(pushConversations, 900);
  }

  function slimConversations(dropImages) {
    return state.conversations.map((convo) => ({
      ...convo,
      messages: convo.messages.map((m) => {
        if (!Array.isArray(m.attachments) || !m.attachments.length) return m;
        return {
          ...m,
          attachments: m.attachments.map((a) =>
            dropImages && a.dataUrl ? { ...a, dataUrl: undefined } : a
          ),
        };
      }),
    }));
  }

  async function putConversations(conversations) {
    return apiFetch('/api/conversations', {
      method: 'PUT',
      body: JSON.stringify({ conversations, updatedAt: Date.now() }),
    });
  }

  async function pushConversations() {
    if (!state.token) return;
    try {
      let response = await putConversations(state.conversations);
      if (response.status === 401) {
        signOut(true);
        return;
      }
      if (response.status === 413) {
        response = await putConversations(slimConversations(true));
        if (response.ok) {
          setSyncState('idle');
          els.syncDot.title = 'Đã đồng bộ (ảnh đính kèm chỉ lưu trên máy này)';
          return;
        }
      }
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || `Lỗi ${response.status}`);
      if (!data.skipped) {
        localStorage.setItem(syncUpdatedKey(), String(data.updatedAt || Date.now()));
      }
      setSyncState('idle');
    } catch (err) {
      setSyncState('error');
      els.syncDot.title = err.message || 'Đồng bộ lỗi';
    }
  }

  async function pullConversations() {
    if (!state.token) return false;
    try {
      const response = await apiFetch('/api/conversations');
      if (response.status === 401) {
        signOut(true);
        return false;
      }
      if (!response.ok) throw new Error(`Lỗi ${response.status}`);
      const data = await response.json();
      const remote = Array.isArray(data.conversations) ? data.conversations : [];
      const remoteUpdatedAt = Number(data.updatedAt) || 0;
      const localUpdatedAt = Number(localStorage.getItem(syncUpdatedKey()) || 0);

      if (!remote.length) {
        if (state.conversations.length) await pushConversations();
        return false;
      }
      if (remoteUpdatedAt <= localUpdatedAt && state.conversations.length) {
        return false;
      }

      state.conversations = remote
        .filter((c) => c && c.id && Array.isArray(c.messages))
        .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
      if (!state.conversations.some((c) => c.id === state.currentId)) {
        state.currentId = state.conversations[0]?.id || null;
      }
      localStorage.setItem(syncUpdatedKey(), String(remoteUpdatedAt));
      saveLocalOnly();
      renderChatList();
      renderMessages();
      updateTopbar();
      setSyncState('idle');
      return true;
    } catch {
      setSyncState('error');
      return false;
    }
  }

  function saveLocalOnly() {
    try {
      localStorage.setItem(chatsKey(), JSON.stringify(state.conversations));
      if (state.currentId) localStorage.setItem(currentIdKey(), state.currentId);
      else localStorage.removeItem(currentIdKey());
    } catch {
      if (!state.quotaWarned) {
        state.quotaWarned = true;
        toast('Bộ nhớ trình duyệt đã đầy, ảnh/tệp cũ có thể không được lưu lại.');
      }
    }
  }

  function openAuth() {
    els.authError.hidden = true;
    els.authError.textContent = '';
    els.authModal.classList.add('show');
    setTimeout(() => els.authEmail.focus(), 80);
  }

  function closeAuth() {
    els.authModal.classList.remove('show');
  }

  async function submitAuth(e) {
    e.preventDefault();
    const username = els.authEmail.value.trim();
    const password = els.authPassword.value;

    els.authError.hidden = true;
    els.authSubmit.disabled = true;
    els.authSubmit.textContent = 'Đang đăng nhập…';

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || `Lỗi ${response.status}`);

      adoptGuestChats(data.user?.id);
      state.token = data.token;
      state.user = data.user;
      loadConversations();
      localStorage.setItem(TOKEN_KEY, data.token);
      localStorage.setItem(USER_KEY, JSON.stringify(data.user));
      renderAccount();
      renderGuest();
      renderChatList();
      renderMessages();
      updateTopbar();
      els.authForm.reset();
      closeAuth();
      updateComposer();
      toast(`Xin chào ${userLabel(data.user)}`);

      const merged = await mergeAfterLogin();
      if (merged) toast('Đã tải lịch sử từ tài khoản');
      else await pushConversations();
    } catch (err) {
      els.authError.textContent = err.message || 'Không đăng nhập được.';
      els.authError.hidden = false;
    } finally {
      els.authSubmit.disabled = false;
      els.authSubmit.textContent = 'Đăng nhập';
    }
  }

  async function mergeAfterLogin() {
    try {
      const response = await apiFetch('/api/conversations');
      if (!response.ok) return false;
      const data = await response.json();
      const remote = Array.isArray(data.conversations) ? data.conversations : [];
      if (!remote.length) return false;

      const byId = new Map();
      for (const convo of remote) byId.set(convo.id, convo);
      for (const convo of state.conversations) {
        const existing = byId.get(convo.id);
        if (!existing || (convo.updatedAt || 0) > (existing.updatedAt || 0)) byId.set(convo.id, convo);
      }

      state.conversations = [...byId.values()].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
      if (!state.conversations.some((c) => c.id === state.currentId)) {
        state.currentId = state.conversations[0]?.id || null;
      }
      saveLocalOnly();
      renderChatList();
      renderMessages();
      updateTopbar();
      setSyncState('idle');
      return true;
    } catch {
      return false;
    }
  }

  async function signOut(silent = false) {
    if (state.token) {
      try {
        await fetch('/api/auth/logout', {
          method: 'POST',
          headers: { Authorization: `Bearer ${state.token}` },
        });
      } catch {}
    }
    state.token = null;
    state.user = null;
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    loadConversations();
    renderChatList();
    renderMessages();
    updateTopbar();
    setSyncState('off');
    renderAccount();
    loadGuestStatus();
    if (!silent) toast('Đã đăng xuất. Lịch sử vẫn còn trên máy này.');
  }

  async function restoreSession() {
    const token = localStorage.getItem(TOKEN_KEY);
    const cachedUser = localStorage.getItem(USER_KEY);
    if (cachedUser) {
      try {
        state.user = JSON.parse(cachedUser);
      } catch {}
    }
    if (!token) {
      renderAccount();
      return;
    }
    state.token = token;
    loadConversations();
    renderChatList();
    renderMessages();
    updateTopbar();
    renderAccount();
    setSyncState('syncing');
    try {
      const response = await apiFetch('/api/auth/me');
      if (!response.ok) {
        await signOut(true);
        return;
      }
      const data = await response.json();
      state.user = data.user;
      localStorage.setItem(USER_KEY, JSON.stringify(data.user));
      renderAccount();
      const pulled = await pullConversations();
      if (!pulled) setSyncState('idle');
    } catch {
      setSyncState('error');
    }
  }

  function current() {
    return state.conversations.find((c) => c.id === state.currentId) || null;
  }

  function newConversationId() {
    return (crypto.randomUUID && crypto.randomUUID()) || `c_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  }

  function touch(convo) {
    convo.updatedAt = Date.now();
  }

  /* ---------------- Theme ---------------- */

  function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    const meta = document.getElementById('themeColor');
    if (meta) meta.setAttribute('content', theme === 'dark' ? '#0a0d0c' : '#f6f8f5');
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {}
  }

  function initTheme() {
    let theme;
    try {
      theme = localStorage.getItem(THEME_KEY);
    } catch {}
    if (!theme) theme = window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    applyTheme(theme);
  }

  /* ---------------- Helpers ---------------- */

  const escapeHtml = (str) =>
    String(str).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);

  function formatTime(ts) {
    if (!ts) return '';
    try {
      return new Date(ts).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
    } catch {
      return '';
    }
  }

  function makeTitle(text) {
    const clean = text.replace(/\s+/g, ' ').trim();
    return clean.length > 58 ? `${clean.slice(0, 58)}…` : clean || 'Cuộc trò chuyện mới';
  }

  let toastTimer = null;
  function toast(message) {
    els.toast.textContent = message;
    els.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => els.toast.classList.remove('show'), 2200);
  }

  function isNearBottom() {
    const el = els.chatScroll;
    return el.scrollHeight - el.scrollTop - el.clientHeight < 90;
  }

  function scrollToBottom(force = false) {
    if (force || state.stickToBottom) {
      els.chatScroll.scrollTo({ top: els.chatScroll.scrollHeight, behavior: 'auto' });
    }
  }

  /* ---------------- Attachments ---------------- */

  function formatBytes(bytes) {
    if (!bytes && bytes !== 0) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function fileExt(name) {
    const match = String(name).toLowerCase().match(/\.([a-z0-9]+)$/);
    return match ? match[1] : '';
  }

  function isImageFile(file) {
    if (file.type && file.type.startsWith('image/')) return true;
    return IMAGE_EXTENSIONS.has(fileExt(file.name));
  }

  function docIconSvg() {
    return '<svg viewBox="0 0 24 24" width="18" height="18" fill="none"><path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8l-5-5z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M14 3v5h5M9 13h6M9 17h4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>';
  }

  async function prepareImage(file) {
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) return file;
    try {
      const bitmap = await createImageBitmap(file);
      const maxDim = 1600;
      const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
      if (scale === 1 && file.size <= 1.5 * 1024 * 1024) {
        bitmap.close?.();
        return file;
      }
      const width = Math.max(1, Math.round(bitmap.width * scale));
      const height = Math.max(1, Math.round(bitmap.height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(bitmap, 0, 0, width, height);
      bitmap.close?.();
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
      if (!blob) return file;
      const base = file.name.replace(/\.[^.]+$/, '') || 'image';
      return new File([blob], `${base}.jpg`, { type: 'image/jpeg' });
    } catch {
      return file;
    }
  }

  function renderPendingAttachments() {
    els.attachPreview.innerHTML = '';
    els.attachPreview.hidden = state.pendingAttachments.length === 0;

    for (const item of state.pendingAttachments) {
      const chip = document.createElement('div');
      chip.className = `attach-chip${item.status === 'uploading' ? ' uploading' : ''}`;

      if (item.kind === 'image' && item.dataUrl) {
        const img = document.createElement('img');
        img.src = item.dataUrl;
        img.alt = item.name;
        chip.appendChild(img);
      } else {
        const icon = document.createElement('span');
        icon.className = 'attach-icon';
        icon.innerHTML = item.status === 'uploading' ? '<span class="spinner"></span>' : docIconSvg();
        chip.appendChild(icon);
      }

      const info = document.createElement('span');
      info.className = 'attach-info';
      const name = document.createElement('span');
      name.className = 'attach-name';
      name.textContent = item.name;
      name.title = item.name;
      const meta = document.createElement('span');
      meta.className = 'attach-size';
      meta.textContent = item.status === 'uploading' ? 'Đang xử lý…' : formatBytes(item.size);
      info.append(name, meta);
      chip.appendChild(info);

      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'attach-remove';
      remove.dataset.id = item.id;
      remove.title = 'Bỏ tệp';
      remove.setAttribute('aria-label', 'Bỏ tệp');
      remove.innerHTML =
        '<svg viewBox="0 0 24 24" width="14" height="14"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
      chip.appendChild(remove);

      els.attachPreview.appendChild(chip);
    }
  }

  function removePendingAttachment(id) {
    state.pendingAttachments = state.pendingAttachments.filter((a) => a.id !== id);
    renderPendingAttachments();
    updateComposer();
  }

  function clearPendingAttachments() {
    state.pendingAttachments = [];
    renderPendingAttachments();
    updateComposer();
  }

  async function uploadFiles(fileList) {
    const files = [...fileList].filter(Boolean);
    if (!files.length) return;

    const accepted = [];
    for (const file of files) {
      if (state.pendingAttachments.length + accepted.length >= MAX_ATTACHMENTS) {
        toast(`Tối đa ${MAX_ATTACHMENTS} tệp mỗi tin nhắn`);
        break;
      }
      const image = isImageFile(file);
      if (image) {
        if (file.size > MAX_IMAGE_SOURCE_BYTES) {
          toast(`${file.name}: ảnh vượt quá 8MB`);
          continue;
        }
      } else {
        const ext = fileExt(file.name);
        if (!DOC_EXTENSIONS.has(ext)) {
          toast(`${file.name}: định dạng chưa hỗ trợ`);
          continue;
        }
        if (file.size > MAX_DOC_BYTES) {
          toast(`${file.name}: tệp vượt quá 25MB`);
          continue;
        }
      }
      const id = (crypto.randomUUID && crypto.randomUUID()) || `a_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      state.pendingAttachments.push({
        id,
        name: file.name,
        size: file.size,
        kind: image ? 'image' : 'text',
        status: 'uploading',
      });
      accepted.push({ id, file, kind: image ? 'image' : 'text' });
    }

    renderPendingAttachments();
    updateComposer();
    if (!accepted.length) return;

    try {
      const prepared = await Promise.all(
        accepted.map(async (item) => ({
          ...item,
          upload: item.kind === 'image' ? await prepareImage(item.file) : item.file,
        }))
      );

      const form = new FormData();
      for (const item of prepared) form.append('files', item.upload, item.upload.name || item.file.name);

      const response = await fetch('/api/upload', { method: 'POST', body: form });
      if (!response.ok) {
        let message = `Lỗi ${response.status}`;
        try {
          const data = await response.json();
          if (data?.error) message = data.error;
        } catch {}
        throw new Error(message);
      }

      const data = await response.json();
      const results = data.attachments || [];

      prepared.forEach((item, index) => {
        const result = results[index];
        const pos = state.pendingAttachments.findIndex((a) => a.id === item.id);
        if (pos === -1) return;
        if (!result || result.error) {
          state.pendingAttachments.splice(pos, 1);
          toast(`${item.file.name}: ${result?.error || 'không xử lý được tệp'}`);
          return;
        }
        state.pendingAttachments[pos] = {
          id: item.id,
          name: item.file.name,
          size: result.size ?? item.file.size,
          mime: result.mime,
          kind: result.kind,
          text: result.text,
          dataUrl: result.dataUrl,
          truncated: Boolean(result.truncated),
          status: 'ready',
        };
      });
    } catch (e) {
      const ids = new Set(accepted.map((a) => a.id));
      state.pendingAttachments = state.pendingAttachments.filter((a) => !ids.has(a.id));
      toast(`Không tải được tệp: ${e.message || 'lỗi mạng'}`);
    } finally {
      renderPendingAttachments();
      updateComposer();
    }
  }

  function createAttachmentsEl(attachments) {
    const wrap = document.createElement('div');
    wrap.className = 'bubble-attachments';

    const images = attachments.filter((a) => a.kind === 'image' && a.dataUrl);
    const docs = attachments.filter((a) => a.kind === 'text' && typeof a.text === 'string');

    if (images.length) {
      const grid = document.createElement('div');
      grid.className = 'bubble-images';
      for (const img of images) {
        const el = document.createElement('img');
        el.src = img.dataUrl;
        el.alt = img.name || 'Ảnh đính kèm';
        el.loading = 'lazy';
        el.title = img.name || 'Ảnh đính kèm';
        grid.appendChild(el);
      }
      wrap.appendChild(grid);
    }

    if (docs.length) {
      const row = document.createElement('div');
      row.className = 'bubble-docs';
      for (const doc of docs) {
        const chip = document.createElement('span');
        chip.className = 'bubble-doc';
        chip.title = `${doc.name}${doc.truncated ? ' (đã rút gọn)' : ''}`;
        chip.innerHTML = docIconSvg();
        const label = document.createElement('span');
        label.textContent = doc.name;
        chip.appendChild(label);
        row.appendChild(chip);
      }
      wrap.appendChild(row);
    }

    return wrap;
  }

  function buildApiContent(msg) {
    const attachments = Array.isArray(msg.attachments) ? msg.attachments : [];
    const docs = attachments.filter((a) => a.kind === 'text' && typeof a.text === 'string');
    const images = attachments.filter((a) => a.kind === 'image' && typeof a.dataUrl === 'string');
    let text = typeof msg.content === 'string' ? msg.content : '';

    if (docs.length) {
      let budget = MAX_DOC_TEXT_PER_MESSAGE;
      const chunks = [];
      for (const doc of docs) {
        if (budget <= 0) {
          chunks.push(`--- Tệp: ${doc.name} ---\n[Đã lược bỏ để tiết kiệm ngữ cảnh]`);
          continue;
        }
        const part = doc.text.slice(0, budget);
        budget -= part.length;
        const cut = part.length < doc.text.length;
        chunks.push(`--- Tệp: ${doc.name}${cut ? ' (đã rút gọn)' : ''} ---\n${part}`);
      }
      text += `${text ? '\n\n' : ''}Nội dung tệp đính kèm:\n${chunks.join('\n\n')}`;
    }

    if (!text.trim()) {
      text = images.length ? 'Hãy phân tích (các) ảnh đính kèm.' : '(không có nội dung)';
    }

    if (!images.length) return text;

    const parts = [{ type: 'text', text }];
    for (const img of images.slice(0, MAX_IMAGES_PER_MESSAGE)) {
      parts.push({ type: 'image_url', image_url: { url: img.dataUrl } });
    }
    return parts;
  }

  /* ---------------- Markdown ---------------- */

  function sanitize(node) {
    node.querySelectorAll('script, iframe, object, embed, link, meta, style, form, input, button').forEach((el) => el.remove());
    node.querySelectorAll('*').forEach((el) => {
      [...el.attributes].forEach((attr) => {
        const name = attr.name.toLowerCase();
        const value = attr.value.trim().toLowerCase();
        if (name.startsWith('on')) el.removeAttribute(attr.name);
        else if ((name === 'href' || name === 'src' || name === 'xlink:href') && value.startsWith('javascript:')) {
          el.removeAttribute(attr.name);
        }
      });
    });
  }

  function renderMarkdown(text) {
    let html;
    if (window.marked && typeof window.marked.parse === 'function') {
      html = window.marked.parse(text, { gfm: true, breaks: true });
    } else {
      html = escapeHtml(text).replace(/\n/g, '<br>');
    }

    const holder = document.createElement('div');
    holder.innerHTML = html;
    sanitize(holder);

    holder.querySelectorAll('pre').forEach((pre) => {
      const codeEl = pre.querySelector('code');
      if (!codeEl) return;
      const langClass = [...codeEl.classList].find((c) => c.startsWith('language-'));
      const lang = langClass ? langClass.slice('language-'.length) : 'code';

      if (window.hljs) {
        try {
          let highlighted;
          if (lang !== 'code' && window.hljs.getLanguage(lang)) {
            highlighted = window.hljs.highlight(codeEl.textContent, { language: lang }).value;
          } else {
            highlighted = window.hljs.highlightAuto(codeEl.textContent).value;
          }
          codeEl.innerHTML = highlighted;
        } catch {}
      }

      const wrap = document.createElement('div');
      wrap.className = 'code-block';

      const head = document.createElement('div');
      head.className = 'code-head';
      const langSpan = document.createElement('span');
      langSpan.className = 'code-lang';
      langSpan.textContent = lang;
      const copyBtn = document.createElement('button');
      copyBtn.type = 'button';
      copyBtn.className = 'code-copy';
      copyBtn.innerHTML =
        '<svg viewBox="0 0 24 24" width="13" height="13" fill="none"><rect x="9" y="9" width="11" height="11" rx="2.5" stroke="currentColor" stroke-width="1.8"/><path d="M15 5.5A2.5 2.5 0 0012.5 3h-6A2.5 2.5 0 004 5.5v6A2.5 2.5 0 006.5 14" stroke="currentColor" stroke-width="1.8"/></svg><span>Sao chép</span>';
      head.append(langSpan, copyBtn);

      pre.replaceWith(wrap);
      wrap.append(head, pre);
    });

    return holder.innerHTML;
  }

  /* ---------------- Rendering ---------------- */

  function renderChatList() {
    els.chatList.innerHTML = '';
    const sorted = [...state.conversations].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

    if (!sorted.length) {
      const empty = document.createElement('div');
      empty.className = 'chat-list-empty';
      empty.textContent = 'Chưa có cuộc trò chuyện nào';
      els.chatList.appendChild(empty);
      return;
    }

    for (const convo of sorted) {
      const item = document.createElement('div');
      item.className = `chat-item${convo.id === state.currentId ? ' active' : ''}`;
      item.tabIndex = 0;
      item.setAttribute('role', 'button');
      item.dataset.id = convo.id;

      const icon = document.createElement('span');
      icon.innerHTML =
        '<svg viewBox="0 0 24 24" width="16" height="16" fill="none"><path d="M21 12a8.5 8.5 0 01-12.2 7.6L4 21l1.4-4.4A8.5 8.5 0 1121 12z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>';

      const title = document.createElement('span');
      title.className = 'chat-item-title';
      title.textContent = convo.title || 'Cuộc trò chuyện mới';

      const del = document.createElement('button');
      del.className = 'chat-item-del';
      del.type = 'button';
      del.title = 'Xóa cuộc trò chuyện';
      del.setAttribute('aria-label', 'Xóa cuộc trò chuyện');
      del.innerHTML =
        '<svg viewBox="0 0 24 24" width="15" height="15" fill="none"><path d="M5 7h14M10 7V5.5A1.5 1.5 0 0111.5 4h1A1.5 1.5 0 0114 5.5V7M6.5 7l.7 11.2a1.5 1.5 0 001.5 1.3h7.6a1.5 1.5 0 001.5-1.3L18.5 7" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>';

      del.addEventListener('click', (e) => {
        e.stopPropagation();
        deleteConversation(convo.id);
      });

      item.append(icon, title, del);
      item.addEventListener('click', () => openConversation(convo.id));
      item.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          openConversation(convo.id);
        }
      });
      els.chatList.appendChild(item);
    }
  }

  function updateTopbar() {
    const convo = current();
    els.topbarName.textContent = convo && convo.messages.length ? convo.title : 'Panda Chat Box';
  }

  function botAvatar() {
    const el = document.createElement('div');
    el.className = 'avatar bot';
    el.innerHTML =
      '<img src="/panda-128.png" alt="" width="30" height="30" draggable="false" />';
    return el;
  }

  function userAvatar() {
    const el = document.createElement('div');
    el.className = 'avatar user-avatar';
    el.textContent = 'B';
    el.title = 'Bạn';
    return el;
  }

  function buildMeta(role, ts) {
    const meta = document.createElement('div');
    meta.className = 'msg-meta';
    const name = document.createElement('strong');
    name.textContent = role === 'assistant' ? 'Panda' : 'Bạn';
    meta.appendChild(name);
    if (ts) {
      const time = document.createElement('span');
      time.textContent = formatTime(ts);
      meta.appendChild(time);
    }
    return meta;
  }

  function createMessageNode(role, content, { markdown = true, ts = Date.now(), attachments = [] } = {}) {
    const msg = document.createElement('div');
    msg.className = `msg ${role}`;
    msg.appendChild(role === 'assistant' ? botAvatar() : userAvatar());

    const body = document.createElement('div');
    body.className = 'msg-body';
    body.appendChild(buildMeta(role, ts));

    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    if (content) {
      if (role === 'assistant' && markdown) {
        bubble.classList.add('markdown');
        bubble.innerHTML = renderMarkdown(content);
      } else {
        bubble.textContent = content;
      }
    }
    if (role === 'user' && attachments && attachments.length) {
      bubble.appendChild(createAttachmentsEl(attachments));
    }
    body.appendChild(bubble);
    msg.appendChild(body);

    return { msg, body, bubble };
  }

  function addActions(body, { role, text, isLast }) {
    const actions = document.createElement('div');
    actions.className = 'msg-actions';

    const copy = document.createElement('button');
    copy.type = 'button';
    copy.className = 'mini-btn';
    copy.innerHTML =
      '<svg viewBox="0 0 24 24" width="14" height="14" fill="none"><rect x="9" y="9" width="11" height="11" rx="2.5" stroke="currentColor" stroke-width="1.8"/><path d="M15 5.5A2.5 2.5 0 0012.5 3h-6A2.5 2.5 0 004 5.5v6A2.5 2.5 0 006.5 14" stroke="currentColor" stroke-width="1.8"/></svg><span>Sao chép</span>';
    copy.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(text());
        toast('Đã sao chép');
      } catch {
        toast('Không thể sao chép');
      }
    });
    actions.appendChild(copy);

    if (role === 'assistant' && isLast) {
      const regen = document.createElement('button');
      regen.type = 'button';
      regen.className = 'mini-btn regen-btn';
      regen.innerHTML =
        '<svg viewBox="0 0 24 24" width="14" height="14" fill="none"><path d="M20 11a8 8 0 10-2.3 5.7M20 5v6h-6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg><span>Tạo lại</span>';
      regen.addEventListener('click', () => regenerate());
      actions.appendChild(regen);
    }

    body.appendChild(actions);
  }

  function renderMessages() {
    els.messages.innerHTML = '';
    const convo = current();
    const messages = convo ? convo.messages : [];
    els.welcome.classList.toggle('hidden', messages.length > 0);

    messages.forEach((m, index) => {
      const { msg, body } = createMessageNode(m.role, m.content, {
        ts: m.ts,
        attachments: m.attachments,
      });
      const copyText = () =>
        m.content || (Array.isArray(m.attachments) ? m.attachments.map((a) => a.name).join(', ') : '');
      if (m.role === 'assistant') {
        addActions(body, {
          role: m.role,
          text: copyText,
          isLast: index === messages.length - 1,
        });
      } else {
        addActions(body, { role: m.role, text: copyText, isLast: false });
      }
      els.messages.appendChild(msg);
    });
  }

  function appendStoredMessage(index) {
    const convo = current();
    const m = convo?.messages[index];
    if (!m) return;
    els.welcome.classList.add('hidden');
    const { msg, body } = createMessageNode(m.role, m.content, {
      ts: m.ts,
      attachments: m.attachments,
    });
    if (m.role === 'user') {
      const copyText = () =>
        m.content || (Array.isArray(m.attachments) ? m.attachments.map((a) => a.name).join(', ') : '');
      addActions(body, { role: m.role, text: copyText, isLast: false });
    }
    els.messages.appendChild(msg);
  }

  /* ---------------- Conversation management ---------------- */

  function ensureConversation() {
    let convo = current();
    if (!convo) {
      convo = { id: newConversationId(), title: 'Cuộc trò chuyện mới', messages: [], createdAt: Date.now(), updatedAt: Date.now() };
      state.conversations.push(convo);
      state.currentId = convo.id;
      saveConversations();
    }
    return convo;
  }

  function newChat() {
    stopGeneration(true);
    const existingEmpty = state.conversations.find((c) => !c.messages.length);
    if (existingEmpty) {
      state.currentId = existingEmpty.id;
      saveConversations();
      renderChatList();
      renderMessages();
      updateTopbar();
      closeSidebar();
      clearPendingAttachments();
      els.input.value = '';
      autoResize();
      updateComposer();
      els.input.focus();
      return;
    }
    const convo = { id: newConversationId(), title: 'Cuộc trò chuyện mới', messages: [], createdAt: Date.now(), updatedAt: Date.now() };
    state.conversations.push(convo);
    state.currentId = convo.id;
    saveConversations();
    renderChatList();
    renderMessages();
    updateTopbar();
    closeSidebar();
    clearPendingAttachments();
    els.input.value = '';
    autoResize();
    updateComposer();
    els.input.focus();
  }

  function openConversation(id) {
    if (id === state.currentId) {
      closeSidebar();
      return;
    }
    stopGeneration(true);
    clearPendingAttachments();
    state.currentId = id;
    saveConversations();
    renderChatList();
    renderMessages();
    updateTopbar();
    closeSidebar();
    updateComposer();
    requestAnimationFrame(() => scrollToBottom(true));
  }

  function deleteConversation(id) {
    const convo = state.conversations.find((c) => c.id === id);
    if (!convo) return;
    const wasCurrent = state.currentId === id;
    if (wasCurrent) {
      stopGeneration(true);
      clearPendingAttachments();
    }
    state.conversations = state.conversations.filter((c) => c.id !== id);
    if (wasCurrent) state.currentId = state.conversations[0]?.id || null;
    saveConversations();
    renderChatList();
    renderMessages();
    updateTopbar();
    closeSidebar();
  }

  function clearCurrentChat() {
    const convo = current();
    if (!convo || !convo.messages.length) {
      toast('Cuộc trò chuyện đang trống');
      return;
    }
    stopGeneration(true);
    clearPendingAttachments();
    convo.messages = [];
    convo.title = 'Cuộc trò chuyện mới';
    touch(convo);
    saveConversations();
    renderChatList();
    renderMessages();
    updateTopbar();
    toast('Đã xóa nội dung cuộc trò chuyện');
  }

  /* ---------------- Streaming ---------------- */

  function guestBlocked() {
    if (state.user) return false;
    return state.guest.requireLogin === true || state.guest.allowed === false;
  }

  function updateComposer() {
    const hasText = els.input.value.trim().length > 0;
    const hasReadyFiles = state.pendingAttachments.some((a) => a.status === 'ready');
    const uploading = state.pendingAttachments.some((a) => a.status === 'uploading');
    const blocked = guestBlocked();
    els.sendBtn.hidden = state.streaming;
    els.sendBtn.disabled = (!hasText && !hasReadyFiles) || uploading || blocked || Boolean(state.streaming);
    els.stopBtn.hidden = !state.streaming;
    els.input.disabled = false;
    els.input.placeholder = blocked
      ? state.guest.requireLogin
        ? 'Đăng nhập để trò chuyện'
        : 'Hết câu hỏi miễn phí — đăng nhập để tiếp tục'
      : 'Nhắn tin cho Panda...';
  }

  function stopGeneration(silent = false) {
    if (state.abortController) {
      state.abortController.abort();
      state.abortController = null;
    }
    if (state.streaming) {
      state.streaming = false;
      updateComposer();
      if (!silent) toast('Đã dừng trả lời');
    }
  }

  function extractDelta(json) {
    if (typeof json === 'string') return '';
    return (
      json.delta ??
      json.choices?.[0]?.delta?.content ??
      json.choices?.[0]?.message?.content ??
      json.choices?.[0]?.text ??
      json.content ??
      ''
    );
  }

  async function streamAssistant() {
    const convo = current();
    if (!convo) return;

    const history = convo.messages.map((m) => ({ role: m.role, content: buildApiContent(m) }));
    if (!history.length) return;

    state.streaming = true;
    state.stickToBottom = true;
    updateComposer();
    els.welcome.classList.add('hidden');
    els.messages.querySelectorAll('.regen-btn').forEach((btn) => btn.remove());

    const { msg, body, bubble } = createMessageNode('assistant', '', { ts: null });
    bubble.innerHTML = '';
    const typing = document.createElement('div');
    typing.className = 'typing';
    typing.innerHTML = '<i></i><i></i><i></i>';
    bubble.appendChild(typing);
    els.messages.appendChild(msg);
    scrollToBottom(true);

    const controller = new AbortController();
    state.abortController = controller;

    let raw = '';
    let started = false;
    let reasoningSeen = false;
    let renderQueued = false;
    let finished = false;
    let lastRenderAt = 0;
    let cursor = null;

    const renderPartial = () => {
      renderQueued = false;
      if (finished) return;
      lastRenderAt = performance.now();
      if (!started) {
        started = true;
        bubble.classList.add('markdown');
        bubble.innerHTML = '';
        cursor = document.createElement('span');
        cursor.className = 'cursor-blink';
      }
      bubble.innerHTML = renderMarkdown(raw);
      bubble.appendChild(cursor);
      if (state.stickToBottom) scrollToBottom();
    };

    const queueRender = () => {
      if (renderQueued) return;
      renderQueued = true;
      const wait = Math.max(0, 40 - (performance.now() - lastRenderAt));
      setTimeout(() => requestAnimationFrame(renderPartial), wait);
    };

    const finalize = () => {
      finished = true;
      if (cursor) cursor.remove();
      if (!raw.trim()) {
        msg.remove();
        return false;
      }
      bubble.innerHTML = renderMarkdown(raw);
      body.querySelector('.msg-meta')?.appendChild(
        (() => {
          const t = document.createElement('span');
          t.textContent = formatTime(Date.now());
          return t;
        })()
      );
      body.querySelector('.msg-actions')?.remove();
      addActions(body, { role: 'assistant', text: () => raw, isLast: true });
      return true;
    };

    try {
      const response = await apiFetch('/api/chat', {
        method: 'POST',
        body: JSON.stringify({ messages: history }),
        signal: controller.signal,
      });

      if (!response.ok) {
        let message = `Lỗi ${response.status}`;
        let code = '';
        try {
          const data = await response.json();
          if (data && data.error) message = data.error;
          if (data && data.code) code = data.code;
        } catch {}

        if (code === 'GUEST_LIMIT') {
          state.guest.allowed = false;
          state.guest.remaining = 0;
          renderGuest();
          updateComposer();
          openAuth();
        } else if (code === 'LOGIN_REQUIRED' || response.status === 401) {
          openAuth();
        }
        throw new Error(message);
      }

      if (!state.user) {
        const remainingHeader = response.headers.get('X-Guest-Remaining');
        if (remainingHeader != null && remainingHeader !== '') {
          const remaining = Number(remainingHeader);
          if (Number.isFinite(remaining)) {
            state.guest.remaining = Math.max(0, remaining);
            state.guest.allowed = remaining > 0;
            state.guest.used = Math.max(state.guest.used, state.guest.limit - state.guest.remaining);
            renderGuest();
            updateComposer();
          }
        }
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let newlineIndex;
        while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, newlineIndex).trim();
          buffer = buffer.slice(newlineIndex + 1);
          if (!line || !line.startsWith('data:')) continue;
          const payload = line.slice(5).trim();
          if (!payload) continue;
          if (payload === '[DONE]') {
            buffer = '';
            break;
          }
          let json;
          try {
            json = JSON.parse(payload);
          } catch {
            continue;
          }
          if (json && json.error) {
            const msgErr = typeof json.error === 'string' ? json.error : json.error.message || 'Lỗi từ nhà cung cấp AI';
            throw new Error(msgErr);
          }
          const delta = extractDelta(json);
          if (delta) {
            raw += delta;
            queueRender();
          } else if (json.choices?.[0]?.delta?.reasoning_content && !reasoningSeen && !started) {
            reasoningSeen = true;
            const label = document.createElement('span');
            label.className = 'typing-label';
            label.textContent = 'Đang suy nghĩ…';
            typing.appendChild(label);
          }
        }
      }

      if (renderQueued) renderPartial();

      if (finalize()) {
        convo.messages.push({ role: 'assistant', content: raw, ts: Date.now() });
        if (convo.title === 'Cuộc trò chuyện mới') convo.title = makeTitle(convo.messages[0]?.content || '');
        touch(convo);
        saveConversations();
        renderChatList();
        updateTopbar();
      }
    } catch (err) {
      if (err.name === 'AbortError') {
        if (renderQueued) renderPartial();
        if (finalize()) {
          convo.messages.push({ role: 'assistant', content: raw, ts: Date.now() });
          touch(convo);
          saveConversations();
          renderChatList();
          updateTopbar();
        }
      } else {
        finished = true;
        msg.remove();
        showError(err.message || 'Đã xảy ra lỗi khi kết nối với AI.');
      }
    } finally {
      state.streaming = false;
      state.abortController = null;
      state.stickToBottom = true;
      updateComposer();
      if (state.stickToBottom) scrollToBottom();
      if (!state.user && state.token === null) loadGuestStatus();
    }
  }

  function showError(message) {
    const msg = document.createElement('div');
    msg.className = 'msg assistant';

    const icon = document.createElement('div');
    icon.className = 'avatar bot';
    icon.innerHTML =
      '<svg viewBox="0 0 24 24" width="18" height="18" fill="none"><path d="M12 8v5M12 16.5v.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.7"/></svg>';

    const body = document.createElement('div');
    body.className = 'msg-body';
    const box = document.createElement('div');
    box.className = 'msg-error';
    const text = document.createElement('span');
    text.textContent = message;
    box.appendChild(text);

    const retry = document.createElement('button');
    retry.type = 'button';
    retry.className = 'mini-btn';
    retry.style.marginLeft = 'auto';
    retry.textContent = 'Thử lại';
    retry.addEventListener('click', () => {
      msg.remove();
      streamAssistant();
    });
    box.appendChild(retry);

    body.appendChild(box);
    msg.append(icon, body);
    els.messages.appendChild(msg);
    scrollToBottom(true);
  }

  async function regenerate() {
    if (state.streaming) return;
    const convo = current();
    if (!convo) return;
    const last = convo.messages[convo.messages.length - 1];
    if (last && last.role === 'assistant') convo.messages.pop();
    if (!convo.messages.length) return;
    saveConversations();
    renderMessages();
    renderChatList();
    await streamAssistant();
  }

  function sendMessage(text) {
    if (state.streaming) return;
    if (guestBlocked()) {
      openAuth();
      return;
    }
    const content = (text || '').trim();
    const readyFiles = state.pendingAttachments.filter((a) => a.status === 'ready');

    if (!content && !readyFiles.length) return;
    if (state.pendingAttachments.some((a) => a.status === 'uploading')) {
      toast('Đang xử lý tệp, chờ một chút');
      return;
    }

    const attachments = readyFiles.map(({ status, ...rest }) => ({ ...rest }));
    const convo = ensureConversation();
    convo.messages.push({ role: 'user', content, attachments, ts: Date.now() });
    const titleSource = content || attachments[0]?.name || '';
    if (!convo.title || convo.title === 'Cuộc trò chuyện mới') convo.title = makeTitle(titleSource);
    touch(convo);
    saveConversations();
    renderChatList();
    updateTopbar();

    els.welcome.classList.add('hidden');
    appendStoredMessage(convo.messages.length - 1);
    scrollToBottom(true);

    els.input.value = '';
    autoResize();
    clearPendingAttachments();

    streamAssistant();
  }

  /* ---------------- UI events ---------------- */

  function autoResize() {
    els.input.style.height = 'auto';
    els.input.style.height = `${Math.min(els.input.scrollHeight, 180)}px`;
  }

  function openSidebar() {
    els.sidebar.classList.add('open');
    els.sidebarBackdrop.classList.add('show');
  }

  function closeSidebar() {
    els.sidebar.classList.remove('open');
    els.sidebarBackdrop.classList.remove('show');
  }

  function openLightbox(src) {
    els.lightboxImg.src = src;
    els.lightbox.classList.add('show');
  }

  function closeLightbox() {
    els.lightbox.classList.remove('show');
    els.lightboxImg.removeAttribute('src');
  }

  function bindEvents() {
    els.themeToggle.addEventListener('click', () => {
      const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
      applyTheme(next);
    });

    els.newChat.addEventListener('click', newChat);
    els.topbarNew.addEventListener('click', newChat);
    els.clearChat.addEventListener('click', clearCurrentChat);
    els.menuBtn.addEventListener('click', openSidebar);
    els.sidebarClose.addEventListener('click', closeSidebar);
    els.sidebarBackdrop.addEventListener('click', closeSidebar);

    els.composer.addEventListener('submit', (e) => {
      e.preventDefault();
      if (state.streaming) return;
      sendMessage(els.input.value);
    });

    els.input.addEventListener('input', () => {
      autoResize();
      updateComposer();
    });

    els.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        if (!state.streaming) sendMessage(els.input.value);
      }
    });

    els.stopBtn.addEventListener('click', () => stopGeneration(false));

    els.attachBtn.addEventListener('click', () => els.fileInput.click());

    els.fileInput.addEventListener('change', () => {
      if (els.fileInput.files?.length) uploadFiles(els.fileInput.files);
      els.fileInput.value = '';
    });

    els.attachPreview.addEventListener('click', (e) => {
      const btn = e.target.closest('.attach-remove');
      if (btn) removePendingAttachment(btn.dataset.id);
    });

    els.input.addEventListener('paste', (e) => {
      const items = [...(e.clipboardData?.items || [])];
      const files = [];
      for (const item of items) {
        if (item.kind !== 'file') continue;
        const file = item.getAsFile();
        if (file && file.type.startsWith('image/')) files.push(file);
      }
      if (files.length) {
        e.preventDefault();
        uploadFiles(files);
      }
    });

    ['dragenter', 'dragover'].forEach((ev) => {
      els.composerBox.addEventListener(ev, (e) => {
        if (!e.dataTransfer?.types?.includes('Files')) return;
        e.preventDefault();
        els.composerBox.classList.add('dragging');
      });
    });
    ['dragleave', 'dragend'].forEach((ev) => {
      els.composerBox.addEventListener(ev, () => els.composerBox.classList.remove('dragging'));
    });
    els.composerBox.addEventListener('drop', (e) => {
      e.preventDefault();
      els.composerBox.classList.remove('dragging');
      if (e.dataTransfer?.files?.length) uploadFiles(e.dataTransfer.files);
    });

    document.addEventListener('dragover', (e) => {
      if (e.dataTransfer?.types?.includes('Files')) e.preventDefault();
    });
    document.addEventListener('drop', (e) => {
      if (e.dataTransfer?.files?.length) e.preventDefault();
    });

    els.lightbox.addEventListener('click', closeLightbox);

    els.guestLogin.addEventListener('click', () => openAuth());

    els.accountBtn.addEventListener('click', () => {
      if (state.user) {
        if (window.confirm(`Đăng xuất khỏi ${userLabel(state.user)}?`)) signOut(false);
      } else {
        openAuth();
      }
    });

    els.authClose.addEventListener('click', closeAuth);
    els.authModal.addEventListener('click', (e) => {
      if (e.target === els.authModal) closeAuth();
    });
    els.authForm.addEventListener('submit', submitAuth);

    els.suggestions.addEventListener('click', (e) => {
      const btn = e.target.closest('.suggestion');
      if (!btn) return;
      const prompt = btn.dataset.prompt;
      if (prompt) sendMessage(prompt);
    });

    els.messages.addEventListener('click', async (e) => {
      const image = e.target.closest('.bubble-images img');
      if (image) {
        openLightbox(image.src);
        return;
      }
      const copyBtn = e.target.closest('.code-copy');
      if (!copyBtn) return;
      const code = copyBtn.closest('.code-block')?.querySelector('pre')?.textContent || '';
      try {
        await navigator.clipboard.writeText(code);
        const label = copyBtn.querySelector('span');
        const original = label?.textContent;
        if (label) label.textContent = 'Đã sao chép';
        setTimeout(() => {
          if (label && original) label.textContent = original;
        }, 1600);
      } catch {
        toast('Không thể sao chép');
      }
    });

    els.chatScroll.addEventListener('scroll', () => {
      state.stickToBottom = isNearBottom();
    });

    document.addEventListener('keydown', (e) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        newChat();
      }
      if (e.key === 'Escape') {
        closeAuth();
        closeLightbox();
        closeSidebar();
      }
    });

    window.addEventListener('online', () => {
      if (state.token && state.syncState === 'error') queueSync();
    });

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && state.token && state.syncState === 'error') {
        queueSync();
      }
    });

    window.addEventListener('resize', autoResize);
  }

  async function loadConfig() {
    try {
      const res = await fetch('/api/config');
      const cfg = await res.json();
      if (cfg.configured) {
        els.statusDot.className = 'status-dot ok';
        els.statusTitle.textContent = 'Đã kết nối';
        els.statusModel.textContent = 'Panda sẵn sàng';
      } else {
        els.statusDot.className = 'status-dot bad';
        els.statusTitle.textContent = 'Chưa cấu hình';
        els.statusModel.textContent = 'Điền thông tin trong .env';
      }
    } catch {
      els.statusDot.className = 'status-dot bad';
      els.statusTitle.textContent = 'Không kiểm tra được';
      els.statusModel.textContent = 'Kiểm tra server';
    }
  }

  function initPandaTrail() {
    if (!HTMLElement.prototype.animate) return;
    if (window.matchMedia?.('(pointer: fine)').matches === false) return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;

    const layer = document.createElement('div');
    layer.className = 'panda-trail';
    layer.setAttribute('aria-hidden', 'true');
    document.body.appendChild(layer);

    const src = '/panda-128.png';
    const preload = new Image();
    preload.src = src;

    const MAX_ITEMS = 22;
    let live = 0;
    let lastX = 0;
    let lastY = 0;
    let lastAt = 0;

    function spawn(x, y) {
      if (live >= MAX_ITEMS) return;
      const size = 16 + Math.random() * 18;
      const img = document.createElement('img');
      img.src = src;
      img.alt = '';
      img.draggable = false;
      img.style.left = `${x}px`;
      img.style.top = `${y}px`;
      img.style.width = `${size}px`;
      img.style.height = `${size}px`;
      layer.appendChild(img);
      live += 1;

      const driftX = (Math.random() * 2 - 1) * 30;
      const driftY = 14 + Math.random() * 26;
      const startRot = (Math.random() * 2 - 1) * 20;
      const endRot = startRot + (Math.random() * 2 - 1) * 40;

      const anim = img.animate(
        [
          {
            transform: `translate(-50%, -50%) translate(0px, 0px) scale(1) rotate(${startRot}deg)`,
            opacity: 0.95,
            filter: 'blur(0px) drop-shadow(0 4px 8px rgba(10, 40, 90, 0.28))',
          },
          {
            transform: `translate(-50%, -50%) translate(${driftX * 0.55}px, ${driftY * 0.55}px) scale(0.55) rotate(${(startRot + endRot) / 2}deg)`,
            opacity: 0.5,
            filter: 'blur(1.5px) drop-shadow(0 6px 10px rgba(10, 40, 90, 0.18))',
            offset: 0.55,
          },
          {
            transform: `translate(-50%, -50%) translate(${driftX}px, ${driftY}px) scale(0.12) rotate(${endRot}deg)`,
            opacity: 0,
            filter: 'blur(5px) drop-shadow(0 8px 12px rgba(10, 40, 90, 0.1))',
          },
        ],
        {
          duration: 740 + Math.random() * 360,
          easing: 'cubic-bezier(0.22, 0.61, 0.36, 1)',
          fill: 'forwards',
        }
      );

      const cleanup = () => {
        if (!img.isConnected) return;
        img.remove();
        live -= 1;
      };
      anim.onfinish = cleanup;
      anim.oncancel = cleanup;
    }

    window.addEventListener(
      'pointermove',
      (e) => {
        if (e.pointerType === 'touch') return;
        const now = performance.now();
        const dx = e.clientX - lastX;
        const dy = e.clientY - lastY;
        const distance = Math.hypot(dx, dy);
        if (now - lastAt < 26 || distance < 9) return;
        lastAt = now;
        lastX = e.clientX;
        lastY = e.clientY;
        spawn(e.clientX + (Math.random() * 10 - 5), e.clientY + (Math.random() * 10 - 5));
      },
      { passive: true }
    );
  }

  function init() {
    initTheme();
    loadConversations();
    bindEvents();
    renderChatList();
    renderMessages();
    updateTopbar();
    updateComposer();
    restoreSession();
    loadConfig();
    loadGuestStatus();
    setInterval(loadConfig, 10000);
    initPandaTrail();
    autoResize();
    els.input.focus();
    requestAnimationFrame(() => scrollToBottom(true));
  }

  init();
})();
