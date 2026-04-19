import { describe, expect, it } from "vitest";
import { resolveClaimedApiKeyPath, resolveSessionKey } from "./execute.js";

describe("resolveSessionKey", () => {
  it("prefixes run-scoped session keys with the configured agent", () => {
    expect(
      resolveSessionKey({
        strategy: "run",
        configuredSessionKey: null,
        agentId: "meridian",
        runId: "run-123",
        issueId: null,
      }),
    ).toBe("agent:meridian:paperclip:run:run-123");
  });

  it("prefixes issue-scoped session keys with the configured agent", () => {
    expect(
      resolveSessionKey({
        strategy: "issue",
        configuredSessionKey: null,
        agentId: "meridian",
        runId: "run-123",
        issueId: "issue-456",
      }),
    ).toBe("agent:meridian:paperclip:issue:issue-456");
  });

  it("prefixes fixed session keys with the configured agent", () => {
    expect(
      resolveSessionKey({
        strategy: "fixed",
        configuredSessionKey: "paperclip",
        agentId: "meridian",
        runId: "run-123",
        issueId: null,
      }),
    ).toBe("agent:meridian:paperclip");
  });

  it("does not double-prefix an already-routed session key", () => {
    expect(
      resolveSessionKey({
        strategy: "fixed",
        configuredSessionKey: "agent:meridian:paperclip",
        agentId: "meridian",
        runId: "run-123",
        issueId: null,
      }),
    ).toBe("agent:meridian:paperclip");
  });
});

describe("resolveClaimedApiKeyPath", () => {
  it("derives a bridge-directory claimed-key path by default", () => {
    expect(
      resolveClaimedApiKeyPath({
        claimedApiKeyPath: null,
        companyId: "company-1",
        agentId: "agent-1",
      }),
    ).toBe("~/.local/share/paperclip-openclaw-bridge/claimed-keys/company-1/agent-1.json");
  });

  it("prefers an explicit claimed-key path over the bridge directory", () => {
    expect(
      resolveClaimedApiKeyPath({
        claimedApiKeyPath: "~/custom/paperclip-key.json",
        bridgeDir: "~/ignored-bridge",
        companyId: "company-1",
        agentId: "agent-1",
      }),
    ).toBe("~/custom/paperclip-key.json");
  });

  it("derives the claimed-key path from a configured bridge directory", () => {
    expect(
      resolveClaimedApiKeyPath({
        claimedApiKeyPath: null,
        bridgeDir: "/srv/paperclip-bridge",
        companyId: "company-1",
        agentId: "agent-1",
      }),
    ).toBe("/srv/paperclip-bridge/claimed-keys/company-1/agent-1.json");
  });
});
