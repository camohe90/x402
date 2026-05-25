import { useEffect, useRef, useState } from 'react';
import { Web3Auth } from '@web3auth/modal';
import { CHAIN_NAMESPACES, WEB3AUTH_NETWORK, CommonPrivateKeyProvider } from '@web3auth/no-modal';
import type { IProvider } from '@web3auth/no-modal';
import nacl from 'tweetnacl';
import algosdk from 'algosdk';
import { AlgorandClient } from '@algorandfoundation/algokit-utils';
import { generateAddressWithSigners } from '@algorandfoundation/algokit-utils/transact';
import type { RawEd25519Signer } from '@algorandfoundation/algokit-utils/crypto';

export interface AlgorandAccount {
  address: string;
  privateKeyBase64: string;
}

export interface WalletBalance {
  algo: number;
  usdc: number;
  usdcOptedIn: boolean;
  accountExists: boolean;
}

export type Web3AuthStatus = 'idle' | 'initializing' | 'ready' | 'connecting' | 'connected' | 'error';

const USDC_ASSET_ID = 10458941;

export async function optInToUSDC(address: string, privateKeyBase64: string): Promise<void> {
  const sk = new Uint8Array(Buffer.from(privateKeyBase64, 'base64')); // 64-byte nacl secret key
  const ed25519Pubkey = sk.subarray(32); // last 32 bytes = public key
  const rawEd25519Signer: RawEd25519Signer = async (bytesToSign) =>
    nacl.sign.detached(bytesToSign, sk);

  const { signer } = generateAddressWithSigners({ ed25519Pubkey, rawEd25519Signer });

  const algorand = AlgorandClient.testNet();
  algorand.account.setSigner(address, signer);
  await algorand.send.assetOptIn({ sender: address, assetId: BigInt(USDC_ASSET_ID) });
}

export async function fetchWalletBalance(address: string): Promise<WalletBalance> {
  try {
    const algorand = AlgorandClient.testNet();
    const info = await algorand.account.getInformation(address);
    const usdcAsset = info.assets?.find(a => a.assetId === BigInt(USDC_ASSET_ID));
    return {
      algo: Number(info.balance.microAlgos) / 1e6,
      usdc: usdcAsset ? Number(usdcAsset.amount) / 1e6 : 0,
      usdcOptedIn: !!usdcAsset,
      accountExists: true,
    };
  } catch {
    // 404 = account not yet funded; network errors return safe zero state
    return { algo: 0, usdc: 0, usdcOptedIn: false, accountExists: false };
  }
}

function buildWeb3Auth(skipSession = false) {
  const chainConfig = {
    chainNamespace: CHAIN_NAMESPACES.OTHER,
    chainId: 'algorand:testnet',
    displayName: 'Algorand Testnet',
    ticker: 'ALGO',
    tickerName: 'Algorand',
    rpcTarget: 'https://testnet-api.algonode.cloud',
    logo: '',
    blockExplorerUrl: 'https://lora.algokit.io/testnet',
  };
  const privateKeyProvider = new CommonPrivateKeyProvider({
    config: { chain: chainConfig, chains: [chainConfig] },
  });
  // Restore persisted session from localStorage. Web3Auth stores its session under
  // "Web3Auth-state" — if initialState is passed, it bypasses localStorage entirely,
  // so we read it ourselves and spread it. We only override currentChainId to keep
  // Algorand as the active chain (prevents the null wsEmbedInstance crash on EIP155).
  let storedState: Record<string, unknown> = {};
  if (!skipSession) {
    try {
      const raw = localStorage.getItem('Web3Auth-state');
      if (raw) storedState = JSON.parse(raw) as Record<string, unknown>;
    } catch { /* ignore parse errors */ }
  }

  return new Web3Auth(
    {
      clientId: import.meta.env.VITE_WEB3AUTH_CLIENT_ID as string,
      web3AuthNetwork: WEB3AUTH_NETWORK.SAPPHIRE_DEVNET,
      privateKeyProvider,
      chains: [chainConfig],
    },
    {
      cachedConnector: null,
      connectedConnectorName: null,
      idToken: null,
      ...storedState,
      currentChainId: 'algorand:testnet',
    },
  );
}

export function useWeb3Auth() {
  const instanceRef = useRef<Web3Auth | null>(null);
  const [status, setStatus] = useState<Web3AuthStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [provider, setProvider] = useState<IProvider | null>(null);

  useEffect(() => {
    if (instanceRef.current) return;
    const w3a = buildWeb3Auth();
    instanceRef.current = w3a;
    setStatus('initializing');

    // Web3Auth's init() resolves before connector setup completes — the CONNECTORS_UPDATED
    // handler that calls setupConnector() is async and fires after init() returns. Session
    // restore (auto-connect) therefore completes via events, not within init()'s promise.
    // Listen for "connected"/"rehydration_error" BEFORE calling init() to avoid missing them.
    const onConnected = () => {
      if (w3a.provider) {
        setProvider(w3a.provider);
        setStatus('connected');
      }
    };
    const onRehydrationError = () => {
      setProvider(null);
      setStatus('ready');
    };
    w3a.on('connected', onConnected);
    w3a.on('rehydration_error', onRehydrationError);

    w3a.init()
      .then(() => {
        // If no cached connector, there is no session to restore — go straight to ready.
        // If cachedConnector is set, the connector setup is still in progress; the event
        // listeners above will fire when it completes (or fails).
        if (!w3a.cachedConnector) {
          setStatus('ready');
        }
      })
      .catch(() => {
        // init() can throw when auto-reconnect crashes (e.g., wsEmbedInstance is null for
        // non-EVM chains when the project config includes EVM chains). Fall back silently:
        // rebuild a fresh instance without a cached connector so connect() works normally.
        w3a.off('connected', onConnected);
        w3a.off('rehydration_error', onRehydrationError);
        const fresh = buildWeb3Auth(true /* skipSession — no auto-connect */);
        instanceRef.current = fresh;
        fresh.init().catch(() => {}); // best-effort; connect() checks ready state
        setStatus('ready');
      });

    // Fallback: if session restore takes more than 10 s, give up and show connect button.
    const timeout = setTimeout(() => {
      setStatus(s => (s === 'initializing' ? 'ready' : s));
    }, 10_000);

    return () => {
      clearTimeout(timeout);
      w3a.off('connected', onConnected);
      w3a.off('rehydration_error', onRehydrationError);
    };
  }, []);

  const connect = async () => {
    const w3a = instanceRef.current;
    if (!w3a) return;
    setStatus('connecting');
    setError(null);
    try {
      const prov = await w3a.connect();
      if (prov) {
        setProvider(prov);
        setStatus('connected');
      } else {
        setStatus('ready');
      }
    } catch (e) {
      setError((e as Error).message ?? 'Connection failed');
      setStatus('ready');
    }
  };

  const disconnect = async () => {
    const w3a = instanceRef.current;
    if (!w3a) return;
    await w3a.logout();
    setProvider(null);
    setStatus('ready');
  };

  const getAccount = async (): Promise<AlgorandAccount | null> => {
    if (!provider) return null;
    try {
      const privateKeyHex = await provider.request({ method: 'private_key' }) as string;
      const seed = new Uint8Array(Buffer.from(privateKeyHex, 'hex')).subarray(0, 32);
      const { secretKey, publicKey } = nacl.sign.keyPair.fromSeed(seed);
      return {
        address: algosdk.encodeAddress(publicKey),
        privateKeyBase64: Buffer.from(secretKey).toString('base64'),
      };
    } catch {
      return null;
    }
  };

  return {
    status,
    isConnected: status === 'connected',
    provider,
    error,
    getAccount,
    connect,
    disconnect,
  };
}
