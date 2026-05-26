export function Logo() {
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
