import algosdk from 'algosdk';
import { wrapFetchWithPayment, x402Client } from '@x402/fetch';
import { ExactAvmScheme } from '@x402/avm/exact/client';
import { toClientAvmSigner, ALGORAND_TESTNET_CAIP2 } from '@x402/avm';

// ── Types ─────────────────────────────────────────────────────────────────────
// Extend WeatherData / replace with your own response type when adapting this
// template to a different x402 seller.

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

// ── Core buyer function ────────────────────────────────────────────────────────
// This is the agent entry point. Swap `sellerUrl` and the response type to
// point this at any x402-protected API — the payment flow stays identical.

export async function buyWeather(
  onEvent: (event: BuyerEvent) => void,
  sellerUrl: string,
  mnemonic: string,
): Promise<void> {
  // Derive the Ed25519 keypair from the 25-word Algorand mnemonic.
  // The 64-byte secretKey (seed || pubkey) is what @x402/avm expects.
  const account = algosdk.mnemonicToSecretKey(mnemonic);
  const privateKeyBase64 = Buffer.from(account.sk).toString('base64');
  const signer = toClientAvmSigner(privateKeyBase64);

  onEvent({ type: 'start', address: String(account.addr), sellerUrl });

  // Register the Algorand Exact-AVM payment scheme with the x402 client.
  // To support a different network or scheme, change the CAIP2 string and scheme.
  const client = new x402Client().register(
    ALGORAND_TESTNET_CAIP2,
    new ExactAvmScheme(signer),
  );

  let attempt = 0;
  let lastTxid: string | undefined;

  // trackedFetch wraps the raw fetch to emit lifecycle events.
  // wrapFetchWithPayment calls this twice: once without payment (→ 402),
  // then again with the signed X-PAYMENT header (→ 200).
  const trackedFetch: typeof fetch = async (input, init) => {
    attempt++;

    if (attempt === 1) {
      onEvent({ type: 'request_sent' });
    } else {
      onEvent({ type: 'payment_sent' });
    }

    const res = await fetch(input, init);

    if (res.status === 402) {
      // x402 v2: payment requirements are in the PAYMENT-REQUIRED header (base64 JSON).
      // The body does not carry `accepts[]` in v2 — read the header instead.
      try {
        const prHeader = res.headers.get('PAYMENT-REQUIRED') ?? res.headers.get('payment-required');
        if (prHeader) {
          const decoded = JSON.parse(Buffer.from(prHeader, 'base64').toString('utf-8')) as {
            accepts?: Array<{ amount: string; asset?: string; payTo: string }>;
          };
          const req = decoded.accepts?.[0];
          onEvent({
            type: 'payment_required',
            amount: req?.amount ?? '0',
            asset: req?.asset ?? '10458941',
            payTo: req?.payTo ?? '',
          });
        } else {
          onEvent({ type: 'payment_required', amount: '0', asset: '10458941', payTo: '' });
        }
      } catch {
        onEvent({ type: 'payment_required', amount: '0', asset: '10458941', payTo: '' });
      }
      await delay(150);
      onEvent({ type: 'payment_signing' });
      await delay(150);
    } else if (res.status === 200 && attempt > 1) {
      // Extract the on-chain txId from the payment-response header (base64 JSON).
      try {
        const header = res.headers.get('payment-response') ?? res.headers.get('PAYMENT-RESPONSE');
        if (header) {
          const decoded = JSON.parse(Buffer.from(header, 'base64').toString('utf-8')) as { transaction?: string };
          lastTxid = decoded.transaction;
        }
      } catch {
        // txid stays undefined
      }
      onEvent({ type: 'settlement_confirmed', txid: lastTxid });
    }

    return res;
  };

  const fetchWithPayment = wrapFetchWithPayment(trackedFetch, client);

  // ── Make the paid request ──────────────────────────────────────────────────
  // Replace '/weather' with your seller's endpoint path.
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
