import { useMemo, useState } from 'react'

import type {
  AdjudicationActionType,
  AdjudicationCase,
  ChangeProposal,
  ExecutionTask,
  ProposalAction,
  SpecialistKind,
  TaskHandoff,
  WorkPackage,
} from '@renderer/agent/types/taskExecution'
import { findMatchingTaskTemplate } from '@renderer/agent/services/taskTemplateService'
import { useAgentStore } from '@renderer/agent/store/AgentStore'

import { AdjudicationPanel } from './AdjudicationPanel'
import { ChangeProposalPanel } from './ChangeProposalPanel'
import { ExecutionDiagnosticsPanel } from './ExecutionDiagnosticsPanel'
import { HandoffDetailPanel } from './HandoffDetailPanel'
import { RollbackProposalPanel } from './RollbackProposalPanel'
import { TaskTemplatePicker } from './TaskTemplatePicker'
import { WorkPackageColumn } from './WorkPackageColumn'
import { buildWorkPackageRuntimeActivity } from './workPackageRuntime'

interface ExecutionTaskPanelProps {
  task: ExecutionTask
  workPackages?: WorkPackage[]
  handoffs?: TaskHandoff[]
  changeProposals?: ChangeProposal[]
  selectedHandoffId?: string | null
  selectedProposalId?: string | null
  adjudicationCase?: AdjudicationCase | null
  onSelectHandoff?: (handoffId: string) => void
  onSelectProposal?: (proposalId: string) => void
  onResolveAdjudication?: (resolution: { action: AdjudicationActionType; selectedFiles?: string[]; targetSpecialist?: SpecialistKind }) => void
  onReviewProposal?: (proposalId: string, action: ProposalAction) => void
  onConfirmRollback?: () => void
}

export function ExecutionTaskPanel({
  task,
  workPackages = [],
  handoffs = [],
  changeProposals = [],
  selectedHandoffId = null,
  selectedProposalId = null,
  adjudicationCase = null,
  onSelectHandoff,
  onSelectProposal,
  onResolveAdjudication,
  onReviewProposal,
  onConfirmRollback,
}: ExecutionTaskPanelProps) {
  const [selectedWorkPackageId, setSelectedWorkPackageId] = useState<string | null>(null)
  const threads = useAgentStore((state) => state.threads)
  const runtimeThreads = Object.keys(threads).length > 0 ? threads : useAgentStore.getState().threads

  const handoffByPackage = new Map<string, TaskHandoff>()
  for (const handoff of handoffs) {
    if (!handoffByPackage.has(handoff.workPackageId)) {
      handoffByPackage.set(handoff.workPackageId, handoff)
    }
  }

  const proposalByPackage = new Map<string, ChangeProposal>()
  for (const proposal of changeProposals) {
    if (!proposalByPackage.has(proposal.workPackageId)) {
      proposalByPackage.set(proposal.workPackageId, proposal)
    }
  }

  const selectedProposal = changeProposals.find((proposal) => proposal.id === selectedProposalId)
    || changeProposals.find((proposal) => proposal.id === task.latestProposalId)
    || changeProposals[0]
    || null
  const selectedHandoff = handoffs.find((handoff) => handoff.id === selectedHandoffId) || handoffs[0] || null
  const matchedTemplate = findMatchingTaskTemplate(task.specialists)
  const workPackageActivities = useMemo(() => new Map(
    workPackages.map((workPackage) => [workPackage.id, buildWorkPackageRuntimeActivity(workPackage, workPackage.threadId ? runtimeThreads[workPackage.threadId] : null)]),
  ), [runtimeThreads, workPackages])

  const fallbackSelectedWorkPackageId = selectedWorkPackageId
    || selectedProposal?.workPackageId
    || selectedHandoff?.workPackageId
    || workPackages.find((workPackage) => ['executing', 'running', 'verifying', 'blocked', 'failed'].includes(workPackage.status))?.id
    || workPackages[0]?.id
    || null

  const selectedWorkPackage = fallbackSelectedWorkPackageId
    ? workPackages.find((workPackage) => workPackage.id === fallbackSelectedWorkPackageId) || null
    : null
  const selectedWorkPackageActivity = selectedWorkPackage
    ? workPackageActivities.get(selectedWorkPackage.id) || null
    : null

  return (
    <section className="rounded-2xl border border-border bg-surface/20 p-5 space-y-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-2">
          <div className="text-xs uppercase tracking-[0.2em] text-text-muted">Execution Task</div>
          <h2 className="text-xl font-semibold text-text-primary">{task.objective}</h2>
          <div className="flex flex-wrap gap-2 text-xs">
            <span className="px-2 py-1 rounded-full bg-accent/10 text-accent">{task.state}</span>
            <span className="px-2 py-1 rounded-full bg-background/60 text-text-secondary">{task.governanceState}</span>
            <span className="px-2 py-1 rounded-full bg-background/60 text-text-secondary">{task.trustMode}</span>
            {task.autonomyMode ? <span className="px-2 py-1 rounded-full bg-background/60 text-text-secondary">{task.autonomyMode}</span> : null}
            {task.patrol?.status ? <span className="px-2 py-1 rounded-full bg-background/60 text-text-secondary">{task.patrol.status}</span> : null}
            <span className="px-2 py-1 rounded-full bg-background/60 text-text-secondary">{task.executionTarget}</span>
            <span className="px-2 py-1 rounded-full bg-background/60 text-text-secondary">{task.risk}</span>
            <span className="px-2 py-1 rounded-full bg-background/60 text-text-secondary">Queued {task.queueSummary.queuedCount}</span>
            <span className="px-2 py-1 rounded-full bg-background/60 text-text-secondary">Pending proposals {task.proposalSummary.pendingCount}</span>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {task.specialists.map((specialist) => (
            <span key={specialist} className="px-3 py-1 rounded-full border border-border bg-background/50 text-xs text-text-primary">
              {specialist}
            </span>
          ))}
        </div>
      </div>

      <TaskTemplatePicker selectedTemplateId={matchedTemplate?.id ?? null} />

      <div className="space-y-2">
        <div className="text-xs uppercase tracking-[0.2em] text-text-muted">Specialists</div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {task.specialists.map((specialist) => {
            const profile = task.specialistProfilesSnapshot[specialist]
            return (
              <article key={specialist} className="rounded-xl border border-border bg-background/30 p-3 space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-medium text-text-primary">{specialist}</div>
                  {profile?.model ? <span className="text-[11px] text-accent">{profile.model}</span> : null}
                </div>
                <div className="text-[11px] text-text-secondary">
                  {[profile?.toolPermission, profile?.networkPermission, profile?.gitPermission].filter(Boolean).join(' · ')}
                </div>
                {profile?.styleHints ? <div className="text-xs text-text-secondary">{profile.styleHints}</div> : null}
              </article>
            )
          })}
        </div>
      </div>

      <div className="space-y-2">
        <div className="text-xs uppercase tracking-[0.2em] text-text-muted">Budget</div>
        <div className="flex flex-wrap gap-2 text-xs">
          <span className="px-2 py-1 rounded-full bg-background/60 text-text-secondary">
            {`LLM ${task.budget.usage.llmCalls}/${task.budget.limits.llmCalls}`}
          </span>
          <span className="px-2 py-1 rounded-full bg-background/60 text-text-secondary">
            {`Cmd ${task.budget.usage.commands}/${task.budget.limits.commands}`}
          </span>
          <span className="px-2 py-1 rounded-full bg-background/60 text-text-secondary">
            {`Verify ${task.budget.usage.verifications}/${task.budget.limits.verifications}`}
          </span>
          {task.budget.warningTriggered ? (
            <span className="px-2 py-1 rounded-full bg-amber-500/10 text-amber-300">warning</span>
          ) : null}
          {task.budget.tripReport ? (
            <span className="px-2 py-1 rounded-full bg-red-500/10 text-red-300">tripped</span>
          ) : null}
        </div>
      </div>

      <ExecutionDiagnosticsPanel
        task={task}
        workPackage={selectedWorkPackage}
        activity={selectedWorkPackageActivity}
      />

      {adjudicationCase ? (
        <AdjudicationPanel
          adjudicationCase={adjudicationCase}
          availableSpecialists={task.specialists}
          onResolve={onResolveAdjudication}
        />
      ) : null}
      {task.rollback.proposal ? <RollbackProposalPanel rollback={task.rollback} onConfirm={onConfirmRollback} /> : null}

      <div className="grid gap-3 lg:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)]">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {workPackages.length > 0 ? workPackages.map((workPackage) => {
            const handoff = handoffByPackage.get(workPackage.id) || null
            const proposal = proposalByPackage.get(workPackage.id) || null
            return (
              <WorkPackageColumn
                key={workPackage.id}
                workPackage={workPackage}
                handoff={handoff}
                proposal={proposal}
                activity={workPackageActivities.get(workPackage.id) || null}
                selected={proposal?.id === selectedProposal?.id || handoff?.id === selectedHandoffId || workPackage.id === fallbackSelectedWorkPackageId}
                onSelectHandoff={onSelectHandoff}
                onSelectProposal={onSelectProposal}
                onSelectWorkPackage={setSelectedWorkPackageId}
              />
            )
          }) : (
            <div className="rounded-xl border border-dashed border-border p-4 text-sm text-text-muted">
              暂无工作包
            </div>
          )}
        </div>

        {selectedProposal ? (
          <ChangeProposalPanel proposal={selectedProposal} onReview={onReviewProposal} />
        ) : (
          <HandoffDetailPanel
            handoff={selectedHandoff}
            workPackage={selectedWorkPackage}
            activity={selectedWorkPackageActivity}
          />
        )}
      </div>
    </section>
  )
}

export default ExecutionTaskPanel
