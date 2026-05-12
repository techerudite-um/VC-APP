const mongoose = require('mongoose');

/**
 * Connects to MongoDB once at application startup.
 * On failure, logs the error and terminates the process.
 * @returns {Promise<void>}
 */
async function connectDB() {
  try {
    mongoose.set('strictQuery', true);
    const uri = process.env.MONGODB_URI;
    if (!uri || String(uri).trim() === '') {
      throw new Error('MONGODB_URI is not set');
    }
    await mongoose.connect(uri);
    // eslint-disable-next-line no-console
    console.log('MongoDB connected');
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
  }
}

module.exports = { connectDB };
