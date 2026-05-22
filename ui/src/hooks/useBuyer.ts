import { useState, useCallback } from 'react';
import { wrapFetchWithPayment, x402Client } from '@x402/fetch';
import { ExactAvmScheme } from '@x402/avm/exact/client';
import { toClientAvmSigner, ALGORAND_TESTNET_CAIP2 } from '@x402/avm';
import type { AlgorandAccount } from './useWeb3Auth';

export interface WeatherData {
  city: string;
  temperature: number;
  condition: string;
  humidity: number;
  paidVia: string;
  timestamp: string;
}

export interface Purchase {
  weather: WeatherData;
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
  amount?: string;
  payTo?: string;
  txid?: string;
  data?: WeatherData;
  message?: string;
}

const SELLER_URL = import.meta.env.VITE_SELLER_URL as string ?? 'http://localhost:4021';

export function useBuyer() {
  const [events, setEvents] = useState<BuyEvent[]>([]);
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [weather, setWeather] = useState<WeatherData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const addEvent = useCallback((e: BuyEvent) => {
    setEvents((prev) => [...prev, e]);
  }, []);

  const buy = useCallback(async (account: AlgorandAccount) => {
    if (loading) return;

    setLoading(true);
    setError(null);
    setEvents([]);
    setWeather(null);

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
        addEvent({ type: 'request_sent' });
      } else {
        addEvent({ type: 'payment_sent' });
      }

      const res = await fetch(input, init);

      if (res.status === 402) {
        try {
          const body = await res.clone().json() as { accepts?: Array<{ amount: string; payTo: string }> };
          const req = body.accepts?.[0];
          addEvent({
            type: 'payment_required',
            amount: req?.amount,
            payTo: req?.payTo,
          });
        } catch {
          addEvent({ type: 'payment_required' });
        }
        await pause(150);
        addEvent({ type: 'payment_signing' });
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
        addEvent({ type: 'settlement_confirmed', txid: lastTxid });
      }

      return res;
    };

    const fetchWithPayment = wrapFetchWithPayment(trackedFetch, client);

    try {
      const response = await fetchWithPayment(`${SELLER_URL}/weather`, { method: 'GET' });
      if (response.ok) {
        const data = await response.json() as WeatherData;
        addEvent({ type: 'success', data, txid: lastTxid });
        setWeather(data);
        setPurchases((prev) => [
          ...prev,
          { weather: data, txid: lastTxid, purchasedAt: new Date().toISOString() },
        ]);
      } else {
        const text = await response.text();
        const msg = `Server returned ${response.status}: ${text}`;
        addEvent({ type: 'error', message: msg });
        setError(msg);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      addEvent({ type: 'error', message: msg });
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [loading, addEvent]);

  return { events, purchases, weather, loading, error, buy };
}

function pause(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
