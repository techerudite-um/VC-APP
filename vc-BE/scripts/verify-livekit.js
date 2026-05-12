/**
 * Verifies LiveKit Cloud credentials without printing secrets.
 * Run from repo root: node vc-BE/scripts/verify-livekit.js
 * Or from vc-BE:    node scripts/verify-livekit.js
 */
const path = require('path');
const { config } = require('dotenv');
const { RoomServiceClient } = require('livekit-server-sdk');

const root = path.join(__dirname, '..');
config({ path: path.join(root, '.env') });

const host = String(process.env.LIVEKIT_WS_URL || '').trim();
const apiKey = String(process.env.LIVEKIT_API_KEY || '').trim();
const apiSecret = String(process.env.LIVEKIT_API_SECRET || '').trim();

function mask(s) {
  if (!s) return '(empty)';
  if (s.length <= 8) return `${s.length} chars`;
  return `${s.slice(0, 4)}…${s.slice(-4)} (${s.length} chars)`;
}

async function main() {
  // eslint-disable-next-line no-console
  console.log('LiveKit env check (no secrets printed):');
  // eslint-disable-next-line no-console
  console.log('  LIVEKIT_WS_URL:', host || '(empty)');
  // eslint-disable-next-line no-console
  console.log('  LIVEKIT_API_KEY:', mask(apiKey));
  // eslint-disable-next-line no-console
  console.log('  LIVEKIT_API_SECRET length:', apiSecret.length);

  if (!host || !apiKey || !apiSecret) {
    // eslint-disable-next-line no-console
    console.error('\nMissing one of LIVEKIT_WS_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET in .env');
    process.exit(1);
  }

  const client = new RoomServiceClient(host, apiKey, apiSecret);
  try {
    const rooms = await client.listRooms();
    // eslint-disable-next-line no-console
    console.log('\nOK — listRooms succeeded. Room count:', rooms.length);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('\nlistRooms failed:', e instanceof Error ? e.message : e);
    // eslint-disable-next-line no-console
    console.error(
      '\nFix: In LiveKit Cloud → same project as this URL → Keys → create a new key, copy API Key + Secret into .env (same pair). Ensure LIVEKIT_API_KEY is the key id and LIVEKIT_API_SECRET is the secret — do not swap them.'
    );
    process.exit(1);
  }
}

main();
