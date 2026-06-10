const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
  userID: { type: String, required: true, unique: true },
  userName: { type: String },
  Gender: { type: String },
  Registrant: { type: String },
  Names: { type: Array, default: [] },
  voiceSample: { type: String }
});

const User = mongoose.model('User', UserSchema);

async function connectDatabase(uri) {
  try {
    await mongoose.connect(uri);
    console.log('[DATABASE] MongoDB connection successful.');
  } catch (err) {
    console.error('[DATABASE] MongoDB connection error:', err.message);
    process.exit(1);
  }
}

module.exports = { User, connectDatabase };
