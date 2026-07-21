module.exports = {
  testEnvironment: 'node',
  setupFilesAfterEnv: ['./tests/setup.js'],
  testTimeout: 20000, // mongodb-memory-server's first download/boot can be slow
  testMatch: ['**/tests/**/*.test.js'],
  forceExit: true,
  clearMocks: true,
};