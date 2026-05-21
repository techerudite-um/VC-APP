const NodeCache = require('node-cache');
const { TrackSource } = require('@livekit/protocol');
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
    if (err.status === 401 || err.status === 403) {
      const e = /** @type {Error & { statusCode?: number }} */ (
        new Error(
          'LiveKit API rejected the credentials. Use LIVEKIT_API_KEY and LIVEKIT_API_SECRET from the same LiveKit project as LIVEKIT_WS_URL (and ensure LIVEKIT_HTTP_URL / LIVEKIT_URL matches that project).'
        )
      );
      e.statusCode = 502;
      return e;
    }
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
 * Ensures a LiveKit room exists.
 * If the room was auto-deleted (emptyTimeout), this silently re-creates it with the same settings.
 * @param {RoomServiceClient} client
 * @param {string} roomId
 * @returns {Promise<void>}
 */
async function ensureRoomExists(client, roomId) {
  try {
    await client.listParticipants(roomId);
  } catch (err) {
    const isNotFound =
      (err instanceof TwirpError && (err.status === 404 || err.code === 'not_found')) ||
      String(err instanceof Error ? err.message : '').toLowerCase().includes('not found');

    if (isNotFound) {
      // eslint-disable-next-line no-console
      console.log(`[ensureRoomExists] Room ${roomId} not found, re-creating...`);
      await client.createRoom({
        name: roomId,
        maxParticipants: 30,
        emptyTimeout: 300,
      });
      // eslint-disable-next-line no-console
      console.log(`[ensureRoomExists] Room ${roomId} re-created successfully`);
    } else {
      throw err;
    }
  }
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
 * @param {string} roomId
 */
function invalidateParticipantsCache(roomId) {
  participantsCache.del(`participants_${roomId}`);
}

/**
 * @param {import('@livekit/protocol').ParticipantPermission | undefined} permission
 */
function isScreenShareAllowedByPermission(permission) {
  const sources = permission?.canPublishSources;
  if (!sources || sources.length === 0) {
    return true;
  }
  return sources.includes(TrackSource.SCREEN_SHARE) || sources.includes(TrackSource.SCREEN_SHARE_AUDIO);
}

/**
 * @param {RoomServiceClient} client
 * @param {string} roomId
 * @param {string} identity
 * @param {boolean} muted
 */
async function muteParticipantMicrophone(client, roomId, identity, muted) {
  const info = await withLiveKitHandling(() => client.getParticipant(roomId, identity));
  const mic = info.tracks?.find((t) => t.source === TrackSource.MICROPHONE);
  if (!mic?.sid) {
    if (muted) {
      invalidateParticipantsCache(roomId);
      return;
    }
    const e = new Error('Participant has no microphone track');
    e.statusCode = 404;
    throw e;
  }
  if (Boolean(mic.muted) === Boolean(muted)) {
    invalidateParticipantsCache(roomId);
    return;
  }
  await withLiveKitHandling(() => client.mutePublishedTrack(roomId, identity, mic.sid, muted));
  invalidateParticipantsCache(roomId);
}

/**
 * Server-side mute/unmute for screen share (and screen share audio) tracks.
 * Uses RoomServiceClient.mutePublishedTrack — same pattern as microphone moderation.
 * @param {RoomServiceClient} client
 * @param {string} roomId
 * @param {string} identity
 * @param {boolean} muted
 */
async function muteParticipantScreenShareTracks(client, roomId, identity, muted) {
  const info = await withLiveKitHandling(() => client.getParticipant(roomId, identity));
  const screenTracks = (info.tracks ?? []).filter(
    (t) => t.source === TrackSource.SCREEN_SHARE || t.source === TrackSource.SCREEN_SHARE_AUDIO
  );
  const withSid = screenTracks.filter((t) => Boolean(t.sid));
  if (withSid.length === 0) {
    const e = new Error('Participant has no screen share track');
    e.statusCode = 404;
    throw e;
  }
  for (const t of withSid) {
    await withLiveKitHandling(() => client.mutePublishedTrack(roomId, identity, t.sid, muted));
  }
  invalidateParticipantsCache(roomId);
}

/**
 * @param {RoomServiceClient} client
 * @param {string} roomId
 * @param {string} identity
 * @param {boolean} allowed
 */
async function setParticipantScreenShareAllowed(client, roomId, identity, allowed) {
  const sources = allowed
    ? [
        TrackSource.CAMERA,
        TrackSource.MICROPHONE,
        TrackSource.SCREEN_SHARE,
        TrackSource.SCREEN_SHARE_AUDIO,
      ]
    : [TrackSource.CAMERA, TrackSource.MICROPHONE];
  await withLiveKitHandling(() =>
    client.updateParticipant(roomId, identity, {
      permission: {
        canSubscribe: true,
        canPublish: true,
        canPublishData: true,
        canPublishSources: sources,
        hidden: false,
        recorder: false,
      },
    })
  );
  invalidateParticipantsCache(roomId);
}

/**
 * Default student publish: camera + microphone only (no screen share).
 * @param {RoomServiceClient} client
 * @param {string} roomId
 * @param {string} identity
 */
async function setStudentDefaultPublishPermissions(client, roomId, identity) {
  await setParticipantScreenShareAllowed(client, roomId, identity, false);
}

/**
 * Enable screen share for one student; disable for all other non-admin participants.
 * @param {RoomServiceClient} client
 * @param {string} roomId
 * @param {string} studentIdentity
 * @param {boolean} enable
 */
async function toggleStudentScreenSharePermission(client, roomId, studentIdentity, enable) {
  if (enable) {
    const participants = await withLiveKitHandling(() => client.listParticipants(roomId));
    const otherStudents = participants.filter(
      (p) => p.identity !== 'admin' && p.identity !== studentIdentity
    );
    for (const student of otherStudents) {
      try {
        await setStudentDefaultPublishPermissions(client, roomId, student.identity);
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn(
          `[screen-share] disable failed for ${student.identity}:`,
          e instanceof Error ? e.message : e
        );
      }
    }
    await setParticipantScreenShareAllowed(client, roomId, studentIdentity, true);
  } else {
    await setParticipantScreenShareAllowed(client, roomId, studentIdentity, false);
  }
}

/**
 * @param {RoomServiceClient} client
 * @param {string} roomId
 * @param {string} identity
 */
async function removeRoomParticipant(client, roomId, identity) {
  await withLiveKitHandling(() => client.removeParticipant(roomId, identity));
  invalidateParticipantsCache(roomId);
}

/**
 * Restricts a student participant's track subscriptions so they only subscribe to the admin's tracks.
 * Unsubscribes from all other participants' published tracks (audio/video layout unchanged server-side).
 * @param {RoomServiceClient} client
 * @param {string} roomId
 * @param {string} studentIdentity
 * @returns {Promise<{ success: true; restrictedTo?: string; note?: string }>}
 */
async function restrictStudentToTeacherTracks(client, roomId, studentIdentity) {
  const participants = await withLiveKitHandling(() => client.listParticipants(roomId));
  const adminParticipant = participants.find((p) => p.identity === 'admin');

  if (!adminParticipant) {
    await withLiveKitHandling(() =>
      client.updateParticipant(roomId, studentIdentity, {
        permission: {
          canSubscribe: true,
          canPublish: true,
          canPublishData: true,
          hidden: false,
          recorder: false,
        },
      })
    );
    invalidateParticipantsCache(roomId);
    return { success: true, note: 'Admin not yet in room, permissions set for when admin joins' };
  }

  const adminTrackSids = (adminParticipant.tracks ?? []).map((t) => t.sid).filter(Boolean);
  if (adminTrackSids.length > 0) {
    await withLiveKitHandling(() =>
      client.updateSubscriptions(roomId, studentIdentity, adminTrackSids, true)
    );
  }

  const otherParticipants = participants.filter(
    (p) => p.identity !== 'admin' && p.identity !== studentIdentity
  );
  for (const other of otherParticipants) {
    const otherTrackSids = (other.tracks ?? []).map((t) => t.sid).filter(Boolean);
    if (otherTrackSids.length > 0) {
      await withLiveKitHandling(() =>
        client.updateSubscriptions(roomId, studentIdentity, otherTrackSids, false)
      );
    }
  }
  invalidateParticipantsCache(roomId);
  return { success: true, restrictedTo: 'admin' };
}

/**
 * Re-subscribe all students to every track the admin is currently publishing
 * (camera, screen share, screen audio). Call when admin starts screen sharing.
 * @param {RoomServiceClient} client
 * @param {string} roomId
 */
async function syncStudentsToAdminTracks(client, roomId) {
  const participants = await withLiveKitHandling(() => client.listParticipants(roomId));
  const adminParticipant = participants.find((p) => p.identity === 'admin');

  if (!adminParticipant) {
    return { success: true, note: 'No admin in room' };
  }

  const adminTrackSids = (adminParticipant.tracks ?? []).map((t) => t.sid).filter(Boolean);
  const students = participants.filter((p) => p.identity !== 'admin');

  for (const student of students) {
    if (adminTrackSids.length > 0) {
      await withLiveKitHandling(() =>
        client.updateSubscriptions(roomId, student.identity, adminTrackSids, true)
      );
    }

    for (const other of participants) {
      if (other.identity === 'admin' || other.identity === student.identity) continue;
      const otherTrackSids = (other.tracks ?? []).map((t) => t.sid).filter(Boolean);
      if (otherTrackSids.length > 0) {
        await withLiveKitHandling(() =>
          client.updateSubscriptions(roomId, student.identity, otherTrackSids, false)
        );
      }
    }
  }

  invalidateParticipantsCache(roomId);
  return { success: true };
}

/**
 * Subscribe the host (admin) to every track students are publishing (camera, screen share, etc.).
 * Required when students use selective subscription or after new tracks are published.
 * @param {RoomServiceClient} client
 * @param {string} roomId
 */
async function syncAdminToStudentTracks(client, roomId) {
  const delays = [0, 400, 1000];
  let lastCount = 0;

  for (const delayMs of delays) {
    if (delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }

    const participants = await withLiveKitHandling(() => client.listParticipants(roomId));
    const adminParticipant = participants.find((p) => p.identity === 'admin');

    if (!adminParticipant) {
      return { success: true, note: 'No admin in room' };
    }

    const students = participants.filter((p) => p.identity !== 'admin');
    const studentTrackSids = [];

    for (const student of students) {
      let info = student;
      try {
        info = await withLiveKitHandling(() => client.getParticipant(roomId, student.identity));
      } catch {
        /* use list snapshot */
      }
      for (const track of info.tracks ?? []) {
        if (track.sid) studentTrackSids.push(track.sid);
      }
    }

    const uniqueSids = [...new Set(studentTrackSids)];
    lastCount = uniqueSids.length;

    if (uniqueSids.length > 0) {
      await withLiveKitHandling(() =>
        client.updateSubscriptions(roomId, 'admin', uniqueSids, true)
      );
    }
  }

  invalidateParticipantsCache(roomId);
  return { success: true, trackCount: lastCount };
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
    participants: participants.map((p) => {
      const mic = p.tracks?.find((t) => t.source === TrackSource.MICROPHONE);
      const screenTracks = (p.tracks ?? []).filter(
        (t) => t.source === TrackSource.SCREEN_SHARE || t.source === TrackSource.SCREEN_SHARE_AUDIO
      );
      const hasActiveScreenShare = screenTracks.some((t) => t.sid && !t.muted);
      const joinedSec = p.joinedAt != null ? Number(p.joinedAt) : 0;
      return {
        identity: p.identity,
        joinedAt: new Date(joinedSec * 1000).toISOString(),
        isPublishing: Boolean(p.tracks && p.tracks.length > 0),
        microphoneTrackSid: mic?.sid ?? null,
        isMicrophoneMuted: Boolean(mic?.muted),
        screenShareAllowed: isScreenShareAllowedByPermission(p.permission),
        hasActiveScreenShare,
      };
    }),
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
  const identity = isAdmin ? 'admin' : participantName;
  const ttlSeconds = 2 * 60 * 60;
  const token = new AccessToken(apiKey, apiSecret, {
    identity,
    ttl: ttlSeconds,
  });
  const screenSources = [
    TrackSource.CAMERA,
    TrackSource.MICROPHONE,
    TrackSource.SCREEN_SHARE,
    TrackSource.SCREEN_SHARE_AUDIO,
  ];
  const guestSources = [TrackSource.CAMERA, TrackSource.MICROPHONE];
  /** @type {import('livekit-server-sdk').VideoGrant} */
  const grant = {
    roomJoin: true,
    room: roomId,
    canSubscribe: true,
    canPublishData: true,
    canPublish: true,
    canPublishSources: isAdmin ? screenSources : guestSources,
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
  ensureRoomExists,
  listRoomParticipants,
  deleteConferenceRoom,
  buildJoinToken,
  getCachedParticipants,
  checkLiveKitHealth,
  muteParticipantMicrophone,
  muteParticipantScreenShareTracks,
  setParticipantScreenShareAllowed,
  setStudentDefaultPublishPermissions,
  toggleStudentScreenSharePermission,
  removeRoomParticipant,
  restrictStudentToTeacherTracks,
  syncStudentsToAdminTracks,
  syncAdminToStudentTracks,
  invalidateParticipantsCache,
};
