# Reading a catalog without reading JavaScript

A catalog is one JSON file per technology under `data/metrics/`. It says what is checked, how much it weighs, how it is measured and why. This page walks one metric field by field, then the shared rules, then one consistency rule.

## One metric, field by field

From `data/metrics/postgresql.json` (catalog 1.13.0), the derived restore-time metric (the `description`, `rationale` and `technical_anchor` texts shortened here):

```json
{
  "metric_id": "BAK-4.9",
  "subcategory": "backup_recovery",
  "legacy_name": "restore_time_estimate_minutes",
  "display_name": "Restore Time Within Declared RTO",
  "description": "Estimated minutes for the data-restore phase of a full restore from backup: database size divided by the attested restore throughput, or by the policy default of 200 MB/s when no restore test attested a rate. It estimates one phase only: detection, provisioning, WAL replay, validation and application reconnection come on top, an\u2026",
  "criticality": "important",
  "weight": null,
  "evaluation_type": "threshold",
  "evaluation_config": {
    "max": 1440,
    "unit": "minutes",
    "by_declaration": {
      "metric": "rto_target",
      "bands": { "rto_5": { "max": 5 }, "rto_15": { "max": 15 }, "rto_60": { "max": 60 }, "rto_240": { "max": 240 }, "rto_480": { "max": 480 }, "rto_1440": { "max": 1440 }, "default": { "max": 1440 } }
    }
  },
  "derived": true,
  "derived_from": { "formula": "restore_time_estimate_minutes", "inputs": ["database_size", "restore_throughput_mb_s"] },
  "sources": ["sql"],
  "optional_when": { "metric": "ha_topology", "in": ["async_standby", "sync_standby", "cluster_managed"] },
  "remediation": "Add an HA topology so failover, not a restore, bounds the RTO, or move the large database to a dedicated instance. If the business accepts a longer recovery, the declared rto_target is wrong: correct it; the restore estimate is then judged against the looser recovery time and the declarations code changes.",
  "rationale": "Engine-derived: database_size GB times 1024 divided by the throughput in MB/s divided by 60. The 200 MB/s default is a conservative pgBackRest or barman restore on SSD and lives in the scoring policy."
}
```

| Field | Meaning |
|---|---|
| `metric_id` | The stable identifier: pillar prefix (BAK, SEC, CAP, PER, FUT), subcategory number, metric number. |
| `subcategory` | Which subcategory's points this metric competes for. Subcategories and their point budgets are declared at the top of the file. |
| `legacy_name` | The key a collector uses in the values map it sends to the engine. This is the name you see in payloads and in `technical_anchor` queries. |
| `display_name`, `description` | What a human reads. Descriptions are written in a state-neutral voice: what the metric measures and why it matters. |
| `criticality` | `critical` (weight 3, trips the gates), `important` (weight 2), `advisory` (weight 1). |
| `weight` | Normally `null`: the weight follows the criticality. A number overrides it (capture metrics use 0.5). |
| `evaluation_type` | `boolean`, `enum`, `threshold` (one bound) or `range` (two bounds). |
| `evaluation_config` | The pass criterion. Here a `max` in minutes, with `by_declaration`: the bound follows the value of another metric, the declared `rto_target`; an estate that declared `rto_15` must restore within 15 minutes, an undeclared estate gets the `default` band. An optional `unless` predicate makes the declaration ignored when it holds (PostgreSQL BAK-2.2 backup age ignores the declared RPO under WAL archiving). Other shapes: `profiles` (bounds per workload profile) and `min_pct` / `max_pct` of a system fact (size-relative). |
| `derived`, `derived_from` | The engine computes this value from other collected values before scoring; the formula's expression is published in the scoring policy. A missing input makes the metric "not provided". |
| `sources` | Where the value can come from: `sql`, `manual` (an attestation), `zabbix`, `worker`. |
| `applies_when` | A technical predicate (version, archiving on, a pooler present); when false the metric is not applicable and counts nowhere, not even in the gates. It may not read a declared target. Not on this metric. |
| `optional_when` | A predicate on declared targets only; when true the declared targets do not require the metric: it still earns or loses its points but leaves the target score and never gates. Here: with a declared standby or cluster, failover bounds the recovery time, so the restore estimate counts but is not required. |
| `floor` | `true` on checks no declaration may make optional (the SSL checks: SSL is a floor on every environment). |
| `remediation` | What to do when it fails. |
| `technical_anchor` | Not on this metric (it is derived). On collected metrics: `{ summary, query }`, the literal SQL or command that produces the value. The simulator shows it with a copy button; the workbooks carry it in the Anchor SQL column. |
| `rationale` | Where the threshold or the criticality comes from. The answer to "why this number". |
| `gate_scope` | `"pillar"` on the few metrics whose failure zeroes their whole pillar (for example an unsupported major version). |
| `license_requirement`, `extension_requirement`, `deployment_profiles`, `min_pg_version` | Applicability by license or pack, extension, deployment profile and version; a metric that does not apply is reported, never penalised. |

## The shared rules

The rules that turn metric evaluations into a score are the same for every catalog and live in one frozen object, `src/scoring/policy.js`. The engine reads it, `docs/scoring-model.md` renders it (the "Scoring policy" block), and the simulator's "How the score works" page renders it. At the time of writing:

- Weights: critical 3x, important 2x, advisory 1x. A subcategory's score is its weighted pass ratio times its points.
- Subcategory gate: a failed critical caps its subcategory at 60 percent of its points.
- Pillar cap: a hard-failed (natural score 0) or missing critical caps its pillar at 60 percent (12 of 20).
- Partial credit: a threshold or range metric earns 50 percent of its points when the value is within 2x of the bound, nothing beyond. The half is exact, never rounded, and such a value is never reported as passed.
- Status bands: excellent at 90 percent or more, good at 70, needs improvement at 50, critical below.
- Missing values (1.17.0): every check with no value counts 0 points and is reported as not assessed; a missing critical also trips the gates (never one outside the run's collection scope); a non-critical declared target left blank costs nothing; a check guarded on its own value does not apply when absent; a not-applicable metric counts nowhere.

## One consistency rule

Rules live in the `consistency_rules` array of the catalog. `PG-CR-RTO-3`:

```json
{
  "rule_id": "PG-CR-RTO-3",
  "title": "Aggressive RTO declared on a standalone instance too large to restore in time",
  "applies_when": {
    "all_of": [
      { "metric": "rto_target", "in": ["rto_5", "rto_15"] },
      { "metric": "ha_topology", "equals": "none" },
      { "metric": "restore_time_estimate_minutes", "gt": 15 }
    ]
  },
  "on_violation": {
    "severity": "critical",
    "score_adjustments": [
      { "type": "metric_zero", "target": "rto_target" },
      { "type": "subcategory_cap", "target": "backup_recovery", "cap_pct": 60 }
    ],
    "title": "Declared RTO {value:rto_target} not achievable by restore on a standalone instance",
    "remediation": "Add an HA topology (a standby or a managed cluster) so failover bounds the RTO, or move the large database to a dedicated instance, or relax rto_target."
  }
}
```

Read it as: *when* the estate declares an RTO of 5 or 15 minutes, *and* has no HA topology, *and* the estimated restore time is above 15 minutes, *then* the declaration is invalidated (its points are zeroed while its weight stays in the denominator) and the Recovery Readiness subcategory is capped at 60 percent, with a critical finding whose title interpolates the declared value. The predicate vocabulary (`all_of`, `any_of`, `none_of`; `equals`, `in`, `not_in`, `gt`, `gte`, `lt`, `lte`, `is_truthy`, `provided`; `system_fact` and `workload_profile` leaves) and the adjustment types are listed in the policy block. The authoring guide is [guides/cross-metric-rules.md](guides/cross-metric-rules.md).

## Where to go next

- Open the same metric in the simulator (`/metrics/postgresql`, search `BAK-4.9`): the card shows the three questions, what is checked, how it is measured, how it scores, computed from the catalog and the policy.
- Change a threshold on the Impact Analyzer and export: the JSON you get back is the catalog with your edit, ready for a pull request.
- Check a real collection: `node scripts/check-payload.js postgresql payload.json`.
