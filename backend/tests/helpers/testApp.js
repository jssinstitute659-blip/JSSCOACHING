require('dotenv').config();
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_jwt_secret_for_ci';

const app = require('../../src/app');

module.exports = app;