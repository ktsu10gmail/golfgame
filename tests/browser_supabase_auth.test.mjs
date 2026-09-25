import assert from "node:assert/strict";
import test from "node:test";

import { createSupabaseAuth, SESSION_KEY } from "../packages/accounts/browser_supabase_auth.mjs";

function memoryStorage() {
  const values = new Map();
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key)
  };
}

function response(payload, ok = true, status = 200) {
  return { ok, status, json: async () => payload };
}

test("Supabase login stores and returns an access token", async () => {
  const storage = memoryStorage();
  const requests = [];
  const auth = createSupabaseAuth(
    { url: "https://project.supabase.co", anon_key: "public-key" },
    {
      storage,
      now: () => 1_000_000,
      fetchImpl: async (url, options) => {
        requests.push({ url, options });
        return response({ access_token: "access", refresh_token: "refresh", expires_in: 3600 });
      }
    }
  );
  await auth.signIn("golfer@example.com", "password123");
  assert.equal(await auth.getAccessToken(), "access");
  assert.match(requests[0].url, /grant_type=password/);
  assert.equal(JSON.parse(storage.getItem(SESSION_KEY)).refresh_token, "refresh");
});

test("expired sessions refresh once and rotate the refresh token", async () => {
  const storage = memoryStorage();
  storage.setItem(SESSION_KEY, JSON.stringify({ access_token: "old", refresh_token: "old-refresh", expires_at: 1 }));
  let calls = 0;
  const auth = createSupabaseAuth(
    { url: "https://project.supabase.co", anon_key: "public-key" },
    {
      storage,
      now: () => 2_000_000,
      fetchImpl: async () => {
        calls += 1;
        return response({ access_token: "new", refresh_token: "new-refresh", expires_in: 3600 });
      }
    }
  );
  const [first, second] = await Promise.all([auth.getAccessToken(), auth.getAccessToken()]);
  assert.equal(first, "new");
  assert.equal(second, "new");
  assert.equal(calls, 1);
  assert.equal(JSON.parse(storage.getItem(SESSION_KEY)).refresh_token, "new-refresh");
});

test("a transient refresh failure keeps the local session for a later retry", async () => {
  const storage = memoryStorage();
  storage.setItem(SESSION_KEY, JSON.stringify({ access_token: "old", refresh_token: "keep-refresh", expires_at: 1 }));
  const auth = createSupabaseAuth(
    { url: "https://project.supabase.co", anon_key: "public-key" },
    { storage, now: () => 2_000_000, fetchImpl: async () => { throw new Error("network unavailable"); } }
  );

  await assert.rejects(() => auth.getAccessToken(), /network unavailable/);
  assert.equal(JSON.parse(storage.getItem(SESSION_KEY)).refresh_token, "keep-refresh");
});

test("a refresh-token race adopts the session rotated by another tab", async () => {
  const storage = memoryStorage();
  storage.setItem(SESSION_KEY, JSON.stringify({ access_token: "old", refresh_token: "old-refresh", expires_at: 1 }));
  const auth = createSupabaseAuth(
    { url: "https://project.supabase.co", anon_key: "public-key" },
    {
      storage,
      now: () => 2_000_000,
      fetchImpl: async () => {
        storage.setItem(SESSION_KEY, JSON.stringify({ access_token: "other-tab-access", refresh_token: "other-tab-refresh", expires_at: 9_999_999 }));
        return response({ error: "Refresh Token Not Found" }, false, 400);
      }
    }
  );

  assert.equal(await auth.getAccessToken(), "other-tab-access");
  assert.equal(JSON.parse(storage.getItem(SESSION_KEY)).refresh_token, "other-tab-refresh");
});

test("signup reports email-confirmation state when no session is returned", async () => {
  const auth = createSupabaseAuth(
    { url: "https://project.supabase.co", anon_key: "public-key" },
    { storage: memoryStorage(), fetchImpl: async () => response({ user: { id: "user-1" }, session: null }) }
  );
  const result = await auth.signUp("new@example.com", "password123", "New Golfer", "http://game/");
  assert.equal(result.session, null);
  assert.equal(result.user.id, "user-1");
});

test("recovery redirect session can update the password", async () => {
  const storage = memoryStorage();
  let updateRequest;
  const auth = createSupabaseAuth(
    { url: "https://project.supabase.co", anon_key: "public-key" },
    {
      storage,
      fetchImpl: async (url, options) => {
        updateRequest = { url, options };
        return response({ id: "user-1" });
      }
    }
  );
  const redirect = auth.consumeRedirect("http://game/#access_token=a&refresh_token=r&expires_in=3600&type=recovery");
  assert.equal(redirect.type, "recovery");
  await auth.updatePassword("new-password");
  assert.match(updateRequest.url, /\/auth\/v1\/user$/);
  assert.equal(updateRequest.options.method, "PUT");
});
