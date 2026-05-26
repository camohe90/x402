import { EXPLORER_BASE } from '../constants';
import { condIcon, formatKey, formatVal } from '../utils/format';

export function ResultCard({ endpoint, data, celebrate, txid }: {
  endpoint: string;
  data: Record<string, unknown>;
  celebrate: boolean;
  txid?: string;
}) {
  const { paidVia, timestamp, ...rest } = data;
  const paidViaStr   = paidVia   != null ? String(paidVia)   : undefined;
  const timestampStr = timestamp != null ? String(timestamp) : undefined;

  const shell = (children: React.ReactNode) => (
    <div style={{ background:'var(--card)', border:'1px solid var(--success)', borderRadius:16, padding:24, boxShadow: celebrate ? '0 0 40px var(--success)66' : '0 0 24px var(--success-dim)', animation: celebrate ? 'celebrate 0.5s ease' : 'fadeIn 0.5s ease', transition:'box-shadow 0.6s ease' }}>
      {celebrate && <div style={{ textAlign:'center', fontSize:11, fontWeight:600, letterSpacing:'0.1em', textTransform:'uppercase', color:'var(--success)', marginBottom:10, animation:'fadeIn 0.3s ease' }}>✓ Payment successful</div>}
      {children}
      {paidViaStr && <div style={{ background:'var(--success-dim)', border:'1px solid var(--success)33', borderRadius:8, padding:'8px 12px', fontSize:11, fontFamily:'var(--mono)', color:'var(--success)', textAlign:'center' }}>{paidViaStr}</div>}
      {timestampStr && <div style={{ fontSize:11, color:'var(--text-muted)', textAlign:'center', marginTop:8 }}>{new Date(timestampStr).toLocaleTimeString()}</div>}
      {txid && (
        <a href={`${EXPLORER_BASE}/${txid}`} target="_blank" rel="noreferrer"
          style={{ display:'flex', alignItems:'center', justifyContent:'center', gap:6, marginTop:12, padding:'8px', background:'var(--primary-dim)', border:'1px solid var(--primary)33', borderRadius:8, color:'var(--primary)', textDecoration:'none', fontSize:12, fontWeight:600 }}>
          View on Lora ↗
        </a>
      )}
    </div>
  );

  const city        = typeof rest['city']        === 'string' ? rest['city']        : null;
  const temperature = typeof rest['temperature'] === 'number' ? rest['temperature'] : null;
  const condition   = typeof rest['condition']   === 'string' ? rest['condition']   : null;
  const humidity    = typeof rest['humidity']    === 'number' ? rest['humidity']    : null;
  const days        = Array.isArray(rest['days']) ? (rest['days'] as Record<string, unknown>[]) : null;

  // Weather shape
  if (city && temperature !== null && condition) {
    const extraScalars = Object.entries(rest).filter(([k, v]) =>
      !['city','temperature','condition','humidity'].includes(k) && !Array.isArray(v) && typeof v !== 'object' && v !== null
    ) as [string, string | number | boolean][];
    const chips: [string, string][] = humidity !== null ? [['Humidity', `${humidity}%`], ['Network', 'Testnet']] : [['Network', 'Testnet']];
    return shell(
      <>
        <div style={{ fontSize:56, marginBottom:8, textAlign:'center' }}>{condIcon(condition)}</div>
        <div style={{ textAlign:'center', marginBottom:16 }}>
          <div style={{ fontSize:22, fontWeight:700 }}>{city}</div>
          <div style={{ fontSize:40, fontWeight:300, color:'var(--primary)', lineHeight:1.1 }}>{temperature}°F</div>
          <div style={{ color:'var(--text-dim)', marginTop:4 }}>{condition}</div>
        </div>
        <div style={{ display:'grid', gridTemplateColumns:`repeat(${chips.length},1fr)`, gap:8, marginBottom:16 }}>
          {chips.map(([l, v]) => (
            <div key={l} style={{ background:'var(--bg)', borderRadius:8, padding:'8px 12px', textAlign:'center' }}>
              <div style={{ fontSize:10, color:'var(--text-muted)', marginBottom:2 }}>{l}</div>
              <div style={{ fontSize:14, fontWeight:600 }}>{v}</div>
            </div>
          ))}
        </div>
        {extraScalars.length > 0 && (
          <div style={{ display:'flex', flexDirection:'column', gap:6, marginBottom:16 }}>
            {extraScalars.map(([k, v]) => (
              <div key={k} style={{ display:'flex', justifyContent:'space-between', padding:'7px 12px', background:'var(--bg)', borderRadius:8 }}>
                <span style={{ fontSize:12, color:'var(--text-muted)' }}>{formatKey(k)}</span>
                <span style={{ fontSize:13, fontWeight:600 }}>{formatVal(v)}</span>
              </div>
            ))}
          </div>
        )}
      </>
    );
  }

  // Forecast shape
  if (city && days) {
    return shell(
      <>
        <div style={{ textAlign:'center', marginBottom:16 }}>
          <div style={{ fontSize:22, fontWeight:700 }}>{city}</div>
          <div style={{ fontSize:11, color:'var(--text-muted)', marginTop:4 }}>{days.length}-day forecast</div>
        </div>
        <div style={{ display:'flex', flexDirection:'column', gap:6, marginBottom:16 }}>
          {days.map((day, i) => {
            const date    = typeof day['date']      === 'string' ? day['date']      : '';
            const tMax    = typeof day['tempMax']   === 'number' ? day['tempMax']   : null;
            const tMin    = typeof day['tempMin']   === 'number' ? day['tempMin']   : null;
            const dayCond = typeof day['condition'] === 'string' ? day['condition'] : '';
            return (
              <div key={date || i} style={{ display:'grid', gridTemplateColumns:'80px 28px 1fr auto', gap:8, alignItems:'center', padding:'6px 8px', borderRadius:8, background: i === 0 ? 'var(--primary-dim)' : 'var(--bg)' }}>
                <span style={{ fontSize:12, color: i === 0 ? 'var(--primary)' : 'var(--text-muted)', fontWeight: i === 0 ? 600 : 400 }}>
                  {i === 0 ? 'Today' : new Date(date + 'T12:00:00').toLocaleDateString('en', { weekday:'short', month:'short', day:'numeric' })}
                </span>
                <span style={{ fontSize:18 }}>{condIcon(dayCond)}</span>
                <span style={{ fontSize:11, color:'var(--text-muted)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{dayCond}</span>
                {tMax !== null && tMin !== null ? (
                  <span style={{ fontFamily:'var(--mono)', fontSize:12, fontWeight:600, whiteSpace:'nowrap' }}>
                    <span style={{ color:'var(--primary)' }}>{tMax}°</span>
                    <span style={{ color:'var(--text-muted)', fontWeight:400 }}> / {tMin}°</span>
                  </span>
                ) : null}
              </div>
            );
          })}
        </div>
      </>
    );
  }

  // Generic fallback
  const scalars = Object.entries(rest).filter(([, v]) => !Array.isArray(v) && typeof v !== 'object' && v !== null) as [string, string | number | boolean][];
  const arrays  = Object.entries(rest).filter(([, v]) => Array.isArray(v)) as [string, Record<string, unknown>[]][];
  return shell(
    <>
      <div style={{ textAlign:'center', fontSize:13, fontWeight:600, letterSpacing:'0.06em', textTransform:'uppercase', color:'var(--text-muted)', marginBottom:16 }}>{endpoint}</div>
      {scalars.length > 0 && (
        <div style={{ display:'grid', gridTemplateColumns:'repeat(2,1fr)', gap:8, marginBottom: arrays.length ? 16 : 12 }}>
          {scalars.map(([k, v]) => (
            <div key={k} style={{ background:'var(--bg)', borderRadius:8, padding:'8px 12px', textAlign:'center' }}>
              <div style={{ fontSize:10, color:'var(--text-muted)', marginBottom:2 }}>{formatKey(k)}</div>
              <div style={{ fontSize:13, fontWeight:600, fontFamily:'var(--mono)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                {k === 'condition' ? `${condIcon(String(v))} ${v}` : formatVal(v)}
              </div>
            </div>
          ))}
        </div>
      )}
      {arrays.map(([k, arr]) => (
        <div key={k} style={{ marginBottom:12 }}>
          <div style={{ fontSize:10, fontWeight:600, letterSpacing:'0.08em', textTransform:'uppercase', color:'var(--text-muted)', marginBottom:6 }}>{formatKey(k)}</div>
          <div style={{ display:'flex', flexDirection:'column', gap:4, maxHeight:220, overflowY:'auto' }}>
            {arr.map((item, i) => {
              const condVal = typeof item['condition'] === 'string' ? item['condition'] : null;
              const entries = Object.entries(item).filter(([, v]) => typeof v !== 'object' && v !== null);
              return (
                <div key={i} style={{ display:'flex', gap:8, alignItems:'center', padding:'5px 10px', fontSize:12, background: i === 0 ? 'var(--primary-dim)' : 'var(--bg)', borderRadius:6, flexWrap:'wrap' }}>
                  {condVal ? <span style={{ fontSize:16 }}>{condIcon(condVal)}</span> : null}
                  {entries.map(([ek, v], j) => (
                    <span key={ek} style={{ color: i === 0 && j === 0 ? 'var(--primary)' : 'var(--text-dim)' }}>
                      {ek === 'condition' ? String(v) : formatVal(v)}
                    </span>
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </>
  );
}
