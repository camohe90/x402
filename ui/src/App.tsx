import { useCallback, useEffect, useRef, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { useWeb3Auth, fetchWalletBalance, optInToUSDC } from './hooks/useWeb3Auth';
import type { WalletBalance } from './hooks/useWeb3Auth';
import { useBuyer, checkSellerHealth } from './hooks/useBuyer';
import type { BuyEvent, Purchase, WeatherData, ForecastData, Endpoint, SellerHealth, PurchaseLog } from './hooks/useBuyer';

// ── Step definitions ──────────────────────────────────────────────────────────

const STEPS = [
  { id: 'request_sent',         label: 'Request',  desc: 'Buyer → Seller',               color: 'primary'   },
  { id: 'payment_required',     label: '402',       desc: 'Seller → Buyer',               color: 'warning'   },
  { id: 'payment_signing',      label: 'Signing',  desc: 'Algorand USDC tx',              color: 'secondary' },
  { id: 'payment_sent',         label: 'Payment',  desc: 'Buyer → Facilitator → Seller',  color: 'primary'   },
  { id: 'settlement_confirmed', label: 'Settled',  desc: 'On-chain confirmed',            color: 'success'   },
  { id: 'success',              label: 'Data',     desc: 'Seller → Buyer',               color: 'success'   },
] as const;

type StepId    = typeof STEPS[number]['id'];
type StepColor = typeof STEPS[number]['color'];

const EXPLORER_BASE = 'https://lora.algokit.io/testnet/transaction';
const GITHUB_URL    = 'https://github.com/camohe90/x402';

// ── Helpers ───────────────────────────────────────────────────────────────────

function stepColor(c: StepColor) {
  return c === 'warning' ? 'var(--warning)' : c === 'secondary' ? 'var(--secondary)' : c === 'success' ? 'var(--success)' : 'var(--primary)';
}
function stepDim(c: StepColor) {
  return c === 'warning' ? 'var(--warning-dim)' : c === 'secondary' ? 'var(--secondary-dim)' : c === 'success' ? 'var(--success-dim)' : 'var(--primary-dim)';
}
function eventColor(type: string) {
  if (type === 'payment_required' || type === 'error') return 'var(--warning)';
  if (type === 'payment_signing'  || type === 'payment_sent') return 'var(--secondary)';
  if (type === 'settlement_confirmed' || type === 'success') return 'var(--success)';
  return 'var(--primary)';
}
function eventLabel(e: BuyEvent) {
  const ep = e.endpoint ?? 'weather';
  switch (e.type) {
    case 'request_sent':         return `GET /${ep} → seller (no payment)`;
    case 'payment_required':     return `402 received — ${Number(e.amount ?? 0) / 1e6} USDC required`;
    case 'payment_signing':      return 'Signing Algorand USDC transaction…';
    case 'payment_sent':         return 'Retrying with payment proof in header';
    case 'settlement_confirmed': {
      const lat = e.latencyMs ? ` · ${e.latencyMs}ms` : '';
      return e.txid ? `Settled — tx: ${e.txid.slice(0, 12)}…${lat}` : `Facilitator confirmed on-chain${lat}`;
    }
    case 'success': {
      const d = e.data;
      if (!d) return 'Data delivered';
      if ('days' in d) return `Forecast delivered — ${(d as ForecastData).city}, ${(d as ForecastData).days.length} days`;
      return `Weather delivered — ${(d as WeatherData).city}, ${(d as WeatherData).temperature}°F`;
    }
    case 'error': return `Error: ${e.message}`;
  }
}
function stepIcon(id: StepId) {
  const m: Record<StepId, string> = { request_sent:'📡', payment_required:'🔴', payment_signing:'✍️', payment_sent:'💸', settlement_confirmed:'⛓️', success:'✅' };
  return m[id];
}
function endpointIcon(ep: Endpoint) {
  if (ep === 'forecast') return '📅';
  return '🌡️';
}
function fmtTime(ms: number) {
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}
const CONDITION_ICON: Record<string, string> = {
  'Clear Sky':'☀️', 'Mainly Clear':'🌤️', 'Partly Cloudy':'⛅', 'Overcast':'☁️',
  'Foggy':'🌫️', 'Drizzle':'🌦️', 'Heavy Drizzle':'🌧️',
  'Light Rain':'🌦️', 'Rain':'🌧️', 'Heavy Rain':'⛈️',
  'Light Snow':'🌨️', 'Snow':'❄️', 'Heavy Snow':'❄️',
  'Showers':'🌦️', 'Heavy Showers':'⛈️', 'Thunderstorm':'⛈️', 'Windy':'💨',
};
function condIcon(c: string) { return CONDITION_ICON[c] ?? '🌤️'; }

// ── Sub-components ────────────────────────────────────────────────────────────

function Logo() {
  return (
    <div style={{ display:'flex', alignItems:'center', gap:10, flexShrink:0 }}>
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
    <span className="nav-badge" style={{ display:'inline-block', padding:'2px 10px', borderRadius:20, fontSize:12, fontWeight:600, letterSpacing:'0.05em', color, background: color === 'var(--primary)' ? 'var(--primary-dim)' : 'var(--secondary-dim)', border:`1px solid ${color}33` }}>
      {text}
    </span>
  );
}

function Skeleton({ width, height, radius=6 }: { width:string|number; height:number; radius?:number }) {
  return <div className="skeleton" style={{ width, height, borderRadius:radius }} />;
}

function InitSkeleton() {
  return (
    <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:16, padding:'0 20px' }}>
      <Skeleton width={220} height={52} radius={12} />
      <Skeleton width={160} height={16} radius={8} />
    </div>
  );
}

function ConnectButton({ status, onConnect, onDisconnect, address, walletHint, balance }: {
  status: string; onConnect: () => void; onDisconnect: () => void;
  address?: string; walletHint?: string; balance?: WalletBalance | null;
}) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const copyAddress = () => {
    if (!address) return;
    navigator.clipboard.writeText(address).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); });
  };

  if (status === 'connected' && address) {
    return (
      <div ref={containerRef} style={{ position:'relative' }}>
        <button onClick={() => setOpen(o => !o)} style={{ display:'flex', alignItems:'center', gap:8, padding:'6px 12px', background:'var(--success-dim)', border:'1px solid var(--success)44', borderRadius:20, cursor:'pointer', outline:'none' }}>
          <span style={{ width:8, height:8, borderRadius:'50%', background:'var(--success)', display:'inline-block', boxShadow:'0 0 6px var(--success)' }} />
          <span style={{ fontFamily:'var(--mono)', fontSize:12, color:'var(--success)' }}>{address.slice(0,6)}…{address.slice(-4)}</span>
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
            {/* QR code for wallet funding */}
            <div style={{ padding:'14px 16px', borderBottom:'1px solid var(--border)' }}>
              <div style={{ fontSize:10, fontWeight:600, letterSpacing:'0.08em', textTransform:'uppercase', color:'var(--text-muted)', marginBottom:10 }}>Scan to Fund</div>
              <div style={{ display:'flex', justifyContent:'center' }}>
                <div style={{ padding:8, background:'#ffffff', borderRadius:8, display:'inline-block' }}>
                  <QRCodeSVG value={address} size={140} bgColor="#ffffff" fgColor="#0f172a" level="M" />
                </div>
              </div>
              <div style={{ fontSize:10, color:'var(--text-muted)', textAlign:'center', marginTop:8 }}>Use at ALGO or USDC faucet</div>
            </div>
            {/* Balances */}
            <div style={{ padding:'14px 16px', borderBottom:'1px solid var(--border)' }}>
              <div style={{ fontSize:10, fontWeight:600, letterSpacing:'0.08em', textTransform:'uppercase', color:'var(--text-muted)', marginBottom:10 }}>Balances</div>
              <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
                {[['ALGO', balance ? balance.algo.toFixed(4) : '—', true],
                  ['USDC', balance ? (balance.usdcOptedIn ? balance.usdc.toFixed(4) : 'Not opted in') : '—', !!(balance?.usdc && balance.usdc >= 0.001)]
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
            <div style={{ padding:'10px 16px' }}>
              <button onClick={() => { setOpen(false); onDisconnect(); }} style={{ width:'100%', padding:'8px', fontSize:13, borderRadius:8, border:'1px solid var(--border)', background:'transparent', color:'var(--text-muted)', cursor:'pointer' }}>Disconnect</button>
            </div>
          </div>
        )}
      </div>
    );
  }
  return (
    <button onClick={onConnect} disabled={status !== 'ready'} style={{ padding:'8px 18px', fontSize:13, fontWeight:600, borderRadius:10, border:'1px solid var(--primary)55', background:'var(--primary-dim)', color:'var(--primary)', cursor: status === 'ready' ? 'pointer' : 'not-allowed', opacity: status === 'ready' ? 1 : 0.5, transition:'opacity 0.2s' }}>
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
      <div style={{ width:44, height:44, borderRadius:12, border:`2px solid ${lit ? c : 'var(--border)'}`, background: lit ? d : 'var(--card)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:18, boxShadow: lit ? `0 0 10px ${c}66` : 'none', transition:'all 0.35s ease', animation: active ? 'pulse 1s ease-in-out infinite' : done ? 'stepDone 0.4s ease' : 'none' }}>
        {done && !active ? '✓' : stepIcon(step.id)}
      </div>
      <div style={{ textAlign:'center', color: lit ? c : 'var(--text-muted)', transition:'color 0.35s ease' }}>
        <div style={{ fontSize:12, fontWeight:600 }}>{step.label}</div>
        <div style={{ fontSize:10, opacity:0.7 }}>{step.desc}</div>
      </div>
    </div>
  );
}

function Connector({ active, done }: { active: boolean; done: boolean }) {
  return (
    <div style={{ flex:0, width:24, height:2, marginTop:-22, alignSelf:'center', background: done ? 'var(--success)' : active ? 'linear-gradient(90deg, var(--primary), var(--secondary), var(--primary))' : 'var(--border)', backgroundSize: active ? '200% 100%' : undefined, animation: active ? 'flowRight 1.2s linear infinite' : 'none', boxShadow: done ? '0 0 6px var(--success)55' : active ? '0 0 6px var(--primary-glow)' : 'none', transition:'background 0.4s ease, box-shadow 0.4s ease', borderRadius:1 }} />
  );
}

function WeatherCard({ data, celebrate, txid }: { data: WeatherData; celebrate: boolean; txid?: string }) {
  return (
    <div style={{ background:'var(--card)', border:'1px solid var(--success)', borderRadius:16, padding:24, boxShadow: celebrate ? '0 0 40px var(--success)66' : '0 0 24px var(--success-dim)', animation: celebrate ? 'celebrate 0.5s ease' : 'fadeIn 0.5s ease', transition:'box-shadow 0.6s ease' }}>
      {celebrate && <div style={{ textAlign:'center', fontSize:11, fontWeight:600, letterSpacing:'0.1em', textTransform:'uppercase', color:'var(--success)', marginBottom:10, animation:'fadeIn 0.3s ease' }}>✓ Payment successful</div>}
      <div style={{ fontSize:48, marginBottom:8, textAlign:'center' }}>{condIcon(data.condition)}</div>
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
      {txid && (
        <a href={`${EXPLORER_BASE}/${txid}`} target="_blank" rel="noreferrer" style={{ display:'flex', alignItems:'center', justifyContent:'center', gap:6, marginTop:12, padding:'8px', background:'var(--primary-dim)', border:'1px solid var(--primary)33', borderRadius:8, color:'var(--primary)', textDecoration:'none', fontSize:12, fontWeight:600 }}>
          View on Lora ↗
        </a>
      )}
    </div>
  );
}

function ForecastCard({ data, celebrate, txid }: { data: ForecastData; celebrate: boolean; txid?: string }) {
  return (
    <div style={{ background:'var(--card)', border:'1px solid var(--success)', borderRadius:16, padding:24, boxShadow: celebrate ? '0 0 40px var(--success)66' : '0 0 24px var(--success-dim)', animation: celebrate ? 'celebrate 0.5s ease' : 'fadeIn 0.5s ease', transition:'box-shadow 0.6s ease' }}>
      {celebrate && <div style={{ textAlign:'center', fontSize:11, fontWeight:600, letterSpacing:'0.1em', textTransform:'uppercase', color:'var(--success)', marginBottom:10, animation:'fadeIn 0.3s ease' }}>✓ Payment successful</div>}
      <div style={{ fontWeight:700, fontSize:18, marginBottom:4, textAlign:'center' }}>{data.city}</div>
      <div style={{ fontSize:11, color:'var(--text-muted)', textAlign:'center', marginBottom:16 }}>7-day forecast</div>
      <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
        {data.days.map((day, i) => (
          <div key={day.date} style={{ display:'grid', gridTemplateColumns:'80px 28px 1fr auto', gap:8, alignItems:'center', padding:'6px 8px', borderRadius:8, background: i === 0 ? 'var(--primary-dim)' : 'var(--bg)' }}>
            <span style={{ fontSize:12, color: i === 0 ? 'var(--primary)' : 'var(--text-muted)', fontWeight: i === 0 ? 600 : 400 }}>
              {i === 0 ? 'Today' : new Date(day.date + 'T12:00:00').toLocaleDateString('en', { weekday:'short', month:'short', day:'numeric' })}
            </span>
            <span style={{ fontSize:16 }}>{condIcon(day.condition)}</span>
            <span style={{ fontSize:11, color:'var(--text-muted)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{day.condition}</span>
            <span style={{ fontFamily:'var(--mono)', fontSize:12, fontWeight:600, whiteSpace:'nowrap' }}>
              <span style={{ color:'var(--primary)' }}>{day.tempMax}°</span>
              <span style={{ color:'var(--text-muted)', fontWeight:400 }}> / {day.tempMin}°</span>
            </span>
          </div>
        ))}
      </div>
      <div style={{ marginTop:12, background:'var(--success-dim)', border:'1px solid var(--success)33', borderRadius:8, padding:'8px 12px', fontSize:11, fontFamily:'var(--mono)', color:'var(--success)', textAlign:'center' }}>{data.paidVia}</div>
      {txid && (
        <a href={`${EXPLORER_BASE}/${txid}`} target="_blank" rel="noreferrer" style={{ display:'flex', alignItems:'center', justifyContent:'center', gap:6, marginTop:12, padding:'8px', background:'var(--primary-dim)', border:'1px solid var(--primary)33', borderRadius:8, color:'var(--primary)', textDecoration:'none', fontSize:12, fontWeight:600 }}>
          View on Lora ↗
        </a>
      )}
    </div>
  );
}

function EventLog({ events, elapsed }: { events: BuyEvent[]; elapsed: number | null }) {
  return (
    <div style={{ background:'var(--card)', border:'1px solid var(--border)', borderRadius:16, overflow:'hidden', fontFamily:'var(--mono)', fontSize:12, height:'100%', display:'flex', flexDirection:'column' }}>
      <div style={{ padding:'10px 16px', borderBottom:'1px solid var(--border)', fontSize:11, fontFamily:'var(--sans)', fontWeight:600, color:'var(--text-muted)', letterSpacing:'0.08em', textTransform:'uppercase', display:'flex', alignItems:'center', gap:8 }}>
        <span style={{ width:8, height:8, borderRadius:'50%', background: events.length > 0 ? 'var(--success)' : 'var(--text-muted)', display:'inline-block', boxShadow: events.length > 0 ? '0 0 6px var(--success)' : 'none', transition:'all 0.3s' }} />
        Event Log
        {elapsed !== null && <span style={{ marginLeft:'auto', fontFamily:'var(--mono)', fontSize:11, color:'var(--success)', fontWeight:700 }}>{fmtTime(elapsed)}</span>}
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

function PastLogsAccordion({ logs }: { logs: PurchaseLog[] }) {
  const [openId, setOpenId] = useState<string | null>(null);
  if (logs.length === 0) return null;
  return (
    <div style={{ marginTop:12 }}>
      <div style={{ fontSize:10, fontWeight:600, letterSpacing:'0.08em', textTransform:'uppercase', color:'var(--text-muted)', marginBottom:8, padding:'0 2px' }}>Purchase log history</div>
      {logs.map(log => (
        <div key={log.id} style={{ marginBottom:4, border:'1px solid var(--border)', borderRadius:8, overflow:'hidden' }}>
          <button
            onClick={() => setOpenId(openId === log.id ? null : log.id)}
            style={{ width:'100%', padding:'8px 12px', display:'flex', alignItems:'center', gap:8, background:'var(--card)', border:'none', cursor:'pointer', textAlign:'left', color:'var(--text-dim)' }}>
            <span style={{ fontSize:11 }}>{endpointIcon(log.endpoint)}</span>
            <span style={{ fontSize:12, fontWeight:600, flex:1 }}>/{log.endpoint}</span>
            <span style={{ fontSize:11, color:'var(--text-muted)' }}>{new Date(log.at).toLocaleTimeString()}</span>
            <span style={{ fontSize:10, color:'var(--text-muted)', marginLeft:8 }}>{openId === log.id ? '▲' : '▼'}</span>
          </button>
          {openId === log.id && (
            <div style={{ padding:'8px 12px 12px', background:'var(--bg)', fontFamily:'var(--mono)', fontSize:11 }}>
              {log.events.map((e, i) => (
                <div key={i} style={{ padding:'3px 0 3px 10px', color: eventColor(e.type), borderLeft:`2px solid ${eventColor(e.type)}`, marginLeft:4, marginBottom:2 }}>
                  {eventLabel(e)}
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function SpendingChart({ purchases }: { purchases: Purchase[] }) {
  if (purchases.length < 2) return null;

  const weatherCount  = purchases.filter(p => p.endpoint === 'weather').length;
  const forecastCount = purchases.filter(p => p.endpoint === 'forecast').length;
  const weatherSpend  = weatherCount  * 0.001;
  const forecastSpend = forecastCount * 0.005;
  const total = weatherSpend + forecastSpend;
  if (total === 0) return null;

  const r = 38;
  const cx = 56;
  const cy = 56;
  const circ = 2 * Math.PI * r;
  const forecastArc = (forecastSpend / total) * circ;
  const weatherArc  = (weatherSpend  / total) * circ;

  return (
    <div style={{ marginBottom:20 }}>
      <div style={{ fontSize:10, fontWeight:600, letterSpacing:'0.08em', textTransform:'uppercase', color:'var(--text-muted)', marginBottom:12 }}>Spend breakdown</div>
      <div style={{ display:'flex', alignItems:'center', gap:28 }}>
        <svg width={112} height={112} viewBox="0 0 112 112">
          <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--border)" strokeWidth={14} />
          {forecastCount > 0 && (
            <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--secondary)" strokeWidth={14}
              strokeDasharray={`${forecastArc} ${circ}`} strokeDashoffset={0}
              transform={`rotate(-90 ${cx} ${cy})`} strokeLinecap="round" />
          )}
          {weatherCount > 0 && (
            <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--primary)" strokeWidth={14}
              strokeDasharray={`${weatherArc} ${circ}`} strokeDashoffset={-forecastArc}
              transform={`rotate(-90 ${cx} ${cy})`} strokeLinecap="round" />
          )}
          <text x={cx} y={cy - 7} textAnchor="middle" fill="var(--text)" fontSize={13} fontWeight={700} fontFamily="var(--mono)">${total.toFixed(3)}</text>
          <text x={cx} y={cy + 9} textAnchor="middle" fill="var(--text-muted)" fontSize={10} fontFamily="var(--sans)">USDC spent</text>
        </svg>

        <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
          {weatherCount > 0 && (
            <div>
              <div style={{ display:'flex', alignItems:'center', gap:7, marginBottom:2 }}>
                <span style={{ width:10, height:10, borderRadius:2, background:'var(--primary)', display:'inline-block', flexShrink:0 }} />
                <span style={{ fontSize:12, fontWeight:600, color:'var(--text-dim)' }}>Weather</span>
              </div>
              <div style={{ fontSize:11, color:'var(--text-muted)', paddingLeft:17 }}>
                {weatherCount} request{weatherCount !== 1 ? 's' : ''} · ${weatherSpend.toFixed(3)}
              </div>
            </div>
          )}
          {forecastCount > 0 && (
            <div>
              <div style={{ display:'flex', alignItems:'center', gap:7, marginBottom:2 }}>
                <span style={{ width:10, height:10, borderRadius:2, background:'var(--secondary)', display:'inline-block', flexShrink:0 }} />
                <span style={{ fontSize:12, fontWeight:600, color:'var(--text-dim)' }}>Forecast</span>
              </div>
              <div style={{ fontSize:11, color:'var(--text-muted)', paddingLeft:17 }}>
                {forecastCount} request{forecastCount !== 1 ? 's' : ''} · ${forecastSpend.toFixed(3)}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function OnboardingStepper({ balance, optingIn, address }: { balance: WalletBalance | null; optingIn: boolean; address: string | null }) {
  const steps = [
    {
      label: 'Fund wallet',
      desc: 'Get testnet ALGO',
      done: !!(balance?.accountExists && balance.algo >= 0.2),
      active: !balance?.accountExists || (balance?.algo ?? 0) < 0.2,
      link: 'https://bank.testnet.algorand.network',
      linkText: 'ALGO faucet',
    },
    {
      label: 'Opt in to USDC',
      desc: optingIn ? 'Processing…' : 'Auto-triggered',
      done: !!balance?.usdcOptedIn,
      active: !!(balance?.accountExists && (balance?.algo ?? 0) >= 0.2 && !balance?.usdcOptedIn && !optingIn),
      link: null,
      linkText: null,
    },
    {
      label: 'Get USDC',
      desc: 'From Circle faucet',
      done: !!(balance?.usdcOptedIn && (balance?.usdc ?? 0) >= 0.001),
      active: !!(balance?.usdcOptedIn && (balance?.usdc ?? 0) < 0.001),
      link: 'https://faucet.circle.com',
      linkText: 'USDC faucet',
    },
  ];

  return (
    <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:14 }}>
      <div style={{ display:'flex', alignItems:'center' }}>
        {steps.map((step, i) => (
          <div key={i} style={{ display:'flex', alignItems:'center' }}>
            <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:6, width:110 }}>
              <div style={{ width:36, height:36, borderRadius:'50%', border:`2px solid ${step.done ? 'var(--success)' : step.active ? 'var(--primary)' : 'var(--border)'}`, background: step.done ? 'var(--success-dim)' : step.active ? 'var(--primary-dim)' : 'var(--card)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:14, fontWeight:700, color: step.done ? 'var(--success)' : step.active ? 'var(--primary)' : 'var(--text-muted)', transition:'all 0.3s', boxShadow: step.active ? '0 0 12px var(--primary-glow)' : 'none', animation: step.active ? 'pulse 1.5s ease-in-out infinite' : 'none' }}>
                {step.done ? '✓' : i + 1}
              </div>
              <div style={{ textAlign:'center' }}>
                <div style={{ fontSize:11, fontWeight:600, color: step.done ? 'var(--success)' : step.active ? 'var(--primary)' : 'var(--text-muted)' }}>{step.label}</div>
                <div style={{ fontSize:10, color:'var(--text-muted)', marginTop:1 }}>{step.desc}</div>
                {step.active && step.link && (
                  <a href={step.link} target="_blank" rel="noreferrer" style={{ fontSize:10, color:'var(--primary)', textDecoration:'underline', marginTop:3, display:'block' }}>{step.linkText} ↗</a>
                )}
              </div>
            </div>
            {i < steps.length - 1 && (
              <div style={{ width:32, height:2, background: step.done ? 'var(--success)' : 'var(--border)', marginBottom:28, transition:'background 0.3s', flexShrink:0 }} />
            )}
          </div>
        ))}
      </div>
      {address && (
        <div style={{ fontSize:11, color:'var(--text-muted)', fontFamily:'var(--mono)' }}>
          {address.slice(0,10)}…{address.slice(-8)}
        </div>
      )}
    </div>
  );
}

function PurchaseHistory({ purchases }: { purchases: Purchase[] }) {
  if (purchases.length === 0) return null;
  const endpointPrice: Record<Endpoint, number> = { weather: 0.001, forecast: 0.005 };
  const totalSpent = purchases.reduce((sum, p) => sum + endpointPrice[p.endpoint], 0);
  return (
    <section style={{ maxWidth:900, margin:'0 auto', width:'100%', padding:'0 40px 48px' }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'baseline', marginBottom:20, flexWrap:'wrap', gap:8 }}>
        <div style={{ fontSize:11, fontWeight:600, letterSpacing:'0.1em', textTransform:'uppercase', color:'var(--text-muted)' }}>Purchase History</div>
        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
          <span style={{ padding:'4px 10px', background:'var(--card)', border:'1px solid var(--border)', borderRadius:8, fontSize:12, color:'var(--text-dim)', fontWeight:600 }}>
            ⚡ {purchases.length} API call{purchases.length !== 1 ? 's' : ''}
          </span>
          <span style={{ padding:'4px 10px', background:'var(--success-dim)', border:'1px solid var(--success)33', borderRadius:8, fontFamily:'var(--mono)', fontSize:12, fontWeight:700, color:'var(--success)' }}>
            ${totalSpent.toFixed(3)} USDC
          </span>
          {purchases.length > 1 && (
            <span style={{ fontSize:11, color:'var(--text-muted)' }}>
              avg ${(totalSpent / purchases.length).toFixed(3)}/call
            </span>
          )}
        </div>
      </div>

      <SpendingChart purchases={purchases} />

      <div style={{ background:'var(--card)', border:'1px solid var(--border)', borderRadius:16, overflow:'hidden' }}>
        <div className="purchase-grid purchase-header" style={{ padding:'10px 20px', borderBottom:'1px solid var(--border)', fontSize:11, fontWeight:600, letterSpacing:'0.07em', textTransform:'uppercase', color:'var(--text-muted)' }}>
          {['Time','Endpoint','Result','Tx ID','Explorer'].map((h,i) => <span key={h} style={{ textAlign: i===4 ? 'right' : 'left' }}>{h}</span>)}
        </div>
        {[...purchases].reverse().map((p, i) => (
          <div key={i} className="purchase-grid" style={{ padding:'12px 20px', borderBottom: i < purchases.length-1 ? '1px solid var(--border)' : 'none', alignItems:'center', fontSize:13, animation:'fadeIn 0.4s ease' }}
            onMouseEnter={e => (e.currentTarget.style.background='var(--card-hover)')}
            onMouseLeave={e => (e.currentTarget.style.background='transparent')}>
            <span style={{ color:'var(--text-muted)', fontFamily:'var(--mono)', fontSize:11 }}>{new Date(p.purchasedAt).toLocaleTimeString()}</span>
            <span style={{ fontWeight:500 }}>/{p.endpoint} <span style={{ color: p.endpoint === 'forecast' ? 'var(--secondary)' : 'var(--primary)', fontSize:11 }}>${endpointPrice[p.endpoint].toFixed(3)}</span></span>
            <span style={{ color:'var(--text-dim)', fontSize:12 }}>
              {p.weather?.city ?? p.forecast?.city ?? '—'}
            </span>
            <span style={{ fontFamily:'var(--mono)', fontSize:11, color: p.txid ? 'var(--text-dim)' : 'var(--text-muted)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', paddingRight:16 }}>{p.txid ?? '—'}</span>
            <span style={{ textAlign:'right' }}>
              {p.txid
                ? <a href={`${EXPLORER_BASE}/${p.txid}`} target="_blank" rel="noreferrer"
                    style={{ display:'inline-flex', alignItems:'center', gap:4, padding:'4px 12px', background:'var(--primary-dim)', border:'1px solid var(--primary)44', borderRadius:6, color:'var(--primary)', textDecoration:'none', fontSize:12, fontWeight:600 }}
                    onMouseEnter={e => { e.currentTarget.style.background='var(--primary)'; e.currentTarget.style.color='#001a15'; }}
                    onMouseLeave={e => { e.currentTarget.style.background='var(--primary-dim)'; e.currentTarget.style.color='var(--primary)'; }}>View ↗</a>
                : <span style={{ color:'var(--text-muted)', fontSize:12 }}>pending</span>}
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

function CodeBlock({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div style={{ position:'relative', background:'#0d1117', border:'1px solid var(--border)', borderRadius:12, overflow:'hidden' }}>
      <button onClick={() => { navigator.clipboard.writeText(code.trim()); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
        style={{ position:'absolute', top:10, right:10, padding:'3px 10px', fontSize:11, borderRadius:6, border:'1px solid var(--border)', background:'var(--card)', color: copied ? 'var(--success)' : 'var(--text-muted)', cursor:'pointer', transition:'color 0.2s', zIndex:1 }}>
        {copied ? '✓ Copied' : 'Copy'}
      </button>
      <pre style={{ margin:0, padding:'20px 20px 16px', overflowX:'auto', fontSize:12, lineHeight:1.7, color:'#e6edf3', fontFamily:'var(--mono)' }}><code>{code.trim()}</code></pre>
    </div>
  );
}

function BuildOnThis({ health }: { health: SellerHealth | null }) {
  const sellerCode = `
// 1. Declare price + who gets paid (your Algorand address)
const routes = {
  'GET /your-endpoint': {
    accepts: {
      scheme:  'exact',
      network: ALGORAND_TESTNET_CAIP2,
      payTo:   process.env.SELLER_ADDRESS,
      price:   '$0.001',  // any USD amount
    },
  },
};

// 2. Add the middleware — one line protects all routes above
app.use(paymentMiddleware(routes, resourceServer));

// 3. Write your handler — it only runs after payment is confirmed
app.get('/your-endpoint', (c) => c.json({ data: 'your data here' }));
`.trim();

  const clientCode = `
// 1. Create a signer from your Algorand private key
const account = algosdk.mnemonicToSecretKey(process.env.MNEMONIC);
const signer  = toClientAvmSigner(
  Buffer.from(account.sk).toString('base64')
);

// 2. Build an x402 client with the Algorand payment scheme
const client = new x402Client()
  .register(ALGORAND_TESTNET_CAIP2, new ExactAvmScheme(signer));

// 3. Wrap fetch — 402 → sign → retry happens automatically
const fetchWithPayment = wrapFetchWithPayment(fetch, client);
const response = await fetchWithPayment('https://your-api.com/endpoint');
const data = await response.json();
`.trim();

  const sellerUrl = (import.meta.env.VITE_SELLER_URL as string) ?? 'http://localhost:4021';

  return (
    <section className="content-section" style={{ maxWidth:900, margin:'0 auto', width:'100%', padding:'0 40px 80px', boxSizing:'border-box' }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:32, flexWrap:'wrap', gap:12 }}>
        <div>
          <div style={{ fontSize:11, fontWeight:600, letterSpacing:'0.1em', textTransform:'uppercase', color:'var(--text-muted)', marginBottom:6 }}>Build on this</div>
          <div style={{ fontSize:20, fontWeight:700, letterSpacing:'-0.02em' }}>Protect any endpoint in minutes</div>
        </div>
        <a href={GITHUB_URL} target="_blank" rel="noreferrer"
          style={{ display:'inline-flex', alignItems:'center', gap:8, padding:'10px 20px', background:'var(--card)', border:'1px solid var(--border)', borderRadius:10, color:'var(--text-dim)', textDecoration:'none', fontSize:13, fontWeight:600, transition:'border-color 0.2s, color 0.2s' }}
          onMouseEnter={e => { e.currentTarget.style.borderColor='var(--primary)'; e.currentTarget.style.color='var(--primary)'; }}
          onMouseLeave={e => { e.currentTarget.style.borderColor='var(--border)'; e.currentTarget.style.color='var(--text-dim)'; }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"/></svg>
          Fork on GitHub
        </a>
      </div>

      {/* Live endpoints */}
      <div style={{ background:'var(--card)', border:'1px solid var(--border)', borderRadius:16, padding:20, marginBottom:24 }}>
        <div style={{ fontSize:10, fontWeight:600, letterSpacing:'0.08em', textTransform:'uppercase', color:'var(--text-muted)', marginBottom:14, display:'flex', justifyContent:'space-between', alignItems:'center' }}>
          <span>Live endpoints — this demo</span>
          <span style={{ display:'flex', alignItems:'center', gap:5, fontSize:11, fontWeight:500 }}>
            <span style={{ width:6, height:6, borderRadius:'50%', background: health?.online ? 'var(--success)' : 'var(--warning)', display:'inline-block' }} />
            {health === null ? 'checking…' : health.online ? 'online' : 'offline'}
          </span>
        </div>
        {[
          { method:'GET', path:'/weather',  price: health?.prices.weather  ?? '$0.001', desc:'Current conditions for a random city' },
          { method:'GET', path:'/forecast', price: health?.prices.forecast ?? '$0.005', desc:'7-day forecast for a random city' },
        ].map(ep => (
          <div key={ep.path} style={{ display:'grid', gridTemplateColumns:'auto 1fr auto', gap:12, alignItems:'center', marginBottom:10, padding:'8px 0', borderBottom:'1px solid var(--border)' }}>
            <span style={{ fontFamily:'var(--mono)', fontSize:12, padding:'4px 8px', background:'var(--primary-dim)', color:'var(--primary)', borderRadius:6, fontWeight:700 }}>{ep.method}</span>
            <div>
              <span style={{ fontFamily:'var(--mono)', fontSize:12, color:'var(--text-dim)' }}>{sellerUrl.replace(/https?:\/\//, '')}<span style={{ color:'var(--primary)' }}>{ep.path}</span></span>
              <div style={{ fontSize:11, color:'var(--text-muted)', marginTop:2 }}>{ep.desc}</div>
            </div>
            <span style={{ fontFamily:'var(--mono)', fontSize:12, color:'var(--success)', fontWeight:700, whiteSpace:'nowrap' }}>{ep.price}</span>
          </div>
        ))}
        <div style={{ marginTop:4, padding:'10px 14px', background:'var(--bg)', borderRadius:8, fontSize:12, fontFamily:'var(--mono)', color:'var(--text-muted)', lineHeight:1.6 }}>
          /weather  → {'{ city, temperature, condition, humidity, paidVia, timestamp }'}<br/>
          /forecast → {'{ city, days: [{ date, tempMax, tempMin, condition }], paidVia, timestamp }'}
        </div>
      </div>

      {/* Code snippets */}
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16 }} className="build-grid">
        <div>
          <div style={{ fontSize:12, fontWeight:600, color:'var(--text-muted)', marginBottom:8, display:'flex', alignItems:'center', gap:6 }}>
            <span style={{ padding:'2px 8px', background:'var(--secondary-dim)', color:'var(--secondary)', borderRadius:6, fontSize:11 }}>Seller</span>
            seller/src/index.ts
          </div>
          <CodeBlock code={sellerCode} />
        </div>
        <div>
          <div style={{ fontSize:12, fontWeight:600, color:'var(--text-muted)', marginBottom:8, display:'flex', alignItems:'center', gap:6 }}>
            <span style={{ padding:'2px 8px', background:'var(--primary-dim)', color:'var(--primary)', borderRadius:6, fontSize:11 }}>Client</span>
            buyer/src/buyer.ts
          </div>
          <CodeBlock code={clientCode} />
        </div>
      </div>

      {/* Ideas */}
      <div style={{ marginTop:24, background:'var(--card)', border:'1px solid var(--border)', borderRadius:16, padding:20 }}>
        <div style={{ fontSize:12, fontWeight:600, letterSpacing:'0.07em', textTransform:'uppercase', color:'var(--text-muted)', marginBottom:16 }}>Ideas to build with x402 + Algorand</div>
        <div className="ideas-grid" style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:12 }}>
          {[
            { emoji:'🤖', title:'AI API gateway',      body:'Charge per LLM call — no accounts, just USDC per token' },
            { emoji:'📊', title:'Real-time data',      body:'Stock prices, sports scores, sensor data — pay per fetch' },
            { emoji:'🗺️',  title:'Mapping / geo',      body:'Geocoding, routing, or satellite imagery on demand' },
            { emoji:'🔐', title:'Secrets vault',       body:'Unlock an encrypted payload after a micro-payment' },
            { emoji:'🎵', title:'Media streaming',     body:'Pay-per-minute audio/video without subscriptions' },
            { emoji:'📝', title:'Document generation', body:'PDFs, reports, or summaries billed per generation' },
          ].map(item => (
            <div key={item.title} style={{ padding:14, background:'var(--bg)', borderRadius:10, border:'1px solid var(--border)' }}>
              <div style={{ fontSize:20, marginBottom:6 }}>{item.emoji}</div>
              <div style={{ fontWeight:600, fontSize:13, marginBottom:4 }}>{item.title}</div>
              <div style={{ fontSize:12, color:'var(--text-muted)', lineHeight:1.5 }}>{item.body}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ── Main App ──────────────────────────────────────────────────────────────────

export default function App() {
  const { status: authStatus, isConnected, error: authError, connect, disconnect, getAccount } = useWeb3Auth();
  const { events, purchaseLogs, purchases, weather, forecast, loading, error: buyError, buy } = useBuyer();
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
  const startTimeRef = useRef<number | null>(null);

  // Apply theme to html element and persist
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('x402-theme', theme);
  }, [theme]);

  // Load wallet on connect / restore session
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

  // Balance auto-poll every 10s when connected
  useEffect(() => {
    if (!isConnected || !address) return;
    const interval = setInterval(() => {
      fetchWalletBalance(address).then(setBalance);
    }, 10_000);
    return () => clearInterval(interval);
  }, [isConnected, address]);

  // Auto opt-in to USDC when wallet has enough ALGO
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

  // Refresh balance after each purchase
  useEffect(() => {
    if (purchases.length === 0 || !address) return;
    const t = setTimeout(() => fetchWalletBalance(address).then(setBalance), 2500);
    return () => clearTimeout(t);
  }, [purchases.length, address]);

  // Celebration on new data
  useEffect(() => {
    if (!weather && !forecast) return;
    setCelebrate(true);
    const t = setTimeout(() => setCelebrate(false), 2500);
    return () => clearTimeout(t);
  }, [weather, forecast]);

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
  const hasResult     = weather !== null || forecast !== null;

  const endpointPrice: Record<Endpoint, string> = {
    weather:  health?.prices.weather  ?? '$0.001',
    forecast: health?.prices.forecast ?? '$0.005',
  };

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

  const buyDisabled = loading || optingIn || (balance !== null && balance.usdc < 0.001);

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
          {/* Theme toggle */}
          <button
            onClick={() => setTheme(t => t === 'dark' ? 'light' : 'dark')}
            title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            style={{ padding:'6px 10px', fontSize:14, borderRadius:20, border:'1px solid var(--border)', background:'var(--card)', color:'var(--text-dim)', cursor:'pointer', lineHeight:1 }}>
            {theme === 'dark' ? '☀️' : '🌙'}
          </button>
          <ConnectButton status={authStatus} onConnect={connect} onDisconnect={disconnect} address={address ?? undefined} walletHint={walletHint} balance={balance} />
        </div>
      </nav>

      {/* Hero */}
      <section className="hero-section" style={{ textAlign:'center', padding:'80px 40px 60px', maxWidth:760, margin:'0 auto', width:'100%', boxSizing:'border-box' }}>
        <div style={{ marginBottom:24, display:'flex', justifyContent:'center', gap:10, flexWrap:'wrap' }}>
          <FeaturePill icon="⚡" text="Instant micropayments" />
          <FeaturePill icon="🔑" text="No API keys" />
          <FeaturePill icon="🔗" text="Algorand USDC" />
        </div>
        <h1 style={{ fontSize:'clamp(28px,6vw,64px)', fontWeight:700, lineHeight:1.1, letterSpacing:'-0.03em', marginBottom:20 }}>
          Pay-per-Request APIs{' '}
          <span style={{ background:'linear-gradient(90deg,var(--primary),var(--secondary))', WebkitBackgroundClip:'text', WebkitTextFillColor:'transparent' }}>on Algorand</span>
        </h1>
        <p style={{ fontSize:'clamp(15px,2.5vw,18px)', color:'var(--text-dim)', lineHeight:1.7, maxWidth:540, margin:'0 auto 36px' }}>
          The x402 protocol lets APIs charge per-request using HTTP 402. No subscriptions, no accounts — just connect your wallet and pay in USDC.
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
        ) : (
          <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:16 }}>
            {/* Endpoint selector */}
            <div style={{ display:'flex', gap:8, padding:4, background:'var(--card)', border:'1px solid var(--border)', borderRadius:12, flexWrap:'wrap', justifyContent:'center' }}>
              {(['weather', 'forecast'] as Endpoint[]).map(ep => (
                <button key={ep} onClick={() => setSelectedEndpoint(ep)} style={{ padding:'8px 20px', fontSize:13, fontWeight:600, borderRadius:9, border:'none', background: selectedEndpoint === ep ? 'var(--primary)' : 'transparent', color: selectedEndpoint === ep ? '#001a15' : 'var(--text-muted)', cursor:'pointer', transition:'all 0.2s' }}>
                  {endpointIcon(ep)} {ep === 'weather' ? 'Current' : '7-day'}
                  <span style={{ marginLeft:6, fontSize:11, opacity:0.8 }}>{endpointPrice[ep]}</span>
                </button>
              ))}
            </div>

            {/* Onboarding stepper or buy button */}
            {walletHint ? (
              <OnboardingStepper balance={balance} optingIn={optingIn} address={address} />
            ) : (
              <div style={{ display:'flex', alignItems:'center', gap:12, flexWrap:'wrap', justifyContent:'center' }}>
                <button onClick={handleBuy} disabled={buyDisabled}
                  style={{ padding:'14px 36px', fontSize:16, fontWeight:600, borderRadius:12, border:'none', background: buyDisabled ? 'var(--border)' : 'linear-gradient(135deg,var(--primary),#00a88a)', color: buyDisabled ? 'var(--text-muted)' : '#001a15', cursor: buyDisabled ? 'not-allowed' : 'pointer', boxShadow: buyDisabled ? 'none' : '0 0 24px var(--primary-glow)', letterSpacing:'-0.01em', transition:'all 0.2s' }}>
                  {loading ? 'Purchasing…' : optingIn ? 'Opting in to USDC…' : `Buy ${selectedEndpoint === 'forecast' ? 'Forecast' : 'Weather'} — ${endpointPrice[selectedEndpoint]}`}
                </button>
              </div>
            )}

            {/* USDC insufficient inline */}
            {!walletHint && balance !== null && balance.usdc < 0.001 && balance.usdcOptedIn && (
              <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                <p style={{ fontSize:13, color:'var(--warning)', margin:0 }}>Insufficient USDC</p>
                {address && (
                  <div style={{ display:'flex', alignItems:'center', gap:6, padding:'4px 10px', background:'var(--card)', border:'1px solid var(--border)', borderRadius:8 }}>
                    <span style={{ fontFamily:'var(--mono)', fontSize:11, color:'var(--text-muted)' }}>{address.slice(0,8)}…</span>
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
      <section className="content-section" style={{ maxWidth:900, margin:'0 auto', width:'100%', padding:'0 40px 48px', boxSizing:'border-box' }}>
        <div style={{ background:'var(--card)', border:'1px solid var(--border)', borderRadius:20, padding:'28px 32px' }}>
          <div style={{ fontSize:11, fontWeight:600, letterSpacing:'0.1em', textTransform:'uppercase', color:'var(--text-muted)', marginBottom:24, display:'flex', justifyContent:'space-between', alignItems:'center' }}>
            <span>Protocol Flow</span>
            {elapsed !== null && !loading && (
              <span style={{ fontFamily:'var(--mono)', color:'var(--success)', fontSize:12 }}>completed in {fmtTime(elapsed)}</span>
            )}
          </div>
          <div className="flow-steps" style={{ display:'flex', alignItems:'flex-start', overflowX:'auto', paddingBottom:4 }}>
            {STEPS.map((step, i) => (
              <div key={step.id} style={{ display:'flex', alignItems:'flex-start', flex:1, minWidth:0 }}>
                <FlowStep step={step} active={activeStep === step.id} done={doneSteps.has(step.id)} />
                {i < STEPS.length-1 && <Connector active={activeStep === step.id} done={doneSteps.has(step.id)} />}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Demo Panel */}
      <section className="content-section" style={{ maxWidth:900, margin:'0 auto', width:'100%', padding:'0 40px 48px', boxSizing:'border-box' }}>
        <div className={hasResult ? 'demo-grid-split' : 'demo-grid-full'} style={{ gap:16, minHeight:240 }}>
          <div style={{ display:'flex', flexDirection:'column', gap:0, minHeight:240 }}>
            <EventLog events={events} elapsed={elapsed} />
            <PastLogsAccordion logs={purchaseLogs} />
          </div>
          {weather  && <WeatherCard  data={weather}  celebrate={celebrate} txid={lastTxid} />}
          {forecast && <ForecastCard data={forecast} celebrate={celebrate} txid={lastTxid} />}
        </div>
      </section>

      {/* Purchase History */}
      <PurchaseHistory purchases={purchases} />

      {/* How it works */}
      <section className="content-section" style={{ maxWidth:900, margin:'0 auto', width:'100%', padding:'0 40px 80px', boxSizing:'border-box' }}>
        <div style={{ fontSize:11, fontWeight:600, letterSpacing:'0.1em', textTransform:'uppercase', color:'var(--text-muted)', marginBottom:24, textAlign:'center' }}>How it works</div>
        <div className="how-grid">
          {[
            { icon:'🔐', title:'1. Connect', body:'Sign in with your email via Web3Auth. A non-custodial Algorand wallet is derived from your credentials — no seed phrase.' },
            { icon:'📡', title:'2. Request', body:'Buyer sends a plain GET /weather or /forecast. No auth header, no API key required.' },
            { icon:'🔴', title:'3. 402 + Requirements', body:'Seller returns HTTP 402 with USDC amount, Algorand address, and facilitator URL.' },
            { icon:'✍️', title:'4. Sign & Retry', body:'Buyer signs an Algorand USDC transaction and retries with the proof in the header.' },
            { icon:'⛓️', title:'5. Settlement', body:'Goplausible facilitator verifies the transaction is on-chain before the seller responds.' },
            { icon:'✅', title:'6. Data delivered', body:'Seller sends real data — weather conditions or a 7-day forecast. One request = one payment.' },
          ].map(item => (
            <div key={item.title} style={{ background:'var(--card)', border:'1px solid var(--border)', borderRadius:12, padding:20 }}>
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
      <footer style={{ borderTop:'1px solid var(--border)', padding:'24px 40px', display:'flex', justifyContent:'space-between', alignItems:'center', flexWrap:'wrap', gap:12, color:'var(--text-muted)', fontSize:13 }}>
        <Logo />
        <div style={{ display:'flex', gap:16, flexWrap:'wrap', alignItems:'center' }}>
          <span>x402 Protocol v2</span><span>·</span>
          <span>Algorand Testnet</span><span>·</span>
          <span>USDC ASA 10458941</span><span>·</span>
          <a href={GITHUB_URL} target="_blank" rel="noreferrer" style={{ color:'var(--primary)', textDecoration:'none', fontWeight:600 }}>GitHub ↗</a>
        </div>
      </footer>

      <style>{`
        @keyframes pulse    { 0%,100%{opacity:1;transform:scale(1)}   50%{opacity:0.7;transform:scale(0.95)} }
        @keyframes fadeIn   { from{opacity:0;transform:translateY(4px)} to{opacity:1;transform:translateY(0)} }
        @keyframes popIn    { from{opacity:0;transform:scale(0.97) translateY(-4px)} to{opacity:1;transform:scale(1) translateY(0)} }
        @keyframes stepDone { 0%{transform:scale(1)} 40%{transform:scale(1.15)} 100%{transform:scale(1)} }
        @keyframes flowRight { 0%{background-position:0% 50%} 100%{background-position:200% 50%} }
        @keyframes celebrate { 0%{transform:scale(0.96);opacity:0.8} 50%{transform:scale(1.02)} 100%{transform:scale(1);opacity:1} }
        @keyframes shimmer  { 0%{background-position:-400px 0} 100%{background-position:400px 0} }

        .skeleton {
          background: linear-gradient(90deg, var(--card) 25%, var(--border) 50%, var(--card) 75%);
          background-size: 400px 100%;
          animation: shimmer 1.4s ease infinite;
        }

        .demo-grid-split { display: grid; grid-template-columns: 1fr 320px; }
        .demo-grid-full  { display: grid; grid-template-columns: 1fr; }
        .purchase-grid   { display: grid; grid-template-columns: 100px 120px 1fr 1fr 100px; }
        .how-grid        { display: grid; grid-template-columns: repeat(3,1fr); gap: 16px; }
        .build-grid      { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
        .ideas-grid      { display: grid; grid-template-columns: repeat(3,1fr); gap: 12px; }

        @media (max-width: 700px) {
          .nav { padding: 12px 16px !important; }
          .nav-badge { display: none; }
          .hero-section { padding: 48px 20px 40px !important; }
          .content-section { padding-left: 16px !important; padding-right: 16px !important; }
          .demo-grid-split { grid-template-columns: 1fr !important; }
          .how-grid { grid-template-columns: 1fr 1fr !important; }
          .build-grid { grid-template-columns: 1fr !important; }
          .ideas-grid { grid-template-columns: 1fr 1fr !important; }
          .purchase-grid { grid-template-columns: 80px 80px 1fr !important; }
          .purchase-grid span:nth-child(4),
          .purchase-grid span:nth-child(5) { display: none; }
          .purchase-header span:nth-child(4),
          .purchase-header span:nth-child(5) { display: none; }
          .flow-steps { gap: 0; }
          .flow-steps > div { min-width: 80px; }
        }

        @media (max-width: 420px) {
          .how-grid { grid-template-columns: 1fr !important; }
          .ideas-grid { grid-template-columns: 1fr !important; }
          .build-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </div>
  );
}
