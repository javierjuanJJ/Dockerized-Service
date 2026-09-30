'use strict';

const fs = require('fs');
const path = require('path');

const REQUIRED_VARS = ['SECRET_MESSAGE', 'USERNAME', 'PASSWORD'];

/**
 * Minimal .env parser. Avoids adding a dependency just to read three variables.
 * Supports KEY=value, optional `export ` prefix, # comments and quoted values.
 */
function parseEnv(contents) {
  const parsed = {};
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;

    const [, key, rawValue] = match;
    let value = rawValue.trim();

    if (
      (value.startsWith('"') && value.endsWith('"') && value.length > 1) ||
      (value.startsWith("'") && value.endsWith("'") && value.length > 1)
    ) {
      value = value.slice(1, -1);
    } else {
      value = value.split('#')[0].trim();
    }

    parsed[key] = value;
  }
  return parsed;
}

/**
 * Loads variables from .env without overwriting anything already present in the
 * environment. Real environment variables (injected by Docker, systemd or
 * GitHub Actions) always win over the file.
 */
function loadEnv(envPath = path.join(__dirname, '..', '.env')) {
  if (!fs.existsSync(envPath)) return {};

  const parsed = parseEnv(fs.readFileSync(envPath, 'utf8'));
  for (const [key, value] of Object.entries(parsed)) {
    if (process.env[key] === undefined) process.env[key] = value;
  }
  return parsed;
}

/**
 * Fails fast with an actionable message. A container missing its secrets should
 * crash on boot rather than start serving broken responses.
 */
function requireVars(names = REQUIRED_VARS) {
  const missing = names.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variable(s): ${missing.join(', ')}. ` +
        'Copy .env.example to .env for local development, or inject them ' +
        'with `docker run --env-file` / the container environment.'
    );
  }
}

module.exports = { parseEnv, loadEnv, requireVars, REQUIRED_VARS };
