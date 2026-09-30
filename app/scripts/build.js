#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const root = path.join(__dirname, '..');
const srcDir = path.join(root, 'src');
const distDir = path.join(root, 'dist');

function gitCommit() {
  // CI passes BUILD_COMMIT (Dockerfile ARG VCS_REF) because .git is not part of
  // the build context, so git is unavailable inside the image.
  if (process.env.BUILD_COMMIT) return process.env.BUILD_COMMIT;

  try {
    return execSync('git rev-parse --short HEAD', {
      cwd: root,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).toString().trim();
  } catch {
    return 'unknown';
  }
}

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dest = path.join(to, entry.name);
    if (entry.isDirectory()) copyDir(src, dest);
    else fs.copyFileSync(src, dest);
  }
}

fs.rmSync(distDir, { recursive: true, force: true });
copyDir(srcDir, distDir);

const metadata = {
  name: require(path.join(root, 'package.json')).name,
  version: require(path.join(root, 'package.json')).version,
  commit: gitCommit(),
  builtAt: new Date().toISOString(),
};

fs.writeFileSync(
  path.join(distDir, 'build-info.json'),
  `${JSON.stringify(metadata, null, 2)}\n`
);

console.log(`Built node-service ${metadata.version} (commit ${metadata.commit}) -> dist/`);
