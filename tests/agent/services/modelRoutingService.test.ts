import { describe, expect, it } from 'vitest'

import { resolveModelRoute, resolveRuntimeAgentRoute } from '@renderer/agent/services/modelRoutingService'

describe('modelRoutingService', () => {
  it('keeps the explicit specialist model ahead of routing policy changes', () => {
    const decision = resolveModelRoute({
      policy: 'budget-aware',
      specialist: 'frontend',
      specialistModel: 'claude-3-5-haiku-20241022',
      defaultModel: 'claude-sonnet-4-20250514',
      availableModels: ['claude-sonnet-4-20250514', 'claude-3-5-haiku-20241022'],
      budget: {
        warningTriggered: true,
        warningThresholdRatio: 0.8,
        usage: { llmCalls: 8, estimatedTokens: 90000 },
        limits: { llmCalls: 10, estimatedTokens: 100000 },
      },
    })

    expect(decision.model).toBe('claude-3-5-haiku-20241022')
    expect(decision.reason).toBe('specialist-explicit')
    expect(decision.degraded).toBe(false)
  })

  it('picks a role-appropriate balanced model when no explicit specialist model is configured', () => {
    const decision = resolveModelRoute({
      policy: 'balanced',
      specialist: 'verifier',
      specialistModel: null,
      defaultModel: 'gpt-4o',
      availableModels: ['gpt-4o', 'gpt-4o-mini', 'o1-mini'],
      budget: {
        warningTriggered: false,
        warningThresholdRatio: 0.8,
        usage: { llmCalls: 1, estimatedTokens: 1000 },
        limits: { llmCalls: 10, estimatedTokens: 100000 },
      },
    })

    expect(decision.model).toBe('gpt-4o-mini')
    expect(decision.reason).toBe('balanced-default')
    expect(decision.degraded).toBe(false)
  })

  it('degrades to a cheaper model when budget-aware routing sees pressure', () => {
    const decision = resolveModelRoute({
      policy: 'budget-aware',
      specialist: 'logic',
      specialistModel: null,
      defaultModel: 'gpt-4o',
      availableModels: ['gpt-4o', 'gpt-4o-mini'],
      budget: {
        warningTriggered: true,
        warningThresholdRatio: 0.8,
        usage: { llmCalls: 9, estimatedTokens: 85000 },
        limits: { llmCalls: 10, estimatedTokens: 100000 },
      },
    })

    expect(decision.model).toBe('gpt-4o-mini')
    expect(decision.reason).toBe('budget-aware-fallback')
    expect(decision.degraded).toBe(true)
  })

  it('preserves explicit coordinator model overrides ahead of routing pressure', () => {
    const decision = resolveRuntimeAgentRoute({
      policy: 'budget-aware',
      runtimeRole: 'coordinator',
      roleProvider: 'anthropic',
      roleModel: 'claude-sonnet-4-20250514',
      defaultProvider: 'openai',
      resolveProviderContext: (providerId) => {
        if (providerId === 'anthropic') {
          return {
            providerId,
            defaultModel: 'claude-sonnet-4-20250514',
            availableModels: ['claude-sonnet-4-20250514', 'claude-3-5-haiku-20241022'],
          }
        }
        return {
          providerId,
          defaultModel: 'gpt-4o',
          availableModels: ['gpt-4o', 'gpt-4o-mini'],
        }
      },
      budget: {
        warningTriggered: true,
        warningThresholdRatio: 0.8,
        usage: { llmCalls: 9, estimatedTokens: 85000 },
        limits: { llmCalls: 10, estimatedTokens: 100000 },
      },
    })

    expect(decision.providerId).toBe('anthropic')
    expect(decision.providerReason).toBe('role-explicit')
    expect(decision.model).toBe('claude-sonnet-4-20250514')
    expect(decision.reason).toBe('specialist-explicit')
  })

  it('routes patrol to a cheaper fallback when budget pressure is active', () => {
    const decision = resolveRuntimeAgentRoute({
      policy: 'budget-aware',
      runtimeRole: 'patrol',
      roleProvider: null,
      roleModel: null,
      defaultProvider: 'openai',
      resolveProviderContext: (providerId) => ({
        providerId,
        defaultModel: 'gpt-4o',
        availableModels: ['gpt-4o', 'gpt-4o-mini'],
      }),
      budget: {
        warningTriggered: true,
        warningThresholdRatio: 0.8,
        usage: { llmCalls: 9, estimatedTokens: 85000 },
        limits: { llmCalls: 10, estimatedTokens: 100000 },
      },
    })

    expect(decision.providerId).toBe('openai')
    expect(decision.model).toBe('gpt-4o-mini')
    expect(decision.reason).toBe('budget-aware-fallback')
  })

})
