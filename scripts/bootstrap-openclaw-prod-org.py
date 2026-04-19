#!/usr/bin/env python3
import json
import os
import subprocess
import sys
import uuid
from pathlib import Path

TEST_CONTAINER = "paperclip-test-db-1"
PROD_CONTAINER = "paperclip-prod-db-1"
DB_NAME = "paperclip"
DB_USER = "paperclip"
SOURCE_COMPANY_NAME = "Nybbly"
PROD_API_URL = "http://127.0.0.1:3100"
HOST_PROD_DATA_DIR = Path.home() / ".local" / "share" / "paperclip" / "prod" / "paperclip"
WORKSPACE_BY_AGENT_KEY = {
    "main": Path.home() / ".openclaw" / "workspace",
    "ork": Path.home() / ".openclaw" / "workspace-ork",
    "stitch": Path.home() / ".openclaw" / "workspace-stitch",
    "personal-os": Path.home() / ".openclaw" / "workspace-personal-os",
}
INSTRUCTION_FILES = ["AGENTS.md", "HEARTBEAT.md", "IDENTITY.md", "SOUL.md", "TOOLS.md", "USER.md"]


def run(cmd: list[str], *, input_text: str | None = None) -> str:
    result = subprocess.run(
        cmd,
        input=input_text,
        text=True,
        capture_output=True,
        check=False,
    )
    if result.returncode != 0:
        raise RuntimeError(
            f"Command failed ({result.returncode}): {' '.join(cmd)}\nSTDOUT:\n{result.stdout}\nSTDERR:\n{result.stderr}"
        )
    return result.stdout.strip()


def psql_json(container: str, sql: str):
    out = run([
        "docker", "exec", container,
        "psql", "-U", DB_USER, "-d", DB_NAME,
        "-t", "-A", "-P", "pager=off",
        "-c", sql,
    ])
    if not out:
        return None
    return json.loads(out)


def psql(container: str, sql: str):
    return run([
        "docker", "exec", "-i", container,
        "psql", "-U", DB_USER, "-d", DB_NAME,
        "-v", "ON_ERROR_STOP=1",
    ], input_text=sql)


def sql_literal(value):
    if value is None:
        return "NULL"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)):
        return str(value)
    if isinstance(value, (dict, list)):
        text = json.dumps(value)
        return "'" + text.replace("'", "''") + "'::jsonb"
    text = str(value)
    return "'" + text.replace("'", "''") + "'"


company = psql_json(
    TEST_CONTAINER,
    f"""
    select row_to_json(c) from (
      select id, name, description, status, budget_monthly_cents, spent_monthly_cents,
             issue_prefix, issue_counter, require_board_approval_for_new_agents,
             brand_color, pause_reason, paused_at,
             feedback_data_sharing_enabled, feedback_data_sharing_consent_at,
             feedback_data_sharing_consent_by_user_id, feedback_data_sharing_terms_version
      from companies
      where name = {sql_literal(SOURCE_COMPANY_NAME)}
      limit 1
    ) c;
    """,
)
if not company:
    raise SystemExit(f"Could not find source company {SOURCE_COMPANY_NAME!r} in test DB")

agents = psql_json(
    TEST_CONTAINER,
    f"""
    select coalesce(json_agg(a), '[]'::json) from (
      select id, name, role, title, reports_to, adapter_type, adapter_config,
             budget_monthly_cents, spent_monthly_cents, runtime_config, permissions,
             icon, metadata
      from agents
      where company_id = {sql_literal(company['id'])}
      order by created_at
    ) a;
    """,
)
if not agents:
    raise SystemExit("No agents found in test DB source company")

existing_prod_company = psql_json(
    PROD_CONTAINER,
    f"""
    select row_to_json(c) from (
      select id, name, issue_prefix from companies where name = {sql_literal(company['name'])} limit 1
    ) c;
    """,
)
if existing_prod_company:
    prod_company_id = existing_prod_company["id"]
else:
    prod_company_id = str(uuid.uuid4())

agent_id_map = {agent["id"]: agent["id"] for agent in agents}

sql_parts: list[str] = ["begin;"]
if not existing_prod_company:
    sql_parts.append(
        f"""
        insert into companies (
          id, name, description, status, budget_monthly_cents, spent_monthly_cents,
          issue_prefix, issue_counter, require_board_approval_for_new_agents,
          brand_color, pause_reason, paused_at,
          feedback_data_sharing_enabled, feedback_data_sharing_consent_at,
          feedback_data_sharing_consent_by_user_id, feedback_data_sharing_terms_version,
          created_at, updated_at
        ) values (
          {sql_literal(prod_company_id)},
          {sql_literal(company['name'])},
          {sql_literal(company.get('description'))},
          {sql_literal(company['status'])},
          {sql_literal(company['budget_monthly_cents'])},
          {sql_literal(company['spent_monthly_cents'])},
          {sql_literal(company['issue_prefix'])},
          {sql_literal(company['issue_counter'])},
          {sql_literal(company['require_board_approval_for_new_agents'])},
          {sql_literal(company.get('brand_color'))},
          {sql_literal(company.get('pause_reason'))},
          {sql_literal(company.get('paused_at'))},
          {sql_literal(company['feedback_data_sharing_enabled'])},
          {sql_literal(company.get('feedback_data_sharing_consent_at'))},
          {sql_literal(company.get('feedback_data_sharing_consent_by_user_id'))},
          {sql_literal(company.get('feedback_data_sharing_terms_version'))},
          now(), now()
        );
        """
    )

for agent in agents:
    reports_to = agent_id_map.get(agent.get("reports_to")) if agent.get("reports_to") else None
    adapter_config = dict(agent.get("adapter_config") or {})
    agent_runtime_key = adapter_config.get("agentId") or ""
    adapter_config["paperclipApiUrl"] = PROD_API_URL
    if agent_runtime_key:
        instructions_root = f"/paperclip/instances/default/companies/{prod_company_id}/agents/{agent['id']}/instructions"
        adapter_config["instructionsRootPath"] = instructions_root
        adapter_config["instructionsFilePath"] = f"{instructions_root}/AGENTS.md"
        adapter_config["instructionsEntryFile"] = "AGENTS.md"
        adapter_config["instructionsBundleMode"] = "managed"
    sql_parts.append(
        f"""
        insert into agents (
          id, company_id, name, role, title, status, reports_to, capabilities,
          adapter_type, adapter_config, budget_monthly_cents, spent_monthly_cents,
          metadata, runtime_config, permissions, icon, created_at, updated_at
        ) values (
          {sql_literal(agent['id'])},
          {sql_literal(prod_company_id)},
          {sql_literal(agent['name'])},
          {sql_literal(agent['role'])},
          {sql_literal(agent.get('title'))},
          'idle',
          {sql_literal(reports_to)},
          NULL,
          {sql_literal(agent['adapter_type'])},
          {sql_literal(adapter_config)},
          {sql_literal(agent['budget_monthly_cents'])},
          {sql_literal(agent['spent_monthly_cents'])},
          {sql_literal(agent.get('metadata') or {})},
          {sql_literal(agent.get('runtime_config') or {})},
          {sql_literal(agent.get('permissions') or {})},
          {sql_literal(agent.get('icon'))},
          now(), now()
        )
        on conflict (id) do update set
          company_id = excluded.company_id,
          name = excluded.name,
          role = excluded.role,
          title = excluded.title,
          status = excluded.status,
          reports_to = excluded.reports_to,
          adapter_type = excluded.adapter_type,
          adapter_config = excluded.adapter_config,
          budget_monthly_cents = excluded.budget_monthly_cents,
          spent_monthly_cents = excluded.spent_monthly_cents,
          metadata = excluded.metadata,
          runtime_config = excluded.runtime_config,
          permissions = excluded.permissions,
          icon = excluded.icon,
          updated_at = now();
        """
    )

sql_parts.append("commit;")
psql(PROD_CONTAINER, "\n".join(sql_parts))

prod_company_root = HOST_PROD_DATA_DIR / "instances" / "default" / "companies" / prod_company_id
for agent in agents:
    agent_runtime_key = (agent.get("adapter_config") or {}).get("agentId")
    if not agent_runtime_key:
        continue
    workspace = WORKSPACE_BY_AGENT_KEY.get(agent_runtime_key)
    if workspace is None:
        raise SystemExit(f"No workspace mapping for runtime agentId {agent_runtime_key!r}")
    dest_dir = prod_company_root / "agents" / agent["id"] / "instructions"
    run([
        "docker", "run", "--rm",
        "-v", f"{HOST_PROD_DATA_DIR}:/paperclip",
        "alpine", "sh", "-lc",
        f"mkdir -p {str(dest_dir).replace(str(HOST_PROD_DATA_DIR), '/paperclip')} && chown -R 1000:1000 /paperclip/instances/default/companies/{prod_company_id}",
    ])
    for filename in INSTRUCTION_FILES:
        src = workspace / filename
        if src.exists():
            run([
                "docker", "cp", str(src), f"paperclip-prod-server-1:{str(dest_dir).replace(str(HOST_PROD_DATA_DIR), '/paperclip')}/{filename}"
            ])
    run([
        "docker", "exec", "-u", "root", "paperclip-prod-server-1", "sh", "-lc",
        f"chown -R 1000:1000 {str(dest_dir).replace(str(HOST_PROD_DATA_DIR), '/paperclip')}"
    ])

summary = {
    "companyId": prod_company_id,
    "companyName": company["name"],
    "issuePrefix": company["issue_prefix"],
    "agents": [
        {
            "id": agent["id"],
            "name": agent["name"],
            "runtimeAgentId": (agent.get("adapter_config") or {}).get("agentId"),
            "reportsTo": agent_id_map.get(agent.get("reports_to")) if agent.get("reports_to") else None,
        }
        for agent in agents
    ],
    "prodInstructionsRoot": str(prod_company_root),
}
print(json.dumps(summary, indent=2))
