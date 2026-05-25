# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

For Algorand-specific patterns (algokit-utils, x402 protocol, wallet signing), load the relevant skill from `skills/` — particularly `algokit-utils-ts`, `algorand-x402-typescript`, and `algorand-frontend`.

## Commands

This is an npm workspace monorepo. Run workspace scripts from the root:

```bash
npm run seller          # start seller server (port 4021)
npm run buyer:server    # start buyer SSE server (port 4022)
npm run ui              # start UI dev server (port 5173)
```

Per-workspace commands:

```bash
# UI
cd ui && npx tsc --noEmit     # type check
cd ui && npm run build        # production build (tsc -b && vite build)
cd ui && npm run dev          # dev server

# Seller / Buyer
cd seller && npm run dev
cd buyer && npm run server
```

Deploy the UI to Vercel (always use the CLI, not GitHub push):

```bash
cd ui && vercel --prod
```

## Architecture

Three independent services communicating over HTTP:

```
Browser (ui/)
  ├── calls seller directly for x402 purchases (VITE_SELLER_URL)
  └── uses Web3Auth for email-based wallet (no seed phrase)

buyer/src/server.ts   — Hono SSE server; streams BuyerEvents to the UI
buyer/src/buyer.ts    — x402 client logic: hits seller, handles 402, signs, retries

seller/src/index.ts   — Hono server with three paid endpoints:
                         GET /weather  — current conditions ($0.001 USDC, env: SELLER_WEATHER_PRICE)
                         GET /forecast — 7-day forecast    ($0.005 USDC, env: SELLER_FORECAST_PRICE)
                         GET /quote    — inspirational quote ($0.002 USDC, env: SELLER_QUOTE_PRICE)
                         Both use Open-Meteo (free, no API key) for real weather data
                         → returns HTTP 402 with payment requirements
                         → verifies payment via goplausible facilitator
                         → delivers data only after payment confirmed
```

### x402 Payment Flow

1. Client sends `GET /weather`, `GET /forecast`, or `GET /quote` (no payment header)
2. Seller returns HTTP 402 with `PAYMENT-REQUIRED` header (base64 JSON) containing `accepts[]` — scheme, network, `payTo`, price
3. Client signs an Algorand USDC transaction via `toClientAvmSigner` from `@x402/avm` and retries with proof in `X-PAYMENT` header
4. `HTTPFacilitatorClient` at `facilitator.goplausible.xyz` verifies and settles on-chain (wrapped with `withRetry` for resilience)
5. Seller delivers the response only after confirmation

### UI-specific architecture

- **No backend for the browser** — the UI calls the seller directly via `VITE_SELLER_URL`
- **Web3Auth** (`@web3auth/modal` v10) is instantiated directly as a class, not via React provider. Instance lives in `useRef` inside `useWeb3Auth`. Critical: pass `initialState: { currentChainId: 'algorand:testnet', ... }` as the second constructor argument — without it the EIP155 chain becomes `chains[0]` and triggers a null `wsEmbedInstance` crash.
- **Key format**: Web3Auth returns a hex private key → sliced to 32 bytes (seed) → nacl produces a 64-byte `secretKey` (seed+pubkey concatenated). `privateKeyBase64` throughout the codebase is this 64-byte value encoded as base64.
- **AVM signer for x402**: `toClientAvmSigner(account.privateKeyBase64)` from `@x402/avm`
- **AVM signer for algokit-utils**: build a `RawEd25519Signer` with `nacl.sign.detached`, wrap with `generateAddressWithSigners` from `@algorandfoundation/algokit-utils/transact`, then `algorand.account.setSigner`

### USDC opt-in

When the wallet has ≥ 0.2 ALGO but hasn't opted in to USDC (ASA `10458941`), `App.tsx` auto-triggers `optInToUSDC` from `useWeb3Auth.ts`. Uses `AlgorandClient.testNet()` + `algorand.send.assetOptIn()`. Needs 0.2 ALGO minimum (base MBR 0.1 + ASA MBR 0.1).

### Seller CORS

The seller allows origins: `localhost:5173`, `localhost:4173`, `UI_ORIGIN` env var, and any `*.vercel.app`. To add a new origin, set `UI_ORIGIN` in `.env`.

## Environment Variables

Root `.env` (seller + buyer):

| Variable | Required | Default | Description |
|---|---|---|---|
| `SELLER_ADDRESS` | seller | — | Algorand address receiving payments |
| `BUYER_MNEMONIC` | buyer | — | 25-word mnemonic for buying account |
| `FACILITATOR_URL` | both | `https://facilitator.goplausible.xyz` | Settlement facilitator |
| `SELLER_URL` | buyer | `http://localhost:4021` | Seller URL for buyer server |
| `UI_ORIGIN` | seller | — | Deployed UI origin for CORS (e.g. `https://ui-vert-five.vercel.app`) |
| `SELLER_WEATHER_PRICE` | seller | `0.001` | Price in USD for `/weather` (plain decimal, no `$`) |
| `SELLER_FORECAST_PRICE` | seller | `0.005` | Price in USD for `/forecast` (plain decimal, no `$`) |
| `SELLER_QUOTE_PRICE` | seller | `0.002` | Price in USD for `/quote` (plain decimal, no `$`) |

UI env (set in Vercel dashboard or `ui/.env.local`):

| Variable | Description |
|---|---|
| `VITE_WEB3AUTH_CLIENT_ID` | Web3Auth dashboard client ID (Sapphire Devnet) |
| `VITE_SELLER_URL` | Public seller URL the browser calls — use ngrok when running locally |

### Running seller for the deployed UI

The browser cannot reach `localhost` from the Vercel-deployed UI. Use ngrok to expose the seller:

```bash
npm run seller                    # terminal 1
npx ngrok http 4021               # terminal 2 — copy the https URL
# Set VITE_SELLER_URL in Vercel dashboard to the ngrok URL, then redeploy
cd ui && vercel --prod
```

## Key Libraries

| Package | Used in | Purpose |
|---|---|---|
| `@x402/hono` | seller | `paymentMiddleware`, `x402ResourceServer` |
| `@x402/fetch` | buyer, ui | `wrapFetchWithPayment`, `x402Client` |
| `@x402/avm` | buyer, ui | `toClientAvmSigner`, `ExactAvmScheme`, `ALGORAND_TESTNET_CAIP2` |
| `@web3auth/modal` v10 | ui | Email-based wallet, `Web3Auth` class, `CHAIN_NAMESPACES.OTHER` |
| `@algorandfoundation/algokit-utils` | ui | `AlgorandClient.testNet()`, `algorand.account.getInformation()`, `algorand.send.assetOptIn()` — all on-chain reads and writes go through this |
| `algosdk` v3 | ui, buyer | `encodeAddress`, `mnemonicToSecretKey` — key derivation only, not used for direct chain calls |
| `tweetnacl` | ui | Ed25519 key derivation and signing |
| `hono` | seller, buyer | HTTP server framework |
