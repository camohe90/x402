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

function buildWeb3Auth(includeStoredSession = true) {
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

  let storedState: Record<string, unknown> = {};
  if (includeStoredSession) {
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
      // Always force Algorand — prevents null wsEmbedInstance crash when the project
      // config adds EVM chains and EIP155 becomes chains[0].
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
    const w3a = buildWeb3Auth(true);
    instanceRef.current = w3a;
    setStatus('initializing');

    // Web3Auth's session restore for non-EVM chains fires an async internal crash
    // ("loginWithSessionId" on null wsEmbedInstance) AFTER init() has already resolved.
    // Suppress it here so it never surfaces as a console error or dev overlay.
    const suppressCrash = (e: PromiseRejectionEvent) => {
      if (String((e.reason as Error)?.message ?? '').includes('loginWithSessionId'))
        e.preventDefault();
    };
    window.addEventListener('unhandledrejection', suppressCrash);

    const onConnected = () => {
      if (w3a.provider) {
        setProvider(w3a.provider);
        setStatus('connected');
      }
    };

    // When session restore fails, the original instance is in a broken state — calling
    // connect() on it would throw the same error. Rebuild a clean instance first.
    const buildFresh = () => {
      w3a.off('connected', onConnected);
      w3a.off('rehydration_error', buildFresh);
      const fresh = buildWeb3Auth(false);
      instanceRef.current = fresh;
      fresh.init().catch(() => {}).finally(() => setStatus('ready'));
    };

    w3a.on('connected', onConnected);
    w3a.on('rehydration_error', buildFresh);

    w3a.init()
      .then(() => {
        // If no cachedConnector, no session to restore — ready immediately.
        // If cachedConnector is set, connector setup is async; 'connected' or
        // 'rehydration_error' will fire when it completes.
        if (!w3a.cachedConnector) setStatus('ready');
      })
      .catch(() => {
        // init() threw synchronously during session restore — fall back to a clean instance.
        buildFresh();
      });

    const timeout = setTimeout(() => {
      setStatus(s => (s === 'initializing' ? 'ready' : s));
    }, 10_000);

    return () => {
      clearTimeout(timeout);
      w3a.off('connected', onConnected);
      w3a.off('rehydration_error', buildFresh);
      window.removeEventListener('unhandledrejection', suppressCrash);
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
