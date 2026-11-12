// All call tests, one after another:  npm run test:voice
const { spawn } = require('node:child_process');
const { join } = require('node:path');
const startServer = require('./server.cjs');

(async () => {
  const stop = await startServer();
  let failed = [];
  for (const t of ['run', 'presence', 'screen', 'recreate', 'limits', 'memory']) {
    console.log(`\n=== ${t} ===`);
    // async: the test server runs in this same process and must be able to answer
    const code = await new Promise((r) => spawn(process.execPath, [join(__dirname, `${t}.cjs`)], { stdio: 'inherit' }).on('exit', r));
    if (code !== 0) failed.push(t);
  }
  await stop();
  console.log(failed.length ? `\nFALLITI: ${failed.join(', ')}` : '\nTutti i test passati.');
  process.exit(failed.length ? 1 : 0);
})();
