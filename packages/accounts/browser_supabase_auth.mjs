const SESSION_KEY = "golfgame-supabase-session";

function apiError(payload, status) {
  return new Error(payload?.msg || payload?.message || payload?.error_description || payload?.error || `Authentication failed (${status})`);
}

function normalizeSession(payload, nowSeconds) {
  if (!payload?.access_token || !payload?.refresh_token) return null;
  return {
    access_token: payload.access_token,
    refresh_token: payload.refresh_token,
    expires_at: Number(payload.expires_at) || nowSeconds + Number(payload.expires_in || 3600),
    user: payload.user || null
  };
}

export function createSupabaseAuth(config, options = {}) {
  if (!config?.url || !config?.anon_key) throw new Error("Supabase configuration is incomplete");
  const storage = options.storage || globalThis.localStorage;
  const fetchImpl = options.fetchImpl || globalThis.fetch.bind(globalThis);
  const now = options.now || (() => Date.now());
  const baseUrl = config.url.replace(/\/$/, "");
  let refreshPromise = null;

  function loadSession() {
    try {
      return JSON.parse(storage.getItem(SESSION_KEY) || "null");
    } catch {
      storage.removeItem(SESSION_KEY);
      return null;
    }
  }

  function saveSession(session) {
    if (!session) storage.removeItem(SESSION_KEY);
    else storage.setItem(SESSION_KEY, JSON.stringify(session));
    return session;
  }

  async function request(path, { method = "POST", body, accessToken } = {}) {
    const headers = { apikey: config.anon_key, "Content-Type": "application/json" };
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
    const response = await fetchImpl(`${baseUrl}/auth/v1${path}`, {
      method,
      headers,
      body: body == null ? undefined : JSON.stringify(body)
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw apiError(payload, response.status);
    return payload;
  }

  async function refreshSession() {
    if (refreshPromise) return refreshPromise;
    const current = loadSession();
    if (!current?.refresh_token) return null;
    refreshPromise = request("/token?grant_type=refresh_token", {
      body: { refresh_token: current.refresh_token }
    }).then(payload => saveSession(normalizeSession(payload, Math.floor(now() / 1000))))
      .catch(error => {
        saveSession(null);
        throw error;
      })
      .finally(() => { refreshPromise = null; });
    return refreshPromise;
  }

  async function getSession() {
    const session = loadSession();
    if (!session) return null;
    if (Number(session.expires_at) > Math.floor(now() / 1000) + 60) return session;
    return refreshSession();
  }

  return {
    loadSession,
    refreshSession,
    async getAccessToken() {
      return (await getSession())?.access_token || null;
    },
    async signIn(email, password) {
      const payload = await request("/token?grant_type=password", { body: { email, password } });
      return saveSession(normalizeSession(payload, Math.floor(now() / 1000)));
    },
    async signUp(email, password, displayName, redirectTo) {
      const path = redirectTo ? `/signup?redirect_to=${encodeURIComponent(redirectTo)}` : "/signup";
      const payload = await request(path, {
        body: {
          email,
          password,
          data: { display_name: displayName }
        }
      });
      const session = normalizeSession(payload, Math.floor(now() / 1000));
      if (session) saveSession(session);
      return { session, user: payload.user || null };
    },
    async sendPasswordReset(email, redirectTo) {
      await request("/recover", { body: { email, redirect_to: redirectTo } });
    },
    async updatePassword(password) {
      const session = await getSession();
      if (!session) throw new Error("The password recovery link has expired. Request a new one.");
      const payload = await request("/user", { method: "PUT", body: { password }, accessToken: session.access_token });
      session.user = payload;
      saveSession(session);
      return payload;
    },
    consumeRedirect(url = globalThis.location?.href) {
      if (!url) return null;
      const parsed = new URL(url);
      const values = new URLSearchParams(parsed.hash.slice(1));
      const session = normalizeSession({
        access_token: values.get("access_token"),
        refresh_token: values.get("refresh_token"),
        expires_in: values.get("expires_in")
      }, Math.floor(now() / 1000));
      if (!session) return null;
      saveSession(session);
      return { type: values.get("type"), session };
    },
    async signOut() {
      const session = loadSession();
      try {
        if (session?.access_token) await request("/logout", { accessToken: session.access_token });
      } finally {
        saveSession(null);
      }
    },
    clear() { saveSession(null); }
  };
}

export { SESSION_KEY };
