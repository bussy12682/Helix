import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';

import { createApp } from './app.js';
import { loadConfig } from './config.js';

const envFile = existsSync('.env.local') ? '.env.local' : '.env';
if (typeof process.loadEnvFile === 'function' && existsSync(envFile)) {
  process.loadEnvFile(envFile);
}

const config = loadConfig(process.env);
const app = createApp({ env: process.env });

const server = http.createServer(async (req, res) => {
  try {
    const url = `http://${req.headers.host ?? 'localhost'}${req.url ?? '/'}`;

    const chunks = [];
    for await (const chunk of req) {
      chunks.push(chunk);
    }

    const body = chunks.length > 0 ? Buffer.concat(chunks) : undefined;

    const request = new Request(url, {
      method: req.method ?? 'GET',
      headers: req.headers,
      body: body && body.length > 0 ? body : undefined,
    });

    const response = await app.request(request);

    for (const [key, value] of response.headers.entries()) {
      res.setHeader(key, value);
    }

    res.statusCode = response.status;
    res.end(await response.text());
  } catch (error) {
    console.error('Helix backend error:', error);
    res.statusCode = 500;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.end(
      JSON.stringify({
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Unexpected server error',
          requestId: randomUUID(),
        },
      }),
    );
  }
});

server.listen(config.appPort, () => {
  console.log(`HELIX backend listening on http://localhost:${config.appPort}`);
});
