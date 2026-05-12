require('dotenv').config();
const bcrypt = require('bcrypt');
const mongoose = require('mongoose');

mongoose.set('strictQuery', true);

const { Admin } = require('../src/models/Admin');

/**
 * One-time admin seed: creates Admin if missing.
 * @returns {Promise<void>}
 */
async function seed() {
  const uri = process.env.MONGODB_URI;
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_SEED_PASSWORD;

  if (!uri || !email || !password) {
    // eslint-disable-next-line no-console
    console.error('Missing MONGODB_URI, ADMIN_EMAIL, or ADMIN_SEED_PASSWORD');
    process.exit(1);
  }

  await mongoose.connect(uri);

  const existing = await Admin.findOne({ email });
  if (existing) {
    // eslint-disable-next-line no-console
    console.log('Admin already exists');
    await mongoose.disconnect();
    process.exit(0);
    return;
  }

  const password_hash = await bcrypt.hash(password, 10);
  await Admin.create({ email, password_hash });
  // eslint-disable-next-line no-console
  console.log('Admin seeded successfully');
  await mongoose.disconnect();
  process.exit(0);
}

seed().catch(async (err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
