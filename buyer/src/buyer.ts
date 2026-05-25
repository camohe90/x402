import algosdk from 'algosdk';
import { wrapFetchWithPayment, x402Client } from '@x402/fetch';
import { ExactAvmScheme } from '@x402/avm/exact/client';
import { toClientAvmSigner, ALGORAND_TESTNET_CAIP2 } from '@x402/avm';

// =============================================================================
// BUYER — x402 Client Agent (server-side)
//
// This file is the template for building a backend agent that pays for
// x402-protected APIs. To adapt it to your own seller, change two things:
//
//   1. RESPONSE TYPE  — replace WeatherData with your API's response shape
//   2. ENDPOINT URL   — replace '/weather' with your seller's path
//
// The payment flow (signer → client → trackedFetch → fetchWithPayment)
// is boilerplate — copy it as-is into any Node.js project.
// =============================================================================

// ── CHANGE 1 — replace with your API's response type ─────────────────────────

export interface WeatherData {
  city: string;
  temperature: number;
  condition: string;
  humidity: number;
  paidVia: string;
  timestamp: string;
}

// Events emitted during the purchase flow (useful for logging / UI streaming)
export type BuyerEvent =
  | { type: 'start';                address: string; sellerUrl: string }
  | { type: 'request_sent' }
  | { type: 'payment_required';     amount: string; asset: string; payTo: string }
  | { type: 'payment_signing' }
  | { type: 'payment_sent' }
  | { type: 'settlement_confirmed'; txid?: string }
  | { type: 'success';              data: WeatherData; txid?: string }
  | { type: 'error';                message: string };

// ── Core buy function ─────────────────────────────────────────────────────────
// onEvent — callback for each step in the flow (log it, stream it, ignore it)
// sellerUrl — base URL of the seller, e.g. https://your-seller.railway.app
// mnemonic  — 25-word Algorand mnemonic for the paying account

export async function buyWeather(
  onEvent: (event: BuyerEvent) => void,
  sellerUrl: string,
  mnemonic: string,
): Promise<void> {

  // Boilerplate: derive signer from mnemonic
  // algosdk gives a 64-byte secretKey (seed + pubkey); @x402/avm needs it as base64
  const account = algosdk.mnemonicToSecretKey(mnemonic);
  const privateKeyBase64 = Buffer.from(account.sk).toString('base64');
  const signer = toClientAvmSigner(privateKeyBase64);

  onEvent({ type: 'start', address: String(account.addr), sellerUrl });

  // Boilerplate: create x402 client with Algorand USDC payment scheme
  const client = new x402Client().register(
    ALGORAND_TESTNET_CAIP2,
    new ExactAvmScheme(signer),
  );

  let attempt = 0;
  let lastTxid: string | undefined;

  // Boilerplate: trackedFetch wraps raw fetch to emit lifecycle events.
  // wrapFetchWithPayment calls it twice:
  //   attempt 1 → no payment header → server returns 402
  //   attempt 2 → signed X-PAYMENT header → server returns 200
  const trackedFetch: typeof fetch = async (input, init) => {
    attempt++;

    if (attempt === 1) {
      onEvent({ type: 'request_sent' });
    } else {
      onEvent({ type: 'payment_sent' });
    }

    const res = await fetch(input, init);

    if (res.status === 402) {
      // x402 v2: payment requirements are in the PAYMENT-REQUIRED header (base64 JSON)
      try {
        const prHeader = res.headers.get('PAYMENT-REQUIRED') ?? res.headers.get('payment-required');
        if (prHeader) {
          const decoded = JSON.parse(Buffer.from(prHeader, 'base64').toString('utf-8')) as {
            accepts?: Array<{ amount: string; asset?: string; payTo: string }>;
          };
          const req = decoded.accepts?.[0];
          onEvent({
            type:   'payment_required',
            amount: req?.amount ?? '0',
            asset:  req?.asset ?? '10458941',
            payTo:  req?.payTo ?? '',
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
      // Extract the on-chain txId from the payment-response header
      try {
        const header = res.headers.get('payment-response') ?? res.headers.get('PAYMENT-RESPONSE');
        if (header) {
          const decoded = JSON.parse(Buffer.from(header, 'base64').toString('utf-8')) as { transaction?: string };
          lastTxid = decoded.transaction;
        }
      } catch {
        // txid stays undefined — not critical
      }
      onEvent({ type: 'settlement_confirmed', txid: lastTxid });
    }

    return res;
  };

  const fetchWithPayment = wrapFetchWithPayment(trackedFetch, client);

  // CHANGE 2 — replace '/weather' with your seller's endpoint path
  try {
    const response = await fetchWithPayment(`${sellerUrl}/weather`, { method: 'GET' });

    if (response.ok) {
      const data = await response.json() as WeatherData; // ← swap WeatherData with your type
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
