# AGENTS.md

## This Project

This is an **x402 demo** — three services demonstrating HTTP 402 micropayments on Algorand Testnet using USDC:

- **`seller/`** — Hono server, exposes `GET /weather` and `GET /forecast` behind x402 `paymentMiddleware`
- **`buyer/`** — Hono SSE server + x402 client, streams purchase events
- **`ui/`** — React + Vite SPA, deployed on Vercel, uses Web3Auth for email-based wallets

See `CLAUDE.md` for commands, environment variables, architecture details, and the ngrok workflow for connecting the deployed UI to a local seller.

**Key skills for this project:** `algokit-utils-ts`, `algorand-x402-typescript`, `algorand-frontend`

## Building and Modifying This Project

Before modifying any x402 or algokit-utils code, load the relevant skill:

1. **x402 protocol** (seller, buyer, payment flow): load `algorand-x402-typescript`
2. **AlgoKit Utils** (asset opt-in, signing, AlgorandClient): load `algokit-utils-ts`
3. **React UI** (wallet integration, frontend patterns): load `algorand-frontend`

## Available Skills

| Task | Skill |
| ---- | ----- |
| x402 clients, servers, facilitators, paywalls | `algorand-x402-typescript` |
| AlgoKit Utils — client setup, assets, signing | `algokit-utils-ts` |
| React dApp frontends, wallet integration | `algorand-frontend` |

## MCP Tools

**Important:** These tools are provided by MCP servers. If a tool isn't available, check `.mcp.json` in the project root and restart the agent.

**Note:** MCP tool names may have different prefixes depending on your coding agent. Claude Code uses `mcp__kapa__search_algorand_knowledge_sources`; other agents may use `kapa_search_algorand_knowledge_sources`.

### Documentation Search (Kapa)

| Tool | Purpose |
| ---- | ------- |
| `kapa_search_algorand_knowledge_sources` | Search official Algorand docs |

### GitHub (Code Examples)

| Tool | Purpose |
| ---- | ------- |
| `github_get_file_contents` | Retrieve example code from repos |
| `github_search_code` | Find code patterns across repos |

## Troubleshooting

### MCP Tools Not Available

| Missing Tool | Fallback |
| ------------ | -------- |
| `kapa_search_algorand_knowledge_sources` | Web search `site:dev.algorand.co {query}` |
| `github_get_file_contents` | Browse GitHub directly |

**To fix:** Check `.mcp.json` exists with `kapa` and `github` entries, then restart the agent.

## Plan Mode

- Make the plan extremely concise. Sacrifice grammar for the sake of concision.
- At the end of each plan, give a list of unresolved questions, if any.

## X402 Development

x402 is an HTTP-native payment protocol built on the HTTP 402 "Payment Required" status code. Three components work together: **Client** requests a protected resource, **Server** responds with 402 and structured payment requirements, and **Facilitator** verifies and settles the payment on-chain.

### Payment Flow

```
Client                  Resource Server           Facilitator           Algorand
  |                          |                        |                    |
  | 1. GET /weather          |                        |                    |
  |------------------------->|                        |                    |
  | 2. 402 + requirements    |                        |                    |
  |<-------------------------|                        |                    |
  | 3. Build + sign txn      |                        |                    |
  | 4. GET + X-PAYMENT       |                        |                    |
  |------------------------->| 5. verify(payload)     |                    |
  |                          |----------------------->| 6. simulate        |
  |                          |                        |------------------->|
  |                          |                        |<-------------------|
  |                          |<-----------------------| {isValid: true}    |
  |                          | 7. settle(payload)     |                    |
  |                          |----------------------->| 8. sign + send     |
  |                          |                        |------------------->|
  |                          |                        |<-------------------| txId
  |                          |<-----------------------|                    |
  | 9. 200 + data            |                        |                    |
  |<-------------------------|                        |                    |
```

### This Project's x402 Specifics

- **Network**: `ALGORAND_TESTNET_CAIP2` from `@x402/avm`
- **Asset**: USDC ASA `10458941` on Algorand Testnet, 6 decimals
- **Seller signer** (`toClientAvmSigner`): takes a 64-byte base64 nacl secret key (seed+pubkey)
- **AlgoKit signer** (`generateAddressWithSigners`): takes `{ ed25519Pubkey, rawEd25519Signer }` — public key is `sk.subarray(32)`, signer wraps `nacl.sign.detached`
- **USDC opt-in**: auto-triggered when wallet has ≥ 0.2 ALGO — uses `algorand.send.assetOptIn()` from algokit-utils
- **CORS**: seller allows `*.vercel.app` and `UI_ORIGIN` env var; browser must use a public seller URL (ngrok for local dev)
- **Public facilitator URL:** `https://facilitator.goplausible.xyz`
