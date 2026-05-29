#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
import { createServer } from 'node:http';

const readyFile = process.argv[2];
if (!readyFile) throw new Error('usage: openapi-server.mjs READY_FILE');

const pets = [
  { id: 1, name: 'Fido' },
  { id: 2, name: 'Spot' },
];

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  res.setHeader('Content-Type', 'application/json');

  const expectedApiKey = process.env.PETSTORE_API_KEY;
  if (expectedApiKey && req.headers['x-api-key'] !== expectedApiKey) {
    res.statusCode = 401;
    res.end(JSON.stringify({ error: 'unauthorized' }));
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/v1/pets') {
    const limit = Number(url.searchParams.get('limit') ?? String(pets.length));
    res.end(JSON.stringify(pets.slice(0, limit)));
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/v1/pets') {
    let raw = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      raw += chunk;
    });
    req.on('end', () => {
      res.end(JSON.stringify({ id: 3, ...JSON.parse(raw || '{}') }));
    });
    return;
  }

  if (req.method === 'GET' && url.pathname.startsWith('/api/v1/pets/')) {
    const id = Number(url.pathname.split('/').at(-1));
    const pet = pets.find((candidate) => candidate.id === id);
    if (pet === undefined) {
      res.statusCode = 404;
      res.end(JSON.stringify({ error: 'not found' }));
      return;
    }
    res.end(JSON.stringify(pet));
    return;
  }

  res.statusCode = 404;
  res.end(JSON.stringify({ error: 'not found' }));
});

server.listen(0, '127.0.0.1', () => {
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('unexpected address');
  writeFileSync(
    readyFile,
    `${JSON.stringify({ baseUrl: `http://127.0.0.1:${address.port}/api/v1` })}\n`,
  );
});

process.on('SIGTERM', () => {
  server.close(() => process.exit(0));
});
