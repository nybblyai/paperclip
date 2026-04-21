import { describe, expect, it } from "vitest";
import {
  buildTelegramMissionControlSummary,
  type TelegramMissionControlSummaryInput,
} from "../services/telegram-mission-control-summary.js";

function buildInput(
  overrides: Partial<TelegramMissionControlSummaryInput> = {},
): TelegramMissionControlSummaryInput {
  return {
    issue: {
      title: "Coordinate the next implementation slice",
      status: "todo",
      ownerAgentId: "agent-ork",
      assigneeAgentId: null,
      missionControl: {
        nextStep: "Operator reviews the implementation patch",
        needsHumanAttention: true,
        handoff: {
          fromAgentId: "agent-main",
          toAgentId: "agent-ork",
          reason: "Engineering implementation",
          requestedNextStep: "Take ownership of the patch",
          unblockCondition: "Patch is merged",
          timestamp: new Date("2026-04-18T15:00:00.000Z"),
          context: {
            issueId: "issue-1",
            identifier: "PAPER-101",
            title: "Coordinate the next implementation slice",
          },
        },
      },
      latestActivitySummary: {
        kind: "activity",
        action: "issue.updated",
        text: "Marked needs human attention",
        actorType: "user",
        actorId: "user-1",
        agentId: null,
        userId: "user-1",
        createdAt: new Date("2026-04-18T15:05:00.000Z"),
      },
      latestHandoffSummary: {
        kind: "handoff",
        action: "issue.handoff_updated",
        text: "Created handoff",
        actorType: "agent",
        actorId: "agent-main",
        agentId: "agent-main",
        userId: null,
        createdAt: new Date("2026-04-18T15:00:00.000Z"),
      },
    },
    comments: [
      {
        body: "Working through the patch now; I will update once the operator reviews it.",
        createdAt: new Date("2026-04-18T15:06:00.000Z"),
      },
    ],
    agentLabels: {
      "agent-main": "Main",
      "agent-ork": "Ork",
    },
    ...overrides,
  };
}

describe("buildTelegramMissionControlSummary", () => {
  it("keeps the same structured summary in both modes while transparent mode appends narration", () => {
    const summary = buildTelegramMissionControlSummary(buildInput({ mode: "summary" }));
    const transparent = buildTelegramMissionControlSummary(buildInput({ mode: "transparent" }));

    expect(summary.lines).toEqual([
      "Owner: Ork",
      "State: needs human attention",
      "Next: Operator reviews the implementation patch",
      "Handoff: Main -> Ork",
      "Latest: Marked needs human attention",
    ]);
    expect(summary.supportingNarration).toEqual([]);

    expect(transparent.lines).toEqual(summary.lines);
    expect(transparent.supportingNarration).toEqual([
      "Working through the patch now; I will update once the operator reviews it.",
    ]);
  });

  it("does not let comments override durable blocker truth in either mode", () => {
    const input = buildInput({
      issue: {
        title: "Review the latest patch",
        status: "todo",
        ownerAgentId: "agent-ork",
        assigneeAgentId: null,
        missionControl: {
          nextStep: "Wait for the operator review",
          needsHumanAttention: false,
          workflowState: {
            kind: "resumed",
            resumedFrom: "blocked_on_upstream",
            enteredAt: new Date("2026-04-18T16:00:00.000Z"),
          },
          handoff: null,
        },
        latestActivitySummary: {
          kind: "activity",
          action: "issue.updated",
          text: "Marked resumed from blocked on upstream",
          actorType: "user",
          actorId: "user-1",
          agentId: null,
          userId: "user-1",
          createdAt: new Date("2026-04-18T16:00:00.000Z"),
        },
        latestHandoffSummary: null,
      },
      comments: [
        {
          body: "Still blocked on the external API even though I resumed the issue.",
          createdAt: new Date("2026-04-18T16:01:00.000Z"),
        },
      ],
    });

    const summary = buildTelegramMissionControlSummary({ ...input, mode: "summary" });
    const transparent = buildTelegramMissionControlSummary({ ...input, mode: "transparent" });

    expect(summary.lines).toEqual([
      "Owner: Ork",
      "State: resumed",
      "Next: Wait for the operator review",
      "Latest: Marked resumed from blocked on upstream",
    ]);
    expect(summary.supportingNarration).toEqual([]);

    expect(transparent.lines).toEqual(summary.lines);
    expect(transparent.supportingNarration).toEqual([
      "Still blocked on the external API even though I resumed the issue.",
    ]);
  });
});
