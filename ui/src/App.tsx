import { useCallback, useEffect, useState } from 'react';
import { useWeb3Auth, fetchWalletBalance, optInToUSDC } from './hooks/useWeb3Auth';
import type { WalletBalance } from './hooks/useWeb3Auth';
import { useBuyer } from './hooks/useBuyer';
import type { BuyEvent, Purchase, WeatherData } from './hooks/useBuyer';

// ── Step definitions ─────────────────────────────────────────────────────────

const STEPS = [
  { id: 'request_sent',         label: 'Request',  desc: 'Buyer → Seller',              color: 'primary'   },
  { id: 'payment_required',     label: '402',       desc: 'Seller → Buyer',              color: 'warning'   },
  { id: 'payment_signing',      label: 'Signing',  desc: 'Algorand USDC tx',             color: 'secondary' },
  { id: 'payment_sent',         label: 'Payment',  desc: 'Buyer → Facilitator → Seller', color: 'primary'   },
  { id: 'settlement_confirmed', label: 'Settled',  desc: 'On-chain confirmed',           color: 'success'   },
  { id: 'success',              label: 'Data',     desc: 'Seller → Buyer',              color: 'success'   },
] as const;

type StepId   = typeof STEPS[number]['id'];
type StepColor = typeof STEPS[number]['color'];

const EXPLORER_BASE = 'https://lora.algokit.io/testnet/transaction';

// ── Helpers ───────────────────────────────────────────────────────────────────

function stepColor(c: StepColor) {
  return c === 'warning' ? 'var(--warning)' : c === 'secondary' ? 'var(--secondary)' : c === 'success' ? 'var(--success)' : 'var(--primary)';
}
function stepDim(c: StepColor) {
  return c === 'warning' ? 'var(--warning-dim)' : c === 'secondary' ? 'var(--secondary-dim)' : c === 'success' ? 'var(--success-dim)' : 'var(--primary-dim)';
}
function eventColor(type: string) {
  if (type === 'payment_required' || type === 'error') return 'var(--warning)';
  if (type === 'payment_signing' || type === 'payment_sent') return 'var(--secondary)';
  if (type === 'settlement_confirmed' || type === 'success') return 'var(--success)';
  return 'var(--primary)';
}
function eventLabel(e: BuyEvent) {
  switch (e.type) {
    case 'request_sent':        return 'GET /weather → seller (no payment)';
    case 'payment_required':    return `402 received — ${Number(e.amount ?? 0) / 1e6} USDC required`;
    case 'payment_signing':     return 'Signing Algorand USDC transaction…';
    case 'payment_sent':        return 'Retrying with payment proof in header';
    case 'settlement_confirmed':return e.txid ? `Settled — tx: ${e.txid.slice(0, 12)}…` : 'Facilitator confirmed on-chain settlement';
    case 'success':             return `Weather data delivered — ${e.data?.city}, ${e.data?.temperature}°F`;
    case 'error':               return `Error: ${e.message}`;
  }
}
function stepIcon(id: StepId) {
  const m: Record<StepId, string> = { request_sent:'📡', payment_required:'🔴', payment_signing:'✍️', payment_sent:'💸', settlement_confirmed:'⛓️', success:'✅' };
  return m[id];
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Logo() {
  return (
    <div style={{ display:'flex', alignItems:'center', gap:10 }}>
      <div style={{ width:32, height:32, borderRadius:8, background:'linear-gradient(135deg,var(--primary),var(--secondary))', display:'flex', alignItems:'center', justifyContent:'center', fontSize:14, fontWeight:700, color:'#fff' }}>x</div>
      <span style={{ fontWeight:700, fontSize:18, letterSpacing:'-0.02em' }}>
        x402 <span style={{ color:'var(--text-muted)', fontWeight:400 }}>×</span>{' '}
        <span style={{ color:'var(--primary)' }}>Algorand</span>
      </span>
    </div>
  );
}

function Badge({ text, color='var(--primary)' }: { text:string; color?:string }) {
  return (
    <span style={{ display:'inline-block', padding:'2px 10px', borderRadius:20, fontSize:12, fontWeight:600, letterSpacing:'0.05em', color, background: color === 'var(--primary)' ? 'var(--primary-dim)' : 'var(--secondary-dim)', border:`1px solid ${color}33` }}>
      {text}
    </span>
  );
}

function ConnectButton({ status, onConnect, onDisconnect, address, walletHint, balance }: {
  status: string;
  onConnect: () => void;
  onDisconnect: () => void;
  address?: string;
  walletHint?: string;
  balance?: WalletBalance | null;
}) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const copyAddress = () => {
    if (!address) return;
    navigator.clipboard.writeText(address).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  if (status === 'connected' && address) {
    return (
      <div style={{ position:'relative' }}>
        <button
          onClick={() => setOpen(o => !o)}
          style={{ display:'flex', alignItems:'center', gap:8, padding:'6px 12px', background:'var(--success-dim)', border:'1px solid var(--success)44', borderRadius:20, cursor:'pointer', outline:'none' }}
        >
          <span style={{ width:8, height:8, borderRadius:'50%', background:'var(--success)', display:'inline-block', boxShadow:'0 0 6px var(--success)' }} />
          <span style={{ fontFamily:'var(--mono)', fontSize:12, color:'var(--success)' }}>
            {address.slice(0,6)}…{address.slice(-4)}
          </span>
          <span style={{ fontSize:10, color:'var(--success)', opacity:0.7, marginLeft:2 }}>{open ? '▲' : '▼'}</span>
        </button>

        {open && (
          <>
            <div onClick={() => setOpen(false)} style={{ position:'fixed', inset:0, zIndex:99 }} />
            <div style={{ position:'absolute', right:0, top:'calc(100% + 8px)', zIndex:100, width:300, background:'var(--card)', border:'1px solid var(--border)', borderRadius:16, boxShadow:'0 8px 32px rgba(0,0,0,0.4)', overflow:'hidden' }}>
              <div style={{ padding:'14px 16px', borderBottom:'1px solid var(--border)' }}>
                <div style={{ fontSize:10, fontWeight:600, letterSpacing:'0.08em', textTransform:'uppercase', color:'var(--text-muted)', marginBottom:6 }}>Wallet Address</div>
                <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                  <span style={{ fontFamily:'var(--mono)', fontSize:11, color:'var(--text-dim)', wordBreak:'break-all', flex:1, lineHeight:1.5 }}>{address}</span>
                  <button onClick={copyAddress} style={{ flexShrink:0, padding:'4px 10px', fontSize:11, borderRadius:6, border:'1px solid var(--border)', background:'transparent', color: copied ? 'var(--success)' : 'var(--text-muted)', cursor:'pointer', whiteSpace:'nowrap' }}>
                    {copied ? '✓ Copied' : 'Copy'}
                  </button>
                </div>
              </div>

              <div style={{ padding:'14px 16px', borderBottom:'1px solid var(--border)' }}>
                <div style={{ fontSize:10, fontWeight:600, letterSpacing:'0.08em', textTransform:'uppercase', color:'var(--text-muted)', marginBottom:10 }}>Balances</div>
                <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
                  <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                    <span style={{ fontSize:13, color:'var(--text-muted)' }}>ALGO</span>
                    <span style={{ fontFamily:'var(--mono)', fontSize:13, fontWeight:600, color:'var(--text-dim)' }}>
                      {balance ? balance.algo.toFixed(4) : '—'}
                    </span>
                  </div>
                  <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                    <span style={{ fontSize:13, color:'var(--text-muted)' }}>USDC</span>
                    <span style={{ fontFamily:'var(--mono)', fontSize:13, fontWeight:600, color: balance?.usdc && balance.usdc >= 0.001 ? 'var(--success)' : 'var(--warning)' }}>
                      {balance ? (balance.usdcOptedIn ? balance.usdc.toFixed(4) : 'Not opted in') : '—'}
                    </span>
                  </div>
                </div>
                {walletHint && (
                  <div style={{ marginTop:10, padding:'8px 10px', background:'rgba(251,191,36,0.08)', border:'1px solid var(--warning)33', borderRadius:8, fontSize:11, color:'var(--warning)', lineHeight:1.5 }}>
                    {walletHint}
                  </div>
                )}
              </div>

              <div style={{ padding:'10px 16px' }}>
                <button onClick={() => { setOpen(false); onDisconnect(); }} style={{ width:'100%', padding:'8px', fontSize:13, borderRadius:8, border:'1px solid var(--border)', background:'transparent', color:'var(--text-muted)', cursor:'pointer' }}>
                  Disconnect
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    );
  }
  return (
    <button
      onClick={onConnect}
      disabled={status !== 'ready'}
      style={{ padding:'8px 18px', fontSize:13, fontWeight:600, borderRadius:10, border:'1px solid var(--primary)55', background:'var(--primary-dim)', color:'var(--primary)', cursor: status === 'ready' ? 'pointer' : 'not-allowed', opacity: status === 'ready' ? 1 : 0.5 }}
    >
      {status === 'idle' || status === 'initializing' ? 'Loading…' : status === 'connecting' ? 'Connecting…' : '🔐 Connect with Email'}
    </button>
  );
}

function FlowStep({ step, active, done }: { step: typeof STEPS[number]; active: boolean; done: boolean }) {
  const c = stepColor(step.color);
  const d = stepDim(step.color);
  const lit = active || done;
  return (
    <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:6, flex:1, minWidth:0 }}>
      <div style={{ width:44, height:44, borderRadius:12, border:`2px solid ${lit ? c : 'var(--border)'}`, background: lit ? d : 'var(--card)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:18, boxShadow: lit ? `0 0 8px ${c}55` : 'none', transition:'all 0.4s ease', animation: (active && step.id === 'payment_signing') ? 'pulse 1s ease-in-out infinite' : 'none' }}>
        {done && !active ? '✓' : stepIcon(step.id)}
      </div>
      <div style={{ textAlign:'center', color: lit ? c : 'var(--text-muted)', transition:'color 0.4s ease' }}>
        <div style={{ fontSize:12, fontWeight:600 }}>{step.label}</div>
        <div style={{ fontSize:10, opacity:0.7 }}>{step.desc}</div>
      </div>
    </div>
  );
}

function Connector({ active }: { active: boolean }) {
  return <div style={{ flex:0, width:24, height:2, marginTop:-22, alignSelf:'center', background: active ? 'var(--primary)' : 'var(--border)', boxShadow: active ? '0 0 6px var(--primary-glow)' : 'none', transition:'all 0.4s ease', borderRadius:1 }} />;
}

function WeatherCard({ data }: { data: WeatherData }) {
  const icons: Record<string, string> = { 'Partly Cloudy':'⛅', 'Foggy':'🌫️', 'Sunny':'☀️', 'Hot & Sunny':'🌞', 'Windy':'💨' };
  return (
    <div style={{ background:'var(--card)', border:'1px solid var(--success)', borderRadius:16, padding:24, boxShadow:'0 0 24px var(--success-dim)', animation:'fadeIn 0.5s ease' }}>
      <div style={{ fontSize:48, marginBottom:8, textAlign:'center' }}>{icons[data.condition] ?? '🌤️'}</div>
      <div style={{ textAlign:'center', marginBottom:16 }}>
        <div style={{ fontSize:22, fontWeight:700 }}>{data.city}</div>
        <div style={{ fontSize:36, fontWeight:300, color:'var(--primary)', lineHeight:1.1 }}>{data.temperature}°F</div>
        <div style={{ color:'var(--text-dim)', marginTop:4 }}>{data.condition}</div>
      </div>
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8, marginBottom:16 }}>
        {[['Humidity', `${data.humidity}%`], ['Network', 'Testnet']].map(([l,v]) => (
          <div key={l} style={{ background:'var(--bg)', borderRadius:8, padding:'8px 12px', textAlign:'center' }}>
            <div style={{ fontSize:10, color:'var(--text-muted)', marginBottom:2 }}>{l}</div>
            <div style={{ fontSize:14, fontWeight:600 }}>{v}</div>
          </div>
        ))}
      </div>
      <div style={{ background:'var(--success-dim)', border:'1px solid var(--success)33', borderRadius:8, padding:'8px 12px', fontSize:11, fontFamily:'var(--mono)', color:'var(--success)', textAlign:'center' }}>{data.paidVia}</div>
      <div style={{ fontSize:11, color:'var(--text-muted)', textAlign:'center', marginTop:8 }}>{new Date(data.timestamp).toLocaleTimeString()}</div>
    </div>
  );
}

function EventLog({ events }: { events: BuyEvent[] }) {
  return (
    <div style={{ background:'var(--card)', border:'1px solid var(--border)', borderRadius:16, overflow:'hidden', fontFamily:'var(--mono)', fontSize:12, height:'100%', display:'flex', flexDirection:'column' }}>
      <div style={{ padding:'10px 16px', borderBottom:'1px solid var(--border)', fontSize:11, fontFamily:'var(--sans)', fontWeight:600, color:'var(--text-muted)', letterSpacing:'0.08em', textTransform:'uppercase', display:'flex', alignItems:'center', gap:8 }}>
        <span style={{ width:8, height:8, borderRadius:'50%', background: events.length > 0 ? 'var(--success)' : 'var(--text-muted)', display:'inline-block', boxShadow: events.length > 0 ? '0 0 6px var(--success)' : 'none' }} />
        Event Log
      </div>
      <div style={{ flex:1, overflowY:'auto', padding:'12px 0' }}>
        {events.length === 0
          ? <div style={{ padding:'24px 16px', color:'var(--text-muted)', fontFamily:'var(--sans)', textAlign:'center', fontSize:13 }}>Waiting for purchase…</div>
          : events.map((e, i) => (
            <div key={i} style={{ padding:'6px 16px', display:'flex', gap:10, alignItems:'flex-start', animation:'fadeIn 0.3s ease', borderLeft:`2px solid ${eventColor(e.type)}`, marginLeft:12, marginBottom:4 }}>
              <span style={{ color:'var(--text-muted)', flexShrink:0, fontSize:10, marginTop:1 }}>{String(i+1).padStart(2,'0')}</span>
              <span style={{ color: eventColor(e.type), lineHeight:1.5 }}>{eventLabel(e)}</span>
            </div>
          ))
        }
      </div>
    </div>
  );
}

function PurchaseHistory({ purchases }: { purchases: Purchase[] }) {
  if (purchases.length === 0) return null;
  return (
    <section style={{ maxWidth:900, margin:'0 auto', width:'100%', padding:'0 40px 80px' }}>
      <div style={{ fontSize:11, fontWeight:600, letterSpacing:'0.1em', textTransform:'uppercase', color:'var(--text-muted)', marginBottom:20 }}>Purchase History</div>
      <div style={{ background:'var(--card)', border:'1px solid var(--border)', borderRadius:16, overflow:'hidden' }}>
        <div style={{ display:'grid', gridTemplateColumns:'140px 1fr 80px 1fr 140px', padding:'10px 20px', borderBottom:'1px solid var(--border)', fontSize:11, fontWeight:600, letterSpacing:'0.07em', textTransform:'uppercase', color:'var(--text-muted)' }}>
          {['Time','City','Temp','Transaction ID','Explorer'].map((h,i) => <span key={h} style={{ textAlign: i===4 ? 'right' : 'left' }}>{h}</span>)}
        </div>
        {[...purchases].reverse().map((p, i) => (
          <div key={i}
            style={{ display:'grid', gridTemplateColumns:'140px 1fr 80px 1fr 140px', padding:'12px 20px', borderBottom: i < purchases.length-1 ? '1px solid var(--border)' : 'none', alignItems:'center', fontSize:13, animation:'fadeIn 0.4s ease' }}
            onMouseEnter={e => (e.currentTarget.style.background='var(--card-hover)')}
            onMouseLeave={e => (e.currentTarget.style.background='transparent')}
          >
            <span style={{ color:'var(--text-muted)', fontFamily:'var(--mono)', fontSize:11 }}>{new Date(p.purchasedAt).toLocaleTimeString()}</span>
            <span style={{ fontWeight:500 }}>{p.weather.city} <span style={{ color:'var(--text-muted)', fontSize:12 }}>{p.weather.condition}</span></span>
            <span style={{ color:'var(--primary)', fontWeight:600 }}>{p.weather.temperature}°F</span>
            <span style={{ fontFamily:'var(--mono)', fontSize:11, color: p.txid ? 'var(--text-dim)' : 'var(--text-muted)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', paddingRight:16 }}>
              {p.txid ?? '—'}
            </span>
            <span style={{ textAlign:'right' }}>
              {p.txid
                ? <a href={`${EXPLORER_BASE}/${p.txid}`} target="_blank" rel="noreferrer"
                    style={{ display:'inline-flex', alignItems:'center', gap:4, padding:'4px 12px', background:'var(--primary-dim)', border:'1px solid var(--primary)44', borderRadius:6, color:'var(--primary)', textDecoration:'none', fontSize:12, fontWeight:600 }}
                    onMouseEnter={e => { e.currentTarget.style.background='var(--primary)'; e.currentTarget.style.color='#001a15'; }}
                    onMouseLeave={e => { e.currentTarget.style.background='var(--primary-dim)'; e.currentTarget.style.color='var(--primary)'; }}
                  >View ↗</a>
                : <span style={{ color:'var(--text-muted)', fontSize:12 }}>pending</span>
              }
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

function FeaturePill({ icon, text }: { icon:string; text:string }) {
  return (
    <div style={{ display:'flex', alignItems:'center', gap:8, padding:'8px 14px', background:'var(--card)', border:'1px solid var(--border)', borderRadius:24, fontSize:13, color:'var(--text-dim)' }}>
      <span>{icon}</span><span>{text}</span>
    </div>
  );
}

// ── Main App ──────────────────────────────────────────────────────────────────

export default function App() {
  const { status: authStatus, isConnected, error: authError, connect, disconnect, getAccount } = useWeb3Auth();
  const { events, purchases, weather, loading, error: buyError, buy } = useBuyer();
  const [address, setAddress] = useState<string | null>(null);
  const [balance, setBalance] = useState<WalletBalance | null>(null);
  const [optingIn, setOptingIn] = useState(false);

  useEffect(() => {
    if (isConnected) {
      getAccount().then(acc => {
        const addr = acc?.address ?? null;
        setAddress(addr);
        if (addr) fetchWalletBalance(addr).then(setBalance);
      });
    } else {
      setAddress(null);
      setBalance(null);
    }
  }, [isConnected, getAccount]);

  useEffect(() => {
    if (!balance || !address || balance.usdcOptedIn || !balance.accountExists || balance.algo < 0.2 || optingIn) return;
    setOptingIn(true);
    getAccount().then(acc => {
      if (!acc) { setOptingIn(false); return; }
      optInToUSDC(acc.address, acc.privateKeyBase64)
        .then(() => fetchWalletBalance(address).then(setBalance))
        .catch(console.error)
        .finally(() => setOptingIn(false));
    });
  }, [balance, address, optingIn, getAccount]);

  const doneSteps = new Set<StepId>(events.map(e => e.type as StepId).filter(t => STEPS.some(s => s.id === t)));
  const lastEventType = events.at(-1)?.type as StepId | undefined;
  const activeStep = loading ? lastEventType ?? null : null;

  const walletHint = balance === null ? undefined
    : !balance.accountExists ? 'Wallet not funded — get testnet ALGO from bank.testnet.algorand.network'
    : !balance.usdcOptedIn ? 'Opt in to USDC (ASA 10458941) then fund with testnet USDC'
    : balance.usdc < 0.001 ? 'Insufficient USDC — need at least 0.001 USDC'
    : undefined;

  const handleBuy = useCallback(async () => {
    const account = await getAccount();
    if (account) buy(account);
  }, [getAccount, buy]);

  const connected = isConnected;

  return (
    <div style={{ minHeight:'100vh', display:'flex', flexDirection:'column' }}>

      {/* Nav */}
      <nav style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'20px 40px', borderBottom:'1px solid var(--border)', position:'sticky', top:0, zIndex:10, background:'rgba(6,9,15,0.85)', backdropFilter:'blur(12px)' }}>
        <Logo />
        <div style={{ display:'flex', alignItems:'center', gap:12 }}>
          <Badge text="Testnet" color="var(--warning)" />
          <Badge text="x402 v2" />
          <ConnectButton status={authStatus} onConnect={connect} onDisconnect={disconnect} address={address ?? undefined} walletHint={walletHint} balance={balance} />
        </div>
      </nav>

      {/* Hero */}
      <section style={{ textAlign:'center', padding:'80px 40px 60px', maxWidth:760, margin:'0 auto', width:'100%' }}>
        <div style={{ marginBottom:24, display:'flex', justifyContent:'center', gap:10, flexWrap:'wrap' }}>
          <FeaturePill icon="⚡" text="Instant micropayments" />
          <FeaturePill icon="🔑" text="No API keys" />
          <FeaturePill icon="🔗" text="Algorand USDC" />
        </div>

        <h1 style={{ fontSize:'clamp(32px,6vw,64px)', fontWeight:700, lineHeight:1.1, letterSpacing:'-0.03em', marginBottom:20 }}>
          Pay-per-Request APIs{' '}
          <span style={{ background:'linear-gradient(90deg,var(--primary),var(--secondary))', WebkitBackgroundClip:'text', WebkitTextFillColor:'transparent' }}>
            on Algorand
          </span>
        </h1>

        <p style={{ fontSize:18, color:'var(--text-dim)', lineHeight:1.7, maxWidth:540, margin:'0 auto 36px' }}>
          The x402 protocol lets APIs charge per-request using HTTP 402. No subscriptions, no accounts — just connect your wallet and pay in USDC.
        </p>

        {!connected ? (
          <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:12 }}>
            <button onClick={connect} disabled={authStatus !== 'ready'}
              style={{ padding:'14px 36px', fontSize:16, fontWeight:600, borderRadius:12, border:'none', background: authStatus === 'ready' ? 'linear-gradient(135deg,var(--primary),#00a88a)' : 'var(--border)', color: authStatus === 'ready' ? '#001a15' : 'var(--text-muted)', cursor: authStatus === 'ready' ? 'pointer' : 'not-allowed', boxShadow: authStatus === 'ready' ? '0 0 24px var(--primary-glow)' : 'none', letterSpacing:'-0.01em' }}>
              {authStatus === 'idle' || authStatus === 'initializing' ? '⏳  Loading…' : authStatus === 'connecting' ? '⏳  Connecting…' : '🔐  Connect with Email to Buy'}
            </button>
            <p style={{ fontSize:13, color:'var(--text-muted)' }}>Powered by Web3Auth — no seed phrase needed</p>
          </div>
        ) : (
          <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:12 }}>
            <button onClick={handleBuy} disabled={loading || (balance !== null && balance.usdc < 0.001)}
              style={{ padding:'14px 36px', fontSize:16, fontWeight:600, borderRadius:12, border:'none', background: (loading || (balance !== null && balance.usdc < 0.001)) ? 'var(--border)' : 'linear-gradient(135deg,var(--primary),#00a88a)', color: (loading || (balance !== null && balance.usdc < 0.001)) ? 'var(--text-muted)' : '#001a15', cursor: (loading || (balance !== null && balance.usdc < 0.001)) ? 'not-allowed' : 'pointer', boxShadow: (loading || (balance !== null && balance.usdc < 0.001)) ? 'none' : '0 0 24px var(--primary-glow)', letterSpacing:'-0.01em' }}>
              {loading ? '⏳  Purchasing…' : '⚡  Buy Weather Data — $0.001'}
            </button>

            {walletHint && (
              <p style={{ fontSize:13, color:'var(--warning)', margin:0 }}>Insufficient balance</p>
            )}
          </div>
        )}

        {(authError || buyError) && (
          <div style={{ marginTop:16, padding:'10px 16px', background:'rgba(239,68,68,0.1)', border:'1px solid #ef444433', borderRadius:8, color:'var(--error)', fontSize:13, fontFamily:'var(--mono)' }}>
            {authError ?? buyError}
          </div>
        )}
      </section>

      {/* Protocol Flow */}
      <section style={{ maxWidth:900, margin:'0 auto', width:'100%', padding:'0 40px 48px' }}>
        <div style={{ background:'var(--card)', border:'1px solid var(--border)', borderRadius:20, padding:'28px 32px' }}>
          <div style={{ fontSize:11, fontWeight:600, letterSpacing:'0.1em', textTransform:'uppercase', color:'var(--text-muted)', marginBottom:24 }}>Protocol Flow</div>
          <div style={{ display:'flex', alignItems:'flex-start', overflowX:'auto', paddingBottom:4 }}>
            {STEPS.map((step, i) => (
              <div key={step.id} style={{ display:'flex', alignItems:'flex-start', flex:1, minWidth:0 }}>
                <FlowStep step={step} active={activeStep === step.id} done={doneSteps.has(step.id)} />
                {i < STEPS.length-1 && <Connector active={doneSteps.has(step.id)} />}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Demo Panel */}
      <section style={{ maxWidth:900, margin:'0 auto', width:'100%', padding:'0 40px 48px' }}>
        <div style={{ display:'grid', gridTemplateColumns: weather ? '1fr 320px' : '1fr', gap:16, minHeight:240 }}>
          <EventLog events={events} />
          {weather && <WeatherCard data={weather} />}
        </div>
      </section>

      {/* Purchase History */}
      <PurchaseHistory purchases={purchases} />

      {/* How it works */}
      <section style={{ maxWidth:900, margin:'0 auto', width:'100%', padding:'0 40px 80px' }}>
        <div style={{ fontSize:11, fontWeight:600, letterSpacing:'0.1em', textTransform:'uppercase', color:'var(--text-muted)', marginBottom:24, textAlign:'center' }}>How it works</div>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:16 }}>
          {[
            { icon:'🔐', title:'1. Connect', body:'Sign in with your email via Web3Auth. A non-custodial Algorand wallet is derived from your credentials — no seed phrase.' },
            { icon:'📡', title:'2. Request', body:'Buyer sends a plain GET /weather. No auth header, no API key required.' },
            { icon:'🔴', title:'3. 402 + Requirements', body:'Seller returns HTTP 402 with USDC amount, Algorand address, and facilitator URL.' },
            { icon:'✍️', title:'4. Sign & Retry', body:'Buyer signs an Algorand USDC transaction and retries with the proof in the header.' },
            { icon:'⛓️', title:'5. Settlement', body:'Goplausible facilitator verifies the transaction is on-chain before the seller responds.' },
            { icon:'✅', title:'6. Data delivered', body:'Seller sends weather data. One request = one payment. No subscriptions.' },
          ].map(item => (
            <div key={item.title} style={{ background:'var(--card)', border:'1px solid var(--border)', borderRadius:12, padding:20 }}>
              <div style={{ fontSize:24, marginBottom:10 }}>{item.icon}</div>
              <div style={{ fontWeight:600, marginBottom:6, fontSize:14 }}>{item.title}</div>
              <div style={{ color:'var(--text-muted)', fontSize:13, lineHeight:1.6 }}>{item.body}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Footer */}
      <footer style={{ borderTop:'1px solid var(--border)', padding:'24px 40px', display:'flex', justifyContent:'space-between', alignItems:'center', flexWrap:'wrap', gap:12, color:'var(--text-muted)', fontSize:13 }}>
        <Logo />
        <div style={{ display:'flex', gap:20 }}>
          <span>x402 Protocol v2</span><span>·</span>
          <span>Algorand Testnet</span><span>·</span>
          <span>USDC ASA 10458941</span>
        </div>
      </footer>

      <style>{`
        @keyframes pulse { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:0.7;transform:scale(0.95)} }
        @keyframes fadeIn { from{opacity:0;transform:translateY(4px)} to{opacity:1;transform:translateY(0)} }
      `}</style>
    </div>
  );
}
