const http = require('http');
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const { loadEnv } = require('./config/env');
const { connectDB } = require('./services/mongoService');
const {
  getRoomServiceClient,
  createConferenceRoom,
  listRoomParticipants,
  deleteConferenceRoom,
  buildJoinToken,
  checkLiveKitHealth,
  getCachedParticipants,
} = require('./services/livekitService');
const { createApiRateLimiter } = require('./middleware/rateLimiter');
const { errorHandler } = require('./middleware/errorHandler');
const { createAuthRouter } = require('./routes/auth');
const { createRoomsRouter } = require('./routes/rooms');
const { createTokenRouter } = require('./routes/token');

/**
 * Returns JSON health status for load balancers and uptime checks.
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 * @returns {Promise<void>}
 */
async function handleHealth(req, res, next) {
  try {
    const liveKitStatus = await checkLiveKitHealth();
    const mongoDown = mongoose.connection.readyState !== 1;
    const livekitDown = liveKitStatus === 'disconnected';

    if (mongoDown || livekitDown) {
      res.status(503).json({
        status: 'degraded',
        timestamp: new Date().toISOString(),
        dependencies: {
          mongodb: mongoDown ? 'disconnected' : 'connected',
          livekit: livekitDown ? 'disconnected' : 'connected',
        },
      });
      return;
    }

    return res.status(200).json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      dependencies: {
        mongodb: 'connected',
        livekit: 'connected',
      },
    });
  } catch (e) {
    next(e);
  }
}

/**
 * Bootstraps configuration, HTTP server, and background checks.
 * @returns {Promise<void>}
 */
async function main() {
  const env = loadEnv();
  await connectDB();
  console.log("Call")

  const roomClient = getRoomServiceClient({
    host: "https://demo-video-calling-8z1c86xj.livekit.cloud",
    apiKey: env.LIVEKIT_API_KEY,
    apiSecret: env.LIVEKIT_API_SECRET,
  });

  const app = express();
  app.locals.env = env;

  app.use(helmet());
  app.use(compression());
  app.use(
    cors({
      origin: env.CLIENT_URL,
      credentials: false,
    })
  );
  app.use(express.json());

  const apiRouter = express.Router();
  apiRouter.use(createApiRateLimiter());

  apiRouter.get('/health', handleHealth);

  apiRouter.use('/auth', createAuthRouter({ env }));

  apiRouter.use(
    '/rooms',
    createRoomsRouter({
      createRoom: (roomId) => createConferenceRoom(roomClient, roomId),
      getCachedParticipants: (roomId) => getCachedParticipants(roomId),
      deleteRoom: (roomId) => deleteConferenceRoom(roomClient, roomId),
    })
  );

  apiRouter.use(
    '/token',
    createTokenRouter({
      env,
      listParticipants: (roomId) => listRoomParticipants(roomClient, roomId),
      buildJoinToken: ({ roomId, isAdmin, participantName }) =>
        buildJoinToken({
          apiKey: env.LIVEKIT_API_KEY,
          apiSecret: env.LIVEKIT_API_SECRET,
          roomId,
          isAdmin,
          participantName,
        }),
    })
  );

  app.use('/api', apiRouter);
  app.use(errorHandler);

  const server = http.createServer(app);
  server.keepAliveTimeout = 65000;
  server.headersTimeout = 66000;

  server.listen(env.PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`Server listening on port ${env.PORT}`);
    // eslint-disable-next-line no-console
    console.log(`LiveKit WebSocket URL: ${env.LIVEKIT_WS_URL}`);
  });
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Fatal startup error:', err);
  process.exit(1);
});
