/**
 * Auth module — Supabase Auth (email/password) cho webapp.
 * Lưu phiên vào localStorage, tự refresh access token khi hết hạn.
 * Cho phép vào app khi còn phiên (kể cả offline); refresh khi có mạng.
 */
const Auth = (() => {
  const CONFIG = window.CLOUD_CONFIG || { url: '', anonKey: '' };
  const KEY = 'khanhchi_session';
  let session = load();

  function load() {
    try { return JSON.parse(localStorage.getItem(KEY)) || null; } catch (e) { return null; }
  }

  function persist() {
    if (session) localStorage.setItem(KEY, JSON.stringify(session));
    else localStorage.removeItem(KEY);
  }

  function store(data) {
    session = {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: Date.now() + ((data.expires_in || 3600) * 1000) - 60000,
      email: (data.user && data.user.email) || (session && session.email) || '',
    };
    persist();
  }

  async function authRequest(path, body) {
    const resp = await fetch(`${CONFIG.url}/auth/v1/${path}`, {
      method: 'POST',
      headers: { 'apikey': CONFIG.anonKey, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const text = await resp.text();
    const data = text ? JSON.parse(text) : {};
    if (!resp.ok) {
      throw new Error(data.error_description || data.msg || data.message || `Lỗi ${resp.status}`);
    }
    return data;
  }

  async function login(email, password) {
    const data = await authRequest('token?grant_type=password', { email, password });
    store(data);
    return true;
  }

  async function refresh() {
    if (!session || !session.refresh_token) throw new Error('Chưa đăng nhập');
    const data = await authRequest('token?grant_type=refresh_token',
      { refresh_token: session.refresh_token });
    store(data);
  }

  async function getAccessToken() {
    if (!session) throw new Error('Chưa đăng nhập');
    if (session.access_token && Date.now() < session.expires_at) return session.access_token;
    await refresh();  // hết hạn → refresh (cần mạng)
    return session.access_token;
  }

  function isLoggedIn() { return !!(session && session.refresh_token); }
  function email() { return session ? session.email : ''; }
  function logout() { session = null; persist(); }

  return { login, refresh, getAccessToken, isLoggedIn, email, logout };
})();
