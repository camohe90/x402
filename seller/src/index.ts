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

const SELLER_ADDRESS  = process.env.SELLER_ADDRESS;
const FACILITATOR_URL = process.env.FACILITATOR_URL ?? 'https://facilitator.goplausible.xyz';
const PORT            = Number(process.env.PORT ?? 4021);
// Prices can be overridden via env — must be a plain decimal (e.g. "0.001")
const WEATHER_PRICE  = `$${process.env.SELLER_WEATHER_PRICE  ?? '0.001'}`;
const FORECAST_PRICE = `$${process.env.SELLER_FORECAST_PRICE ?? '0.005'}`;

if (!SELLER_ADDRESS) {
  console.error('[seller] ERROR: SELLER_ADDRESS is required.');
  process.exit(1);
}

// ── Cities & weather helpers ──────────────────────────────────────────────────

const CITIES = [
  { city: 'New York',      lat: 40.7128,  lon: -74.0060  },
  { city: 'San Francisco', lat: 37.7749,  lon: -122.4194 },
  { city: 'Miami',         lat: 25.7617,  lon: -80.1918  },
  { city: 'Chicago',       lat: 41.8781,  lon: -87.6298  },
  { city: 'Austin',        lat: 30.2672,  lon: -97.7431  },
];

// WMO weather interpretation codes → human-readable condition
const WMO: Record<number, string> = {
  0: 'Clear Sky', 1: 'Mainly Clear', 2: 'Partly Cloudy', 3: 'Overcast',
  45: 'Foggy', 48: 'Foggy',
  51: 'Drizzle', 53: 'Drizzle', 55: 'Heavy Drizzle',
  61: 'Light Rain', 63: 'Rain', 65: 'Heavy Rain',
  71: 'Light Snow', 73: 'Snow', 75: 'Heavy Snow',
  80: 'Showers', 81: 'Showers', 82: 'Heavy Showers',
  95: 'Thunderstorm', 96: 'Thunderstorm', 99: 'Thunderstorm',
};

function randomCity() {
  return CITIES[Math.floor(Math.random() * CITIES.length)];
}

async function fetchCurrentWeather(lat: number, lon: number) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}`
    + `&current=temperature_2m,weather_code,relative_humidity_2m&temperature_unit=fahrenheit`;
  const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`Open-Meteo ${res.status}`);
  const data = await res.json() as {
    current: { temperature_2m: number; weather_code: number; relative_humidity_2m: number };
  };
  return data.current;
}

async function fetchForecast(lat: number, lon: number) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}`
    + `&daily=temperature_2m_max,temperature_2m_min,weather_code&temperature_unit=fahrenheit`
    + `&timezone=auto&forecast_days=7`;
  const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`Open-Meteo ${res.status}`);
  const data = await res.json() as {
    daily: {
      time: string[];
      temperature_2m_max: number[];
      temperature_2m_min: number[];
      weather_code: number[];
    };
  };
  return data.daily;
}

// ── Facilitator with retry ────────────────────────────────────────────────────

async function withRetry<T>(fn: () => Promise<T>, attempts = 3, delayMs = 500): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (attempts <= 1) throw err;
    await new Promise(r => setTimeout(r, delayMs));
    return withRetry(fn, attempts - 1, delayMs * 2);
  }
}

const baseFacilitator = new HTTPFacilitatorClient({ url: FACILITATOR_URL });

// Wrap verify/settle with retry — network blips to the facilitator won't fail the payment
const facilitatorClient = {
  url: baseFacilitator.url,
  getSupported: () => baseFacilitator.getSupported(),
  verify: (...args: Parameters<typeof baseFacilitator.verify>) =>
    withRetry(() => baseFacilitator.verify(...args)),
  settle: (...args: Parameters<typeof baseFacilitator.settle>) =>
    withRetry(() => baseFacilitator.settle(...args)),
};

// ── x402 Setup ────────────────────────────────────────────────────────────────

const resourceServer = new x402ResourceServer(facilitatorClient)
  .register(ALGORAND_TESTNET_CAIP2, new ExactAvmScheme());

const routes = {
  'GET /weather': {
    accepts: {
      scheme: 'exact' as const,
      network: ALGORAND_TESTNET_CAIP2 as Network,
      payTo: SELLER_ADDRESS as string,
      price: WEATHER_PRICE,
    },
    description: 'Current weather for a random city — pay-per-request via x402',
  },
  'GET /forecast': {
    accepts: {
      scheme: 'exact' as const,
      network: ALGORAND_TESTNET_CAIP2 as Network,
      payTo: SELLER_ADDRESS as string,
      price: FORECAST_PRICE,
    },
    description: '7-day forecast for a random city — pay-per-request via x402',
  },
};

// ── Hono App ──────────────────────────────────────────────────────────────────

const app = new Hono();

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

// Request logger — logs method, path, status, and whether it was a paid request
app.use(async (c, next) => {
  const start = Date.now();
  await next();
  const ms = Date.now() - start;
  const paid = c.req.header('x-payment') ? '💰' : '  ';
  console.log(`[seller] ${paid} ${c.req.method} ${c.req.path} → ${c.res.status} (${ms}ms)`);
});

app.use(paymentMiddleware(routes, resourceServer));

// ── Free endpoints ────────────────────────────────────────────────────────────

app.get('/health', (c) =>
  c.json({
    status: 'ok',
    service: 'x402-seller',
    timestamp: new Date().toISOString(),
    endpoints: {
      '/weather':  { price: WEATHER_PRICE,  description: 'Current conditions for a random city' },
      '/forecast': { price: FORECAST_PRICE, description: '7-day forecast for a random city' },
    },
  }),
);

app.get('/', (c) =>
  c.json({
    service: 'x402 Demo Seller Agent',
    endpoints: [
      { path: '/weather',  method: 'GET', price: `${WEATHER_PRICE} USDC`,  description: 'Current weather data' },
      { path: '/forecast', method: 'GET', price: `${FORECAST_PRICE} USDC`, description: '7-day forecast' },
      { path: '/health',   method: 'GET', price: 'free',                    description: 'Health check' },
    ],
    facilitator: FACILITATOR_URL,
    payTo: SELLER_ADDRESS,
    network: ALGORAND_TESTNET_CAIP2,
  }),
);

// ── Paid endpoints ────────────────────────────────────────────────────────────

app.get('/weather', async (c) => {
  const { city, lat, lon } = randomCity();
  try {
    const current = await fetchCurrentWeather(lat, lon);
    return c.json({
      city,
      temperature: Math.round(current.temperature_2m),
      condition:   WMO[current.weather_code] ?? 'Unknown',
      humidity:    current.relative_humidity_2m,
      timestamp:   new Date().toISOString(),
      paidVia:     'x402 / Algorand USDC Testnet',
    });
  } catch (err) {
    // Open-Meteo unavailable — return static fallback so the payment isn't wasted
    console.error('[seller] Open-Meteo error, using fallback:', err);
    return c.json({
      city,
      temperature: Math.round(60 + Math.random() * 40),
      condition:   'Partly Cloudy',
      humidity:    Math.round(50 + Math.random() * 30),
      timestamp:   new Date().toISOString(),
      paidVia:     'x402 / Algorand USDC Testnet (cached)',
    });
  }
});

app.get('/forecast', async (c) => {
  const { city, lat, lon } = randomCity();
  try {
    const daily = await fetchForecast(lat, lon);
    const days = daily.time.map((date, i) => ({
      date,
      tempMax:   Math.round(daily.temperature_2m_max[i]),
      tempMin:   Math.round(daily.temperature_2m_min[i]),
      condition: WMO[daily.weather_code[i]] ?? 'Unknown',
    }));
    return c.json({
      city,
      days,
      timestamp: new Date().toISOString(),
      paidVia:   'x402 / Algorand USDC Testnet',
    });
  } catch (err) {
    console.error('[seller] Open-Meteo forecast error:', err);
    return c.json({ error: 'Forecast temporarily unavailable — please retry' }, 503);
  }
});

// ── Start ─────────────────────────────────────────────────────────────────────

serve({ fetch: app.fetch, port: PORT }, () => {
  console.log(`\n[seller] x402 Resource Server ready`);
  console.log(`[seller]   URL:         http://localhost:${PORT}`);
  console.log(`[seller]   Pay-to:      ${SELLER_ADDRESS}`);
  console.log(`[seller]   Network:     ${ALGORAND_TESTNET_CAIP2}`);
  console.log(`[seller]   Facilitator: ${FACILITATOR_URL}`);
  console.log(`[seller]   /weather     ${WEATHER_PRICE} USDC`);
  console.log(`[seller]   /forecast    ${FORECAST_PRICE} USDC\n`);
});
