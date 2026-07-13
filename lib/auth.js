const crypto = require("crypto");

const AUTH_PASSWORD = process.env.AUTH_PASSWORD || "";
// Regenerated on each restart, invalidating outstanding sessions.
const AUTH_SECRET = crypto.randomBytes(32).toString("hex");
const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;
const COOKIE_NAME = "bb_session";

function isAuthEnabled() {
  return Boolean(AUTH_PASSWORD);
}

function signSession(exp) {
  const payload = Buffer.from(JSON.stringify({ exp })).toString("base64url");
  const sig = crypto
    .createHmac("sha256", AUTH_SECRET)
    .update(payload)
    .digest("base64url");
  return `${payload}.${sig}`;
}

function verifySession(token) {
  if (!token) return false;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return false;
  const expected = crypto
    .createHmac("sha256", AUTH_SECRET)
    .update(payload)
    .digest("base64url");
  try {
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
    const { exp } = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return typeof exp === "number" && exp > Date.now();
  } catch (_) {
    return false;
  }
}

function parseCookies(req) {
  const cookie = req.headers.cookie || "";
  const out = {};
  cookie.split(";").forEach((part) => {
    const i = part.indexOf("=");
    if (i < 0) return;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k) out[k] = v;
  });
  return out;
}

function issueCookie(res, req) {
  const exp = Date.now() + SESSION_MAX_AGE_SECONDS * 1000;
  const token = signSession(exp);
  const secure =
    req.secure ||
    String(req.headers["x-forwarded-proto"] || "").split(",")[0] === "https";
  const parts = [
    `${COOKIE_NAME}=${token}`,
    "HttpOnly",
    "Path=/",
    `Max-Age=${SESSION_MAX_AGE_SECONDS}`,
    "SameSite=Lax",
  ];
  if (secure) parts.push("Secure");
  res.setHeader("Set-Cookie", parts.join("; "));
}

function clearCookie(res) {
  res.setHeader(
    "Set-Cookie",
    `${COOKIE_NAME}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax`,
  );
}

function isAuthenticated(req) {
  if (!isAuthEnabled()) return true;
  const cookies = parseCookies(req);
  return verifySession(cookies[COOKIE_NAME]);
}

function checkPassword(candidate) {
  if (!isAuthEnabled()) return true;
  if (typeof candidate !== "string") return false;
  const a = Buffer.from(candidate);
  const b = Buffer.from(AUTH_PASSWORD);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

const LOGIN_PATHS = new Set(["/login", "/logout"]);
const PUBLIC_PATHS = new Set(["/favicon.ico", "/style.css"]);

function requireAuth(req, res, next) {
  if (!isAuthEnabled()) return next();
  if (LOGIN_PATHS.has(req.path)) return next();
  if (PUBLIC_PATHS.has(req.path)) return next();
  if (isAuthenticated(req)) return next();

  const wantsJson =
    req.path.startsWith("/api/") ||
    (req.headers.accept || "").includes("application/json");
  if (wantsJson) {
    return res.status(401).json({ error: "Auth required. Please sign in." });
  }
  res.redirect("/login");
}

function loginPageHtml({ error = "", redirect = "/" } = {}) {
  const errBlock = error
    ? `<p class="err">${error.replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;" }[c]))}</p>`
    : "";
  const safeRedirect = redirect.startsWith("/") && !redirect.startsWith("//") ? redirect : "/";
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Book Brewery — sign in</title>
    <link rel="stylesheet" href="/style.css" />
    <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Ctext y='.9em' font-size='56'%3E%F0%9F%8D%B5%3C/text%3E%3C/svg%3E" />
    <style>
      body { align-items: center; justify-content: center; padding: 24px; }
      .login-card {
        width: min(400px, 100%);
        background: var(--surface);
        border: 1px solid var(--line);
        border-radius: var(--radius-lg);
        padding: 36px 30px;
        box-shadow: var(--shadow);
        text-align: center;
      }
      .login-mark { font-size: 44px; filter: drop-shadow(0 4px 12px var(--accent-glow)); }
      .login-card h1 {
        font-family: var(--font-display);
        font-size: 26px;
        margin: 12px 0 4px;
        background: linear-gradient(135deg, var(--accent-3), var(--accent-2));
        -webkit-background-clip: text; background-clip: text; color: transparent;
      }
      .login-card p.sub { color: var(--ink-2); font-size: 14px; margin: 4px 0 22px; }
      .login-card input[type="password"] {
        width: 100%;
        padding: 12px 14px;
        border: 1px solid var(--line);
        background: var(--surface-2);
        color: var(--ink);
        border-radius: 12px;
        font: inherit;
        font-size: 15px;
        outline: none;
        margin-bottom: 14px;
      }
      .login-card input[type="password"]:focus { border-color: var(--accent); box-shadow: 0 0 0 4px var(--accent-glow); }
      .login-card button { width: 100%; }
      .login-card .err {
        background: rgba(156, 52, 24, 0.08);
        color: var(--danger);
        border: 1px solid rgba(156, 52, 24, 0.28);
        padding: 8px 12px;
        border-radius: 10px;
        font-size: 13px;
        margin-bottom: 14px;
      }
    </style>
  </head>
  <body>
    <div class="login-card">
      <div class="login-mark">🍵</div>
      <h1>Book Brewery</h1>
      <p class="sub">Sign in to keep brewing.</p>
      ${errBlock}
      <form method="POST" action="/login">
        <input type="hidden" name="redirect" value="${safeRedirect}" />
        <input type="password" name="password" placeholder="Password" autofocus required />
        <button type="submit" class="btn primary">Sign in</button>
      </form>
    </div>
  </body>
</html>`;
}

module.exports = {
  isAuthEnabled,
  isAuthenticated,
  requireAuth,
  checkPassword,
  issueCookie,
  clearCookie,
  loginPageHtml,
};
