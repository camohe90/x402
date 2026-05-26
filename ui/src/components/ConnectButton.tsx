import { useState, useEffect, useRef } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import type { WalletBalance } from '../hooks/useWeb3Auth';

export function ConnectButton({ status, onConnect, onDisconnect, address, walletHint, balance, getMnemonic, onRefreshBalance }: {
  status: string;
  onConnect: () => void;
  onDisconnect: () => void;
  address?: string;
  walletHint?: string;
  balance?: WalletBalance | null;
  getMnemonic?: () => Promise<string | null>;
  onRefreshBalance?: () => void;
}) {
  const [open, setOpen]   = useState(false);
  const [copied, setCopied] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Mnemonic state — words never enter the DOM until revealMnemonic() resolves.
  // Everything wiped when the dropdown closes; nothing is ever persisted.
  const [mnemonicOpen, setMnemonicOpen]       = useState(false);
  const [mnemonic, setMnemonic]               = useState<string | null>(null);
  const [loadingMnemonic, setLoadingMnemonic] = useState(false);
  const [copiedMnemonic, setCopiedMnemonic]   = useState(false);

  useEffect(() => {
    if (!open) {
      setMnemonicOpen(false);
      setMnemonic(null);
      setCopiedMnemonic(false);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Called only when user explicitly taps "Tap to reveal" — words first enter the DOM here
  const revealMnemonic = async () => {
    if (!getMnemonic || loadingMnemonic) return;
    setLoadingMnemonic(true);
    const m = await getMnemonic();
    setMnemonic(m);
    setLoadingMnemonic(false);
  };

  const hideMnemonic = () => { setMnemonic(null); setMnemonicOpen(false); };

  const copyMnemonic = () => {
    if (!mnemonic) return;
    navigator.clipboard.writeText(mnemonic).then(() => {
      setCopiedMnemonic(true);
      setTimeout(() => setCopiedMnemonic(false), 2000);
    });
  };

  const copyAddress = () => {
    if (!address) return;
    navigator.clipboard.writeText(address).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); });
  };

  if (status === 'connected' && address) {
    return (
      <div ref={containerRef} style={{ position:'relative' }}>
        <button onClick={() => setOpen(o => !o)} style={{ display:'flex', alignItems:'center', gap:8, padding:'6px 12px', background:'var(--success-dim)', border:'1px solid var(--success)44', borderRadius:20, cursor:'pointer', outline:'none' }}>
          <span style={{ width:8, height:8, borderRadius:'50%', background:'var(--success)', display:'inline-block', boxShadow:'0 0 6px var(--success)' }} />
          <span style={{ fontFamily:'var(--mono)', fontSize:12, color:'var(--success)' }}>{address.slice(0, 6)}…{address.slice(-4)}</span>
          <span style={{ fontSize:10, color:'var(--success)', opacity:0.7, marginLeft:2 }}>{open ? '▲' : '▼'}</span>
        </button>

        {open && (
          <div style={{ position:'absolute', right:0, top:'calc(100% + 8px)', zIndex:100, width:300, background:'var(--card)', border:'1px solid var(--border)', borderRadius:16, boxShadow:'0 8px 32px rgba(0,0,0,0.4)', overflow:'hidden', animation:'popIn 0.15s ease' }}>

            {/* Address */}
            <div style={{ padding:'14px 16px', borderBottom:'1px solid var(--border)' }}>
              <div style={{ fontSize:10, fontWeight:600, letterSpacing:'0.08em', textTransform:'uppercase', color:'var(--text-muted)', marginBottom:6 }}>Wallet Address</div>
              <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                <span style={{ fontFamily:'var(--mono)', fontSize:11, color:'var(--text-dim)', wordBreak:'break-all', flex:1, lineHeight:1.5 }}>{address}</span>
                <button onClick={copyAddress} style={{ flexShrink:0, padding:'4px 10px', fontSize:11, borderRadius:6, border:'1px solid var(--border)', background:'transparent', color: copied ? 'var(--success)' : 'var(--text-muted)', cursor:'pointer', whiteSpace:'nowrap', transition:'color 0.2s' }}>
                  {copied ? '✓ Copied' : 'Copy'}
                </button>
              </div>
            </div>

            {/* QR code */}
            <div style={{ padding:'14px 16px', borderBottom:'1px solid var(--border)' }}>
              <div style={{ fontSize:10, fontWeight:600, letterSpacing:'0.08em', textTransform:'uppercase', color:'var(--text-muted)', marginBottom:10 }}>Scan to Fund</div>
              <div style={{ display:'flex', justifyContent:'center' }}>
                <div style={{ padding:8, background:'#ffffff', borderRadius:8, display:'inline-block' }}>
                  <QRCodeSVG value={address} size={140} bgColor="#ffffff" fgColor="#0f172a" level="M" />
                </div>
              </div>
              <div style={{ fontSize:10, color:'var(--text-muted)', textAlign:'center', marginTop:8 }}>Use at ALGO or USDC faucet</div>
            </div>

            {/* Balances + manual refresh */}
            <div style={{ padding:'14px 16px', borderBottom:'1px solid var(--border)' }}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:10 }}>
                <div style={{ fontSize:10, fontWeight:600, letterSpacing:'0.08em', textTransform:'uppercase', color:'var(--text-muted)' }}>Balances</div>
                {onRefreshBalance && (
                  <button onClick={onRefreshBalance} title="Refresh balance"
                    style={{ padding:'2px 8px', fontSize:11, borderRadius:6, border:'1px solid var(--border)', background:'transparent', color:'var(--text-muted)', cursor:'pointer', lineHeight:1 }}>
                    ↻
                  </button>
                )}
              </div>
              <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
                {[
                  ['ALGO', balance ? balance.algo.toFixed(4) : '—', true],
                  ['USDC', balance ? (balance.usdcOptedIn ? balance.usdc.toFixed(4) : 'Not opted in') : '—', !!(balance?.usdc && balance.usdc >= 0.001)],
                ].map(([label, val, ok]) => (
                  <div key={String(label)} style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                    <span style={{ fontSize:13, color:'var(--text-muted)' }}>{label}</span>
                    <span style={{ fontFamily:'var(--mono)', fontSize:13, fontWeight:600, color: ok ? 'var(--text-dim)' : 'var(--warning)' }}>{String(val)}</span>
                  </div>
                ))}
              </div>
              {walletHint && (
                <div style={{ marginTop:10, padding:'8px 10px', background:'rgba(251,191,36,0.08)', border:'1px solid var(--warning)33', borderRadius:8, fontSize:11, color:'var(--warning)', lineHeight:1.8 }}>
                  {walletHint}
                  <div style={{ marginTop:4, display:'flex', gap:10 }}>
                    {(!balance?.accountExists || balance.algo < 0.2) && (
                      <a href="https://bank.testnet.algorand.network/" target="_blank" rel="noreferrer" style={{ color:'var(--primary)', textDecoration:'underline' }}>Get ALGO ↗</a>
                    )}
                    {balance?.accountExists && !balance.usdcOptedIn && balance.algo >= 0.2 && (
                      <a href="https://faucet.circle.com/" target="_blank" rel="noreferrer" style={{ color:'var(--primary)', textDecoration:'underline' }}>Get USDC ↗</a>
                    )}
                    {balance?.usdcOptedIn && balance.usdc < 0.001 && (
                      <a href="https://faucet.circle.com/" target="_blank" rel="noreferrer" style={{ color:'var(--primary)', textDecoration:'underline' }}>Get USDC ↗</a>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Recovery phrase — words never enter the DOM until explicit reveal tap */}
            <div style={{ padding:'14px 16px', borderBottom:'1px solid var(--border)' }}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                <div>
                  <div style={{ fontSize:10, fontWeight:600, letterSpacing:'0.08em', textTransform:'uppercase', color:'var(--text-muted)' }}>Recovery Phrase</div>
                  {!mnemonicOpen && <div style={{ fontSize:11, color:'var(--text-muted)', marginTop:2 }}>25-word Algorand mnemonic</div>}
                </div>
                {!mnemonic ? (
                  <button
                    onClick={() => mnemonicOpen ? hideMnemonic() : setMnemonicOpen(true)}
                    style={{ padding:'4px 10px', fontSize:11, borderRadius:6, border:'1px solid var(--border)', background:'transparent', color:'var(--text-muted)', cursor:'pointer', whiteSpace:'nowrap' }}>
                    {mnemonicOpen ? 'Cancel' : 'Show'}
                  </button>
                ) : (
                  <div style={{ display:'flex', gap:6 }}>
                    <button onClick={copyMnemonic}
                      style={{ padding:'4px 10px', fontSize:11, borderRadius:6, border:'1px solid var(--border)', background:'transparent', color: copiedMnemonic ? 'var(--success)' : 'var(--text-muted)', cursor:'pointer', transition:'color 0.2s' }}>
                      {copiedMnemonic ? '✓ Copied' : 'Copy'}
                    </button>
                    <button onClick={hideMnemonic}
                      style={{ padding:'4px 10px', fontSize:11, borderRadius:6, border:'1px solid var(--border)', background:'transparent', color:'var(--text-muted)', cursor:'pointer' }}>
                      Hide
                    </button>
                  </div>
                )}
              </div>

              {mnemonicOpen && (
                <>
                  <div style={{ marginTop:10, padding:'7px 10px', background:'rgba(239,68,68,0.08)', border:'1px solid #ef444433', borderRadius:7, fontSize:11, color:'var(--error)', lineHeight:1.6 }}>
                    Anyone with these words controls this wallet. Never share them.
                  </div>
                  {!mnemonic ? (
                    <button onClick={revealMnemonic} disabled={loadingMnemonic}
                      style={{ marginTop:10, width:'100%', padding:'10px', fontSize:12, fontWeight:600, borderRadius:8, border:'1px solid var(--border)', background:'var(--bg)', color: loadingMnemonic ? 'var(--text-muted)' : 'var(--text)', cursor: loadingMnemonic ? 'wait' : 'pointer' }}>
                      {loadingMnemonic ? 'Loading…' : 'Tap to reveal phrase'}
                    </button>
                  ) : (
                    <div style={{ marginTop:10, display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:4 }}>
                      {mnemonic.split(' ').map((word, i) => (
                        <div key={i} style={{ padding:'4px 6px', background:'var(--bg)', borderRadius:5, fontSize:11, fontFamily:'var(--mono)' }}>
                          <span style={{ color:'var(--text-muted)', fontSize:10, marginRight:3 }}>{i + 1}.</span>
                          <span style={{ color:'var(--text)', fontWeight:600 }}>{word}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>

            <div style={{ padding:'10px 16px' }}>
              <button onClick={() => { setOpen(false); onDisconnect(); }}
                style={{ width:'100%', padding:'8px', fontSize:13, borderRadius:8, border:'1px solid var(--border)', background:'transparent', color:'var(--text-muted)', cursor:'pointer' }}>
                Disconnect
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <button onClick={onConnect} disabled={status !== 'ready'}
      style={{ padding:'8px 18px', fontSize:13, fontWeight:600, borderRadius:10, border:'1px solid var(--primary)55', background:'var(--primary-dim)', color:'var(--primary)', cursor: status === 'ready' ? 'pointer' : 'not-allowed', opacity: status === 'ready' ? 1 : 0.5, transition:'opacity 0.2s' }}>
      {status === 'idle' || status === 'initializing' ? 'Loading…' : status === 'connecting' ? 'Connecting…' : '🔐 Connect with Email'}
    </button>
  );
}
