import type { WalletBalance } from '../hooks/useWeb3Auth';

export function OnboardingStepper({ balance, optingIn, address }: {
  balance: WalletBalance | null;
  optingIn: boolean;
  address: string | null;
}) {
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
          {address.slice(0, 10)}…{address.slice(-8)}
        </div>
      )}
    </div>
  );
}
