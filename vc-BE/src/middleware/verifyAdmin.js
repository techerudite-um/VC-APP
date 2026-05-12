const jwt = require('jsonwebtoken');

/**
 * Express middleware that requires a valid admin JWT in the Authorization header.
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 * @returns {void}
 */
function verifyAdmin(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Invalid credentials' });
    return;
  }
  const token = header.slice('Bearer '.length).trim();
  try {
    const decoded = jwt.verify(token, req.app.locals.env.JWT_SECRET);
    if (!decoded || typeof decoded !== 'object' || decoded.isAdmin !== true) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }
    req.admin = decoded;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid credentials' });
  }
}

/**
 * Verifies a Bearer JWT for an admin user (used concurrently with LiveKit calls).
 * @param {string | undefined} authorizationHeader
 * @param {string} jwtSecret
 * @returns {import('jsonwebtoken').JwtPayload}
 */
function verifyAdminJwtFromHeader(authorizationHeader, jwtSecret) {
  if (!authorizationHeader || !authorizationHeader.startsWith('Bearer ')) {
    const err = /** @type {Error & { statusCode?: number }} */ (new Error('Invalid credentials'));
    err.statusCode = 401;
    throw err;
  }
  const token = authorizationHeader.slice('Bearer '.length).trim();
  try {
    const decoded = jwt.verify(token, jwtSecret);
    if (!decoded || typeof decoded !== 'object' || decoded.isAdmin !== true) {
      const err = /** @type {Error & { statusCode?: number }} */ (new Error('Invalid credentials'));
      err.statusCode = 401;
      throw err;
    }
    return /** @type {import('jsonwebtoken').JwtPayload} */ (decoded);
  } catch (e) {
    if (e && typeof e === 'object' && 'statusCode' in e) {
      throw e;
    }
    const err = /** @type {Error & { statusCode?: number }} */ (new Error('Invalid credentials'));
    err.statusCode = 401;
    throw err;
  }
}

module.exports = { verifyAdmin, verifyAdminJwtFromHeader };
