const express = require('express');
const { nanoid } = require('nanoid');
const { verifyAdmin } = require('../middleware/verifyAdmin');
const { roomCreationLimiter } = require('../middleware/rateLimiter');
const { Room } = require('../models/Room');
const AppError = require('../utils/AppError');

/**
 * @param {unknown} err
 * @returns {boolean}
 */
function isLiveKitRoomNotFound(err) {
  const msg = String(err instanceof Error ? err.message : '').toLowerCase();
  return msg.includes('room not found') || msg.includes('not found');
}

/**
 * Creates a new conference room and returns join URL metadata.
 * @param {{ createRoom: (id: string) => Promise<unknown> }} deps
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 * @returns {Promise<void>}
 */
async function handleCreateRoom(deps, req, res, next) {
  let roomId;
  try {
    let attempts = 0;
    while (attempts < 5) {
      const candidate = nanoid(10);
      const existing = await Room.findOne({ roomId: candidate });
      if (!existing) {
        roomId = candidate;
        break;
      }
      attempts += 1;
    }
    if (!roomId) {
      next(new AppError('Failed to generate unique room ID', 500));
      return;
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[rooms/create] MongoDB error while reserving roomId:', e);
    next(new AppError('Database error', 500));
    return;
  }

  try {
    await deps.createRoom(roomId);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error(
      '[rooms/create] LiveKit createRoom failed — check LIVEKIT_WS_URL, LIVEKIT_API_KEY/SECRET, and that LiveKit is running:',
      e instanceof Error ? e.message : e
    );
    next(new AppError('LiveKit service unavailable', 503));
    return;
  }

  try {
    await Room.create({ roomId });
  } catch (persistErr) {
    // eslint-disable-next-line no-console
    console.warn(
      '[rooms/create] MongoDB room audit save failed:',
      persistErr instanceof Error ? persistErr.message : persistErr
    );
  }

  res.json({
    roomId,
    roomUrl: `${req.app.locals.env.CLIENT_URL}/room/${roomId}`,
    message: 'Share this link with your team to join the meeting',
  });
}

/**
 * Lists participants in a room (admin only).
 * @param {{ getCachedParticipants: (id: string) => Promise<{ count: number; participants: unknown[] }> }} deps
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 * @returns {Promise<void>}
 */
async function handleListParticipants(deps, req, res, next) {
  try {
    const { roomId } = req.params;
    const data = await deps.getCachedParticipants(roomId);
    res.json(data);
  } catch (e) {
    if (isLiveKitRoomNotFound(e)) {
      res.status(404).json({ error: 'Room not found' });
      return;
    }
    // eslint-disable-next-line no-console
    console.error('[rooms/participants] LiveKit listParticipants failed:', e);
    const statusCode =
      e && typeof e === 'object' && 'statusCode' in e && Number.isFinite(Number(e.statusCode))
        ? Number(e.statusCode)
        : 503;
    const message = e instanceof Error ? e.message : 'LiveKit service unavailable';
    next(new AppError(message, statusCode >= 400 && statusCode < 600 ? statusCode : 503));
  }
}

/**
 * @param {string} identity
 * @returns {boolean}
 */
function isProtectedHostIdentity(identity) {
  return identity === 'admin';
}

/**
 * Microphone track mute — RoomServiceClient.mutePublishedTrack (microphone source).
 * @param {{ muteParticipant: (roomId: string, identity: string, muted: boolean) => Promise<void> }} deps
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 * @returns {Promise<void>}
 */
async function handleMuteParticipant(deps, req, res, next) {
  try {
    const { roomId, identity } = req.params;
    const id = decodeURIComponent(identity);
    const muted = Boolean(req.body?.muted);
    await deps.muteParticipant(roomId, id, muted);
    res.json({ success: true, muted });
  } catch (e) {
    if (e && typeof e === 'object' && 'statusCode' in e && /** @type {{ statusCode: number }} */ (e).statusCode === 404) {
      res.status(404).json({ error: e instanceof Error ? e.message : 'Not found' });
      return;
    }
    if (isLiveKitRoomNotFound(e)) {
      res.status(404).json({ error: 'Room not found' });
      return;
    }
    next(new AppError('LiveKit service unavailable', 503));
  }
}

/**
 * Screen share track mute via RoomServiceClient.mutePublishedTrack.
 * @param {{ muteScreenShareTrack: (roomId: string, identity: string, muted: boolean) => Promise<void> }} deps
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 * @returns {Promise<void>}
 */
async function handleMuteParticipantScreenShare(deps, req, res, next) {
  try {
    const { roomId, identity } = req.params;
    const id = decodeURIComponent(identity);
    const muted = Boolean(req.body?.muted);
    await deps.muteScreenShareTrack(roomId, id, muted);
    res.json({ success: true, muted });
  } catch (e) {
    if (e && typeof e === 'object' && 'statusCode' in e && /** @type {{ statusCode: number }} */ (e).statusCode === 404) {
      res.status(404).json({ error: e instanceof Error ? e.message : 'Not found' });
      return;
    }
    if (isLiveKitRoomNotFound(e)) {
      res.status(404).json({ error: 'Room not found' });
      return;
    }
    next(new AppError('LiveKit service unavailable', 503));
  }
}

/**
 * Participant publish permission for screen share (RoomServiceClient.updateParticipant).
 * @param {{ setScreenShare: (roomId: string, identity: string, allowed: boolean) => Promise<void> }} deps
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 * @returns {Promise<void>}
 */
async function handleScreenSharePermission(deps, req, res, next) {
  try {
    const { roomId, identity } = req.params;
    const id = decodeURIComponent(identity);
    const allowed = Boolean(req.body?.allowed);
    await deps.setScreenShare(roomId, id, allowed);
    res.json({ success: true, allowed });
  } catch (e) {
    if (isLiveKitRoomNotFound(e)) {
      res.status(404).json({ error: 'Room not found' });
      return;
    }
    next(new AppError('LiveKit service unavailable', 503));
  }
}

/**
 * Kick participant — RoomServiceClient.removeParticipant.
 * @param {{ removeParticipant: (roomId: string, identity: string) => Promise<void> }} deps
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 * @returns {Promise<void>}
 */
async function handleRemoveParticipant(deps, req, res, next) {
  try {
    const { roomId, identity } = req.params;
    const id = decodeURIComponent(identity);
    if (isProtectedHostIdentity(id)) {
      next(new AppError('Cannot remove the host/admin connection', 400));
      return;
    }
    await deps.removeParticipant(roomId, id);
    res.json({ success: true });
  } catch (e) {
    if (isLiveKitRoomNotFound(e)) {
      res.status(404).json({ error: 'Room not found' });
      return;
    }
    next(new AppError('LiveKit service unavailable', 503));
  }
}

/**
 * Deletes a room by id (admin only). Uses LiveKit `deleteRoom`.
 * @param {{ deleteRoom: (id: string) => Promise<void> }} deps
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 * @returns {Promise<void>}
 */
async function handleDeleteRoom(deps, req, res, next) {
  try {
    const { roomId } = req.params;
    try {
      await deps.deleteRoom(roomId);
    } catch (e) {
      if (isLiveKitRoomNotFound(e)) {
        res.status(404).json({ error: 'Room not found' });
        return;
      }
      next(new AppError('LiveKit service unavailable', 503));
      return;
    }
    try {
      await Room.findOneAndUpdate({ roomId }, { isActive: false });
    } catch (mongoErr) {
      // eslint-disable-next-line no-console
      console.warn(
        '[rooms/delete] MongoDB room deactivate failed:',
        mongoErr instanceof Error ? mongoErr.message : mongoErr
      );
    }
    res.json({ success: true });
  } catch (e) {
    next(e);
  }
}

/**
 * Creates the rooms router (create, list participants, delete).
 * @param {{ createRoom: (id: string) => Promise<unknown>; getCachedParticipants: (id: string) => Promise<{ count: number; participants: unknown[] }>; deleteRoom: (id: string) => Promise<void>; muteParticipant: (roomId: string, identity: string, muted: boolean) => Promise<void>; muteScreenShareTrack: (roomId: string, identity: string, muted: boolean) => Promise<void>; setScreenShare: (roomId: string, identity: string, allowed: boolean) => Promise<void>; removeParticipant: (roomId: string, identity: string) => Promise<void> }} deps
 * @returns {import('express').Router}
 */
function createRoomsRouter(deps) {
  const router = express.Router();
  router.post(
    '/create',
    roomCreationLimiter,
    verifyAdmin,
    (req, res, next) => handleCreateRoom(deps, req, res, next)
  );
  router.post(
    '/:roomId/participants/:identity/mute',
    verifyAdmin,
    (req, res, next) => handleMuteParticipant(deps, req, res, next)
  );
  router.post(
    '/:roomId/participants/:identity/screen-share/mute',
    verifyAdmin,
    (req, res, next) => handleMuteParticipantScreenShare(deps, req, res, next)
  );
  router.post(
    '/:roomId/participants/:identity/screen-share',
    verifyAdmin,
    (req, res, next) => handleScreenSharePermission(deps, req, res, next)
  );
  router.delete(
    '/:roomId/participants/:identity',
    verifyAdmin,
    (req, res, next) => handleRemoveParticipant(deps, req, res, next)
  );
  router.get('/:roomId/participants', verifyAdmin, (req, res, next) => handleListParticipants(deps, req, res, next));
  router.delete('/:roomId', verifyAdmin, (req, res, next) => handleDeleteRoom(deps, req, res, next));
  return router;
}

module.exports = {
  createRoomsRouter,
  handleCreateRoom,
  handleListParticipants,
  handleDeleteRoom,
  handleMuteParticipant,
  handleMuteParticipantScreenShare,
  handleScreenSharePermission,
  handleRemoveParticipant,
};
