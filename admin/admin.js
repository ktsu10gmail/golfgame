import { createSupabaseAuth } from "../packages/accounts/browser_supabase_auth.mjs";

let auth = null;
let currentSection = "home";

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];

export function adminUrl(path, parameters = {}) {
  const url = new URL(path, globalThis.location?.origin || "http://localhost");
  for (const [name, value] of Object.entries(parameters)) {
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      url.searchParams.set(name, String(value));
    }
  }
  return `${url.pathname}${url.search}`;
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = String(text);
  return node;
}

function displayDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
}

async function adminApi(path, options = {}) {
  const request = { ...options, headers: { ...(options.headers || {}) } };
  if (auth) {
    const token = await auth.getAccessToken();
    if (token) request.headers.Authorization = `Bearer ${token}`;
  }
  let response = await fetch(path, request);
  if (response.status === 401 && auth?.loadSession()?.refresh_token) {
    const refreshed = await auth.refreshSession();
    if (refreshed?.access_token) {
      request.headers.Authorization = `Bearer ${refreshed.access_token}`;
      response = await fetch(path, request);
    }
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error || `Back Office request failed (${response.status})`);
    error.status = response.status;
    throw error;
  }
  return payload;
}

function setSection(name) {
  currentSection = name;
  $$('[data-panel]').forEach(panel => {
    panel.hidden = panel.dataset.panel !== name;
    panel.classList.toggle("active", panel.dataset.panel === name);
  });
  $$('[data-section]').forEach(button => {
    button.setAttribute("aria-current", button.dataset.section === name ? "page" : "false");
  });
  const labels = { home: "Back Office", users: "Users", licensing: "Access & Licensing", coaches: "Coaches", audit: "Audit" };
  $("#page-title").textContent = labels[name] || "Back Office";
  if (name === "licensing") void loadCodes();
  if (name === "coaches") void loadCoaches();
  if (name === "audit") void loadAudit();
}

function record(primary, secondary, tags = []) {
  const article = element("article", "record");
  const copy = element("div");
  copy.append(element("strong", "", primary), element("small", "", secondary));
  if (tags.length) {
    const tagLine = element("div");
    tags.forEach(tag => tagLine.append(element("span", "record-tag", tag)));
    copy.prepend(tagLine);
  }
  article.append(copy);
  return article;
}

function actionButton(label, action, value) {
  const button = element("button", "", label);
  button.type = "button";
  button.dataset.action = action;
  button.dataset.value = String(value);
  return button;
}

function renderError(container, error) {
  container.replaceChildren(element("div", "empty-state", error.message));
}

async function loadCodes() {
  const container = $("#code-list");
  container.replaceChildren(element("div", "empty-state", "Loading issued codes…"));
  try {
    const payload = await adminApi("/api/admin/access-codes?limit=50");
    const codes = payload.codes || [];
    if (!codes.length) {
      container.replaceChildren(element("div", "empty-state", "No Access Codes have been issued."));
      return;
    }
    container.replaceChildren(...codes.map(code => {
      const item = record(
        `${code.plan} · ending ${code.code_hint}`,
        `${code.status} · ${code.redemption_count}/${code.max_redemptions} redeemed · ${code.duration_days} days · created by ${code.created_by_name}`,
        [code.status]
      );
      const actions = element("div", "record-actions");
      actions.append(actionButton("Redemptions", "code-redemptions", code.id));
      if (code.status === "ACTIVE") actions.append(actionButton("Revoke", "revoke-code", code.id));
      item.append(actions);
      return item;
    }));
  } catch (error) { renderError(container, error); }
}

async function showRedemptions(codeId) {
  try {
    const payload = await adminApi(`/api/admin/access-codes/${encodeURIComponent(codeId)}/redemptions`);
    const details = (payload.items || []).map(item => `${item.player_name} · ${item.email || "no email"} · ${displayDate(item.redeemed_at)}`).join("\n") || "No redemptions recorded.";
    window.alert(details);
  } catch (error) { window.alert(error.message); }
}

async function revokeCode(codeId) {
  if (!window.confirm("Revoke this Access Code? Existing activated access will not be removed.")) return;
  try {
    await adminApi("/api/admin/access-codes/revoke", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code_id: codeId }) });
    await loadCodes();
  } catch (error) { window.alert(error.message); }
}

function appendDetailCard(container, label, value) {
  const card = element("div", "detail-card");
  card.append(element("span", "", label), element("strong", "", value ?? "—"));
  container.append(card);
}

export function diagnosticLabels(diagnostic) {
  return [
    ["Entitlement Decision", diagnostic.entitlement_decision, diagnostic.entitlement_reason],
    ["Enforcement Mode", diagnostic.enforcement_mode, "Server policy at the time of inspection."],
    ["Current Runtime Result", diagnostic.runtime_result, diagnostic.runtime_reason],
  ];
}

function renderUserDetail(payload) {
  const container = $("#user-detail");
  const account = payload.account;
  const diagnostic = payload.diagnostic;
  container.replaceChildren();
  container.append(element("h3", "", account.display_name));
  container.append(element("p", "", `Account: ${account.account_status} · Identity: ${account.identity_label}`));
  const trace = element("div", "trace");
  diagnosticLabels(diagnostic).forEach(([label, value, note]) => {
    const step = element("div");
    step.append(element("span", "", label), element("strong", "", value), element("small", "", note));
    trace.append(step);
  });
  container.append(trace);
  const grid = element("div", "detail-grid");
  appendDetailCard(grid, "Jetta player ID", account.id);
  appendDetailCard(grid, "Email", account.email || "Not recorded");
  appendDetailCard(grid, "Supabase identity", account.supabase_user_id || "Local development account");
  appendDetailCard(grid, "Roles", account.roles.join(", "));
  appendDetailCard(grid, "Valid grants", diagnostic.valid_grants.map(grant => grant.type).join(", ") || "None");
  appendDetailCard(grid, "Current Coach", diagnostic.current_coach_relationship?.coach_name || "None");
  container.append(grid);
  container.hidden = false;
}

async function searchUsers(event) {
  event.preventDefault();
  const container = $("#user-results");
  container.replaceChildren(element("div", "empty-state", "Searching accounts…"));
  try {
    const payload = await adminApi(adminUrl("/api/admin/users", { query: $("#user-search").value, limit: 25 }));
    if (!payload.items.length) {
      container.replaceChildren(element("div", "empty-state", "No account matches this search."));
      return;
    }
    container.replaceChildren(...payload.items.map(user => {
      const item = record(user.display_name, `${user.identity_label} · ${user.email || "No email"} · Player ${user.id}`, [...user.roles, user.play_access]);
      const actions = element("div", "record-actions");
      actions.append(actionButton("Inspect access", "user-detail", user.id));
      item.append(actions);
      return item;
    }));
  } catch (error) { renderError(container, error); }
}

async function loadUserDetail(playerId) {
  const container = $("#user-detail");
  container.hidden = false;
  container.replaceChildren(element("p", "", "Loading entitlement evidence…"));
  try { renderUserDetail(await adminApi(`/api/admin/users/${encodeURIComponent(playerId)}`)); }
  catch (error) { renderError(container, error); }
}

async function loadCoaches(event) {
  event?.preventDefault();
  const container = $("#coach-results");
  container.replaceChildren(element("div", "empty-state", "Loading Coaches…"));
  try {
    const payload = await adminApi(adminUrl("/api/admin/coaches", { query: $("#coach-search").value, limit: 25 }));
    if (!payload.items.length) {
      container.replaceChildren(element("div", "empty-state", "No Coach accounts match."));
      return;
    }
    container.replaceChildren(...payload.items.map(coach => {
      const item = record(coach.display_name, `${coach.subscription_status || "No Coach subscription"} · ${coach.sponsored_students}/${coach.seat_capacity} sponsored · ${coach.active_relationships} relationships`, ["COACH"]);
      const actions = element("div", "record-actions");
      actions.append(actionButton("Inspect", "coach-detail", coach.id));
      item.append(actions);
      return item;
    }));
  } catch (error) { renderError(container, error); }
}

async function loadCoachDetail(coachId) {
  const container = $("#coach-detail");
  container.hidden = false;
  container.replaceChildren(element("p", "", "Loading Coach operations…"));
  try {
    const payload = await adminApi(`/api/admin/coaches/${encodeURIComponent(coachId)}`);
    container.replaceChildren(element("h3", "", payload.account.display_name), element("p", "", `${payload.subscription?.status || "No subscription"} · ${payload.sponsored_students}/${payload.seat_capacity} sponsored seats`));
    const grid = element("div", "detail-grid");
    appendDetailCard(grid, "Grace deadline", displayDate(payload.subscription?.grace_ends_at));
    appendDetailCard(grid, "Seats available", payload.seats_available);
    appendDetailCard(grid, "Relationships", payload.relationships.length);
    appendDetailCard(grid, "Pending invitations", payload.invitations.filter(item => item.status === "PENDING").length);
    container.append(grid);
    payload.relationships.forEach(relationship => {
      container.append(record(relationship.player_name, `${relationship.relationship_status} relationship · ${relationship.seat_status || "No sponsored seat"}`, [relationship.seat_status || "UNSPONSORED"]));
    });
  } catch (error) { renderError(container, error); }
}

async function loadAudit(event) {
  event?.preventDefault();
  const container = $("#audit-list");
  container.replaceChildren(element("div", "empty-state", "Loading audit evidence…"));
  try {
    const payload = await adminApi(adminUrl("/api/admin/audit", { event_type: $("#audit-event-type").value, subject_id: $("#audit-subject").value, actor_id: $("#audit-actor").value, limit: 50 }));
    if (!payload.items.length) {
      container.replaceChildren(element("div", "empty-state", "No audit events match these filters."));
      return;
    }
    container.replaceChildren(...payload.items.map(eventItem => {
      const item = record(eventItem.event_type, `${displayDate(eventItem.created_at)} · actor ${eventItem.actor_player_id ?? "system"} · subject ${eventItem.subject_player_id ?? "—"}`, [eventItem.entity_type || "EVENT"]);
      item.firstElementChild.append(element("pre", "audit-detail", JSON.stringify(eventItem.detail, null, 2)));
      return item;
    }));
  } catch (error) { renderError(container, error); }
}

async function initialize() {
  const accessState = $("#access-state");
  try {
    const configResponse = await fetch("/api/auth/config", { cache: "no-store" });
    const config = await configResponse.json();
    if (config.provider === "supabase") auth = createSupabaseAuth(config);
    const payload = await adminApi("/api/admin/session");
    $("#admin-name").textContent = payload.admin.name;
    $("#enforcement-badge").textContent = `${payload.enforcement_mode} enforcement`;
    accessState.hidden = true;
    $("#workspace").hidden = false;
    setSection("home");
  } catch (error) {
    accessState.classList.add("denied");
    accessState.replaceChildren();
    const pulse = element("span", "pulse");
    const copy = element("div");
    copy.append(element("strong", "", error.status === 403 ? "Administrator role required" : "Sign in through the Jetta application"));
    copy.append(element("p", "", "This restricted Back Office returns no operational data until the server verifies ADMIN access."));
    const link = element("a", "", "Open Jetta product application");
    link.href = "/";
    copy.append(link);
    accessState.append(pulse, copy);
  }
}

function bindEvents() {
  $$('[data-section]').forEach(button => button.addEventListener("click", () => setSection(button.dataset.section)));
  $$('[data-open-section]').forEach(button => button.addEventListener("click", () => setSection(button.dataset.openSection)));
  $("#user-search-form").addEventListener("submit", searchUsers);
  $("#coach-search-form").addEventListener("submit", loadCoaches);
  $("#audit-filter-form").addEventListener("submit", loadAudit);
  $("#refresh-codes").addEventListener("click", loadCodes);
  $("#code-form").addEventListener("submit", async event => {
    event.preventDefault();
    const output = $("#created-code");
    output.hidden = false;
    output.replaceChildren(element("span", "", "Generating secure code…"));
    try {
      const payload = await adminApi("/api/admin/access-codes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ plan: $("#code-plan").value, duration_days: Number($("#code-days").value), max_redemptions: Number($("#code-redemptions").value) }) });
      output.replaceChildren(element("strong", "", `${payload.access_code.plan} Access Code created`), element("code", "", payload.access_code.code), element("small", "", "Copy this code now. The complete plaintext code will not be shown again."));
      await loadCodes();
    } catch (error) { output.replaceChildren(element("span", "", error.message)); }
  });
  document.addEventListener("click", event => {
    const action = event.target.closest("[data-action]");
    if (!action) return;
    if (action.dataset.action === "user-detail") void loadUserDetail(action.dataset.value);
    if (action.dataset.action === "coach-detail") void loadCoachDetail(action.dataset.value);
    if (action.dataset.action === "code-redemptions") void showRedemptions(action.dataset.value);
    if (action.dataset.action === "revoke-code") void revokeCode(action.dataset.value);
  });
}

if (typeof document !== "undefined") {
  bindEvents();
  void initialize();
}
