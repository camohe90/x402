// =============================================================================
// BROWSER BUYER — x402 client hook for the React UI
//
// To adapt to your own seller, change:
//   1. RESPONSE TYPES — replace WeatherData / ForecastData
//   2. ENDPOINTS      — update the Endpoint union and buy() call paths
//
// The payment flow inside buy() is boilerplate — don't change it.
// =============================================================================

import { useState, useCallback } from 'react';
import { wrapFetchWithPayment, x402Client } from '@x402/fetch';
import { ExactAvmScheme } from '@x402/avm/exact/client';
import { toClientAvmSigner, ALGORAND_TESTNET_CAIP2 } from '@x402/avm';
import type { AlgorandAccount } from './useWeb3Auth';

// ── Response types — replace with your seller's shapes ────────────────────────

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

// Update this union to match your seller's endpoints
export type Endpoint = 'weather' | 'forecast';

export interface Purchase {
  endpoint: Endpoint;
  weather?: WeatherData;
  forecast?: ForecastData;
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
  data?: WeatherData | ForecastData;
  message?: string;
}

// ── Config ────────────────────────────────────────────────────────────────────

const SELLER_URL = (import.meta.env.VITE_SELLER_URL as string) ?? 'http://localhost:4021';
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

// ── Health check ──────────────────────────────────────────────────────────────

export interface SellerHealth {
  online: boolean;
  prices: { weather: string; forecast: string };
}

export async function checkSellerHealth(): Promise<SellerHealth> {
  try {
    const res = await fetch(`${SELLER_URL}/health`, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) return { online: false, prices: { weather: '$0.001', forecast: '$0.005' } };
    const data = await res.json() as {
      endpoints?: {
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
    return { online: false, prices: { weather: '$0.001', forecast: '$0.005' } };
  }
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useBuyer() {
  const [events, setEvents]           = useState<BuyEvent[]>([]);
  const [purchaseLogs, setPurchaseLogs] = useState<PurchaseLog[]>([]);
  const [purchases, setPurchases]     = useState<Purchase[]>(() => loadPurchases());
  const [weather, setWeather]         = useState<WeatherData | null>(null);
  const [forecast, setForecast]       = useState<ForecastData | null>(null);
  const [loading, setLoading]         = useState(false);
  const [error, setError]             = useState<string | null>(null);

  const addEvent = useCallback((e: BuyEvent) => {
    setEvents(prev => [...prev, e]);
  }, []);

  const buy = useCallback(async (account: AlgorandAccount, endpoint: Endpoint = 'weather') => {
    if (loading) return;
    setLoading(true);
    setError(null);
    setEvents([]);
    setWeather(null);
    setForecast(null);

    const signer = toClientAvmSigner(account.privateKeyBase64);
    const client = new x402Client().register(ALGORAND_TESTNET_CAIP2, new ExactAvmScheme(signer));

    const MAX_RETRIES = 1;
    let retryCount = 0;

    while (retryCount <= MAX_RETRIES) {
      let attempt = 0;
      let lastTxid: string | undefined;
      const buyStart = Date.now();
      const currentEvents: BuyEvent[] = [];

      // Wrapper so events go both to state and to the local snapshot for PurchaseLog
      const emit = (e: BuyEvent) => {
        currentEvents.push(e);
        addEvent(e);
      };

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

      const fetchWithPayment = wrapFetchWithPayment(trackedFetch, client);

      try {
        const response = await fetchWithPayment(`${SELLER_URL}/${endpoint}`, { method: 'GET' });

        if (response.ok) {
          const latencyMs = Date.now() - buyStart;

          if (endpoint === 'weather') {
            const data = await response.json() as WeatherData;
            emit({ type: 'success', endpoint, data, txid: lastTxid });
            setWeather(data);
            setPurchases(prev => {
              const next = [...prev, { endpoint, weather: data, txid: lastTxid, purchasedAt: new Date().toISOString(), latencyMs }];
              savePurchases(next);
              return next;
            });
          } else {
            const data = await response.json() as ForecastData;
            emit({ type: 'success', endpoint, data, txid: lastTxid });
            setForecast(data);
            setPurchases(prev => {
              const next = [...prev, { endpoint, forecast: data, txid: lastTxid, purchasedAt: new Date().toISOString(), latencyMs }];
              savePurchases(next);
              return next;
            });
          }

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

  return { events, purchaseLogs, purchases, weather, forecast, loading, error, buy };
}

function pause(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}
