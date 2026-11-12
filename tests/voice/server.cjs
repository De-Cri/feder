// Starts the test server on :5199 and returns the function to stop it.
// If it's already running (another test, or started by hand) it uses that one.
const { resolve } = require('node:path');

module.exports = async function startServer() {
  const { createServer } = await import('vite');
  const server = await createServer({ configFile: resolve(__dirname, 'vite.config.ts'), logLevel: 'error' });
  try {
    await server.listen();
  } catch (e) {
    await server.close();
    if (/already in use/i.test(String(e?.message))) return async () => {};
    throw e;
  }
  return () => server.close();
};
