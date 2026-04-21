import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { activityLog, agents, companies, createDb, heartbeatRuns } from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { logActivity } from "../services/activity-log.ts";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres activity log tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

describeEmbeddedPostgres("activity log", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-activity-log-");
    db = createDb(tempDb.connectionString);
  }, 20_000);

  afterEach(async () => {
    await db.delete(activityLog);
    await db.delete(heartbeatRuns);
    await db.delete(agents);
    await db.delete(companies);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  it("stores activity without a run reference for manual non-UUID run ids", async () => {
    const companyId = randomUUID();

    await db.insert(companies).values({
      id: companyId,
      name: "Paperclip",
      issuePrefix: `T${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
    });

    await expect(
      logActivity(db, {
        companyId,
        actorType: "agent",
        actorId: randomUUID(),
        action: "issue.updated",
        entityType: "issue",
        entityId: randomUUID(),
        runId: "manual-main-1776636479",
      }),
    ).resolves.toBeUndefined();

    const rows = await db.select().from(activityLog);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.runId).toBeNull();
  });

  it("keeps a valid UUID run reference when the heartbeat run exists", async () => {
    const companyId = randomUUID();
    const runId = randomUUID();
    const agentId = randomUUID();

    await db.insert(companies).values({
      id: companyId,
      name: "Paperclip",
      issuePrefix: `T${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
    });

    await db.insert(agents).values({
      id: agentId,
      companyId,
      name: "Agent",
      role: "engineer",
      status: "running",
      adapterType: "codex_local",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
    });

    await db.insert(heartbeatRuns).values({
      id: runId,
      companyId,
      agentId,
      invocationSource: "assignment",
      status: "running",
      contextSnapshot: {},
    });

    await expect(
      logActivity(db, {
        companyId,
        actorType: "agent",
        actorId: agentId,
        action: "issue.updated",
        entityType: "issue",
        entityId: randomUUID(),
        runId,
      }),
    ).resolves.toBeUndefined();

    const rows = await db.select().from(activityLog);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.runId).toBe(runId);
  });
});
