export function Skeleton({ className = '' }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={`animate-pulse rounded-[var(--raio-pequeno)] bg-borda motion-reduce:animate-none ${className}`}
    />
  )
}
