/**
 * Global Express error handler: logs and returns JSON without leaking internals.
 * @param {Error & { statusCode?: number; isOperational?: boolean }} err
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 * @returns {void}
 */
const errorHandler = (err, req, res, next) => {
  if (res.headersSent) {
    next(err);
    return;
  }
  // eslint-disable-next-line no-console
  console.error(`[ERROR] ${err.message}`);

  if (err.isOperational) {
    res.status(err.statusCode || 400).json({
      error: err.message,
    });
    return;
  }

  res.status(500).json({
    error: 'Internal server error',
  });
};

module.exports = { errorHandler };
