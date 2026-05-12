/**
 * Base URL for LiveKit Room Service (Twirp) HTTP API, e.g. `https://your-project.livekit.cloud`.
 * Prefer `LIVEKIT_URL` when set; otherwise derive from `LIVEKIT_WS_URL` so keys and host stay on one project.
 * @returns {string}
 */
function resolveLiveKitHttpUrl() {
  const explicit = process.env.LIVEKIT_URL && String(process.env.LIVEKIT_URL).trim();
  if (explicit) {
    return explicit.replace(/\/+$/, '');
  }
  const ws = process.env.LIVEKIT_WS_URL && String(process.env.LIVEKIT_WS_URL).trim();
  if (!ws) return '';
  try {
    const u = new URL(ws);
    if (u.protocol === 'wss:') return `https://${u.host}`;
    if (u.protocol === 'ws:') return `http://${u.host}`;
    return `${u.protocol}//${u.host}`;
  } catch {
    return '';
  }
}

/**
 * Loads and validates required environment variables.
 * @throws {Error} When any required variable is missing or empty.
 * @returns {Record<string, string | number>}
 */
function loadEnv() {
  require('dotenv').config();

  const required = [
    'PORT',
    'LIVEKIT_API_KEY',
    'LIVEKIT_API_SECRET',
    'LIVEKIT_WS_URL',
    'MONGODB_URI',
    'ADMIN_EMAIL',
    'JWT_SECRET',
    'CLIENT_URL',
  ];

  const missing = required.filter((key) => !process.env[key] || String(process.env[key]).trim() === '');
  if (missing.length > 0) {
    throw new Error(`Missing or empty environment variables: ${missing.join(', ')}`);
  }

  const LIVEKIT_HTTP_URL = resolveLiveKitHttpUrl();
  if (!LIVEKIT_HTTP_URL) {
    throw new Error(
      'Could not resolve LiveKit HTTP API URL: set LIVEKIT_URL (https://your-project.livekit.cloud) or use a valid LIVEKIT_WS_URL (wss://…).'
    );
  }

  return {
    PORT: Number(process.env.PORT),
    LIVEKIT_API_KEY: String(process.env.LIVEKIT_API_KEY).trim(),
    LIVEKIT_API_SECRET: String(process.env.LIVEKIT_API_SECRET).trim(),
    LIVEKIT_WS_URL: String(process.env.LIVEKIT_WS_URL).trim(),
    LIVEKIT_HTTP_URL,
    MONGODB_URI: String(process.env.MONGODB_URI).trim(),
    ADMIN_EMAIL: String(process.env.ADMIN_EMAIL).trim(),
    JWT_SECRET: String(process.env.JWT_SECRET).trim(),
    CLIENT_URL: String(process.env.CLIENT_URL).trim(),
  };
}

module.exports = { loadEnv };
