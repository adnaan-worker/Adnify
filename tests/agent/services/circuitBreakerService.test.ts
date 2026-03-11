import { describe, expect, it } from 'vitest'

import { shouldTripCircuitBreaker } from '@renderer/agent/services/circuitBreakerService'

describe('circuit breaker', () => {
  it('trips when retries exceed threshold without net progress', () => {
    const result = shouldTripCircuitBreaker({
      retryCount: 3,
      repeatedCommands: 3,
      repeatedFiles: 2,
      progressDelta: 0,
    })

    expect(result.trip).toBe(true)
  })

  it('stays closed when progress is still being made', () => {
    const result = shouldTripCircuitBreaker({
      retryCount: 3,
      repeatedCommands: 3,
      repeatedFiles: 2,
      progressDelta: 1,
    })

    expect(result.trip).toBe(false)
  })
})
