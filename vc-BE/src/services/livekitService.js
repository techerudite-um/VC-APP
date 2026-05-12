const NodeCache = require('node-cache');
const { RoomServiceClient, AccessToken, TwirpError } = require('livekit-server-sdk');

const participantsCache = new NodeCache({ stdTTL: 2 });

/** @type {RoomServiceClient | null} */
let roomServiceClient = null;

/** @type {{ status: string; checkedAt: number }} */
let livekitHealthCache = { status: 'unknown', checkedAt: 0 };

/**
 * Determines whether an error likely indicates network or upstream unavailability.
 * @param {unknown} err
 * @returns {boolean}
 */
function isLikelyConnectivityError(err) {
  if (!err || typeof err !== 'object') {
    return false;
  }
  const e = /** @type {NodeJS.ErrnoException & { cause?: NodeJS.ErrnoException }} */ (err);
  const code = e.code || e.cause?.code;
  if (code === 'ECONNREFUSED' || code === 'ETIMEDOUT' || code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
    return true;
  }
  const msg = String(e.message || '').toLowerCase();
  return msg.includes('fetch failed') || msg.includes('network') || msg.includes('aborted');
}

/**
 * Maps LiveKit / Twirp failures to an HTTP-friendly Error with statusCode.
 * @param {unknown} err
 * @returns {Error & { statusCode?: number }}
 */
function mapLiveKitError(err) {
  if (err instanceof TwirpError) {
    if (err.status === 404 || err.code === 'not_found') {
      const e = /** @type {Error & { statusCode?: number }} */ (new Error('Room not found'));
      e.statusCode = 404;
      return e;
    }
    if (err.status >= 500 || err.status === 502 || err.status === 503) {
      const e = /** @type {Error & { statusCode?: number }} */ (
        new Error('LiveKit service is temporarily unavailable. Please try again shortly.')
      );
      e.statusCode = 503;
      return e;
    }
  }
  if (isLikelyConnectivityError(err)) {
    const e = /** @type {Error & { statusCode?: number }} */ (
      new Error('LiveKit service is temporarily unavailable. Please try again shortly.')
    );
    e.statusCode = 503;
    return e;
  }
  const e = /** @type {Error & { statusCode?: number }} */ (
    new Error(err instanceof Error ? err.message : 'LiveKit request failed')
  );
  e.statusCode = 502;
  return e;
}

/**
 * Wraps an async LiveKit call with consistent error mapping.
 * @template T
 * @param {() => Promise<T>} fn
 * @returns {Promise<T>}
 */
async function withLiveKitHandling(fn) {
  try {
    return await fn();
  } catch (err) {
    throw mapLiveKitError(err);
  }
}

/**
 * Initializes and returns the singleton RoomServiceClient.
 * @param {{ host: string; apiKey: string; apiSecret: string }} config
 * @returns {RoomServiceClient}
 */
function getRoomServiceClient(config) {
  if (!roomServiceClient) {
    roomServiceClient = new RoomServiceClient(config.host, config.apiKey, config.apiSecret);
  }
  return roomServiceClient;
}

/**
 * Creates a room with the conferencing limits from the product spec.
 * @param {RoomServiceClient} client
 * @param {string} roomId
 * @returns {Promise<unknown>}
 */
function createConferenceRoom(client, roomId) {
  return withLiveKitHandling(() =>
    client.createRoom({
      name: roomId,
      maxParticipants: 30,
      emptyTimeout: 300,
    })
  );
}

/**
 * Lists participants in a room.
 * @param {RoomServiceClient} client
 * @param {string} roomId
 * @returns {Promise<import('@livekit/protocol').ParticipantInfo[]>}
 */
function listRoomParticipants(client, roomId) {
  return withLiveKitHandling(() => client.listParticipants(roomId));
}

/**
 * Deletes a room by name.
 * @param {RoomServiceClient} client
 * @param {string} roomId
 * @returns {Promise<void>}
 */
function deleteConferenceRoom(client, roomId) {
  return withLiveKitHandling(() => client.deleteRoom(roomId));
}

/**
 * Cached participant list for a room (short TTL).
 * @param {string} roomId
 * @returns {Promise<{ count: number; participants: { identity: string; joinedAt: string; isPublishing: boolean }[] }>}
 */
async function getCachedParticipants(roomId) {
  const cacheKey = `participants_${roomId}`;
  const cached = participantsCache.get(cacheKey);
  if (cached) {
    return /** @type {{ count: number; participants: { identity: string; joinedAt: string; isPublishing: boolean }[] }} */ (
      cached
    );
  }

  if (!roomServiceClient) {
    throw new Error('LiveKit client not initialized');
  }

  const participants = await withLiveKitHandling(() => roomServiceClient.listParticipants(roomId));

  const mapped = {
    count: participants.length,
    participants: participants.map((p) => ({
      identity: p.identity,
      joinedAt: new Date(Number(p.joinedAt) * 1000).toISOString(),
      isPublishing: p.tracks && p.tracks.length > 0,
    })),
  };

  participantsCache.set(cacheKey, mapped);
  return mapped;
}

/**
 * Checks LiveKit API reachability with a short-lived cache.
 * @returns {Promise<string>}
 */
async function checkLiveKitHealth() {
  const now = Date.now();
  if (now - livekitHealthCache.checkedAt < 10000) {
    return livekitHealthCache.status;
  }
  if (!roomServiceClient) {
    livekitHealthCache = { status: 'disconnected', checkedAt: now };
    return livekitHealthCache.status;
  }
  try {
    console.log(roomServiceClient)
    await roomServiceClient.listRooms();
    livekitHealthCache = { status: 'connected', checkedAt: now };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(
      '[health] LiveKit listRooms failed (same credentials as createRoom):',
      err
    );
    livekitHealthCache = {
      status: 'disconnected',
      checkedAt: now,
    };
  }
  return livekitHealthCache.status;
}

/**
 * Builds a LiveKit JWT for joining (and optionally administering) a room.
 * @param {{ apiKey: string; apiSecret: string; roomId: string; isAdmin: boolean; participantName: string }} params
 * @returns {Promise<string>}
 */
async function buildJoinToken(params) {
  const { apiKey, apiSecret, roomId, isAdmin, participantName } = params;
  console.log(params)
  const identity = isAdmin ? 'admin' : participantName;
  const ttlSeconds = 2 * 60 * 60;
  const token = new AccessToken(apiKey, apiSecret, {
    identity,
    ttl: ttlSeconds,
  });
  /** @type {Record<string, unknown>} */
  const grant = {
    roomJoin: true,
    room: roomId,
    canPublish: true,
    canSubscribe: true,
  };
  if (isAdmin) {
    grant.roomAdmin = true;
    grant.roomCreate = true;
  }
  token.addGrant(grant);
  return token.toJwt();
}

module.exports = {
  getRoomServiceClient,
  createConferenceRoom,
  listRoomParticipants,
  deleteConferenceRoom,
  buildJoinToken,
  getCachedParticipants,
  checkLiveKitHealth,
};
