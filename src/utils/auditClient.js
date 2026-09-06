import api from "../api/axios";

const MAX_LABEL_LENGTH = 120;

function readUser() {
  try {
    return JSON.parse(sessionStorage.getItem("user") || "null");
  } catch {
    return null;
  }
}

function buildBasePayload() {
  const user = readUser();
  return {
    session_id: user?.session_id || null,
    username: user?.username || null,
    role: user?.role || null,
    page: window.location.pathname,
  };
}

export async function logAuditEvent(event, details = null) {
  try {
    const payload = {
      ...buildBasePayload(),
      event,
      details,
    };
    await api.post("/api/audit/event", payload);
  } catch (err) {
    // Keep silent to avoid interrupting user flow.
    console.warn("Audit event failed:", err?.message || err);
  }
}

export async function logLogoutEvent() {
  try {
    const payload = buildBasePayload();
    await api.post("/api/audit/logout", payload);
  } catch (err) {
    console.warn("Audit logout failed:", err?.message || err);
  }
}

export function getClickLabel(target) {
  if (!target) return "";
  const raw =
    target.getAttribute?.("data-audit-label") ||
    target.getAttribute?.("aria-label") ||
    target.innerText ||
    target.value ||
    target.id ||
    target.name ||
    target.className ||
    "";
  return String(raw).replace(/\s+/g, " ").trim().slice(0, MAX_LABEL_LENGTH);
}
