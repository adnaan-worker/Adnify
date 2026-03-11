import type { ModelRoutingPolicy, SpecialistKind } from '../types/taskExecution'

export interface ModelRoutingBudgetSnapshot {
  warningTriggered?: boolean
  warningThresholdRatio?: number
  usage?: Partial<Record<'timeMs' | 'estimatedTokens' | 'llmCalls' | 'commands' | 'verifications', number>>
  limits?: Partial<Record<'timeMs' | 'estimatedTokens' | 'llmCalls' | 'commands' | 'verifications', number>>
}

export interface ResolveModelRouteInput {
  policy: ModelRoutingPolicy
  specialist: SpecialistKind
  specialistModel?: string | null
  defaultModel: string
  availableModels: string[]
  budget?: ModelRoutingBudgetSnapshot | null
}

export interface ModelRouteDecision {
  model: string
  reason: 'specialist-explicit' | 'balanced-default' | 'budget-aware-fallback' | 'global-default'
  degraded: boolean
}


export interface ResolvedProviderContext {
  providerId: string
  defaultModel: string
  availableModels: string[]
}

export interface ResolveSpecialistRouteInput {
  policy: ModelRoutingPolicy
  specialist: SpecialistKind
  specialistProvider?: string | null
  specialistModel?: string | null
  defaultProvider: string
  resolveProviderContext: (providerId: string) => ResolvedProviderContext
  budget?: ModelRoutingBudgetSnapshot | null
}

export interface SpecialistRouteDecision extends ModelRouteDecision {
  providerId: string
  providerReason: 'specialist-explicit' | 'global-default'
}

const SPECIALIST_MODEL_PREFERENCES: Record<SpecialistKind, RegExp[]> = {
  frontend: [/sonnet/i, /gpt-4o/i, /gpt-4\.1/i, /o1/i, /o3/i, /pro/i],
  logic: [/o3/i, /o1/i, /sonnet/i, /gpt-4\.1/i, /gpt-4o/i, /pro/i],
  verifier: [/mini/i, /haiku/i, /flash/i, /gpt-4o/i, /sonnet/i],
  reviewer: [/mini/i, /haiku/i, /flash/i, /gpt-4o/i, /sonnet/i],
}

const ECONOMY_MODEL_PREFERENCES: RegExp[] = [/mini/i, /haiku/i, /flash/i]

function normalizeModels(defaultModel: string, availableModels: string[]): string[] {
  const models = [defaultModel, ...availableModels].filter(Boolean)
  return Array.from(new Set(models))
}

function selectByPreferences(models: string[], patterns: RegExp[]): string | null {
  for (const pattern of patterns) {
    const match = models.find((model) => pattern.test(model))
    if (match) return match
  }

  return null
}

function isBudgetPressureActive(budget?: ModelRoutingBudgetSnapshot | null): boolean {
  if (!budget) return false
  if (budget.warningTriggered) return true

  const threshold = budget.warningThresholdRatio ?? 0.8
  const dimensions = Object.keys(budget.usage || {}) as Array<keyof NonNullable<ModelRoutingBudgetSnapshot['usage']>>

  return dimensions.some((dimension) => {
    const limit = budget.limits?.[dimension]
    const usage = budget.usage?.[dimension]

    if (!limit || !usage) return false
    return usage >= limit * threshold
  })
}

export function resolveModelRoute(input: ResolveModelRouteInput): ModelRouteDecision {
  const explicitModel = input.specialistModel?.trim()
  if (explicitModel) {
    return {
      model: explicitModel,
      reason: 'specialist-explicit',
      degraded: false,
    }
  }

  const models = normalizeModels(input.defaultModel, input.availableModels)
  const balancedModel = selectByPreferences(models, SPECIALIST_MODEL_PREFERENCES[input.specialist]) || input.defaultModel

  if (input.policy === 'manual') {
    return {
      model: input.defaultModel,
      reason: 'global-default',
      degraded: false,
    }
  }

  if (input.policy === 'budget-aware' && isBudgetPressureActive(input.budget)) {
    const cheaperModel = selectByPreferences(models, ECONOMY_MODEL_PREFERENCES)
    if (cheaperModel && cheaperModel !== balancedModel) {
      return {
        model: cheaperModel,
        reason: 'budget-aware-fallback',
        degraded: true,
      }
    }

    if (cheaperModel) {
      return {
        model: cheaperModel,
        reason: 'budget-aware-fallback',
        degraded: cheaperModel !== input.defaultModel,
      }
    }
  }

  if (balancedModel) {
    return {
      model: balancedModel,
      reason: 'balanced-default',
      degraded: false,
    }
  }

  return {
    model: input.defaultModel,
    reason: 'global-default',
    degraded: false,
  }
}


export function resolveSpecialistRoute(input: ResolveSpecialistRouteInput): SpecialistRouteDecision {
  const providerId = input.specialistProvider?.trim() || input.defaultProvider
  const providerContext = input.resolveProviderContext(providerId)
  const modelDecision = resolveModelRoute({
    policy: input.policy,
    specialist: input.specialist,
    specialistModel: input.specialistModel,
    defaultModel: providerContext.defaultModel,
    availableModels: providerContext.availableModels,
    budget: input.budget,
  })

  return {
    ...modelDecision,
    providerId,
    providerReason: input.specialistProvider?.trim() ? 'specialist-explicit' : 'global-default',
  }
}
