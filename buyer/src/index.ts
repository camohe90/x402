import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../.env') });

import { buyWeather, type BuyerEvent } from './buyer.js';

const BUYER_MNEMONIC = process.env.BUYER_MNEMONIC;
const SELLER_URL = process.env.SELLER_URL ?? 'http://localhost:4021';
const NUM_REQUESTS = 3;

if (!BUYER_MNEMONIC) {
  console.error('[buyer] ERROR: BUYER_MNEMONIC is required.');
  console.error('[buyer] Set it to the 25-word mnemonic of your Algorand buying account.');
  process.exit(1);
}

async function run() {
  console.log('[buyer] Starting x402 buyer agent...');

  for (let i = 1; i <= NUM_REQUESTS; i++) {
    console.log(`\n[buyer] ── Purchase ${i}/${NUM_REQUESTS} ─────────────────────`);

    await buyWeather(
      (event: BuyerEvent) => {
        switch (event.type) {
          case 'start':
            console.log(`[buyer] Signer address: ${event.address}`);
            console.log(`[buyer] Target: ${event.sellerUrl}/weather`);
            break;
          case 'request_sent':
            console.log('[buyer] → Sending request...');
            break;
          case 'payment_required':
            console.log(`[buyer] ← 402 Payment Required (${Number(event.amount) / 1e6} USDC → ${event.payTo.slice(0, 8)}...)`);
            break;
          case 'payment_signing':
            console.log('[buyer] ✍  Signing payment...');
            break;
          case 'payment_sent':
            console.log('[buyer] → Payment sent, awaiting settlement...');
            break;
          case 'settlement_confirmed':
            console.log('[buyer] ✓  Settlement confirmed by facilitator');
            break;
          case 'success':
            console.log('[buyer] ✅ Data received:');
            console.log(`        City:        ${event.data.city}`);
            console.log(`        Temperature: ${event.data.temperature}°F`);
            console.log(`        Condition:   ${event.data.condition}`);
            console.log(`        Humidity:    ${event.data.humidity}%`);
            console.log(`        Paid via:    ${event.data.paidVia}`);
            break;
          case 'error':
            console.error(`[buyer] ✗  Error: ${event.message}`);
            break;
        }
      },
      SELLER_URL,
      BUYER_MNEMONIC!,
    );

    if (i < NUM_REQUESTS) {
      await new Promise((r) => setTimeout(r, 1500));
    }
  }

  console.log('\n[buyer] Agent done — all purchases complete.');
}

run().catch((err) => {
  console.error('[buyer] Fatal error:', err);
  process.exit(1);
});
