# Adding a New Metric

This guide walks through adding a new metric to a technology's scoring catalog.

## Prerequisites

- Identify which **pillar** and **subcategory** the metric belongs to
- Determine how the value will be **collected** (SQL query, monitoring, manual input)
- Define what **passing** looks like (boolean, enum list, threshold)

## Step-by-Step

### 1. Choose an ID

Metric IDs follow the pattern: `{PILLAR_PREFIX}-{SUBCAT_NUM}.{METRIC_NUM}`

| Pillar | Prefix |
|--------|--------|
| Backup & Recovery | BAK |
| Security | SEC |
| Capacity | CAP |
| Performance | PERF |
| Future-Proofing | FUT |

Example: The 3rd metric in the 2nd backup subcategory = `BAK-2.3`

### 2. Define the Metric

Add a new entry to the `metrics` array in `data/metrics/{technology}.json`:

```json
{
  "metric_id": "SEC-3.5",
  "subcategory": "security_audit",
  "legacy_name": "audit_log_rotation",
  "display_name": "Audit Log Rotation Configured",
  "description": "Audit logs are configured for automatic rotation to prevent disk exhaustion",
  "criticality": "important",
  "weight": null,
  "evaluation_type": "boolean",
  "evaluation_config": { "pass_value": true },
  "sources": ["sql"],
  "agent_only": false,
  "deployment_profiles": null,
  "min_pg_version": null,
  "extension_requirement": null,
  "metric_tier": "baseline",
  "remediation": "Configure log_rotation_age and log_rotation_size in postgresql.conf",
  "cis_reference": null,
  "gate_scope": null
}
```

### 3. Field Reference

| Field | Required | Description |
|-------|----------|-------------|
| `metric_id` | Yes | Unique ID (e.g., `SEC-3.5`) |
| `subcategory` | Yes | Must match a subcategory key in the catalog |
| `legacy_name` | Yes | Unique key for value lookup. Must match what collectors emit. |
| `display_name` | Yes | Human-readable name shown in reports |
| `description` | Yes | What this metric checks |
| `criticality` | Yes | `critical`, `important`, or `advisory` |
| `weight` | No | Override weight (null = use criticality weight) |
| `evaluation_type` | Yes | `boolean`, `enum`, `threshold`, or `range` |
| `evaluation_config` | Yes | Pass criteria for the evaluation type |
| `sources` | Yes | Array: `["sql"]`, `["manual"]`, `["sql", "zabbix"]`, etc. |
| `agent_only` | No | `true` if only available in agent mode (default: `false`) |
| `deployment_profiles` | No | Array of profiles or `null` for all |
| `min_pg_version` | No | Minimum version as integer (e.g., `170000` for PG 17) |
| `extension_requirement` | No | Extension name or `null` |
| `metric_tier` | No | `baseline`, `target_aware`, or `environment_optional` |
| `remediation` | Yes | Action to take when the metric fails |
| `cis_reference` | No | CIS Benchmark section reference |
| `gate_scope` | No | `null`, `"subcategory"`, or `"pillar"` |
| `derived` | No | `true` marks an engine-computed metric — its value is calculated from other metrics, never collected |
| `derived_from` | With `derived` | `{ "formula": "...", "inputs": [...] }` — formula must be one of the engine whitelist: `memory_pressure_pct`, `wal_buffers_ratio`, `wal_buffers_ratio_capped`, `count_csv`. See [derived metrics](../scoring-model.md#derived-metrics-v160) |
| `applies_when` | No (v1.8.0+) | Predicate (same DSL as consistency rules) — when false the metric is *not applicable*: no points at stake, no criticality gate. Use for conditional criticals (e.g. replication metrics gated on a standby count). Missing-signal idioms: `{ "metric": "x", "is_truthy": true }` applies only when `x` is known on; `{ "none_of": [{ "metric": "x", "equals": "off" }] }` applies unless known off. See [metric applicability](../scoring-model.md#metric-applicability--applies_when-v180) |
| `license_requirement` | No (v1.9.0+) | One of `enterprise_edition`, `diagnostic_pack`, `tuning_pack`, `advanced_security`, `advanced_compression`, `partitioning`, `rac`, `active_data_guard`. When the customer doesn't own it (engine `licensedOptions`; `enterprise_edition` auto-derived from `edition`), the metric is *not applicable* — no penalty, reported in `licenseExcluded`. Context-driven sibling of `applies_when`; the collector also reads it to skip unlicensed SQL. See [license applicability](../scoring-model.md#licensepack-applicability--license_requirement-v190) |

### 4. Validate

```bash
npm run validate-catalogs
```

This ensures:
- The metric ID is unique
- The subcategory exists
- Points still sum correctly
- All required fields are present

### 5. Regenerate Docs

```bash
npm run generate-docs
```

### 6. Test with the Simulator

```bash
cd simulator && docker compose up --build
```

Navigate to the score simulator, enter a value for your new metric, and verify it affects the score as expected.

## Important Notes

- Adding a metric does **not** change the point budget. The subcategory's `maxPoints` stays the same — the new metric shares points with existing metrics through weighted normalization.
- A new `critical` metric will activate the 60% gate if it fails.
- If the metric requires a new collector or query, that change belongs to the collecting tool, not to this package; state the expected input in `docs/consumer-contract.md`.
- A metric's **`metric_id`** (e.g. `BAK-4.4`) is **catalog-local** — the same id can label different concepts in different technologies (Oracle `BAK-4.4` = `dataguard_configured`, PostgreSQL `BAK-4.4` = `dr_plan_documented`). The **`legacy_name`** is the **cross-catalog key** consumers join on: keep it stable and unique per concept, and never assume id-stability across technologies. When adding a metric, reuse the *next free* id within the target subcategory rather than matching another catalog's id for the same concept.
