'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');

const { loadEnv, requireVars } = require('./env');

/**
 * Constant-time string comparison to avoid leaking the expected value through
 * response timing when Basic Auth credentials are guessed.
 */
function safeEqual(a = '', b = '') {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Basic Auth guard. Browsers show the login prompt on the 401 + WWW-Authenticate
 * response, so both the correct and the incorrect path end up in the browser UI.
 */
function basicAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, encoded] = header.split(' ');

  if (scheme !== 'Basic' || !encoded) {
    res.set('WWW-Authenticate', 'Basic realm="Restricted", charset="UTF-8"');
    return res.status(401).type('text/plain').send('Authentication required\n');
  }

  const [username, password] = Buffer.from(encoded, 'base64')
    .toString('utf8')
    .split(':');

  const userOk = safeEqual(username, process.env.USERNAME);
  const passOk = safeEqual(password, process.env.PASSWORD);

  if (!userOk || !passOk) {
    res.set('WWW-Authenticate', 'Basic realm="Restricted", charset="UTF-8"');
    return res.status(401).type('text/plain').send('Invalid username or password\n');
  }

  return next();
}

function createApp() {
  const app = express();

  app.disable('x-powered-by');

  app.get('/', (req, res) => {
    res.type('text/plain').send('Hello, world!\n');
  });

  app.get('/secret', basicAuth, (req, res) => {
    res.type('text/plain').send(`${process.env.SECRET_MESSAGE}\n`);
  });

  app.get('/healthz', (req, res) => {
    res.json({ status: 'ok' });
  });

  app.get('/info', (req, res) => {
    const infoPath = path.join(__dirname, 'build-info.json');
    if (!fs.existsSync(infoPath)) {
      return res
        .status(503)
        .json({ error: 'build-info.json not found, run `npm run build`' });
    }
    res.type('application/json').send(fs.readFileSync(infoPath, 'utf8'));
  });

  return app;
}

function start() {
  loadEnv();
  requireVars();

  const port = Number(process.env.PORT) || 80;
  const app = createApp();

  const server = app.listen(port, '0.0.0.0', () => {
    console.log(`node-service listening on 0.0.0.0:${port}`);
  });

  const shutdown = (signal) => () => {
    console.log(`Received ${signal}, shutting down`);
    server.close(() => process.exit(0));
  };
  process.on('SIGTERM', shutdown('SIGTERM'));
  process.on('SIGINT', shutdown('SIGINT'));
}

if (require.main === module) start();

module.exports = { createApp, basicAuth, safeEqual };
