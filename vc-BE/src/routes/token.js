const express = require('express');
const { verifyAdminJwtFromHeader } = require('../middleware/verifyAdmin');
const { tokenLimiter } = require('../middleware/rateLimiter');
const AppError = require('../utils/AppError');

/**
 * Issues a LiveKit access token after optional admin JWT verification and capacity checks.
 * @param {{ env: Record<string, string | number>; listParticipants: (roomId: string) => Promise<unknown[]>; buildJoinToken: (args: { roomId: string; isAdmin: boolean; participantName: string }) => Promise<string> }} deps
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 * @returns {Promise<void>}
 */
async function handleIssueToken(deps, req, res, next) {
  try {
    const { roomId, participantName, isAdmin } = req.body || {};
    const adminFlag = Boolean(isAdmin);

    if (!roomId || typeof roomId !== 'string') {
      next(new AppError('roomId is required', 400));
      return;
    }

    if (!adminFlag) {
      if (
        !participantName ||
        typeof participantName !== 'string' ||
        participantName.trim() === '' ||
        participantName.length > 30
      ) {
        next(new AppError('Participant name must be between 1 and 30 characters', 400));
        return;
      }
      const nameRegex = /^[a-zA-Z0-9 _-]{1,30}$/;
      if (!nameRegex.test(participantName)) {
        res.status(400).json({
          error:
            'Name can only contain letters, numbers, spaces, hyphens and underscores (max 30 chars)',
        });
        return;
      }
    }

    const authHeader = req.headers.authorization;
    const adminPromise = adminFlag
      ? Promise.resolve().then(() => verifyAdminJwtFromHeader(authHeader, deps.env.JWT_SECRET))
      : Promise.resolve(null);

    const [, participants] = await Promise.all([adminPromise, deps.listParticipants(roomId)]);

    if (participants.length >= 30) {
      res.status(403).json({ error: 'Room is full' });
      return;
    }

    // LiveKit enforces maxParticipants=30 as the hard gate.
    // If somehow a token is issued past 30, LiveKit will
    // reject the connection at the SDK level.
    // No further action needed server-side.

    const token = await deps.buildJoinToken({
      roomId,
      isAdmin: adminFlag,
      participantName: typeof participantName === 'string' ? participantName : '',
    });

    res.json({
      token,
      wsUrl: deps.env.LIVEKIT_WS_URL,
    });
  } catch (e) {
    const err = /** @type {Error & { statusCode?: number }} */ (e);
    if (typeof err.statusCode === 'number' && err.statusCode === 401) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }
    const msg = String(err.message || '').toLowerCase();
    if (typeof err.statusCode === 'number' && err.statusCode === 404) {
      res.status(404).json({ error: 'Room not found' });
      return;
    }
    if (msg.includes('room not found') || msg.includes('not found')) {
      res.status(404).json({ error: 'Room not found' });
      return;
    }
    if (err && typeof err === 'object' && 'name' in err) {
      const n = /** @type {{ name?: string }} */ (err).name;
      if (n === 'MongoServerError' || n === 'MongoNetworkError' || n === 'MongooseError') {
        next(new AppError('Database error', 500));
        return;
      }
    }
    next(new AppError('LiveKit service unavailable', 503));
  }
}

/**
 * Creates the token router for LiveKit access tokens.
 * @param {{ env: Record<string, string | number>; listParticipants: (roomId: string) => Promise<unknown[]>; buildJoinToken: (args: { roomId: string; isAdmin: boolean; participantName: string }) => Promise<string> }} deps
 * @returns {import('express').Router}
 */
function createTokenRouter(deps) {
  const router = express.Router();
  router.post('/', tokenLimiter, (req, res, next) => handleIssueToken(deps, req, res, next));
  return router;
}

module.exports = { createTokenRouter, handleIssueToken };
