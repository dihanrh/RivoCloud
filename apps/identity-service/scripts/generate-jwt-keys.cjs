#!/usr/bin/env node
const { generateKeyPairSync } = require('node:crypto');
const { mkdirSync, writeFileSync, existsSync } = require('node:fs');
const { join } = require('node:path');

const keysDir = join(__dirname, '..', 'keys');
mkdirSync(keysDir, { recursive: true });

const privatePath = join(keysDir, 'private.pem');
const publicPath = join(keysDir, 'public.pem');

if (existsSync(privatePath) && existsSync(publicPath)) {
  console.log('JWT keypair already exists at apps/identity-service/keys/, skipping.');
  process.exit(0);
}

const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

writeFileSync(privatePath, privateKey);
writeFileSync(publicPath, publicKey);
console.log('Generated JWT RS256 keypair at apps/identity-service/keys/.');
