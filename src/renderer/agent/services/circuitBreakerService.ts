export interface CircuitBreakerInput {
  retryCount: number
  repeatedCommands: number
  repeatedFiles: number
  progressDelta: number
}

export type CircuitBreakerResult =
  | { trip: true; reason: string }
  | { trip: false }

export function shouldTripCircuitBreaker(input: CircuitBreakerInput): CircuitBreakerResult {
  const stalled = input.progressDelta <= 0
  const repeated = input.retryCount >= 3 || input.repeatedCommands >= 3 || input.repeatedFiles >= 2

  return repeated && stalled
    ? { trip: true, reason: 'Detected repeated work without net progress' }
    : { trip: false }
}
