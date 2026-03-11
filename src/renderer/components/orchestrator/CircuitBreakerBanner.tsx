import type { CircuitBreakerState } from '@renderer/agent/types/taskExecution'

interface CircuitBreakerBannerProps {
  circuitBreaker: CircuitBreakerState
}

export function CircuitBreakerBanner({ circuitBreaker }: CircuitBreakerBannerProps) {
  if (!circuitBreaker.tripped) {
    return null
  }

  return (
    <section className="rounded-2xl border border-red-500/40 bg-red-500/10 p-4 space-y-2">
      <div className="text-sm font-semibold text-red-200">Circuit breaker tripped</div>
      <div className="text-sm text-red-100">{circuitBreaker.reason}</div>
      <div className="text-xs text-red-100/90">
        Retries {circuitBreaker.metrics.retryCount} · Repeated commands {circuitBreaker.metrics.repeatedCommands} · Repeated files {circuitBreaker.metrics.repeatedFiles} · Progress Δ {circuitBreaker.metrics.progressDelta}
      </div>
    </section>
  )
}

export default CircuitBreakerBanner
