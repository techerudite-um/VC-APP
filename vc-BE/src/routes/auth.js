const express = require('express');
const jwt = require('jsonwebtoken');
const { loginLimiter } = require('../middleware/rateLimiter');

/** Static admin credentials (not loaded from the database). */
const STATIC_ADMIN_EMAIL = 'admin@livemeet.com';
const STATIC_ADMIN_PASSWORD = 'admin123';

/**
 * Handles admin login: validates email/password and returns a JWT.
 * @param {{ env: Record<string, string | number> }} deps
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 * @returns {Promise<void>}
 */
async function handleLogin(deps, req, res, next) {
  try {
    const { email, password } = req.body || {};
    if (!email || !password || typeof email !== 'string' || typeof password !== 'string') {
      res.status(400).json({ error: 'Email and password are required' });
      return;
    }
    const emailTrim = email.trim();
    const passwordTrim = password.trim();
    const emailOk = emailTrim === STATIC_ADMIN_EMAIL;
    const passwordOk = passwordTrim === STATIC_ADMIN_PASSWORD;
    if (!emailOk || !passwordOk) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }
    const token = jwt.sign({ isAdmin: true }, deps.env.JWT_SECRET, { expiresIn: '8h' });
    res.json({ token });
  } catch (e) {
    next(e);
  }
}

/**
 * Creates the auth router (login).
 * @param {{ env: Record<string, string | number> }} deps
 * @returns {import('express').Router}
 */
function createAuthRouter(deps) {
  const router = express.Router();
  router.post('/login', loginLimiter, (req, res, next) => handleLogin(deps, req, res, next));
  return router;
}

module.exports = { createAuthRouter, handleLogin };
