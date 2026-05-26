export function Skeleton({ width, height, radius = 6 }: { width: string | number; height: number; radius?: number }) {
  return <div className="skeleton" style={{ width, height, borderRadius: radius }} />;
}

export function InitSkeleton() {
  return (
    <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:16, padding:'0 20px' }}>
      <Skeleton width={220} height={52} radius={12} />
      <Skeleton width={160} height={16} radius={8} />
    </div>
  );
}
