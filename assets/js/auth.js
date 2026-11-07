// Client-side authentication.
//
// IMPORTANT: this is a basic visitor deterrent, NOT real access control.
// GitHub Pages is a static host: anyone who can reach the site can download
// the HTML, JS, JSON and receipt files directly. See README.md.

// Generate your own values with:  node tools/generate-credentials.mjs
const AUTH_CONFIG = Object.freeze({
  username: "tenant",
  salt: "F2gHfTCBYm3KYwZdIGzt0A==",
  hash: "gOubXBzo0TKu3vKk57NSKaxyeLeWLKv0qkY5MebCc18=",
  iterations: 600000,
});

const SESSION_KEY = "tenantPortal.session";
const SESSION_TTL_MS = 8 * 60 * 60 * 1000; // 8 hours, and always cleared when the tab closes

const encoder = new TextEncoder();

function base64ToBytes(b64) {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

async function deriveHash(password, salt, iterations) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    key,
    256
  );
  return new Uint8Array(bits);
}

/** Constant-time comparison (no early exit on the first differing byte). */
function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/**
 * Always derives the hash, even for a wrong username, so response time does
 * not reveal whether the username was right.
 */
export async function verifyCredentials(username, password) {
  if (!globalThis.crypto || !crypto.subtle) {
    throw new Error("secure-context-required");
  }
  const derived = await deriveHash(password, base64ToBytes(AUTH_CONFIG.salt), AUTH_CONFIG.iterations);
  const hashOk = timingSafeEqual(derived, base64ToBytes(AUTH_CONFIG.hash));

  const userOk = timingSafeEqual(
    encoder.encode(String(username).trim().toLowerCase()),
    encoder.encode(AUTH_CONFIG.username.toLowerCase())
  );
  return hashOk && userOk;
}

/* ---------------- Session (sessionStorage: cleared when the tab closes) ---------------- */

function startSession(username) {
  sessionStorage.setItem(SESSION_KEY, JSON.stringify({ user: username, at: Date.now() }));
}

function readSession() {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (!s || typeof s.at !== "number" || Date.now() - s.at > SESSION_TTL_MS) {
      sessionStorage.removeItem(SESSION_KEY);
      return null;
    }
    return s;
  } catch {
    return null;
  }
}

export function isAuthenticated() {
  return readSession() !== null;
}

export function getSessionUser() {
  const s = readSession();
  return s ? s.user : null;
}

function goTo(page) {
  // Relative to the current URL, so it works under a GitHub Pages repo subpath.
  location.replace(new URL(page, location.href).href);
}

/** Guard for protected pages. Redirects and returns false when not signed in. */
export function requireAuth() {
  if (!isAuthenticated()) {
    goTo("index.html");
    return false;
  }
  // Back/forward cache could resurrect the page after logout; re-check.
  window.addEventListener("pageshow", (e) => {
    if (e.persisted && !isAuthenticated()) goTo("index.html");
  });
  return true;
}

export function logout() {
  sessionStorage.removeItem(SESSION_KEY);
  goTo("index.html");
}

/* ---------------- Login page wiring ---------------- */

export function initLoginPage() {
  if (isAuthenticated()) {
    goTo("dashboard.html");
    return;
  }

  const form = document.getElementById("login-form");
  const userInput = document.getElementById("username");
  const passInput = document.getElementById("password");
  const toggle = document.getElementById("toggle-password");
  const button = document.getElementById("login-btn");
  const formError = document.getElementById("form-error");
  const fieldErrors = {
    username: document.getElementById("username-error"),
    password: document.getElementById("password-error"),
  };

  const setFieldError = (name, input, message) => {
    const el = fieldErrors[name];
    el.textContent = message || "";
    el.hidden = !message;
    input.setAttribute("aria-invalid", message ? "true" : "false");
  };
  const setFormError = (message) => {
    formError.textContent = message || "";
    formError.hidden = !message;
  };

  toggle.addEventListener("click", () => {
    const show = passInput.type === "password";
    passInput.type = show ? "text" : "password";
    toggle.textContent = show ? "Hide" : "Show";
    toggle.setAttribute("aria-label", show ? "Hide password" : "Show password");
    toggle.setAttribute("aria-pressed", String(show));
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    setFormError("");

    const username = userInput.value.trim();
    const password = passInput.value;
    setFieldError("username", userInput, username ? "" : "Enter your username.");
    setFieldError("password", passInput, password ? "" : "Enter your password.");
    if (!username || !password) {
      (username ? passInput : userInput).focus();
      return;
    }

    button.disabled = true;
    button.textContent = "Signing in…";
    try {
      const ok = await verifyCredentials(username, password);
      if (ok) {
        startSession(AUTH_CONFIG.username);
        goTo("dashboard.html");
        return;
      }
      setFormError("Incorrect username or password.");
      passInput.select();
    } catch (err) {
      setFormError(
        err && err.message === "secure-context-required"
          ? "Sign-in needs a secure connection (https:// or localhost)."
          : "Something went wrong while signing in. Please try again."
      );
    } finally {
      button.disabled = false;
      button.textContent = "Sign in";
    }
  });
}
