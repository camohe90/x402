/**
 * Seller Agent — x402 Resource Server
 *
 * Exposes a weather API protected by x402 micropayments on Algorand Testnet.
 * Buyers must pay USDC to access each request.
 *
 * Payment Flow:
 *  1. Buyer sends GET /weather (no payment)
 *  2. Server responds HTTP 402 with payment requirements in the header
 *  3. Buyer signs an Algorand USDC payment and retries with proof
 *  4. Goplausible facilitator verifies the on-chain settlement
 *  5. Server delivers the weather data
 */

import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../.env') });
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { cors } from 'hono/cors';
import { paymentMiddleware, x402ResourceServer, type Network } from '@x402/hono';
import { HTTPFacilitatorClient } from '@x402/core/server';
import { ExactAvmScheme } from '@x402/avm/exact/server';
import { ALGORAND_TESTNET_CAIP2 } from '@x402/avm';

// ── Environment ──────────────────────────────────────────────────────────────

const SELLER_ADDRESS = process.env.SELLER_ADDRESS;
const FACILITATOR_URL = process.env.FACILITATOR_URL ?? 'https://facilitator.goplausible.xyz';
const PORT = Number(process.env.PORT ?? 4021);

if (!SELLER_ADDRESS) {
  console.error('[seller] ERROR: SELLER_ADDRESS is required.');
  console.error('[seller] Set it to the Algorand address that will receive payments.');
  process.exit(1);
}

// ── x402 Server Setup ─────────────────────────────────────────────────────────
//
// 1. HTTPFacilitatorClient: connects to the goplausible facilitator which handles
//    on-chain settlement verification and replay attack prevention.
//
// 2. x402ResourceServer: the core payment server that validates incoming proofs.
//    Register the Algorand Exact scheme so it knows how to verify AVM payments.
//
// 3. paymentMiddleware: wraps Hono routes, returning 402 for unpaid requests
//    and forwarding paid ones to the actual route handler.

const facilitatorClient = new HTTPFacilitatorClient({ url: FACILITATOR_URL });

const resourceServer = new x402ResourceServer(facilitatorClient)
  .register(ALGORAND_TESTNET_CAIP2, new ExactAvmScheme());

// ── Route Definitions ─────────────────────────────────────────────────────────

const routes = {
  'GET /weather': {
    accepts: {
      scheme: 'exact' as const,
      network: ALGORAND_TESTNET_CAIP2 as Network,
      payTo: SELLER_ADDRESS as string,
      price: '$0.001', // USD — billed in USDC on Algorand Testnet
    },
    description: 'Real-time weather data — pay-per-request via x402',
  },
};

// ── Hono App ──────────────────────────────────────────────────────────────────

const app = new Hono();

// Allow browser clients (UI on :5173) to call the seller directly
app.use(cors({
  origin: (origin) => {
    const allowed = [
      'http://localhost:5173',
      'http://localhost:4173',
      process.env.UI_ORIGIN,
    ].filter(Boolean) as string[];
    if (!origin || allowed.includes(origin) || origin.endsWith('.vercel.app')) {
      return origin ?? '*';
    }
    return null as unknown as string;
  },
  exposeHeaders: ['PAYMENT-REQUIRED', 'payment-required', 'PAYMENT-RESPONSE', 'X-PAYMENT-RESPONSE'],
}));

// Payment middleware — intercepts all requests; returns 402 if no valid payment
app.use(paymentMiddleware(routes, resourceServer));

// Health check — free, no payment needed
app.get('/health', (c) =>
  c.json({ status: 'ok', service: 'x402-seller', timestamp: new Date().toISOString() }),
);

// Root — advertise available paid endpoints
app.get('/', (c) =>
  c.json({
    service: 'x402 Demo Seller Agent',
    endpoints: [
      { path: '/weather', method: 'GET', price: '$0.001 USDC', description: 'Random city weather data' },
      { path: '/health', method: 'GET', price: 'free', description: 'Health check' },
    ],
    facilitator: FACILITATOR_URL,
    payTo: SELLER_ADDRESS,
    network: ALGORAND_TESTNET_CAIP2,
  }),
);

// Protected weather endpoint — only reachable after a valid x402 payment
app.get('/weather', (c) => {
  const cities = [
    { city: 'New York', temperature: 72, condition: 'Partly Cloudy', humidity: 65 },
    { city: 'San Francisco', temperature: 58, condition: 'Foggy', humidity: 82 },
    { city: 'Miami', temperature: 88, condition: 'Sunny', humidity: 78 },
    { city: 'Chicago', temperature: 45, condition: 'Windy', humidity: 55 },
    { city: 'Austin', temperature: 95, condition: 'Hot & Sunny', humidity: 40 },
  ];

  const weather = cities[Math.floor(Math.random() * cities.length)];

  return c.json({
    ...weather,
    timestamp: new Date().toISOString(),
    paidVia: 'x402 / Algorand USDC Testnet',
  });
});

// ── Start ─────────────────────────────────────────────────────────────────────

serve({ fetch: app.fetch, port: PORT }, () => {
  console.log(`\n[seller] x402 Resource Server ready`);
  console.log(`[seller]   URL:         http://localhost:${PORT}`);
  console.log(`[seller]   Pay-to:      ${SELLER_ADDRESS}`);
  console.log(`[seller]   Network:     ${ALGORAND_TESTNET_CAIP2}`);
  console.log(`[seller]   Facilitator: ${FACILITATOR_URL}`);
  console.log(`[seller]   Protected:   GET /weather  ($0.001 USDC)\n`);
});
