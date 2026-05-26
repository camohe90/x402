// =============================================================================
// App.tsx — state management and layout for the x402 Algorand template
//
// TO ADAPT THIS TO YOUR OWN SELLER:
//   1. seller/src/index.ts     — swap routes, price, and handler (CHANGE 1–3)
//   2. hooks/useBuyer.ts       — update Endpoint type and response types (CHANGE 1–3)
//   3. components/ResultCard   — auto-renders any JSON shape; replace if you want
//      a custom layout for your specific response.
//
// Everything else (event log, purchase history, protocol flow, spending chart)
// works with any endpoint and does not need to change.
// =============================================================================

import { useCallback, useEffect, useRef, useState } from 'react';
import { useWeb3Auth, fetchWalletBalance, optInToUSDC } from './hooks/useWeb3Auth';
import type { WalletBalance } from './hooks/useWeb3Auth';
import { useBuyer, checkSellerHealth } from './hooks/useBuyer';
import type { BuyEvent, Endpoint, SellerHealth } from './hooks/useBuyer';
import { STEPS, GITHUB_URL } from './constants';
import type { StepId } from './constants';
import { endpointIcon, fmtTime } from './utils/format';
import { Logo } from './components/Logo';
import { Skeleton, InitSkeleton } from './components/Skeleton';
import { ConnectButton } from './components/ConnectButton';
import { OnboardingStepper } from './components/OnboardingStepper';
import { ProtocolFlow } from './components/FlowSteps';
import { EventLog } from './components/EventLog';
import { ResultCard } from './components/ResultCard';
import { PurchaseHistory } from './components/PurchaseHistory';
import { BuildOnThis } from './components/BuildOnThis';

function Badge({ text, color = 'var(--primary)' }: { text: string; color?: string }) {
  return (
    <span className="nav-badge" style={{ display:'inline-block', padding:'2px 10px', borderRadius:20, fontSize:12, fontWeight:600, letterSpacing:'0.05em', color, background: color === 'var(--primary)' ? 'var(--primary-dim)' : 'var(--secondary-dim)', border:`1px solid ${color}33` }}>
      {text}
    </span>
  );
}

export default function App() {
  const { status: authStatus, isConnected, error: authError, connect, disconnect, getAccount, getMnemonic } = useWeb3Auth();
  const { events, purchases, result, lastEndpoint, loading, error: buyError, buy } = useBuyer();
  const [address, setAddress]       = useState<string | null>(null);
  const [balance, setBalance]       = useState<WalletBalance | null>(null);
  const [optingIn, setOptingIn]     = useState(false);
  const [heroCopied, setHeroCopied] = useState(false);
  const [celebrate, setCelebrate]   = useState(false);
  const [elapsed, setElapsed]       = useState<number | null>(null);
  const [selectedEndpoint, setSelectedEndpoint] = useState<Endpoint>('weather');
  const [health, setHealth]         = useState<SellerHealth | null>(null);
  const [theme, setTheme]           = useState<'dark' | 'light'>(() =>
    (localStorage.getItem('x402-theme') as 'dark' | 'light') ?? 'dark'
  );
  const startTimeRef  = useRef<number | null>(null);
  const resultCardRef = useRef<HTMLDivElement>(null);

  // Apply theme to html element and persist
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('x402-theme', theme);
  }, [theme]);

  // Guard: never overwrite a valid balance with a network-error zero-state
  const guardedSetBalance = useCallback((newBal: WalletBalance) => {
    setBalance(prev => prev?.accountExists && !newBal.accountExists ? prev : newBal);
  }, []);

  // Load wallet on connect / restore session
  useEffect(() => {
    if (isConnected) {
      getAccount().then(acc => {
        const addr = acc?.address ?? null;
        setAddress(addr);
        if (addr) fetchWalletBalance(addr).then(guardedSetBalance);
      });
    } else {
      setAddress(null);
      setBalance(null);
    }
  }, [isConnected, getAccount, guardedSetBalance]);

  // Balance auto-poll every 10s when connected
  useEffect(() => {
    if (!isConnected || !address) return;
    const interval = setInterval(() => {
      fetchWalletBalance(address).then(guardedSetBalance);
    }, 10_000);
    return () => clearInterval(interval);
  }, [isConnected, address, guardedSetBalance]);

  // Auto opt-in to USDC when wallet has enough ALGO
  useEffect(() => {
    if (!balance || !address || balance.usdcOptedIn || !balance.accountExists || balance.algo < 0.2 || optingIn) return;
    setOptingIn(true);
    getAccount().then(acc => {
      if (!acc) { setOptingIn(false); return; }
      optInToUSDC(acc.address, acc.privateKeyBase64)
        .then(() => fetchWalletBalance(address).then(guardedSetBalance))
        .catch(console.error)
        .finally(() => setOptingIn(false));
    });
  }, [balance, address, optingIn, getAccount, guardedSetBalance]);

  // Refresh balance after each purchase
  useEffect(() => {
    if (purchases.length === 0 || !address) return;
    const t = setTimeout(() => fetchWalletBalance(address).then(guardedSetBalance), 2500);
    return () => clearTimeout(t);
  }, [purchases.length, address, guardedSetBalance]);

  // Celebration on new data
  useEffect(() => {
    if (!result) return;
    setCelebrate(true);
    const t = setTimeout(() => setCelebrate(false), 2500);
    return () => clearTimeout(t);
  }, [result]);

  // Total purchase timer
  useEffect(() => {
    if (loading) {
      startTimeRef.current = Date.now();
      setElapsed(null);
    } else if (startTimeRef.current !== null) {
      setElapsed(Date.now() - startTimeRef.current);
      startTimeRef.current = null;
    }
  }, [loading]);

  // Seller health check on mount
  useEffect(() => {
    checkSellerHealth().then(setHealth);
  }, []);

  const doneSteps     = new Set<StepId>(events.map(e => e.type as StepId).filter(t => STEPS.some(s => s.id === t)));
  const lastEventType = events.at(-1)?.type as StepId | undefined;
  const activeStep    = loading ? lastEventType ?? null : null;
  const lastTxid      = [...purchases].at(-1)?.txid;
  const hasResult     = result !== null;

  const endpointPrice: Record<string, string> = health?.prices ?? { weather: '$0.001', forecast: '$0.005' };

  const walletHint = balance === null ? undefined
    : !balance.accountExists       ? 'Wallet not funded — get testnet ALGO'
    : balance.algo < 0.2           ? 'Need at least 0.2 ALGO to auto opt-in to USDC'
    : !balance.usdcOptedIn         ? (optingIn ? 'Opting in to USDC…' : 'Opt in to USDC then fund with testnet USDC')
    : balance.usdc < 0.001         ? 'Insufficient USDC balance'
    : undefined;

  const handleBuy = useCallback(async () => {
    const account = await getAccount();
    if (account) buy(account, selectedEndpoint);
  }, [getAccount, buy, selectedEndpoint]);

  const handleRefreshBalance = useCallback(() => {
    if (address) fetchWalletBalance(address).then(guardedSetBalance);
  }, [address, guardedSetBalance]);

  const buyDisabled = optingIn || (balance !== null && balance.usdc < 0.001);

  return (
    <div style={{ minHeight:'100vh', display:'flex', flexDirection:'column' }}>

      {/* Seller offline banner */}
      {health?.online === false && (
        <div style={{ background:'rgba(251,191,36,0.1)', borderBottom:'1px solid var(--warning)44', padding:'8px 40px', fontSize:12, color:'var(--warning)', textAlign:'center' }}>
          Seller API unreachable — purchases will fail. Check <code style={{ fontFamily:'var(--mono)' }}>VITE_SELLER_URL</code>.
        </div>
      )}

      {/* Nav */}
      <nav className="nav" style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'16px 40px', borderBottom:'1px solid var(--border)', position:'sticky', top:0, zIndex:10, background:'var(--nav-bg)', backdropFilter:'blur(12px)', gap:12, flexWrap:'wrap' }}>
        <Logo />
        <div style={{ display:'flex', alignItems:'center', gap:10, flexWrap:'wrap' }}>
          <Badge text="Testnet" color="var(--warning)" />
          <Badge text="x402 v2" />
          <a href={GITHUB_URL} target="_blank" rel="noreferrer" className="nav-badge"
            style={{ display:'inline-flex', alignItems:'center', gap:5, padding:'4px 12px', borderRadius:20, fontSize:12, fontWeight:600, color:'var(--text-dim)', background:'var(--card)', border:'1px solid var(--border)', textDecoration:'none' }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"/></svg>
            GitHub
          </a>
          <button onClick={() => setTheme(t => t === 'dark' ? 'light' : 'dark')}
            title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            style={{ padding:'6px 10px', fontSize:14, borderRadius:20, border:'1px solid var(--border)', background:'var(--card)', color:'var(--text-dim)', cursor:'pointer', lineHeight:1 }}>
            {theme === 'dark' ? '☀️' : '🌙'}
          </button>
          <ConnectButton status={authStatus} onConnect={connect} onDisconnect={disconnect}
            address={address ?? undefined} walletHint={walletHint} balance={balance}
            getMnemonic={getMnemonic} onRefreshBalance={handleRefreshBalance} />
        </div>
      </nav>

      {/* Hero */}
      <section className="hero-section" style={{ textAlign:'center', padding:'80px 40px 60px', maxWidth:760, margin:'0 auto', width:'100%', boxSizing:'border-box' }}>
        <h1 style={{ fontSize:'clamp(28px,6vw,64px)', fontWeight:700, lineHeight:1.1, letterSpacing:'-0.03em', marginBottom:20 }}>
          Monetize Any API{' '}
          <span style={{ background:'linear-gradient(90deg,var(--primary),var(--secondary))', WebkitBackgroundClip:'text', WebkitTextFillColor:'transparent' }}>in Minutes</span>
        </h1>
        <p style={{ fontSize:'clamp(15px,2.5vw,18px)', color:'var(--text-dim)', lineHeight:1.7, maxWidth:540, margin:'0 auto 36px' }}>
          x402 turns any API into a pay-per-request service using HTTP 402. No subscriptions, no API keys — buyers connect their wallet and pay in USDC on Algorand.
        </p>

        {!isConnected ? (
          <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:12 }}>
            {authStatus === 'idle' || authStatus === 'initializing' ? <InitSkeleton /> : (
              <>
                <button onClick={connect} disabled={authStatus !== 'ready'}
                  style={{ padding:'14px 36px', fontSize:16, fontWeight:600, borderRadius:12, border:'none', background: authStatus === 'ready' ? 'linear-gradient(135deg,var(--primary),#00a88a)' : 'var(--border)', color: authStatus === 'ready' ? '#001a15' : 'var(--text-muted)', cursor: authStatus === 'ready' ? 'pointer' : 'not-allowed', boxShadow: authStatus === 'ready' ? '0 0 24px var(--primary-glow)' : 'none', letterSpacing:'-0.01em', transition:'all 0.2s' }}>
                  {authStatus === 'connecting' ? 'Connecting…' : 'Connect with Email to Buy'}
                </button>
                <p style={{ fontSize:13, color:'var(--text-muted)' }}>Powered by Web3Auth — no seed phrase needed</p>
              </>
            )}
          </div>
        ) : balance === null ? (
          <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:16 }}>
            <Skeleton width={280} height={44} radius={10} />
            <Skeleton width={220} height={52} radius={12} />
          </div>
        ) : (
          <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:16 }}>
            {/* Endpoint selector */}
            <div style={{ display:'flex', gap:8, padding:4, background:'var(--card)', border:'1px solid var(--border)', borderRadius:12, flexWrap:'wrap', justifyContent:'center' }}>
              {(['weather', 'forecast'] as Endpoint[]).map(ep => (
                <button key={ep} onClick={() => setSelectedEndpoint(ep)} style={{ padding:'8px 20px', fontSize:13, fontWeight:600, borderRadius:9, border:'none', background: selectedEndpoint === ep ? 'var(--primary)' : 'transparent', color: selectedEndpoint === ep ? '#001a15' : 'var(--text-muted)', cursor:'pointer', transition:'all 0.2s' }}>
                  {endpointIcon(ep)} {ep === 'weather' ? 'Weather' : 'Forecast'}
                  <span style={{ marginLeft:6, fontSize:11, opacity:0.8 }}>{endpointPrice[ep]}</span>
                </button>
              ))}
            </div>

            {/* Onboarding stepper or buy button */}
            {walletHint ? (
              <OnboardingStepper balance={balance} optingIn={optingIn} address={address} />
            ) : (
              <div style={{ display:'flex', alignItems:'center', gap:12, flexWrap:'wrap', justifyContent:'center' }}>
                <button onClick={handleBuy} disabled={loading || buyDisabled}
                  style={{ padding:'14px 36px', fontSize:16, fontWeight:600, borderRadius:12, border:'none', background: buyDisabled ? 'var(--border)' : 'linear-gradient(135deg,var(--primary),#00a88a)', color: buyDisabled ? 'var(--text-muted)' : '#001a15', cursor: (loading || buyDisabled) ? 'not-allowed' : 'pointer', boxShadow: buyDisabled ? 'none' : '0 0 24px var(--primary-glow)', letterSpacing:'-0.01em', transition:'background 0.15s, color 0.15s', display:'flex', alignItems:'center', gap:10 }}>
                  {loading && <span style={{ width:14, height:14, border:'2px solid currentColor', borderTopColor:'transparent', borderRadius:'50%', animation:'spin 0.7s linear infinite', opacity:0.8, flexShrink:0 }} />}
                  {loading ? 'Purchasing…' : optingIn ? 'Opting in to USDC…' : `Buy /${selectedEndpoint} — ${endpointPrice[selectedEndpoint] ?? ''}`}
                </button>
              </div>
            )}

            {/* Insufficient USDC inline */}
            {!walletHint && balance.usdc < 0.001 && balance.usdcOptedIn && (
              <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                <p style={{ fontSize:13, color:'var(--warning)', margin:0 }}>Insufficient USDC</p>
                {address && (
                  <div style={{ display:'flex', alignItems:'center', gap:6, padding:'4px 10px', background:'var(--card)', border:'1px solid var(--border)', borderRadius:8 }}>
                    <span style={{ fontFamily:'var(--mono)', fontSize:11, color:'var(--text-muted)' }}>{address.slice(0, 8)}…</span>
                    <button onClick={() => { navigator.clipboard.writeText(address); setHeroCopied(true); setTimeout(() => setHeroCopied(false), 1500); }}
                      style={{ fontSize:11, padding:'2px 8px', borderRadius:4, border:'1px solid var(--border)', background:'transparent', color: heroCopied ? 'var(--success)' : 'var(--text-muted)', cursor:'pointer' }}>
                      {heroCopied ? '✓' : 'Copy'}
                    </button>
                    <a href="https://faucet.circle.com/" target="_blank" rel="noreferrer" style={{ fontSize:11, color:'var(--primary)', textDecoration:'underline' }}>Get USDC ↗</a>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {(authError || buyError) && (
          <div style={{ marginTop:16, display:'flex', flexDirection:'column', alignItems:'center', gap:10 }}>
            <div style={{ padding:'10px 16px', background:'rgba(239,68,68,0.1)', border:'1px solid #ef444433', borderRadius:8, color:'var(--error)', fontSize:13, fontFamily:'var(--mono)' }}>
              {authError ?? buyError}
            </div>
            {buyError && (
              <button onClick={handleBuy} disabled={loading} style={{ padding:'8px 20px', fontSize:13, fontWeight:600, borderRadius:8, border:'1px solid var(--primary)55', background:'var(--primary-dim)', color:'var(--primary)', cursor:'pointer' }}>
                Retry
              </button>
            )}
          </div>
        )}
      </section>

      {/* Protocol Flow */}
      <ProtocolFlow activeStep={activeStep} doneSteps={doneSteps} elapsed={elapsed} loading={loading} />

      {/* Demo Panel */}
      <section className="content-section" style={{ maxWidth:900, margin:'0 auto', width:'100%', padding:'0 40px 48px', boxSizing:'border-box' }}>
        <div className={hasResult ? 'demo-grid-split' : 'demo-grid-full'} style={{ gap:16, minHeight:240 }}>
          <EventLog events={events} elapsed={elapsed} />
          {result && lastEndpoint && (
            <div ref={resultCardRef}>
              <ResultCard endpoint={lastEndpoint} data={result} celebrate={celebrate} txid={lastTxid} />
            </div>
          )}
        </div>
      </section>

      {/* Purchase History */}
      <PurchaseHistory purchases={purchases} prices={endpointPrice} />

      {/* How it works */}
      <section className="content-section" style={{ maxWidth:900, margin:'0 auto', width:'100%', padding:'0 40px 80px', boxSizing:'border-box' }}>
        <div style={{ fontSize:11, fontWeight:600, letterSpacing:'0.1em', textTransform:'uppercase', color:'var(--text-muted)', marginBottom:24, textAlign:'center' }}>How it works</div>
        <div className="how-grid">
          {[
            { icon:'🔐', title:'1. Connect',            body:'Sign in with your email via Web3Auth. A non-custodial Algorand wallet is derived from your credentials — no seed phrase.' },
            { icon:'📡', title:'2. Request',            body:'Buyer sends a plain GET /weather or /forecast. No auth header, no API key required.' },
            { icon:'🔴', title:'3. 402 + Requirements', body:'Seller returns HTTP 402 with USDC amount, Algorand address, and facilitator URL.' },
            { icon:'✍️', title:'4. Sign & Retry',      body:'Buyer signs an Algorand USDC transaction and retries with the proof in the header.' },
            { icon:'⛓️', title:'5. Settlement',         body:'Goplausible facilitator verifies the transaction is on-chain before the seller responds.' },
            { icon:'✅', title:'6. Data delivered',     body:'Seller sends real data — weather conditions or a 7-day forecast. One request = one payment.' },
          ].map(item => (
            <div key={item.title}
              style={{ background:'var(--card)', border:'1px solid var(--border)', borderRadius:12, padding:20, transition:'border-color 0.2s, transform 0.2s', cursor:'default' }}
              onMouseEnter={e => { e.currentTarget.style.borderColor='var(--primary)55'; e.currentTarget.style.transform='translateY(-2px)'; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor='var(--border)'; e.currentTarget.style.transform='translateY(0)'; }}>
              <div style={{ fontSize:24, marginBottom:10 }}>{item.icon}</div>
              <div style={{ fontWeight:600, marginBottom:6, fontSize:14 }}>{item.title}</div>
              <div style={{ color:'var(--text-muted)', fontSize:13, lineHeight:1.6 }}>{item.body}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Build on this */}
      <BuildOnThis health={health} />

      {/* Footer */}
      <footer style={{ borderTop:'1px solid var(--border)', fontSize:12 }}>
        <div style={{ maxWidth:900, margin:'0 auto', padding:'20px 40px', display:'flex', justifyContent:'space-between', alignItems:'center', flexWrap:'wrap', gap:12, color:'var(--text-muted)' }}>
          <Logo />
          <div style={{ display:'flex', gap:20, alignItems:'center', flexWrap:'wrap' }}>
            {([
              { label:'Faucet',   href:'https://bank.testnet.algorand.network', icon:<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2C6 2 2 7 2 12s4 10 10 10 10-4.5 10-10S18 2 12 2z"/><path d="M12 6v6l4 2"/></svg> },
              { label:'Explorer', href:'https://lora.algokit.io/testnet',          icon:<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg> },
              { label:'GitHub',   href:GITHUB_URL,                                  icon:<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"/></svg> },
            ] as const).map(({ label, href, icon }) => (
              <a key={label} href={href} target="_blank" rel="noreferrer"
                style={{ display:'flex', alignItems:'center', gap:5, color:'var(--text-muted)', textDecoration:'none', transition:'color 0.2s' }}
                onMouseEnter={e => (e.currentTarget.style.color = 'var(--text-dim)')}
                onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-muted)')}>
                {icon}{label}
              </a>
            ))}
          </div>
          <span style={{ fontSize:11, opacity:0.6 }}>MIT · x402 v2 · Algorand Testnet</span>
        </div>
      </footer>

      <style>{`
        @keyframes pulse     { 0%,100%{opacity:1;transform:scale(1)}   50%{opacity:0.7;transform:scale(0.95)} }
        @keyframes spin      { to { transform: rotate(360deg); } }
        @keyframes fadeIn    { from{opacity:0;transform:translateY(4px)} to{opacity:1;transform:translateY(0)} }
        @keyframes popIn     { from{opacity:0;transform:scale(0.97) translateY(-4px)} to{opacity:1;transform:scale(1) translateY(0)} }
        @keyframes stepDone  { 0%{transform:scale(1)} 40%{transform:scale(1.15)} 100%{transform:scale(1)} }
        @keyframes flowRight { 0%{background-position:0% 50%} 100%{background-position:200% 50%} }
        @keyframes celebrate { 0%{transform:scale(0.96);opacity:0.8} 50%{transform:scale(1.02)} 100%{transform:scale(1);opacity:1} }
        @keyframes shimmer   { 0%{background-position:-400px 0} 100%{background-position:400px 0} }

        .skeleton {
          background: linear-gradient(90deg, var(--card) 25%, var(--border) 50%, var(--card) 75%);
          background-size: 400px 100%;
          animation: shimmer 1.4s ease infinite;
        }

        .demo-grid-split { display: grid; grid-template-columns: 1fr 320px; }
        .demo-grid-full  { display: grid; grid-template-columns: 1fr; }
        .purchase-grid   { display: grid; grid-template-columns: 100px 120px 1fr 1fr 100px; }
        .how-grid        { display: grid; grid-template-columns: repeat(3,1fr); gap: 16px; }
        .ideas-grid      { display: grid; grid-template-columns: repeat(3,1fr); gap: 12px; }

        @media (max-width: 700px) {
          .nav { padding: 10px 16px !important; gap: 8px !important; }
          .nav-badge { display: none; }
          .hero-section { padding: 40px 20px 32px !important; }
          .content-section { padding-left: 16px !important; padding-right: 16px !important; }
          .demo-grid-split { grid-template-columns: 1fr !important; }
          .how-grid { grid-template-columns: 1fr 1fr !important; }
          .ideas-grid { grid-template-columns: 1fr 1fr !important; }
          .purchase-grid { grid-template-columns: 72px 90px 1fr !important; }
          .purchase-grid span:nth-child(4),
          .purchase-grid span:nth-child(5) { display: none; }
          .purchase-header span:nth-child(4),
          .purchase-header span:nth-child(5) { display: none; }
          .flow-steps { gap: 0; }
          .flow-steps > div { min-width: 72px; }
          footer > div { padding: 16px !important; flex-direction: column; align-items: flex-start !important; gap: 10px !important; }
        }

        @media (max-width: 420px) {
          .how-grid { grid-template-columns: 1fr !important; }
          .ideas-grid { grid-template-columns: 1fr !important; }
          .flow-steps > div { min-width: 56px; }
        }
      `}</style>
    </div>
  );
}
