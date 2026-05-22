import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../.env') });

import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { cors } from 'hono/cors';
import { streamSSE } from 'hono/streaming';
import { buyWeather, type BuyerEvent } from './buyer.js';

const BUYER_MNEMONIC = process.env.BUYER_MNEMONIC;
const SELLER_URL = process.env.SELLER_URL ?? 'http://localhost:4021';
const PORT = Number(process.env.BUYER_PORT ?? 4022);

if (!BUYER_MNEMONIC) {
  console.error('[buyer-server] ERROR: BUYER_MNEMONIC is required.');
  process.exit(1);
}

const app = new Hono();

app.use('/api/*', cors());

app.get('/api/health', (c) =>
  c.json({ status: 'ok', service: 'x402-buyer-server' }),
);

app.get('/api/buy', (c) =>
  streamSSE(c, async (stream) => {
    try {
      await buyWeather(
        async (event: BuyerEvent) => {
          await stream.writeSSE({ data: JSON.stringify(event) });
        },
        SELLER_URL,
        BUYER_MNEMONIC!,
      );
    } catch (err) {
      await stream.writeSSE({
        data: JSON.stringify({ type: 'error', message: String(err) }),
      });
    }
    await stream.writeSSE({ data: JSON.stringify({ type: 'done' }) });
  }),
);

serve({ fetch: app.fetch, port: PORT }, () => {
  console.log(`[buyer-server] API server ready at http://localhost:${PORT}`);
  console.log(`[buyer-server]   SSE endpoint: GET /api/buy`);
  console.log(`[buyer-server]   Seller:       ${SELLER_URL}`);
});
