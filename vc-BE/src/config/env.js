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

  return {
    PORT: Number(process.env.PORT),
    LIVEKIT_API_KEY: String(process.env.LIVEKIT_API_KEY).trim(),
    LIVEKIT_API_SECRET: String(process.env.LIVEKIT_API_SECRET).trim(),
    LIVEKIT_WS_URL: String(process.env.LIVEKIT_WS_URL).trim(),
    LIVEKIT_URL: String(process.env.LIVEKIT_URL).trim(),
    MONGODB_URI: String(process.env.MONGODB_URI).trim(),
    ADMIN_EMAIL: String(process.env.ADMIN_EMAIL).trim(),
    JWT_SECRET: String(process.env.JWT_SECRET).trim(),
    CLIENT_URL: String(process.env.CLIENT_URL).trim(),
  };
}

module.exports = { loadEnv };
