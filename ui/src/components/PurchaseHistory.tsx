import { useState } from 'react';
import type { Purchase } from '../hooks/useBuyer';
import { firstResult, visiblePages } from '../utils/format';
import { SpendingChart } from './SpendingChart';
import { EXPLORER_BASE } from '../constants';

const PAGE_SIZE = 8;

export function PurchaseHistory({ purchases, prices }: { purchases: Purchase[]; prices: Record<string, string> }) {
  const [page, setPage] = useState(0);

  if (purchases.length === 0) return null;

  const sorted   = [...purchases].reverse();
  const pages    = Math.ceil(sorted.length / PAGE_SIZE);
  const safePage = Math.min(page, pages - 1);
  const slice    = sorted.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);
  const from     = safePage * PAGE_SIZE + 1;
  const to       = Math.min(safePage * PAGE_SIZE + PAGE_SIZE, sorted.length);

  return (
    <section style={{ maxWidth:900, margin:'0 auto', width:'100%', padding:'0 40px 48px' }}>
      <div style={{ fontSize:11, fontWeight:600, letterSpacing:'0.1em', textTransform:'uppercase', color:'var(--text-muted)', marginBottom:0 }}>Purchase History</div>

      <SpendingChart purchases={purchases} prices={prices} />

      <div style={{ background:'var(--card)', border:'1px solid var(--border)', borderRadius:16, overflow:'hidden' }}>
        <div className="purchase-grid purchase-header" style={{ padding:'10px 20px', borderBottom:'1px solid var(--border)', fontSize:11, fontWeight:600, letterSpacing:'0.07em', textTransform:'uppercase', color:'var(--text-muted)' }}>
          {['Time', 'Endpoint', 'Result', 'Tx ID', 'Explorer'].map((h, i) => <span key={h} style={{ textAlign: i === 4 ? 'right' : 'left' }}>{h}</span>)}
        </div>
        {slice.map((p, i) => (
          <div key={safePage * PAGE_SIZE + i} className="purchase-grid"
            style={{ padding:'12px 20px', borderBottom: i < slice.length - 1 ? '1px solid var(--border)' : 'none', alignItems:'center', fontSize:13, animation:'fadeIn 0.3s ease' }}
            onMouseEnter={e => (e.currentTarget.style.background = 'var(--card-hover)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
            <span style={{ color:'var(--text-muted)', fontFamily:'var(--mono)', fontSize:11 }}>{new Date(p.purchasedAt).toLocaleTimeString()}</span>
            <span style={{ fontWeight:500 }}>/{p.endpoint} <span style={{ color: p.endpoint === 'forecast' ? 'var(--secondary)' : 'var(--primary)', fontSize:11 }}>{prices[p.endpoint] ?? ''}</span></span>
            <span style={{ color:'var(--text-dim)', fontSize:12 }}>
              {firstResult(p.result) === '—'
                ? <span style={{ color:'var(--border)', fontSize:14 }} title="Result not saved (historic purchase)">·</span>
                : firstResult(p.result)}
            </span>
            <span style={{ fontFamily:'var(--mono)', fontSize:11, color: p.txid ? 'var(--text-dim)' : 'var(--text-muted)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', paddingRight:16 }}>{p.txid ?? '—'}</span>
            <span style={{ textAlign:'right' }}>
              {p.txid
                ? <a href={`${EXPLORER_BASE}/${p.txid}`} target="_blank" rel="noreferrer"
                    style={{ display:'inline-flex', alignItems:'center', gap:4, padding:'4px 12px', background:'var(--primary-dim)', border:'1px solid var(--primary)44', borderRadius:6, color:'var(--primary)', textDecoration:'none', fontSize:12, fontWeight:600 }}
                    onMouseEnter={e => { e.currentTarget.style.background = 'var(--primary)'; e.currentTarget.style.color = '#001a15'; }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'var(--primary-dim)'; e.currentTarget.style.color = 'var(--primary)'; }}>View ↗</a>
                : <span style={{ color:'var(--text-muted)', fontSize:12 }}>pending</span>}
            </span>
          </div>
        ))}

        {pages > 1 && (
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'10px 20px', borderTop:'1px solid var(--border)', background:'var(--bg)' }}>
            <span style={{ fontSize:11, color:'var(--text-muted)', fontFamily:'var(--mono)' }}>{from}–{to} of {sorted.length}</span>
            <div style={{ display:'flex', alignItems:'center', gap:4 }}>
              <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={safePage === 0}
                style={{ width:28, height:28, borderRadius:6, border:'1px solid var(--border)', background:'transparent', cursor: safePage === 0 ? 'not-allowed' : 'pointer', color: safePage === 0 ? 'var(--border)' : 'var(--text-muted)', fontSize:14 }}>‹</button>
              {visiblePages(safePage, pages).map((pg, i) =>
                typeof pg === 'number'
                  ? <button key={pg} onClick={() => setPage(pg)}
                      style={{ width:28, height:28, borderRadius:6, border:'1px solid', cursor:'pointer', fontSize:11, fontWeight:600, transition:'all 0.15s',
                        borderColor: pg === safePage ? 'var(--primary)' : 'var(--border)',
                        background:  pg === safePage ? 'var(--primary-dim)' : 'transparent',
                        color:       pg === safePage ? 'var(--primary)'     : 'var(--text-muted)',
                      }}>{pg + 1}</button>
                  : <span key={`e${i}`} style={{ width:20, textAlign:'center', color:'var(--text-muted)', fontSize:12, userSelect:'none' }}>…</span>
              )}
              <button onClick={() => setPage(p => Math.min(pages - 1, p + 1))} disabled={safePage === pages - 1}
                style={{ width:28, height:28, borderRadius:6, border:'1px solid var(--border)', background:'transparent', cursor: safePage === pages - 1 ? 'not-allowed' : 'pointer', color: safePage === pages - 1 ? 'var(--border)' : 'var(--text-muted)', fontSize:14 }}>›</button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
