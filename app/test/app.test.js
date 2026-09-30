'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const { parseEnv } = require('../src/env');
const { createApp, safeEqual } = require('../src/index');

const USERNAME = 'admin';
const PASSWORD = 'supersecret';
const SECRET_MESSAGE = 'This is the secret message';

process.env.SECRET_MESSAGE = SECRET_MESSAGE;
process.env.USERNAME = USERNAME;
process.env.PASSWORD = PASSWORD;

const app = createApp();

/** Starts the app on an ephemeral port and returns a request helper. */
async function withServer(run) {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  const request = (path, headers = {}) =>
    new Promise((resolve, reject) => {
      const req = http.request(
        { host: '127.0.0.1', port, path, headers },
        (res) => {
          let body = '';
          res.setEncoding('utf8');
          res.on('data', (chunk) => {
            body += chunk;
          });
          res.on('end', () =>
            resolve({ status: res.statusCode, headers: res.headers, body })
          );
        }
      );
      req.on('error', reject);
      req.end();
    });

  try {
    await run(request);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

const basic = (user, pass) => ({
  authorization: `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`,
});

test('parseEnv reads plain, quoted, exported and comment lines', () => {
  const parsed = parseEnv(
    [
      '# a comment',
      'SECRET_MESSAGE=hello world',
      'export USERNAME=admin',
      'PASSWORD="quoted # not a comment"',
      "QUOTED_SINGLE='single'",
      'EMPTY=',
      'SPACED = padded ',
      'not a valid line',
      'PASSWORD=overridden',
    ].join('\n')
  );

  assert.equal(parsed.SECRET_MESSAGE, 'hello world');
  assert.equal(parsed.USERNAME, 'admin');
  assert.equal(parsed.PASSWORD, 'overridden');
  assert.equal(parsed.QUOTED_SINGLE, 'single');
  assert.equal(parsed.EMPTY, '');
  assert.equal(parsed.SPACED, 'padded');
  assert.equal(Object.hasOwn(parsed, 'not a valid line'), false);
});

test('parseEnv strips trailing inline comments from unquoted values', () => {
  assert.equal(parseEnv('PORT=3000 # the port').PORT, '3000');
});

test('safeEqual compares values without throwing on length mismatch', () => {
  assert.equal(safeEqual('abc', 'abc'), true);
  assert.equal(safeEqual('abc', 'abd'), false);
  assert.equal(safeEqual('abc', 'abcd'), false);
  assert.equal(safeEqual(undefined, ''), true);
});

test('GET / returns Hello, world!', async () => {
  await withServer(async (request) => {
    const res = await request('/');
    assert.equal(res.status, 200);
    assert.equal(res.body, 'Hello, world!\n');
  });
});

test('GET /secret without credentials returns 401 and prompts for Basic Auth', async () => {
  await withServer(async (request) => {
    const res = await request('/secret');
    assert.equal(res.status, 401);
    assert.match(res.headers['www-authenticate'], /^Basic realm=/);
    assert.equal(res.body, 'Authentication required\n');
  });
});

test('GET /secret with a malformed Authorization header returns 401', async () => {
  await withServer(async (request) => {
    for (const authorization of ['Bearer token', 'Basic', 'Basic !!!not-base64!!!']) {
      const res = await request('/secret', { authorization });
      assert.equal(res.status, 401, `expected 401 for "${authorization}"`);
      assert.match(res.headers['www-authenticate'], /^Basic realm=/);
    }
  });
});

test('GET /secret with valid credentials returns the secret message', async () => {
  await withServer(async (request) => {
    const res = await request('/secret', basic(USERNAME, PASSWORD));
    assert.equal(res.status, 200);
    assert.equal(res.body, `${SECRET_MESSAGE}\n`);
  });
});

test('GET /secret rejects wrong username, wrong password and empty password', async () => {
  await withServer(async (request) => {
    const cases = [
      ['wrong', PASSWORD],
      [USERNAME, 'wrong'],
      ['wrong', 'wrong'],
      [USERNAME, ''],
      ['', PASSWORD],
    ];

    for (const [user, pass] of cases) {
      const res = await request('/secret', basic(user, pass));
      assert.equal(res.status, 401, `expected 401 for ${user}:${pass}`);
      assert.equal(res.body, 'Invalid username or password\n');
    }
  });
});

test('the secret message is never exposed without authentication', async () => {
  await withServer(async (request) => {
    const res = await request('/secret');
    assert.ok(!res.body.includes(SECRET_MESSAGE));
  });
});

test('GET /healthz reports ok', async () => {
  await withServer(async (request) => {
    const res = await request('/healthz');
    assert.equal(res.status, 200);
    assert.deepEqual(JSON.parse(res.body), { status: 'ok' });
  });
});
