'use strict';
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const dir = __dirname;
const logPath = path.join(dir, 'node-start.log');
const log = fs.createWriteStream(logPath, { flags: 'a' });

function line(msg) {
  log.write(`${new Date().toISOString()} ${msg}\n`);
}

line('--- launch ---');
line(`PORT=${process.env.PORT ?? '(not set)'}`);
line(`cwd=${dir}`);

const child = spawn(process.execPath, [path.join(dir, 'server.js')], {
  cwd: dir,
  env: process.env,
  stdio: ['ignore', log, log],
});

child.on('exit', (code, signal) => {
  line(`exit code=${code} signal=${signal ?? ''}`);
  process.exit(code ?? 1);
});

child.on('error', (err) => {
  line(`spawn error: ${err.stack || err}`);
  process.exit(1);
});
