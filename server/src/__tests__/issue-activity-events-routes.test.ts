import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { normalizeIssueExecutionPolicy } from "../services/issue-execution-policy.ts";

const mockIssueService = vi.hoisted(() => ({
  getById: vi.fn(),
  assertCheckoutOwner: vi.fn(),
  update: vi.fn(),
  addComment: vi.fn(),
  findMentionedAgents: vi.fn(),
  getRelationSummaries: vi.fn(),
  listWakeableBlockedDependents: vi.fn(),
  getWakeableParentAfterChildCompletion: vi.fn(),
}));

const mockLogActivity = vi.hoisted(() => vi.fn(async () => undefined));
const mockAccessService = vi.hoisted(() => ({
  canUser: vi.fn(async () => false),
  hasPermission: vi.fn(async () => false),
}));
const mockAgentService = vi.hoisted(() => ({
  getById: vi.fn(async () => null),
  resolveByReference: vi.fn(async (_companyId: string, raw: string) => ({
    ambiguous: false,
    agent: { id: raw },
  })),
}));
const mockBoardAuthService = vi.hoisted(() => ({
  findBoardApiKeyByToken: vi.fn(async () => null),
  resolveBoardAccess: vi.fn(),
  touchBoardApiKey: vi.fn(),
}));

vi.mock("../services/index.js", () => ({
  accessService: () => mockAccessService,
  agentService: () => mockAgentService,
  documentService: () => ({}),
  executionWorkspaceService: () => ({}),
  feedbackService: () => ({
    listIssueVotesForUser: vi.fn(async () => []),
    saveIssueVote: vi.fn(async () => ({ vote: null, consentEnabledNow: false, sharingEnabled: false })),
  }),
  goalService: () => ({}),
  heartbeatService: () => ({
    wakeup: vi.fn(async () => undefined),
    reportRunActivity: vi.fn(async () => undefined),
    getRun: vi.fn(async () => null),
    getActiveRunForAgent: vi.fn(async () => null),
    cancelRun: vi.fn(async () => null),
  }),
  instanceSettingsService: () => ({
    get: vi.fn(async () => ({
      id: "instance-settings-1",
      general: {
        censorUsernameInLogs: false,
        feedbackDataSharingPreference: "prompt",
      },
    })),
    listCompanyIds: vi.fn(async () => ["company-1"]),
  }),
  issueApprovalService: () => ({}),
  issueService: () => mockIssueService,
  logActivity: mockLogActivity,
  projectService: () => ({}),
  routineService: () => ({
    syncRunStatusForIssue: vi.fn(async () => undefined),
  }),
  workProductService: () => ({}),
}));

vi.mock("../services/board-auth.js", () => ({
  boardAuthService: () => mockBoardAuthService,
}));

async function createApp(actor: Record<string, unknown> = {
  type: "board",
  userId: "local-board",
  companyIds: ["company-1"],
  source: "local_implicit",
  isInstanceAdmin: false,
}) {
  const [{ issueRoutes }, { errorHandler }] = await Promise.all([
    vi.importActual<typeof import("../routes/issues.js")>("../routes/issues.js"),
    vi.importActual<typeof import("../middleware/index.js")>("../middleware/index.js"),
  ]);
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).actor = actor;
    next();
  });
  app.use("/api", issueRoutes({} as any, {} as any));
  app.use(errorHandler);
  return app;
}

function createSelectChain(rows: unknown[]) {
  return {
    from() {
      return {
        where() {
          return Promise.resolve(rows);
        },
      };
    },
  };
}

function createAuthenticatedAgentDb(input: {
  token: string;
  keyId?: string;
  agentId: string;
  companyId: string;
}) {
  const select = vi
    .fn()
    .mockImplementationOnce(() =>
      createSelectChain([
        {
          id: input.keyId ?? "agent-key-1",
          agentId: input.agentId,
          companyId: input.companyId,
          keyHash: createHash("sha256").update(input.token).digest("hex"),
          revokedAt: null,
        },
      ]))
    .mockImplementationOnce(() =>
      createSelectChain([
        {
          id: input.agentId,
          companyId: input.companyId,
          status: "active",
        },
      ]));

  const update = vi.fn(() => ({
    set: vi.fn(() => ({
      where: vi.fn().mockResolvedValue(undefined),
    })),
  }));

  return { select, update } as any;
}

async function createAuthenticatedAgentApp(input: {
  token: string;
  agentId: string;
  companyId: string;
}) {
  const [{ issueRoutes }, { errorHandler }, { actorMiddleware }] = await Promise.all([
    vi.importActual<typeof import("../routes/issues.js")>("../routes/issues.js"),
    vi.importActual<typeof import("../middleware/index.js")>("../middleware/index.js"),
    vi.importActual<typeof import("../middleware/auth.js")>("../middleware/auth.js"),
  ]);
  const app = express();
  app.use(express.json());
  app.use(
    actorMiddleware(createAuthenticatedAgentDb(input), {
      deploymentMode: "authenticated",
    }),
  );
  app.use("/api", issueRoutes({} as any, {} as any));
  app.use(errorHandler);
  return app;
}

function makeIssue() {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    companyId: "company-1",
    status: "todo",
    assigneeAgentId: "22222222-2222-4222-8222-222222222222",
    assigneeUserId: null,
    createdByUserId: "local-board",
    identifier: "PAP-580",
    title: "Activity event issue",
    executionPolicy: null,
    executionState: null,
  };
}

describe("issue activity event routes", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doUnmock("../routes/issues.js");
    vi.doUnmock("../routes/authz.js");
    vi.doUnmock("../middleware/index.js");
    vi.resetAllMocks();
    mockIssueService.assertCheckoutOwner.mockResolvedValue({ adoptedFromRunId: null });
    mockIssueService.findMentionedAgents.mockResolvedValue([]);
    mockIssueService.getRelationSummaries.mockResolvedValue({ blockedBy: [], blocks: [] });
    mockIssueService.listWakeableBlockedDependents.mockResolvedValue([]);
    mockIssueService.getWakeableParentAfterChildCompletion.mockResolvedValue(null);
    mockAccessService.canUser.mockResolvedValue(false);
    mockAccessService.hasPermission.mockResolvedValue(false);
    mockAgentService.getById.mockResolvedValue(null);
    mockAgentService.resolveByReference.mockImplementation(async (_companyId: string, raw: string) => ({
      ambiguous: false,
      agent: { id: raw },
    }));
    mockBoardAuthService.findBoardApiKeyByToken.mockResolvedValue(null);
    mockBoardAuthService.resolveBoardAccess.mockReset();
    mockBoardAuthService.touchBoardApiKey.mockReset();
  });

  it("logs blocker activity with added and removed issue summaries", async () => {
    const issue = makeIssue();
    mockIssueService.getById.mockResolvedValue(issue);
    mockIssueService.getRelationSummaries
      .mockResolvedValueOnce({
        blockedBy: [
          {
            id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            identifier: "PAP-10",
            title: "Old blocker",
            status: "todo",
            priority: "medium",
            assigneeAgentId: null,
            assigneeUserId: null,
          },
        ],
        blocks: [],
      })
      .mockResolvedValueOnce({
        blockedBy: [
          {
            id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
            identifier: "PAP-11",
            title: "New blocker",
            status: "todo",
            priority: "medium",
            assigneeAgentId: null,
            assigneeUserId: null,
          },
        ],
        blocks: [],
      });
    mockIssueService.update.mockImplementation(async (_id: string, patch: Record<string, unknown>) => ({
      ...issue,
      ...patch,
      updatedAt: new Date(),
    }));

    const res = await request(await createApp())
      .patch("/api/issues/11111111-1111-4111-8111-111111111111")
      .send({ blockedByIssueIds: ["bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"] });

    expect(res.status).toBe(200);
    await vi.waitFor(() => {
      expect(mockLogActivity).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          action: "issue.blockers_updated",
          details: expect.objectContaining({
            addedBlockedByIssueIds: ["bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"],
            removedBlockedByIssueIds: ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"],
            addedBlockedByIssues: [
              {
                id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
                identifier: "PAP-11",
                title: "New blocker",
              },
            ],
            removedBlockedByIssues: [
              {
                id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
                identifier: "PAP-10",
                title: "Old blocker",
              },
            ],
          }),
        }),
      );
    });
  }, 15_000);

  it("logs explicit reviewer and approver activity when execution policy participants change", async () => {
    const existingPolicy = normalizeIssueExecutionPolicy({
      stages: [
        {
          id: "11111111-1111-4111-8111-111111111111",
          type: "review",
          participants: [{ type: "agent", agentId: "11111111-2222-4333-8444-555555555555" }],
        },
        {
          id: "22222222-2222-4222-8222-222222222222",
          type: "approval",
          participants: [{ type: "agent", agentId: "66666666-7777-4888-8999-aaaaaaaaaaaa" }],
        },
      ],
    })!;
    const nextPolicy = normalizeIssueExecutionPolicy({
      stages: [
        {
          id: "11111111-1111-4111-8111-111111111111",
          type: "review",
          participants: [{ type: "agent", agentId: "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff" }],
        },
        {
          id: "22222222-2222-4222-8222-222222222222",
          type: "approval",
          participants: [{ type: "user", userId: "local-board" }],
        },
      ],
    })!;
    const issue = {
      ...makeIssue(),
      executionPolicy: existingPolicy,
    };
    mockIssueService.getById.mockResolvedValue(issue);
    mockIssueService.update.mockImplementation(async (_id: string, patch: Record<string, unknown>) => ({
      ...issue,
      ...patch,
      executionPolicy: patch.executionPolicy,
      updatedAt: new Date(),
    }));

    const res = await request(await createApp())
      .patch("/api/issues/11111111-1111-4111-8111-111111111111")
      .send({ executionPolicy: nextPolicy });

    expect(res.status).toBe(200);
    await vi.waitFor(() => {
      expect(mockLogActivity).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          action: "issue.reviewers_updated",
          details: expect.objectContaining({
            participants: [{ type: "agent", agentId: "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff", userId: null }],
            addedParticipants: [{ type: "agent", agentId: "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff", userId: null }],
            removedParticipants: [{ type: "agent", agentId: "11111111-2222-4333-8444-555555555555", userId: null }],
          }),
        }),
      );
      expect(mockLogActivity).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          action: "issue.approvers_updated",
          details: expect.objectContaining({
            participants: [{ type: "user", agentId: null, userId: "local-board" }],
            addedParticipants: [{ type: "user", agentId: null, userId: "local-board" }],
            removedParticipants: [{ type: "agent", agentId: "66666666-7777-4888-8999-aaaaaaaaaaaa", userId: null }],
          }),
        }),
      );
    });
  });

  it("records a Main to Ork tracked handoff through the issue update route", async () => {
    const mainAgentId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const orkAgentId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const handoffTimestamp = "2026-04-19T12:00:00.000Z";
    const existingIssue = {
      ...makeIssue(),
      ownerAgentId: mainAgentId,
      assigneeAgentId: mainAgentId,
      missionControl: {
        collaboratorAgentIds: [],
        nextStep: "Decide who should take the implementation slice.",
      },
    };
    const updatedIssue = {
      ...existingIssue,
      ownerAgentId: orkAgentId,
      assigneeAgentId: orkAgentId,
      missionControl: {
        collaboratorAgentIds: [mainAgentId],
        nextStep: "Implement the tracked handoff validation and report targeted verification.",
        workflowState: {
          kind: "handed_off",
          enteredAt: new Date(handoffTimestamp),
        },
        handoff: {
          fromAgentId: mainAgentId,
          toAgentId: orkAgentId,
          reason: "Engineering ownership is clear",
          requestedNextStep: "Take the implementation slice and return with verification evidence.",
          unblockCondition: "Patch and targeted verification are complete.",
          timestamp: new Date(handoffTimestamp),
          context: {
            issueId: existingIssue.id,
            identifier: existingIssue.identifier,
            title: existingIssue.title,
          },
        },
      },
      updatedAt: new Date(handoffTimestamp),
    };

    mockIssueService.getById.mockResolvedValue(existingIssue);
    mockIssueService.update.mockResolvedValue(updatedIssue);
    mockIssueService.addComment.mockResolvedValue({
      id: "comment-3",
      issueId: existingIssue.id,
      companyId: existingIssue.companyId,
      body: "Routing this to Ork for engineering execution.",
    });
    mockAccessService.hasPermission.mockResolvedValue(true);

    const res = await request(await createApp({
      type: "agent",
      agentId: mainAgentId,
      companyId: "company-1",
      runId: "run-main-1",
      source: "api_key",
    }))
      .patch(`/api/issues/${existingIssue.id}`)
      .send({
        ownerAgentId: orkAgentId,
        assigneeAgentId: orkAgentId,
        missionControl: {
          collaboratorAgentIds: [mainAgentId],
          nextStep: "Implement the tracked handoff validation and report targeted verification.",
          workflowState: {
            kind: "handed_off",
            enteredAt: handoffTimestamp,
          },
          handoff: {
            fromAgentId: mainAgentId,
            toAgentId: orkAgentId,
            reason: "Engineering ownership is clear",
            requestedNextStep: "Take the implementation slice and return with verification evidence.",
            unblockCondition: "Patch and targeted verification are complete.",
            timestamp: handoffTimestamp,
            context: {
              issueId: existingIssue.id,
              identifier: existingIssue.identifier,
              title: existingIssue.title,
            },
          },
        },
        comment: "Routing this to Ork for engineering execution.",
      });

    expect(res.status).toBe(200);
    expect(mockIssueService.update).toHaveBeenCalledWith(
      existingIssue.id,
      expect.objectContaining({
        ownerAgentId: orkAgentId,
        assigneeAgentId: orkAgentId,
        actorAgentId: mainAgentId,
        actorUserId: null,
        missionControl: expect.objectContaining({
          collaboratorAgentIds: [mainAgentId],
          nextStep: "Implement the tracked handoff validation and report targeted verification.",
          workflowState: expect.objectContaining({
            kind: "handed_off",
          }),
          handoff: expect.objectContaining({
            fromAgentId: mainAgentId,
            toAgentId: orkAgentId,
            reason: "Engineering ownership is clear",
          }),
        }),
      }),
    );
    expect(mockIssueService.addComment).toHaveBeenCalledWith(
      existingIssue.id,
      "Routing this to Ork for engineering execution.",
      expect.objectContaining({
        agentId: mainAgentId,
        runId: "run-main-1",
        userId: undefined,
      }),
    );
    expect(mockLogActivity).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: "issue.updated",
        actorType: "agent",
        actorId: mainAgentId,
        agentId: mainAgentId,
        runId: "run-main-1",
        entityId: existingIssue.id,
        details: expect.objectContaining({
          ownerAgentId: orkAgentId,
          assigneeAgentId: orkAgentId,
          source: "comment",
          identifier: existingIssue.identifier,
          _previous: expect.objectContaining({
            ownerAgentId: mainAgentId,
            assigneeAgentId: mainAgentId,
            missionControl: existingIssue.missionControl,
          }),
        }),
      }),
    );
    expect(mockLogActivity).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: "issue.handoff_updated",
        actorType: "agent",
        actorId: mainAgentId,
        agentId: mainAgentId,
        runId: "run-main-1",
        entityId: existingIssue.id,
        details: expect.objectContaining({
          identifier: existingIssue.identifier,
          missionControl: updatedIssue.missionControl,
          _previous: {
            missionControl: existingIssue.missionControl,
          },
        }),
      }),
    );
  });

  it("records an agent-authenticated needs-human-attention escalation through the issue update route", async () => {
    const mainAgentId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const apiToken = "pcp_agent_token_needs_human";
    const runId = "run-main-needs-human-1";
    const existingIssue = {
      ...makeIssue(),
      ownerAgentId: mainAgentId,
      assigneeAgentId: mainAgentId,
      missionControl: {
        collaboratorAgentIds: [],
        needsHumanAttention: false,
        nextStep: "Keep implementation moving without operator help.",
      },
    };
    const updatedIssue = {
      ...existingIssue,
      missionControl: {
        collaboratorAgentIds: [],
        needsHumanAttention: true,
        nextStep: "Operator review needed before continuing the implementation slice.",
      },
      updatedAt: new Date("2026-04-19T13:00:00.000Z"),
    };

    mockIssueService.getById.mockResolvedValue(existingIssue);
    mockIssueService.update.mockResolvedValue(updatedIssue);
    mockIssueService.addComment.mockResolvedValue({
      id: "comment-needs-human-1",
      issueId: existingIssue.id,
      companyId: existingIssue.companyId,
      body: "Escalating for operator review before continuing the tracked work.",
    });

    const res = await request(
      await createAuthenticatedAgentApp({
        token: apiToken,
        agentId: mainAgentId,
        companyId: existingIssue.companyId,
      }),
    )
      .patch(`/api/issues/${existingIssue.id}`)
      .set("Authorization", `Bearer ${apiToken}`)
      .set("X-Paperclip-Run-Id", runId)
      .send({
        missionControl: {
          collaboratorAgentIds: [],
          needsHumanAttention: true,
          nextStep: "Operator review needed before continuing the implementation slice.",
        },
        comment: "Escalating for operator review before continuing the tracked work.",
      });

    expect(res.status).toBe(200);
    expect(mockIssueService.update).toHaveBeenCalledWith(
      existingIssue.id,
      expect.objectContaining({
        actorAgentId: mainAgentId,
        actorUserId: null,
        missionControl: {
          collaboratorAgentIds: [],
          needsHumanAttention: true,
          nextStep: "Operator review needed before continuing the implementation slice.",
        },
      }),
    );
    expect(mockIssueService.addComment).toHaveBeenCalledWith(
      existingIssue.id,
      "Escalating for operator review before continuing the tracked work.",
      expect.objectContaining({
        agentId: mainAgentId,
        runId,
        userId: undefined,
      }),
    );
    expect(mockLogActivity).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: "issue.updated",
        actorType: "agent",
        actorId: mainAgentId,
        agentId: mainAgentId,
        runId,
        entityId: existingIssue.id,
        details: expect.objectContaining({
          source: "comment",
          identifier: existingIssue.identifier,
          missionControl: updatedIssue.missionControl,
          _previous: expect.objectContaining({
            missionControl: existingIssue.missionControl,
          }),
        }),
      }),
    );
    expect(mockLogActivity).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: "issue.handoff_updated",
        entityId: existingIssue.id,
      }),
    );
  });

  it("records an agent-authenticated blocked to resumed update through the issue update route", async () => {
    const orkAgentId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const apiToken = "pcp_agent_token_resume";
    const runId = "run-ork-resume-1";
    const resumeTimestamp = "2026-04-19T14:00:00.000Z";
    const existingIssue = {
      ...makeIssue(),
      status: "blocked",
      ownerAgentId: orkAgentId,
      assigneeAgentId: orkAgentId,
      missionControl: {
        collaboratorAgentIds: [],
        needsHumanAttention: false,
        nextStep: "Wait for the upstream dependency to land.",
        workflowState: {
          kind: "blocked_on_upstream",
          enteredAt: new Date("2026-04-19T13:30:00.000Z"),
        },
      },
    };
    const updatedIssue = {
      ...existingIssue,
      status: "todo",
      missionControl: {
        collaboratorAgentIds: [],
        needsHumanAttention: false,
        nextStep: "Resume the implementation now that the upstream dependency is unblocked.",
        workflowState: {
          kind: "resumed",
          enteredAt: new Date(resumeTimestamp),
          resumedFrom: "blocked_on_upstream",
        },
      },
      updatedAt: new Date(resumeTimestamp),
    };

    mockIssueService.getById.mockResolvedValue(existingIssue);
    mockIssueService.update.mockResolvedValue(updatedIssue);
    mockIssueService.addComment.mockResolvedValue({
      id: "comment-resume-1",
      issueId: existingIssue.id,
      companyId: existingIssue.companyId,
      body: "Upstream is clear. Resuming this slice now.",
    });

    const res = await request(
      await createAuthenticatedAgentApp({
        token: apiToken,
        agentId: orkAgentId,
        companyId: existingIssue.companyId,
      }),
    )
      .patch(`/api/issues/${existingIssue.id}`)
      .set("Authorization", `Bearer ${apiToken}`)
      .set("X-Paperclip-Run-Id", runId)
      .send({
        status: "todo",
        missionControl: {
          collaboratorAgentIds: [],
          needsHumanAttention: false,
          nextStep: "Resume the implementation now that the upstream dependency is unblocked.",
          workflowState: {
            kind: "resumed",
            enteredAt: resumeTimestamp,
            resumedFrom: "blocked_on_upstream",
          },
        },
        comment: "Upstream is clear. Resuming this slice now.",
      });

    expect(res.status).toBe(200);
    expect(mockIssueService.update).toHaveBeenCalledWith(
      existingIssue.id,
      expect.objectContaining({
        status: "todo",
        actorAgentId: orkAgentId,
        actorUserId: null,
        missionControl: expect.objectContaining({
          collaboratorAgentIds: [],
          needsHumanAttention: false,
          nextStep: "Resume the implementation now that the upstream dependency is unblocked.",
          workflowState: expect.objectContaining({
            kind: "resumed",
            resumedFrom: "blocked_on_upstream",
          }),
        }),
      }),
    );
    expect(mockIssueService.addComment).toHaveBeenCalledWith(
      existingIssue.id,
      "Upstream is clear. Resuming this slice now.",
      expect.objectContaining({
        agentId: orkAgentId,
        runId,
        userId: undefined,
      }),
    );
    expect(mockLogActivity).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: "issue.updated",
        actorType: "agent",
        actorId: orkAgentId,
        agentId: orkAgentId,
        runId,
        entityId: existingIssue.id,
        details: expect.objectContaining({
          status: "todo",
          source: "comment",
          identifier: existingIssue.identifier,
          missionControl: updatedIssue.missionControl,
          _previous: expect.objectContaining({
            status: "blocked",
            missionControl: existingIssue.missionControl,
          }),
        }),
      }),
    );
    expect(mockLogActivity).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: "issue.handoff_updated",
        entityId: existingIssue.id,
      }),
    );
  }, 15_000);
});
