import { describe, expect, it } from "vitest";
import { resolveExternalRunId } from "../services/heartbeat";

describe("resolveExternalRunId", () => {
  it("prefers explicit externalRunId from persisted result json", () => {
    expect(
      resolveExternalRunId({
        adapterResult: { exitCode: 0, signal: null, timedOut: false },
        persistedResultJson: {
          externalRunId: "oc-run-123",
          runId: "fallback-run",
        },
      }),
    ).toBe("oc-run-123");
  });

  it("falls back to runId when the gateway payload has not been normalized yet", () => {
    expect(
      resolveExternalRunId({
        adapterResult: { exitCode: 0, signal: null, timedOut: false },
        persistedResultJson: {
          runId: "oc-run-456",
        },
      }),
    ).toBe("oc-run-456");
  });
});
