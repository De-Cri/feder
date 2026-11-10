// Avvia il server di test su :5199 e restituisce la funzione per spegnerlo.
// Se è già acceso (un altro test, o lanciato a mano) usa quello.
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
