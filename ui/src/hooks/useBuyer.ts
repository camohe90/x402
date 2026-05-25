import { useState, useCallback } from 'react';
import { wrapFetchWithPayment, x402Client } from '@x402/fetch';
import { ExactAvmScheme } from '@x402/avm/exact/client';
import { toClientAvmSigner, ALGORAND_TESTNET_CAIP2 } from '@x402/avm';
import type { AlgorandAccount } from './useWeb3Auth';

// ── Types ─────────────────────────────────────────────────────────────────────

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

export type Endpoint = 'weather' | 'forecast';

export interface Purchase {
  endpoint: Endpoint;
  weather?: WeatherData;
  forecast?: ForecastData;
  txid?: string;
  purchasedAt: string;
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
  data?: WeatherData | ForecastData;
  message?: string;
}

const SELLER_URL = import.meta.env.VITE_SELLER_URL as string ?? 'http://localhost:4021';

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
  const [events, setEvents]     = useState<BuyEvent[]>([]);
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [weather, setWeather]   = useState<WeatherData | null>(null);
  const [forecast, setForecast] = useState<ForecastData | null>(null);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState<string | null>(null);

  const addEvent = useCallback((e: BuyEvent) => {
    setEvents((prev) => [...prev, e]);
  }, []);

  const buy = useCallback(async (account: AlgorandAccount, endpoint: Endpoint = 'weather') => {
    if (loading) return;

    setLoading(true);
    setError(null);
    setEvents([]);
    setWeather(null);
    setForecast(null);

    const signer = toClientAvmSigner(account.privateKeyBase64);
    const client = new x402Client().register(
      ALGORAND_TESTNET_CAIP2,
      new ExactAvmScheme(signer),
    );

    let attempt = 0;
    let lastTxid: string | undefined;

    const trackedFetch: typeof fetch = async (input, init) => {
      attempt++;

      if (attempt === 1) {
        addEvent({ type: 'request_sent', endpoint });
      } else {
        addEvent({ type: 'payment_sent', endpoint });
      }

      const res = await fetch(input, init);

      if (res.status === 402) {
        try {
          // x402 v2: payment requirements are in the PAYMENT-REQUIRED header (base64 JSON)
          const prHeader = res.headers.get('PAYMENT-REQUIRED') ?? res.headers.get('payment-required');
          if (prHeader) {
            const decoded = JSON.parse(Buffer.from(prHeader, 'base64').toString('utf-8')) as {
              accepts?: Array<{ amount: string; payTo: string }>;
            };
            const req = decoded.accepts?.[0];
            addEvent({ type: 'payment_required', endpoint, amount: req?.amount, payTo: req?.payTo });
          } else {
            addEvent({ type: 'payment_required', endpoint });
          }
        } catch {
          addEvent({ type: 'payment_required', endpoint });
        }
        await pause(150);
        addEvent({ type: 'payment_signing', endpoint });
        await pause(150);
      } else if (res.status === 200 && attempt > 1) {
        try {
          const header = res.headers.get('payment-response') ?? res.headers.get('PAYMENT-RESPONSE');
          if (header) {
            const decoded = JSON.parse(Buffer.from(header, 'base64').toString('utf-8')) as { transaction?: string };
            lastTxid = decoded.transaction;
          }
        } catch {
          // txid stays undefined
        }
        addEvent({ type: 'settlement_confirmed', endpoint, txid: lastTxid });
      }

      return res;
    };

    const fetchWithPayment = wrapFetchWithPayment(trackedFetch, client);

    try {
      const response = await fetchWithPayment(`${SELLER_URL}/${endpoint}`, { method: 'GET' });
      if (response.ok) {
        if (endpoint === 'weather') {
          const data = await response.json() as WeatherData;
          addEvent({ type: 'success', endpoint, data, txid: lastTxid });
          setWeather(data);
          setPurchases((prev) => [...prev, { endpoint, weather: data, txid: lastTxid, purchasedAt: new Date().toISOString() }]);
        } else {
          const data = await response.json() as ForecastData;
          addEvent({ type: 'success', endpoint, data, txid: lastTxid });
          setForecast(data);
          setPurchases((prev) => [...prev, { endpoint, forecast: data, txid: lastTxid, purchasedAt: new Date().toISOString() }]);
        }
      } else {
        const text = await response.text();
        const msg = `Server returned ${response.status}: ${text}`;
        addEvent({ type: 'error', endpoint, message: msg });
        setError(msg);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      addEvent({ type: 'error', endpoint, message: msg });
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [loading, addEvent]);

  return { events, purchases, weather, forecast, loading, error, buy };
}

function pause(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
