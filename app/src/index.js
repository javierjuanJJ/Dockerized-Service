'use strict';

const fs = require('fs');
const path = require('path');
const express = require('express');

const app = express();
const port = Number(process.env.PORT) || 80;

app.get('/', (req, res) => {
  res.type('text/plain').send('Hello, world!\n');
});

app.get('/healthz', (req, res) => {
  res.json({ status: 'ok' });
});

app.get('/info', (req, res) => {
  const infoPath = path.join(__dirname, 'build-info.json');
  if (!fs.existsSync(infoPath)) {
    return res.status(503).json({ error: 'build-info.json not found, run `npm run build`' });
  }
  res.type('application/json').send(fs.readFileSync(infoPath, 'utf8'));
});

app.listen(port, '0.0.0.0', () => {
  console.log(`node-service listening on 0.0.0.0:${port}`);
});
