import algosdk from 'algosdk';
import { wrapFetchWithPayment, x402Client } from '@x402/fetch';
import { ExactAvmScheme } from '@x402/avm/exact/client';
import { toClientAvmSigner, ALGORAND_TESTNET_CAIP2 } from '@x402/avm';

export interface WeatherData {
  city: string;
  temperature: number;
  condition: string;
  humidity: number;
  paidVia: string;
  timestamp: string;
}

export type BuyerEvent =
  | { type: 'start'; address: string; sellerUrl: string }
  | { type: 'request_sent' }
  | { type: 'payment_required'; amount: string; asset: string; payTo: string }
  | { type: 'payment_signing' }
  | { type: 'payment_sent' }
  | { type: 'settlement_confirmed'; txid?: string }
  | { type: 'success'; data: WeatherData; txid?: string }
  | { type: 'error'; message: string };

export async function buyWeather(
  onEvent: (event: BuyerEvent) => void,
  sellerUrl: string,
  mnemonic: string,
): Promise<void> {
  const account = algosdk.mnemonicToSecretKey(mnemonic);
  const privateKeyBase64 = Buffer.from(account.sk).toString('base64');
  const signer = toClientAvmSigner(privateKeyBase64);

  onEvent({ type: 'start', address: String(account.addr), sellerUrl });

  const client = new x402Client().register(
    ALGORAND_TESTNET_CAIP2,
    new ExactAvmScheme(signer),
  );

  let attempt = 0;
  let lastTxid: string | undefined;

  const trackedFetch: typeof fetch = async (input, init) => {
    attempt++;

    if (attempt === 1) {
      onEvent({ type: 'request_sent' });
    } else {
      onEvent({ type: 'payment_sent' });
    }

    const res = await fetch(input, init);

    if (res.status === 402) {
      try {
        const body = await res.clone().json() as { accepts?: Array<{ amount: string; asset: string; payTo: string }> };
        const req = body.accepts?.[0];
        onEvent({
          type: 'payment_required',
          amount: req?.amount ?? '1000',
          asset: req?.asset ?? '10458941',
          payTo: req?.payTo ?? '',
        });
      } catch {
        onEvent({ type: 'payment_required', amount: '1000', asset: '10458941', payTo: '' });
      }
      await delay(150);
      onEvent({ type: 'payment_signing' });
      await delay(150);
    } else if (res.status === 200 && attempt > 1) {
      const allHeaders: Record<string, string> = {};
      res.headers.forEach((v, k) => { allHeaders[k] = v; });
      console.log('[buyer] 200 response headers:', JSON.stringify(allHeaders, null, 2));
      try {
        const header = res.headers.get('payment-response') ?? res.headers.get('PAYMENT-RESPONSE');
        console.log('[buyer] payment-response header:', header?.slice(0, 60));
        if (header) {
          const decoded = JSON.parse(Buffer.from(header, 'base64').toString('utf-8')) as { transaction?: string };
          console.log('[buyer] decoded txid:', decoded.transaction);
          lastTxid = decoded.transaction;
        }
      } catch (e) {
        console.log('[buyer] header decode error:', e);
      }
      onEvent({ type: 'settlement_confirmed', txid: lastTxid });
    }

    return res;
  };

  const fetchWithPayment = wrapFetchWithPayment(trackedFetch, client);

  try {
    const response = await fetchWithPayment(`${sellerUrl}/weather`, { method: 'GET' });

    if (response.ok) {
      const data = await response.json() as WeatherData;
      onEvent({ type: 'success', data, txid: lastTxid });
    } else {
      const text = await response.text();
      onEvent({ type: 'error', message: `Server returned ${response.status}: ${text}` });
    }
  } catch (err) {
    onEvent({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
}

function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
