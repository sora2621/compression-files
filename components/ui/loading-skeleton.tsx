export function LoadingSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-3" aria-label="読み込み中" aria-busy="true">
      {Array.from({ length: rows }, (_, index) => (
        <div
          key={index}
          className="h-20 animate-pulse rounded-2xl bg-[var(--surface-subtle)] motion-reduce:animate-none"
        />
      ))}
      <span className="sr-only">読み込んでいます</span>
    </div>
  );
}
