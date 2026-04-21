import type { IssueComment, IssueMissionControlMetadata, IssueStatus } from "@paperclipai/shared";

export type TelegramMissionControlMode = "summary" | "transparent";

type TelegramMissionControlIssue = {
  title: string;
  status: IssueStatus;
  ownerAgentId?: string | null;
  assigneeAgentId?: string | null;
  missionControl?: IssueMissionControlMetadata | null;
  latestActivitySummary?: { text: string } | null;
  latestHandoffSummary?: { text: string } | null;
};

export interface TelegramMissionControlSummaryInput {
  issue: TelegramMissionControlIssue;
  comments?: Pick<IssueComment, "body" | "createdAt">[];
  mode?: TelegramMissionControlMode;
  agentLabels?: Record<string, string>;
  maxTransparentComments?: number;
}

export interface TelegramMissionControlSummary {
  lines: string[];
  supportingNarration: string[];
}

function readAgentLabel(
  agentId: string | null | undefined,
  labels: Record<string, string> | undefined,
): string | null {
  if (!agentId) return null;
  return labels?.[agentId] ?? agentId;
}

function summarizeState(issue: TelegramMissionControlIssue): string {
  const workflowKind = issue.missionControl?.workflowState?.kind ?? null;
  if (issue.missionControl?.needsHumanAttention === true) return "needs human attention";
  if (issue.status === "in_review") return "in review";
  if (issue.status === "done") return "done";
  if (issue.status === "cancelled") return "cancelled";
  if (issue.status === "blocked") return "blocked";
  if (workflowKind === "waiting_on_human") return "waiting on human";
  if (workflowKind === "blocked_on_upstream") return "blocked on upstream";
  if (workflowKind === "handed_off") return "handed off";
  if (workflowKind === "resumed") return "resumed";
  return issue.status.replace(/_/g, " ");
}

function summarizeHandoff(
  missionControl: IssueMissionControlMetadata | null | undefined,
  labels: Record<string, string> | undefined,
): string | null {
  const handoff = missionControl?.handoff;
  if (!handoff) return null;
  const from = readAgentLabel(handoff.fromAgentId, labels) ?? "Unknown";
  const to = readAgentLabel(handoff.toAgentId, labels) ?? "Unknown";
  return `${from} -> ${to}`;
}

function pickTransparentComments(
  comments: Pick<IssueComment, "body" | "createdAt">[] | undefined,
  maxCount: number,
): string[] {
  if (!comments?.length || maxCount <= 0) return [];
  return [...comments]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .map((comment) => comment.body.trim())
    .filter((body) => body.length > 0)
    .slice(0, maxCount)
    .reverse();
}

export function buildTelegramMissionControlSummary(
  input: TelegramMissionControlSummaryInput,
): TelegramMissionControlSummary {
  const { issue, mode = "summary", agentLabels, maxTransparentComments = 2 } = input;
  const lines: string[] = [];
  const owner = readAgentLabel(issue.ownerAgentId ?? issue.assigneeAgentId, agentLabels);
  if (owner) {
    lines.push(`Owner: ${owner}`);
  }

  lines.push(`State: ${summarizeState(issue)}`);

  const nextStep =
    issue.missionControl?.nextStep
    ?? issue.missionControl?.handoff?.requestedNextStep
    ?? null;
  if (nextStep) {
    lines.push(`Next: ${nextStep}`);
  }

  const handoffSummary = summarizeHandoff(issue.missionControl, agentLabels);
  if (handoffSummary) {
    lines.push(`Handoff: ${handoffSummary}`);
  }

  if (issue.latestActivitySummary?.text) {
    lines.push(`Latest: ${issue.latestActivitySummary.text}`);
  } else if (issue.latestHandoffSummary?.text) {
    lines.push(`Latest: ${issue.latestHandoffSummary.text}`);
  }

  const supportingNarration =
    mode === "transparent"
      ? pickTransparentComments(input.comments, maxTransparentComments)
      : [];

  return {
    lines,
    supportingNarration,
  };
}
