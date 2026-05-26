import { useState } from 'react';
import type { SellerHealth } from '../hooks/useBuyer';
import { GITHUB_URL } from '../constants';

function FeaturePill({ icon, text }: { icon: string; text: string }) {
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

function EndpointCard({ path, price, desc, example, sellerUrl, last }: {
  path: string; price: string; desc: string;
  example: Record<string, unknown>; sellerUrl: string; last: boolean;
}) {
  const [copiedUrl,  setCopiedUrl]  = useState(false);
  const [copiedCurl, setCopiedCurl] = useState(false);
  const [curlOpen,   setCurlOpen]   = useState(false);

  const fullUrl = `${sellerUrl}${path}`;
  const curlCmd = `curl "${fullUrl}"\n# → HTTP 402 with payment requirements\n# Retry with X-PAYMENT header after signing`;

  const copyUrl  = () => { navigator.clipboard.writeText(fullUrl); setCopiedUrl(true); setTimeout(() => setCopiedUrl(false), 1500); };
  const copyCurl = () => { navigator.clipboard.writeText(`curl "${fullUrl}"`); setCopiedCurl(true); setTimeout(() => setCopiedCurl(false), 1500); };

  return (
    <div style={{ background:'var(--bg)', border:'1px solid var(--border)', borderRadius:10, overflow:'hidden', marginBottom: last ? 0 : 8 }}>
      <div style={{ display:'grid', gridTemplateColumns:'auto 1fr auto', gap:10, alignItems:'center', padding:'10px 12px' }}>
        <span style={{ fontFamily:'var(--mono)', fontSize:11, padding:'3px 7px', background:'var(--primary-dim)', color:'var(--primary)', borderRadius:5, fontWeight:700, letterSpacing:'0.04em', flexShrink:0 }}>GET</span>
        <div style={{ minWidth:0 }}>
          <div style={{ display:'flex', alignItems:'center', gap:6, flexWrap:'wrap' }}>
            <span style={{ fontFamily:'var(--mono)', fontSize:13, fontWeight:600, color:'var(--primary)' }}>{path}</span>
            <button onClick={copyUrl} title={copiedUrl ? 'Copied!' : `Copy ${fullUrl}`}
              style={{ padding:'1px 7px', fontSize:10, borderRadius:5, border:'1px solid var(--border)', background:'transparent', color: copiedUrl ? 'var(--success)' : 'var(--text-muted)', cursor:'pointer', transition:'color 0.2s, border-color 0.2s', flexShrink:0 }}>
              {copiedUrl ? '✓ copied' : 'copy url'}
            </button>
          </div>
          <div style={{ fontSize:11, color:'var(--text-muted)', marginTop:2 }}>{desc}</div>
        </div>
        <span style={{ fontFamily:'var(--mono)', fontSize:13, color:'var(--success)', fontWeight:700, whiteSpace:'nowrap' }}>{price}</span>
      </div>

      <div style={{ borderTop:'1px solid var(--border)', padding:'10px 12px', background:'var(--card)' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:8 }}>
          <span style={{ fontSize:10, fontWeight:600, letterSpacing:'0.07em', textTransform:'uppercase', color:'var(--text-muted)' }}>Example response</span>
          <button onClick={() => setCurlOpen(o => !o)}
            style={{ display:'flex', alignItems:'center', gap:4, padding:'2px 8px', fontSize:10, borderRadius:5, border:'1px solid var(--border)', background: curlOpen ? 'var(--primary-dim)' : 'transparent', color: curlOpen ? 'var(--primary)' : 'var(--text-muted)', cursor:'pointer', transition:'all 0.15s', fontFamily:'var(--mono)' }}>
            <span style={{ fontSize:11 }}>$</span><span>cURL</span><span style={{ opacity:0.6, fontSize:9 }}>{curlOpen ? '▲' : '▼'}</span>
          </button>
        </div>

        {curlOpen && (
          <div style={{ position:'relative', background:'#0d1117', borderRadius:8, overflow:'hidden', marginBottom:10 }}>
            <button onClick={copyCurl}
              style={{ position:'absolute', top:8, right:8, padding:'2px 8px', fontSize:10, borderRadius:5, border:'1px solid var(--border)', background:'var(--card)', color: copiedCurl ? 'var(--success)' : 'var(--text-muted)', cursor:'pointer', transition:'color 0.2s', zIndex:1 }}>
              {copiedCurl ? '✓' : 'Copy'}
            </button>
            <pre style={{ margin:0, padding:'12px 14px', fontSize:11, lineHeight:1.7, color:'#e6edf3', fontFamily:'var(--mono)', overflowX:'auto' }}><code>{curlCmd}</code></pre>
          </div>
        )}

        <pre style={{ margin:0, padding:'10px 12px', background:'#0d1117', borderRadius:8, fontSize:11, lineHeight:1.7, color:'#e6edf3', fontFamily:'var(--mono)', overflowX:'auto' }}>
          <code>
            {(() => {
              const lines = JSON.stringify(example, null, 2).split('\n');
              return lines.map((line, i) => {
                const keyMatch = line.match(/^(\s*)("[\w]+")(:)(.*)/);
                if (keyMatch) {
                  const [, indent, key, colon, rest] = keyMatch;
                  const valTrimmed = rest.trim();
                  let valColor = '#79c0ff';
                  if (/^-?\d/.test(valTrimmed))                         valColor = '#f2cc60';
                  if (valTrimmed === 'true' || valTrimmed === 'false') valColor = '#ff7b72';
                  if (valTrimmed === 'null')                            valColor = 'var(--text-muted)';
                  return (
                    <span key={i}>
                      {indent}<span style={{ color:'#88c0ff' }}>{key}</span><span style={{ color:'var(--text-muted)' }}>{colon} </span><span style={{ color: valColor }}>{rest.trimStart()}</span>{'\n'}
                    </span>
                  );
                }
                return <span key={i} style={{ color:'#8b949e' }}>{line}{'\n'}</span>;
              });
            })()}
          </code>
        </pre>
      </div>
    </div>
  );
}

export function BuildOnThis({ health }: { health: SellerHealth | null }) {
  const [activeTab, setActiveTab] = useState<'seller' | 'client'>('seller');
  const sellerUrl = (import.meta.env.VITE_SELLER_URL as string) ?? 'http://localhost:4021';

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
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:4 }}>
          <span style={{ fontSize:10, fontWeight:600, letterSpacing:'0.08em', textTransform:'uppercase', color:'var(--text-muted)' }}>Live endpoints — this demo</span>
          <span style={{ display:'flex', alignItems:'center', gap:5, fontSize:11, fontWeight:500 }}>
            <span style={{ width:6, height:6, borderRadius:'50%', background: health?.online ? 'var(--success)' : 'var(--warning)', display:'inline-block', boxShadow: health?.online ? '0 0 6px var(--success)88' : 'none' }} />
            <span style={{ color: health?.online ? 'var(--success)' : 'var(--warning)', fontSize:11, fontWeight:600 }}>
              {health === null ? 'checking…' : health.online ? 'online' : 'offline'}
            </span>
          </span>
        </div>
        <div style={{ fontFamily:'var(--mono)', fontSize:11, color:'var(--text-muted)', marginBottom:14, paddingLeft:2 }}>
          {sellerUrl.replace(/https?:\/\//, '')}
        </div>
        {([
          {
            path: '/weather',
            price: health?.prices.weather ?? '$0.001',
            desc: 'Current conditions for a random city',
            example: { city:'Miami', temperature:88, condition:'Sunny', humidity:78, paidVia:'x402 / Algorand USDC Testnet', timestamp: new Date().toISOString() },
          },
          {
            path: '/forecast',
            price: health?.prices.forecast ?? '$0.005',
            desc: '7-day forecast for a random city',
            example: { city:'New York', days:[{ date:'2025-01-01', tempMax:45, tempMin:32, condition:'Partly Cloudy' }, { date:'2025-01-02', tempMax:50, tempMin:35, condition:'Sunny' }, { date:'…', tempMax:'…', tempMin:'…', condition:'…' }], paidVia:'x402 / Algorand USDC Testnet', timestamp: new Date().toISOString() },
          },
        ]).map((ep, i, arr) => (
          <EndpointCard key={ep.path} path={ep.path} price={ep.price} desc={ep.desc}
            example={ep.example as Record<string, unknown>} sellerUrl={sellerUrl} last={i === arr.length - 1} />
        ))}
      </div>

      {/* Tabbed code */}
      <div style={{ marginTop:8 }}>
        <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:8 }}>
          <span style={{ fontSize:11, fontWeight:600, letterSpacing:'0.07em', textTransform:'uppercase', color:'var(--text-muted)', whiteSpace:'nowrap' }}>View code for</span>
          <div style={{ display:'inline-flex', background:'var(--bg)', border:'1px solid var(--border)', borderRadius:10, padding:4, gap:4 }}>
            {([
              { id:'seller', label:'Seller', file:'seller/src/index.ts', color:'var(--secondary)', dim:'var(--secondary-dim)' },
              { id:'client', label:'Client', file:'buyer/src/buyer.ts',  color:'var(--primary)',   dim:'var(--primary-dim)'   },
            ] as const).map(tab => {
              const active = activeTab === tab.id;
              return (
                <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                  style={{ padding:'7px 16px', fontSize:12, cursor:'pointer', transition:'all 0.18s', borderRadius:7, border: active ? `1px solid ${tab.color}44` : '1px solid transparent', background: active ? tab.dim : 'transparent', display:'flex', alignItems:'center', gap:8,
                    color: active ? tab.color : 'var(--text-dim)' }}>
                  <span style={{ width:7, height:7, borderRadius:'50%', flexShrink:0, transition:'all 0.18s', background: active ? tab.color : 'var(--border)', boxShadow: active ? `0 0 6px ${tab.color}88` : 'none' }} />
                  <span style={{ fontWeight:700 }}>{tab.label}</span>
                  <span style={{ fontSize:10, fontWeight:400, fontFamily:'var(--mono)', opacity: active ? 1 : 0.5 }}>{tab.file}</span>
                </button>
              );
            })}
          </div>
        </div>
        <CodeBlock code={activeTab === 'seller' ? sellerCode : clientCode} />
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
            <div key={item.title}
              style={{ padding:14, background:'var(--bg)', borderRadius:10, border:'1px solid var(--border)', transition:'border-color 0.2s, transform 0.2s', cursor:'default' }}
              onMouseEnter={e => { e.currentTarget.style.borderColor='var(--primary)55'; e.currentTarget.style.transform='translateY(-2px)'; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor='var(--border)'; e.currentTarget.style.transform='translateY(0)'; }}>
              <div style={{ fontSize:20, marginBottom:6 }}>{item.emoji}</div>
              <div style={{ fontWeight:600, fontSize:13, marginBottom:4 }}>{item.title}</div>
              <div style={{ fontSize:12, color:'var(--text-muted)', lineHeight:1.5 }}>{item.body}</div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ marginTop:24, display:'flex', justifyContent:'center', gap:12, flexWrap:'wrap' }}>
        <FeaturePill icon="⚡" text="Instant micropayments" />
        <FeaturePill icon="🔑" text="No API keys" />
        <FeaturePill icon="🔗" text="Algorand USDC" />
        <FeaturePill icon="🌐" text="Any HTTP endpoint" />
      </div>
    </section>
  );
}
