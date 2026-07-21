const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../../src/models/User');

const createUser = async ({ username, password = 'password123', role = 'admin', fullName = 'Test User', ...rest }) => {
  const hashedPassword = await bcrypt.hash(password, 10);
  return User.create({ username, password: hashedPassword, role, fullName, ...rest });
};

const tokenFor = (user) =>
  jwt.sign({ id: user._id, role: user.role, username: user.username }, process.env.JWT_SECRET, { expiresIn: '1h' });

module.exports = { createUser, tokenFor };