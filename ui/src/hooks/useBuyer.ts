// =============================================================================
// BROWSER BUYER — x402 client hook for the React UI
//
// To adapt to your own seller, change THREE things:
//   1. RESPONSE TYPES — add interfaces that match your seller's JSON shape
//   2. ENDPOINT TYPE  — replace the Endpoint union with your route name(s)
//   3. HEALTH CHECK   — update endpoint paths and fallback prices
//
// Do NOT change the payment flow inside buy() — it is boilerplate.
// =============================================================================

import { useState, useCallback } from 'react';
import { wrapFetchWithPayment, x402Client } from '@x402/fetch';
import { ExactAvmScheme } from '@x402/avm/exact/client';
import { toClientAvmSigner, ALGORAND_TESTNET_CAIP2, ALGORAND_MAINNET_CAIP2 } from '@x402/avm';
import type { AlgorandAccount } from './useWeb3Auth';

// ── CHANGE 1 — Response types ─────────────────────────────────────────────────
// Replace these with interfaces that match your seller's JSON response shapes.
// ResultCard in App.tsx will auto-render any shape — you only need types here
// if you want TypeScript safety when reading the response in buy() below.

export interface WeatherData {
  city: string;
  temperature: number;
  condition: string;
  humidity: number;
  paidVia: string;
  timestamp: string;
}

export interface ForecastDay {
  date: string;
  tempMax: number;
  tempMin: number;
  condition: string;
}

export interface ForecastData {
  city: string;
  days: ForecastDay[];
  paidVia: string;
  timestamp: string;
}

// ── CHANGE 2 — Endpoint names ─────────────────────────────────────────────────
// List every route your seller exposes (without the leading '/').
// The buy() call below constructs the URL as: SELLER_URL + '/' + endpoint
// CHANGE: replace 'weather' | 'forecast' with your own endpoint names
export type Endpoint = 'weather' | 'forecast';

export interface Purchase {
  endpoint: Endpoint;
  result?: Record<string, unknown>; // generic — holds whatever your seller returns
  txid?: string;
  purchasedAt: string;
  latencyMs?: number;
}

export interface PurchaseLog {
  id: string;
  endpoint: Endpoint;
  events: BuyEvent[];
  at: string;
}

export type BuyEventType =
  | 'request_sent'
  | 'payment_required'
  | 'payment_signing'
  | 'payment_sent'
  | 'settlement_confirmed'
  | 'success'
  | 'error';

export interface BuyEvent {
  type: BuyEventType;
  endpoint?: Endpoint;
  amount?: string;
  payTo?: string;
  txid?: string;
  latencyMs?: number;
  data?: Record<string, unknown>; // whatever your seller returns
  message?: string;
}

// ── Config ────────────────────────────────────────────────────────────────────

const SELLER_URL   = (import.meta.env.VITE_SELLER_URL as string) ?? 'http://localhost:4021';
const IS_MAINNET   = import.meta.env.VITE_NETWORK === 'mainnet';
const NETWORK_CAIP2 = IS_MAINNET ? ALGORAND_MAINNET_CAIP2 : ALGORAND_TESTNET_CAIP2;
const PURCHASES_KEY = 'x402-purchases';

function loadPurchases(): Purchase[] {
  try {
    const raw = localStorage.getItem(PURCHASES_KEY);
    return raw ? (JSON.parse(raw) as Purchase[]) : [];
  } catch {
    return [];
  }
}

function savePurchases(purchases: Purchase[]) {
  try {
    localStorage.setItem(PURCHASES_KEY, JSON.stringify(purchases.slice(-50)));
  } catch { /* storage full — silently ignore */ }
}

// ── CHANGE 3 — Health check ───────────────────────────────────────────────────
// Update the endpoint paths and fallback prices to match your seller.
// The prices object keys must match your Endpoint type above.

export interface SellerHealth {
  online: boolean;
  prices: Record<Endpoint, string>;
}

// NOTE: fallback prices must match your seller's defaults in .env
export async function checkSellerHealth(): Promise<SellerHealth> {
  const fallback: SellerHealth = {
    online: false,
    // CHANGE: update keys + fallback values to match your endpoints
    prices: { weather: '$0.001', forecast: '$0.005' },
  };
  try {
    const res = await fetch(`${SELLER_URL}/health`, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) return fallback;
    const data = await res.json() as {
      endpoints?: {
        // CHANGE: update paths to match your seller's routes
        '/weather'?:  { price: string };
        '/forecast'?: { price: string };
      };
    };
    return {
      online: true,
      prices: {
        weather:  data.endpoints?.['/weather']?.price  ?? '$0.001',
        forecast: data.endpoints?.['/forecast']?.price ?? '$0.005',
      },
    };
  } catch {
    return fallback;
  }
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useBuyer() {
  const [events, setEvents]             = useState<BuyEvent[]>([]);
  const [purchaseLogs, setPurchaseLogs] = useState<PurchaseLog[]>([]);
  const [purchases, setPurchases]       = useState<Purchase[]>(() => loadPurchases());
  const [result, setResult]             = useState<Record<string, unknown> | null>(null);
  const [lastEndpoint, setLastEndpoint] = useState<Endpoint | null>(null);
  const [loading, setLoading]           = useState(false);
  const [error, setError]               = useState<string | null>(null);

  const addEvent = useCallback((e: BuyEvent) => {
    setEvents(prev => [...prev, e]);
  }, []);

  // ── buy() — DO NOT CHANGE the payment flow ───────────────────────────────
  // Only change the SELLER_URL path if you rename the endpoint in your seller.
  // The x402 handshake (402 → sign → retry) is handled automatically by
  // wrapFetchWithPayment. Your code receives a normal Response when it's done.
  const buy = useCallback(async (account: AlgorandAccount, endpoint: Endpoint = 'weather') => {
    if (loading) return;
    setLoading(true);
    setError(null);
    setEvents([]);
    setResult(null);
    setLastEndpoint(null);

    const signer = toClientAvmSigner(account.privateKeyBase64);
    const client = new x402Client().register(NETWORK_CAIP2, new ExactAvmScheme(signer));

    const MAX_RETRIES = 1;
    let retryCount = 0;

    while (retryCount <= MAX_RETRIES) {
      let attempt = 0;
      let lastTxid: string | undefined;
      const buyStart = Date.now();
      const currentEvents: BuyEvent[] = [];

      const emit = (e: BuyEvent) => { currentEvents.push(e); addEvent(e); };

      // ── Boilerplate: tracks payment events, do not modify ─────────────────
      const trackedFetch: typeof fetch = async (input, init) => {
        attempt++;
        if (attempt === 1) {
          emit({ type: 'request_sent', endpoint });
        } else {
          emit({ type: 'payment_sent', endpoint });
        }

        const res = await fetch(input, init);

        if (res.status === 402) {
          try {
            const prHeader = res.headers.get('PAYMENT-REQUIRED') ?? res.headers.get('payment-required');
            if (prHeader) {
              const decoded = JSON.parse(Buffer.from(prHeader, 'base64').toString('utf-8')) as {
                accepts?: Array<{ amount: string; payTo: string }>;
              };
              const req = decoded.accepts?.[0];
              emit({ type: 'payment_required', endpoint, amount: req?.amount, payTo: req?.payTo });
            } else {
              emit({ type: 'payment_required', endpoint });
            }
          } catch {
            emit({ type: 'payment_required', endpoint });
          }
          await pause(150);
          emit({ type: 'payment_signing', endpoint });
          await pause(150);
        } else if (res.status === 200 && attempt > 1) {
          try {
            const header = res.headers.get('payment-response') ?? res.headers.get('PAYMENT-RESPONSE');
            if (header) {
              const decoded = JSON.parse(Buffer.from(header, 'base64').toString('utf-8')) as { transaction?: string };
              lastTxid = decoded.transaction;
            }
          } catch { /* txid stays undefined */ }
          const latencyMs = Date.now() - buyStart;
          emit({ type: 'settlement_confirmed', endpoint, txid: lastTxid, latencyMs });
        }

        return res;
      };
      // ── End boilerplate ───────────────────────────────────────────────────

      const fetchWithPayment = wrapFetchWithPayment(trackedFetch, client);

      try {
        const response = await fetchWithPayment(`${SELLER_URL}/${endpoint}`, { method: 'GET' });

        if (response.ok) {
          const latencyMs = Date.now() - buyStart;

          // Generic: parse whatever JSON your seller returns.
          // ResultCard in App.tsx renders any shape automatically.
          const data = await response.json() as Record<string, unknown>;
          emit({ type: 'success', endpoint, data, txid: lastTxid });
          setResult(data);
          setLastEndpoint(endpoint);
          setPurchases(prev => {
            const next = [...prev, { endpoint, result: data, txid: lastTxid, purchasedAt: new Date().toISOString(), latencyMs }];
            savePurchases(next);
            return next;
          });
          setPurchaseLogs(prev => [{
            id: `${Date.now()}`,
            endpoint,
            events: [...currentEvents],
            at: new Date().toISOString(),
          }, ...prev].slice(0, 10));

          break;
        } else {
          const text = await response.text();
          const msg = `Server returned ${response.status}: ${text}`;
          if (retryCount < MAX_RETRIES && attempt <= 1) {
            emit({ type: 'error', endpoint, message: `${msg} — retrying...` });
            retryCount++;
            await pause(1500 * retryCount);
          } else {
            emit({ type: 'error', endpoint, message: msg });
            setError(msg);
            break;
          }
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (retryCount < MAX_RETRIES && attempt <= 1) {
          emit({ type: 'error', endpoint, message: `Network error — retrying... (${retryCount + 1})` });
          retryCount++;
          await pause(1500 * retryCount);
        } else {
          emit({ type: 'error', endpoint, message: msg });
          setError(msg);
          break;
        }
      }
    }

    setLoading(false);
  }, [loading, addEvent]);

  return { events, purchaseLogs, purchases, result, lastEndpoint, loading, error, buy };
}

function pause(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}
