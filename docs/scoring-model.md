# Scoring Model

This document explains how the database health scoring engine works.

## Overview

Every database instance is scored on a **100-point scale** across **5 equal pillars** (20 points each):

| Pillar | Focus |
|--------|-------|
| **Backup & Recovery** | WAL archiving, backup schedules, PITR, retention, recovery readiness |
| **Security** | Authentication, encryption, access control, audit logging |
| **Capacity** | Storage, connections, maintenance, bloat, replication slots |
| **Performance** | Caching, query optimization, locking, replication, checkpoints |
| **Future-Proofing** | Version currency, configuration best practices, upgrade readiness |

## Design Philosophy

The scoring system is built to support operational decisions, not academic benchmarks. Every algorithmic choice below is grounded in seven principles. These principles are the lens through which thresholds, criticality flags, and gates should be evaluated during Technology Leader validation.

1. **Operational truth, not academic precision.** Scores reflect real-world consequences — RPO/RTO impact, attack surface, capacity headroom, upgrade exposure — not statistical perfection. A score of 78 should mean "the database is healthy with a few specific concerns" to an experienced DBA, not a calibrated probability.

2. **Equal pillars, no implicit hierarchy.** Backup, Security, Capacity, Performance, and Future-Proofing are weighted 20/20/20/20/20 because they are all non-negotiable foundations of a healthy database. A perfectly tuned database with no backups is not "mostly healthy". The equal weighting is intentional and load-bearing — it forbids trade-offs across pillars.

3. **Criticality is operator judgment, codified.** The three tiers — `critical` (3×), `important` (2×), `advisory` (1×) — are deliberately coarse. They mean what an experienced DBA means by them: a critical metric is a *must-have*; important is a *should-have*; advisory is a *nice-to-have*. Refining the tier of a metric is a human call that requires production context, not a tuning parameter to be optimized.

4. **Conservative gates on critical metrics.** When a foundation wobbles, the score should reflect concern, not optimism. A critical metric anywhere short of full pass triggers the subcategory's 60% gate — including partial credit. The partial-credit value still informs the raw score (so 50%-failing is distinguishable from 100%-failing), but it does not unlock the cap. See *Step 3* below for the worked example.

5. **Honest about missing data.** A missing critical signal *is* a finding: silence is failure. Since 1.17.0 every uncollected check counts 0 points and is reported as not assessed (`pointsNotAssessed`), so the score never claims more than was looked at and the maximum minus the score is the whole gap. The target never depends on what was collected. Two assessments with different data availability differ by exactly what was not assessed.

6. **Technology-agnostic by design.** The engine does not know PostgreSQL from MongoDB. Technology-specific knowledge — what to measure, how to evaluate it, where the value comes from — lives entirely in the catalog. The same algorithm scores any database. This is what makes the engine stable and the catalogs reviewable independently.

7. **Catalogs are evolving artifacts.** The engine is stable; the catalogs are not. **All six catalogs await formal Technology Leader validation** of weights, thresholds, criticality flags, remediation text, and metric placement. The PostgreSQL catalog has more empirical heritage (informally exercised through `DB_Health_report_tool` use), but it has not been formally validated within the scope of this framework either. Technology Leader review is the *inception* of trust in a catalog, not the end.

## Hierarchy

```
Total Score (100 pts)
  └── Pillar (20 pts each, 5 pillars)
        └── Subcategory (3-7 pts each, 3-5 per pillar)
              └── Metric (weighted by criticality)
```

Each pillar contains 3-5 subcategories, each with a fixed point allocation that sums to 20.

## Metric Properties

Every metric has:

| Property | Description |
|----------|-------------|
| `metric_id` | Unique ID (e.g., `BAK-1.1`) |
| `legacy_name` | Key used for value lookup (e.g., `archive_mode`) |
| `criticality` | `critical` (3x), `important` (2x), or `advisory` (1x) |
| `evaluation_type` | `boolean`, `enum`, `threshold`, or `range` |
| `evaluation_config` | Pass criteria (e.g., `{ pass_values: ["on", "always"] }`) |
| `sources` | Where the value comes from: `sql`, `manual`, `zabbix`, `worker` |

## Three Data Sources

Metrics are collected from three types of sources:

1. **SQL / Healthcheck Scripts** — Direct database queries (e.g., `SELECT current_setting('archive_mode')`)
2. **Monitoring** — Zabbix passive items, PMM, or worker script execution
3. **Manual Inputs** — Values provided by the operator (e.g., RPO target, backup schedule)

Each metric declares which source(s) can provide its value.

## Evaluation Types

### Boolean
Pass/fail check. Value must equal the expected value.

```json
{ "evaluation_type": "boolean", "evaluation_config": { "pass_value": true } }
```

Special variant: `check: "not_empty_or_dummy"` rejects empty strings and dummy values like `/bin/true` or `(disabled)`.

### Enum
Value must be in a list of acceptable values (case-insensitive).

```json
{ "evaluation_type": "enum", "evaluation_config": { "pass_values": ["on", "always"] } }
```

### Threshold
Value must be within numeric bounds. Supports `min` (higher-is-better), `max` (lower-is-better), or both.

```json
{ "evaluation_type": "threshold", "evaluation_config": { "max": 85 } }
```

Partial credit: **50%** of points if within 2x of the threshold. The half is exact and never rounded (1.15.0): rounding used to hand a weight-1 metric its full point, and a `passed` flag, for a value outside its bound. `passed` is true only when the value is inside the bound.

### Range
Alias for threshold with both `min` and `max`.

### Size-relative thresholds (v1.5.0+)

A threshold can express its bound as a percentage of a system fact rather than an absolute number, so the same metric scores fairly across instance sizes.

```json
{
  "evaluation_type": "threshold",
  "evaluation_config": {
    "min_pct": 5,
    "min_pct_of": "ram_kb",
    "absolute_floor": { "min": 65536 },
    "unit": "kB"
  }
}
```

At evaluation time the engine computes the effective bound as `systemFacts.ram_kb * (min_pct / 100)`. The recognised anchors are `ram_kb`, `cpu_count`, and `storage_size_kb`. The validator fails closed on unknown anchors.

`absolute_floor` is consulted when the required `systemFact` is missing — the metric is scored against the floor instead of being silently excluded, and an `info` finding flags that a fallback was used. If neither a fact nor a floor is available, the metric is marked unresolved (score 0, `info` finding).

A `max_pct` / `max_pct_of` pair works the same way for lower-is-better thresholds.

### Workload-profile thresholds (v1.5.0+)

When the "good" value of a threshold depends on workload type (OLTP vs OLAP vs mixed), the evaluation_config can be keyed by profile:

```json
{
  "evaluation_type": "threshold",
  "evaluation_config": {
    "profiles": {
      "default": { "min": 95 },
      "oltp":    { "min": 98 },
      "olap":    { "min": 85 },
      "mixed":   { "min": 95 }
    }
  }
}
```

The active profile is `options.workloadProfile` on `ScoringEngine.calculate`, default `'mixed'`. An unknown profile falls back to `'default'`.

The two shapes compose: a profile entry can itself carry `min_pct` / `max_pct` with its own `absolute_floor`.

> **Profile-aware caveat.** Two assessments of the same instance under different profiles can legitimately disagree by several pillar points. The choice of workload profile is operator judgment — record it alongside the assessment so the score is interpretable. The `default` profile exists as a last-resort fallback, not as the recommended profile to declare.

### Declaration-keyed thresholds — `by_declaration` (v1.14.0+)

When a threshold should scale with a **declared operational target** rather than sit at an absolute, `evaluation_config` can carry a `by_declaration` block. A declared metric's value selects a band of bounds; an undeclared, empty, or unmatched value falls back to an explicit `bands.default` (or the base `min`/`max`), so **estates that declare nothing score exactly as before**. This is how "backup age must be within my declared RPO" or "Data Guard lag must be under my declared RPO" is expressed without engine branches.

```json
{
  "evaluation_type": "threshold",
  "evaluation_config": {
    "max": 24,
    "unit": "hours",
    "by_declaration": {
      "metric": "rpo_target",
      "bands": {
        "rpo_60":   { "max": 1 },
        "rpo_1440": { "max": 24 },
        "default":  { "max": 24 }
      }
    }
  }
}
```

**`unless` (1.15.0).** A `by_declaration` block may carry an `unless` predicate, written in the same language as a rule's `applies_when`. When it holds, the declaration is ignored and the metric scores as if nothing were declared (the `bands.default` or the base bounds). PostgreSQL BAK-2.2 uses it: with `archive_mode` on or always, a base backup plus the archived WAL recovers far past the backup time, so backup age keeps its 24-hour freshness bound and the declared RPO is judged by the WAL-archiving checks instead.

The declaration is read from the collected values (e.g. `rpo_target`, `growth_headroom_target`), matched case-insensitively. `by_declaration` is mutually exclusive with `profiles` and must always provide an undeclared fallback (top-level `min`/`max` or a `bands.default`); the catalog validator enforces both. This keeps the score's promise literal: **meeting your own declared standard scores full**, and tightening the target is a maturity-ladder move, not a penalty.

### Recognised systemFacts and profiles

| systemFact | Unit | Used by | Notes |
|------------|------|---------|-------|
| `ram_kb` | kilobytes | memory-sized configs (work_mem, maintenance_work_mem, buffer pool) | Total host RAM available to the database |
| `cpu_count` | integer | parallel-worker tuning, connection limits | Logical CPU cores |
| `storage_size_kb` | kilobytes | storage-relative thresholds | Total storage allocated to the instance |

| workloadProfile | When to declare |
|-----------------|-----------------|
| `oltp` | High-concurrency transactional workloads, small reads/writes, high cache locality |
| `olap` | Analytical workloads, large scans, working sets exceeding RAM by design |
| `mixed` | Default for general workloads — the conservative middle |
| `default` | Last-resort fallback inside metric definitions when a profile isn't declared |

## Derived metrics (v1.6.0+)

Some "best practice" checks aren't a single collected value — they are a *relation* between several values plus host facts. Example: pgtune-style memory budget says `shared_buffers + max_connections × work_mem ≤ ~80% of RAM`. Rather than encode this as a JSON expression DSL, the engine pre-computes it as a **derived metric** that behaves like any other threshold metric.

A derived metric declares `derived: true` and a `derived_from` block:

```json
{
  "metric_id": "PER-1.10",
  "legacy_name": "memory_pressure_pct",
  "evaluation_type": "threshold",
  "evaluation_config": { "max": 80, "unit": "percent_ram" },
  "derived": true,
  "derived_from": {
    "formula": "memory_pressure_pct",
    "inputs": ["shared_buffers_bytes", "max_connections", "work_mem_bytes", "ram_bytes"]
  },
  "sources": ["sql"]
}
```

The engine runs a pre-evaluation pass before scoring. For each active derived metric it looks up the named `formula` in its formula whitelist and calls the JS handler with the bundle `{ values, systemFacts }`. The handler returns a number → written back into `values` under the metric's `legacy_name`. From that point on the metric is scored normally (threshold/enum/boolean dispatch, weighted normalization, criticality gate, etc.).

**Missing-input policy.** A derived metric whose formula returns `null` (any required input absent) is treated as not-provided, identical to a missing collector value: since 1.17.0 it counts 0 points and is reported as not assessed, so a consumer that omits `systemFacts` loses the points of the memory checks derived from RAM. It reads `missing` like any uncollected check; pass the system facts.

**No silent overwrite.** If an operator explicitly supplies a value for a derived metric's legacy_name (e.g., from the simulator's manual inputs form), the engine does **not** recompute it — the explicit value wins.

### Supported formulas

| Formula | Inputs | Output | Used by |
|---------|--------|--------|---------|
| `memory_pressure_pct` | `shared_buffers_bytes`, `max_connections`, `work_mem_bytes`, `ram_bytes` | `(sb + mc × wm) / ram × 100` | PostgreSQL PER-1.10 |
| `wal_buffers_ratio` | `wal_buffers_bytes`, `shared_buffers_bytes` | `wb / sb` (decimal ratio) | *(retired from PG in v1.7.0 — falsely failed PostgreSQL's auto-tune above ~533 MB shared_buffers)* |
| `wal_buffers_ratio_capped` (v1.8.0) | `wal_buffers_bytes`, `shared_buffers_bytes` | `wb / min(sb/32, 16MB)` — `1.0` = exactly the auto-tuned value, so `{min: 1}` passes defaults at every size | PostgreSQL PER-1.12 re-add (pending catalog release) |
| `count_csv` | one comma-separated string metric | count of non-empty tokens | PostgreSQL PER-4.3 (`synchronous_standby_names_count`) |

The formula whitelist is enforced by `scripts/validate-catalogs.js`; the input list is cross-checked against the catalog's metric `legacy_name`s and the systemFacts anchor whitelist.

## Cross-metric relations (v1.6.0+)

Some constraints can't be expressed by any single metric — they're *relations between metrics*: PITR requires `wal_level ≥ replica`; synchronous_commit must match the declared replication topology; huge_pages should be enabled when shared_buffers is in the multi-GB range. These ship as `consistency_rules` at the top of each catalog JSON.

A rule is a **predicate** over collected values, system facts, and workload profile, plus an **on_violation** action:

```json
{
  "rule_id": "PG-CR-SYNC-1",
  "applies_when": {
    "all_of": [
      { "metric": "synchronous_commit",              "in": ["off", "local"] },
      { "metric": "synchronous_standby_names_count", "gte": 1 }
    ]
  },
  "on_violation": {
    "severity": "critical",
    "score_adjustment": { "type": "pillar_deduction", "target": "backup", "points": 4 },
    "title":       "Synchronous standbys declared but commit semantics undermine them",
    "description": "synchronous_standby_names is populated but synchronous_commit={value:synchronous_commit}; …",
    "remediation": "Set synchronous_commit to remote_apply/remote_write/on."
  },
  "pillar_hint": "backup"
}
```

### Predicate DSL

Composites carry exactly one of `all_of` / `any_of` / `none_of`. Leaves carry exactly one operator from one of three families:

**Metric-value leaves** (read `values[node.metric]`): `equals`, `in`, `not_in`, `gt`, `gte`, `lt`, `lte`, `is_truthy`, `provided`.

**System-fact leaves** (v1.6.0; read `ctx.systemFacts[node.system_fact]`):
```json
{ "system_fact": "ram_kb", "gte": 8388608 }
{ "system_fact": "storage_type", "in": ["ssd", "nvme"] }
{ "system_fact": "edition", "equals": "enterprise" }
```
Numeric anchors (`ram_kb`, `ram_bytes`, `cpu_count`, `storage_size_kb`, `storage_size_bytes` — the same whitelist as size-relative thresholds) take numeric comparators only (`equals`, `gt`, `gte`, `lt`, `lte`). **String facts** (v1.8.0: `storage_type`, `edition`) take case-insensitive `equals` / `in` / `not_in` and are never valid as size-relative anchors or derived-formula inputs.

**Workload-profile leaves** (v1.6.0; read `ctx.workloadProfile`):
```json
{ "workload_profile": "olap" }
{ "workload_profile": { "in": ["olap", "mixed"] } }
```
String form is sugar for `equals`. Object form supports `equals` / `in` / `not_in`. Allowed values: `oltp`, `olap`, `mixed`, `default`.

### Score adjustments

`on_violation.score_adjustment.type` selects how a fired rule moves the score:

| Type | Effect |
|------|--------|
| `none` | Findings-only (rule emits a finding, score unchanged). |
| `subcategory_deduction` | Subtract `points` from the targeted subcategory's score. Floors at 0. |
| `subcategory_cap` | Cap the subcategory's score at `cap_pct` of its maxPoints. Lowest cap wins when multiple rules target the same subcategory. |
| `pillar_deduction` | Subtract `points` from the targeted pillar's accumulated score (applied during pillar rollup). Floors at 0. |
| `metric_zero` (v1.8.0) | The targeted metric (`target` = its `legacy_name`) earns **0 points while its weight stays in the denominator** — punitive. Canonical use: a declared intent (`rpo_target=rpo_5`) contradicted by configuration (`archive_mode=off`) should not earn its points. The metric entry gains `zeroed_by_rules` + `natural_score`. Gates keep following the **natural** evaluation: a zeroed-but-naturally-passing critical does not fire the 60% gate (compose an explicit `subcategory_cap` in the same rule when that is wanted). |

**Multiple adjustments per rule** (v1.8.0): `on_violation.score_adjustments: [ … ]` (plural, XOR with the singular form) lets one rule move several targets — e.g. connection saturation deducting on both `capacity_connections` and `perf_locks`. Entries follow the same shapes; `none` and duplicate `(type, target)` pairs are validator errors. Findings from plural rules annotate `score_movements` (array, in application order) instead of the singular `score_movement`.

**Composition order**: `metric_zero` applies inside the weighted normalization (it changes the numerator before anything else) → critical-tier 60% gate (driven by natural scores) → subcategory deductions sum → caps apply (lowest wins) → pillar deductions during rollup.

**Score movement annotation.** Each fired rule whose `score_adjustment.type != 'none'` augments its originating finding with a `score_movement` object so consumers can render "this rule reduced *Caching* by 1.0 points":

```json
{
  "rule_id": "PG-CR-HP-1",
  "score_movement": {
    "type": "subcategory_deduction",
    "target": "perf_cache",
    "requested": 2,
    "applied": 2,
    "prior_score": 3.61,
    "new_score": 1.61
  }
}
```

The annotation is **optional and additive** — pre-v1.6.0 consumers that don't read it continue to work.

## Declared targets and the coherence model (v1.9.0 / v1.7.0)

The engine's deepest purpose is not to check a configuration against a fixed ideal — it is to measure whether observed reality is **coherent with what the operator declared they need**. A *declared target* is a manual-input metric whose value is an operational intent: `rpo_target`, `rto_target`, `security_posture`, `growth_headroom_target`, `ha_topology` and `upgrade_plan` (PG) / `dr_topology` (Oracle), flagged `declared_target: true` in the catalog (Oracle's `upgrade_plan` is a yes/no attestation, not a declared target).

Three rules govern every declared target:

1. **Declaration is never graded.** A target enum is *all-pass*: every declarable value is in `pass_values`, so declaring anything — however modest — earns full points. Declaring `rpo_1440` (24-hour RPO) costs exactly nothing. This is the "at your own pace" principle: the score never punishes an honest, humble target. It is enforced by a catalog-content test (`test/coherence-targets.test.js`).

2. **Incoherence is punished — by rules, not by the metric.** A `consistency_rule` links the declaration to the *evidence that must back it* and fires when they contradict. The canonical shape is `metric_zero` on the target (the declared points are invalidated while the weight stays in the denominator), optionally stacked with a `subcategory_cap` when the contradiction invalidates the whole subcategory. Example: `rto_target=rto_5` with no PITR, no standby, and no backup tool → `PG-CR-RTO-2` zeroes `rto_target` and caps `backup_recovery` at 60 %.

3. **A declaration sets a target, it never switches a check off (1.16.0).** Every check counts for every estate: 100 always means best practice everywhere. A declaration decides which checks are *required*: a check whose `optional_when` holds (see *Target and status* below) still earns or loses its own points, but leaves the target score and never triggers a criticality gate. A DEV that declares a 24-hour RPO is not required to archive WAL, and a DEV that archives anyway scores above its target.

This is what separates the model from a checklist: a checklist scores the configuration; the coherence model scores the *gap between declared intent and observed reality*. Maturity is then a journey of **tightening your own targets** — declaring `rpo_60`, later `rpo_15` — each rung activating stricter coherence rules, at a pace the operator controls.

Targets now exist in every pillar (Backup: RPO/RTO; Security: `security_posture`; Capacity: `growth_headroom_target`; Performance: HA/DR topology; Future-Proofing: the `upgrade_plan` ↔ version-currency link). See the catalog `release_notes` and [cross-metric rules guide](guides/cross-metric-rules.md) for the full rule list.

## Scoring policy (generated)

The shared rules below are the engine's published definition of the score. They are read by the engine from `src/scoring/policy.js` and rendered here by `npm run generate-docs`, so this table cannot drift from the code. The simulator's "How the score works" page renders the same object.

<!-- policy:start -->
_Generated from `src/scoring/policy.js` (policy 1.15.0) by `npm run generate-docs`. Do not edit by hand._

| Rule | Value |
|------|-------|
| Criticality weights | critical 3x, important 2x, advisory 1x |
| Subcategory gate | a failed critical metric caps its subcategory at 60 percent of its points |
| Pillar critical cap | a hard-failed or missing critical metric caps its pillar at 60 percent of its points |
| Partial credit | threshold and range metrics earn 50 percent of their points when the value is within 2x of the bound (exact, never rounded; such a value is never reported as passed), nothing beyond |
| Status bands | excellent at 90 percent or more, good at 70, needs improvement at 50, critical below that |
| Default restore throughput | 200 MB/s, used by restore_time_estimate_minutes when no restore test attested a rate |

**Derived formulas** (engine-computed before scoring; a missing input makes the metric not provided):

| Formula | Expression | Inputs | Unit | Meaning |
|---------|------------|--------|------|---------|
| `memory_pressure_pct` | `(shared_buffers_bytes + max_connections * work_mem_bytes) / ram_bytes * 100` | `shared_buffers_bytes`, `max_connections`, `work_mem_bytes`, `ram_bytes` | percent | Configuration heuristic, not a bound: share of host RAM set aside for shared buffers plus max_connections times work_mem. work_mem applies per sort or hash operation and hash operations may use hash_mem_multiplier times it. |
| `wal_buffers_ratio` | `wal_buffers_bytes / shared_buffers_bytes` | `wal_buffers_bytes`, `shared_buffers_bytes` | ratio | WAL buffers as a decimal share of shared buffers (0.03 = 3 percent). |
| `wal_buffers_ratio_capped` | `wal_buffers_bytes / min(shared_buffers_bytes / 32, 16 MB)` | `wal_buffers_bytes`, `shared_buffers_bytes` | ratio | WAL buffers against the PostgreSQL auto-tune expectation; 1.0 is exactly the auto-tuned value. |
| `count_csv` | `count of non-empty comma-separated entries in the input` | `<one comma-separated input>` | count | Number of entries declared in a comma-separated setting (for example synchronous_standby_names). |
| `oracle_memory_pct_of_ram` | `(sga_target + (pga_aggregate_limit or pga_aggregate_target)) / ram_bytes * 100` | `sga_target`, `pga_aggregate_target`, `pga_aggregate_limit`, `ram_bytes` | percent | Instance memory as a share of host RAM; the PGA hard limit is used when set, the target otherwise. |
| `restore_time_estimate_minutes` | `database_size_gb * 1024 / (restore_throughput_mb_s or defaults.restoreThroughputMbPerSecond) / 60` | `database_size`, `restore_throughput_mb_s` | minutes | Minutes to restore the database at the attested restore throughput, or at the policy default when none was attested. |

**Vocabularies** enforced by `npm run validate-catalogs`:

- Sources: `sql`, `manual`, `zabbix`, `worker`
- Numeric system-fact anchors: `ram_kb`, `ram_bytes`, `cpu_count`, `storage_size_kb`, `storage_size_bytes`
- String system facts: `storage_type`, `edition`
- Workload profiles: `default`, `oltp`, `olap`, `mixed`
- License requirements: `enterprise_edition`, `diagnostic_pack`, `tuning_pack`, `advanced_security`, `advanced_compression`, `partitioning`, `rac`, `active_data_guard`
- Boolean checks: `not_empty_or_dummy`, `not_empty`
- Predicate operators: metric leaves `equals`, `in`, `not_in`, `gt`, `gte`, `lt`, `lte`, `is_truthy`, `provided`; numeric system facts `equals`, `gt`, `gte`, `lt`, `lte`; string facts and workload profile `equals`, `in`, `not_in`
- Score adjustment types: `subcategory_cap`, `subcategory_deduction`, `pillar_deduction`, `metric_zero`, `none`
- Evaluation types: `boolean`, `enum`, `threshold`, `range`; criticalities: `critical`, `important`, `advisory`; rule severities: `critical`, `warning`, `info`
<!-- policy:end -->

## Scoring Calculation

### Step 1: Evaluate Each Metric

For each active metric, the collected value is evaluated against the metric's config. Result: `score` (0 to weight) and `passed` (boolean).

### Step 2: Weighted Normalization (per subcategory)

Within each subcategory:

```
subcategory_score = (sum_of_metric_scores / sum_of_metric_weights) * subcategory_maxPoints
```

Weights come from the criticality weights in the Scoring policy above (critical, important, advisory).

**Example**: A subcategory with maxPoints=5 and three metrics:
- Critical metric (weight 3): passes → score 3
- Important metric (weight 2): passes → score 2
- Advisory metric (weight 1): fails → score 0

Score = (3+2+0) / (3+2+1) * 5 = 5/6 * 5 = **4.17 points**

### Step 3: Criticality Gate (per subcategory)

If **any critical metric fails** in a subcategory, the subcategory score is **capped at the subcategory gate share** of its maxPoints (Scoring policy above).

This prevents a subcategory from scoring well when a foundational requirement is missing.

A finding is always emitted when the gate is active — even if the natural score is already at or below 60% (no capping needed). This way, a low subcategory score is never silent about *why*.

**Subcategories without critical metrics are intentional.** Some domains — maintenance hygiene, capacity planning, upgrade planning, lock contention — degrade gradually and have no single binary catastrophic state. Their subcategories carry only important/advisory metrics and therefore can never trigger the 60% gate; they influence the score proportionally instead. Promoting a metric to critical just to "enable gating" would invent severity the domain doesn't have.

#### Why partial credit still triggers the gate

A critical threshold metric that scores **partial credit** (the partial-credit rule in the Scoring policy above) still triggers the gate. The intent is conservative-by-design: when a foundational requirement is at the boundary, the score should reflect concern, not optimism.

**Worked example.** Consider a `backup_wal` subcategory worth 5 points with one critical threshold metric `archive_lag_minutes` (weight 3, `max: 5`) and two non-critical metrics passing.

| Lag value | Critical metric score | Subcategory raw | After 60% gate | Final |
|-----------|-----------------------|-----------------|----------------|-------|
| 4 min (pass) | 3 / 3 (full) | 5.0 / 5 | gate not triggered | **100%** |
| 8 min (partial — within 2× of max) | 1.5 / 3 (50%) | 3.75 / 5 | capped to 3.0 | **60%** |
| 15 min (full failure) | 0 / 3 | 2.0 / 5 | gate active, no capping | **40%** |

Note that the partial-credit case (lag=8) and the full-failure case (lag=15) both trigger the gate finding. The partial-credit case includes a "partial credit X/Y" detail in the finding description so the reviewer sees exactly what tripped it.

> **Algorithmic alternatives** (e.g., binary critical scoring where critical metrics return 0 or full, never partial) are tracked for v1.2 once Technology Leader validation produces field evidence. The current model is intentionally conservative.

### Step 4: Pillar Rollup

Pillar score = sum of subcategory scores, capped at the pillar's maxPoints (20).

### Step 5: Pillar Criticality Cap (v1.14.0)

If a critical metric anywhere in the pillar **hard-fails (natural score 0) or is missing**, the whole pillar is **capped at the pillar critical cap share of its maxPoints** (Scoring policy above; 12 of 20 points at the current value). This escalates the Step 3 subcategory 60% gate one level: without it, a single failed critical only dents the subcategory it lives in and is diluted to roughly two points at the pillar tile, so a failing foundation could hide behind a 98/100. Partial credit does **not** trigger this cap (it follows the natural evaluation, hard-fail only, mirroring the subcategory gate). The pillar is flagged `criticalGated: true` in the output and a finding is emitted when the cap binds. Like a `pillar_deduction`, this is a pillar-scoped adjustment, so a capped pillar may show less than the sum of its subcategories.

### Step 6: Pillar Zero Gate

If a metric with `gate_scope: "pillar"` and `criticality: "critical"` fails on its natural evaluation, the **entire pillar score is set to 0** (this overrides the Step 5 cap). Currently only the "Version Supported" metric (FUT-1.2 in PostgreSQL) and the Oracle `archive_log_mode` / `db_version` metrics carry this gate. A **missing** pillar-gate critical does not zero the pillar (its natural score is unknown), but it does trip the Step 5 cap.

### Step 7: Total Score

Total = sum of all 5 pillar scores (max 100).

### Step 8: Target (1.16.0, absolute since 1.17.0)

Each subcategory's target is its points times the share of its weight that the *required* checks carry, over every applicable check, collected or not, including the checks outside the run's collection scope. For the same catalog, declarations and applicability facts, every run has the same target. A pillar's target is the sum of its subcategories, capped at its 20 points; the total target (`targetScore`) is the sum of the pillars. An estate that declares nothing is required to meet every check, so its target equals its maximum.

## Status Levels

Status follows the share of the target reached (1.16.0): `targetAttainment` is the points earned on required checks (`requiredScore`) divided by the target, as a percentage, at the total, pillar and subcategory levels. Extra effort on checks the targets do not require raises the score but never the share of the target. **"Excellent" means on target: every check the declared targets require is assessed and fully met, and no rule deduction or cap took required points** (a check guarded on its own value, or version-gated under an unknown server version, does not apply when it was not collected, and a non-critical declared target left blank keeps its full points, so these are outside it) (`onTarget`, with `requiredMissed` listing the required checks missed, or the rule that took the points, so every consumer can flag "target not reached"). A required check with no value (1.17.0: any criticality, in or out of the run's collection scope) stays in the target, counts 0 and is listed in `requiredMissed` as `missing`, so the estate is not on target until it is assessed. Below that, the status bands in the Scoring policy above apply to `targetAttainment`, with "good" as the ceiling, and `targetAttainment` never reads 100. Where nothing is declared every check is required, so "excellent" means every check met. `totalPercentage` (score divided by maximum) is kept for consumers that read it.

The percentage floors of each status are the status bands in the Scoring policy above. The internal status codes (`excellent` / `good` / `needs_improvement` / `critical`) are kept stable so existing checker and platform CSS classes, filters and badges do not break; downstream UIs label them Healthy / Degraded / Warning / Critical. The `excellent` cut-off was raised from 85 to 90 percent in commit `58372ee` (2026-05-20) to match dbi services' internal grading, so a score of 76 lands in `good` / "Degraded" rather than `excellent` / "Healthy".

### Disposition: read the band with it (1.15.0)

The band follows the total alone. Because the gates cap a pillar instead of zeroing the total, a failed critical check can sit inside an `excellent` total (the adoption review of 2026-09-04 reproduced 92/100 with autovacuum off), and a critical cross-metric finding may not move the band at all. Every result therefore carries `disposition`:

- `state`: `clear`, or `critical_unresolved` when at least one critical requirement is open;
- `items`: one entry per open problem. A critical metric reads `{ kind: 'metric', id, name, pillar, reason }`, where `reason` is `failed` (below full points), `missing` (no value), `unresolved` (a size-relative bound whose system fact is missing) or `invalidated` (zeroed by a non-critical rule, rule ids in `rules`). A critical-severity cross-metric finding reads `{ kind: 'rule', id, name, pillar, reason: 'rule', invalidates }`, listing the critical metrics it zeroed, so one problem is never counted twice;
- `unassessed`: the required critical metrics never assessed because their collector did not run (`reason` `mode` or `source`) or, since 1.17.0, because an unknown server version left them out (`reason` `version_unknown`). `clear` covers assessed metrics only.

`status` and the score are unchanged by the disposition. A consumer that shows a status label should show the disposition next to it.

## On score precision

The engine rounds scores at three rollup sites — subcategory, pillar, and total — to **2 decimal places** (`Math.round(x * 100) / 100`). This precision was inherited from the initial extraction (it predates the v1.0.0 commit) and is deliberate, not academic.

**Why 2 and not 1.** The simulator and impact analyzer surface score *deltas* when a single rule fires or a threshold is edited. A pillar-level deduction of 1 point on a 20-point pillar is a 5%-of-pillar move that looks fine at 1 decimal. But a `subcategory_deduction` of 0.5 points on a 5-point subcategory is a 0.05-point move at the total-score level — at 1 decimal that rounds to "0.1" (visually doubled) or "0.0" (visually gone); at 2 decimal it stays "0.05" and faithfully represents what the rule did. The 2-decimal precision preserves these small deltas so a tech leader iterating on a catalog can see exactly which change moved the score by how much.

**This is not "spurious precision".** 2-decimal output does not imply 2-decimal *accuracy* — Principle 1 in the [Design Philosophy](#design-philosophy) ("operational truth, not academic precision") still applies. The 2-decimal value is the faithful result of the weighted normalization formula (`(sum_of_metric_scores / sum_of_metric_weights) × maxPoints`), not a calibrated probability. When weights ∈ {1, 2, 3} and metric scores can be half-integers (50% partial credit), the natural output already lands at 3+ significant figures (e.g. `25/7 ≈ 3.5714…`); the rounding decision is where in the precision tail to cut.

**Recommendation for consumer UIs**: format at 1 decimal for human-facing dashboards and executive summaries (the worked example in the README shows `90.7`); keep 2 decimals in audit/diagnostic views where score deltas are the operator's main signal (simulator, impact analyzer, benchmark report). The engine's job is to return truth; presentation precision belongs to the consumer.

## Missing Values

> **One ruler, whatever was collected (1.17.0).** An uncollected check stays on the ruler at 0 points and is reported in `pointsNotAssessed` (total, pillar, subcategory), so score plus points not assessed never exceeds the maximum. A missing *critical* signal is also a finding: it triggers the criticality gates. Before 1.17.0 a missing non-critical check left its section and its neighbours absorbed its points; that is gone. See *Principle 5* in the [Design Philosophy](#design-philosophy).

- **Missing critical metric** → counts 0 points (the weight stays in the denominator) and the criticality gate triggers.
- **Missing non-critical metric** (1.17.0) → counts 0 points, stays in the target when required, listed in `requiredMissed` as `missing`.
- **Out of the run's collection scope** (1.17.0: an agent-only check in a standalone run, a source not in `availableSources`) → counts 0 points and stays in the target, flagged `outOfScope: true`, but never triggers a gate or cap: the run had no means to collect it. A value sent for it is not scored.
- **Empty string** → a missing value.
- **Non-critical declared target left blank** (1.17.0, Adrien 2026-10-08) → costs nothing: it keeps its full points as any declared value would (`undeclared: true`, `value: 'not declared'`) and is not a missed required check. A declaration is an input that sets the target, and an undeclared estate already pays through a target at its maximum. A blank critical declaration (recovery point, recovery time) counts 0 and gates, as before.
- **Unknown server version** (1.17.0) → a version-gated check applies when its value was collected and does not apply when absent; an info finding names the checks left out.
- **Missing manual input** → generates an informational finding suggesting the operator provide the value.
- **Not applicable metric** (v1.8.0, `applies_when` false) → a third state, distinct from "not provided": excluded from numerator, denominator, **and gates** — even when critical. The entry is still reported (`applicable: false`, `maxScore: 0`, `value: "not applicable"` unless a value was collected anyway) so reviewers can audit what was skipped and why. A subcategory where nothing applies reports `maxScore: 0` and drops out of the pillar denominator (v1.7.1 dynamic denominator; since 1.17.0 a subcategory whose checks apply but were not collected stays in).

## Assessment context and coverage (v1.11.0+)

Every result carries two additive top-level keys so a score is reproducible and its completeness is visible — the "citable certificate" a stored or shared score needs.

- **`context`** echoes the conditions the score was produced under: `technology`, `catalogVersion`, `engineVersion`, `mode`, `workloadProfile`, `deploymentProfile`, `pgVersion`, `serverVersion` (1.15.0, the version the filter used), `licensedOptions` (normalised, including the auto-derived `enterprise_edition`), `availableSources`, and `systemFactsProvided`.
- **`coverage`** reports how much of the *applicable* catalog was actually assessed: `assessedWeight` / `applicableWeight` / `percentage`, a `counts` breakdown (`scored`, `missingCritical`, `missingNonCritical`, `notApplicable`, `licenseExcluded`), and a `perPillar` percentage map. Weights are per-metric effective weights; not-applicable and license-excluded metrics sit **outside** the denominator (a Standard Edition estate is measured only on what it can run). A missing **critical** metric both punishes the score *and* lowers coverage — both are true and both are shown, so a sparse assessment reads as sparse instead of silently out-scoring a fully-collected one.

- **Collection scope (1.15.0).** The coverage denominator only holds metrics that were in scope, so a run that declared only SQL can read 100 percent. `coverage.collectionScope` is `full` or `partial`, and `coverage.outOfScope` lists the metrics that apply to the estate but were never assessed because their evidence source was not declared (`availableSources`) or they need the agent in standalone mode: `count`, `critical` (their metric ids) and `metricIds`. Metrics left out for version, deployment profile, extension, license or `applies_when` are not counted: they do not apply. Show the collection scope next to any coverage figure, and show the score as `totalScore` out of `totalMaxScore`.

Both keys are additive: pre-v1.11.0 consumers reading a closed key-set are unaffected.

## Active Metric Filtering

Not all metrics apply to every instance. The engine filters metrics by:

- **Mode**: `standalone` (direct SQL) or `agent` (remote execution)
- **Database version**: Some metrics require a minimum version. Pass `serverVersion` in the catalog's own format (PostgreSQL `server_version_num` such as 170000, dotted for MySQL, MariaDB and MongoDB such as `8.0.35`); `pgVersion` stays accepted as its alias. Since 1.15.0 the MySQL and MariaDB minimum-version fields are enforced, not only PostgreSQL's (MongoDB, Oracle and SQL Server fields are registered but empty today). A version that cannot be read or compared filters nothing
- **Deployment profile**: Some metrics only apply to certain environments (e.g., self-managed vs. Azure)
- **Installed extensions**: Extension-specific metrics only activate when the extension is detected
- **Available sources**: Only metrics whose data source is available are scored

### Metric applicability — `applies_when` (v1.8.0+)

The filters above are *catalog-level* (they need no collected values). `applies_when` is the *runtime* layer on top: an optional per-metric predicate — same DSL as consistency rules — evaluated against the collected values + context after the derived-metrics pass. When it is false the metric is **not applicable** (see *Missing Values* above).

```json
{ "metric_id": "PER-4.1", "legacy_name": "replication_lag_seconds", "criticality": "critical",
  "applies_when": { "any_of": [
    { "metric": "streaming_status",  "is_truthy": true },
    { "metric": "ha_standby_count",  "gte": 1 }
  ] } }
```

> Pick the gate signal carefully: gating replication metrics on `synchronous_standby_names_count` would wrongly exempt *asynchronous* fleets — gate on replication **presence**, not on one replication flavor.

This is what makes **conditional criticals** sound: replication metrics stay critical *on instances that have replication* and vanish elsewhere, instead of being permanently downgraded to `important` for everyone.

Authoring idioms for the missing-signal case (a predicate over a missing value is false → metric not applicable, the fail-safe direction):

- `{ "metric": "x", "is_truthy": true }` — applies only when `x` is known to be on.
- `{ "none_of": [ { "metric": "x", "equals": "off" } ] }` — applies unless `x` is known off (missing → still applies).

Derived metrics are always computed (cheap, pure) even when their own `applies_when` is false, so rule predicates and other metrics' `applies_when` can reference derived values regardless of applicability.

`applies_when` holds technical conditions only (a version, archiving being on, a pooler being present). From 1.16.0 it may not read a declared target: a declaration never decides whether a check is judged.

### Target and status — `optional_when` (1.16.0)

`optional_when` is an optional per-metric predicate, in the same language, that may read **declared targets only** (metrics flagged `declared_target`). When it holds, the declared targets do not require the check:

- it still earns or loses its own points, so doing more than the policy asks shows in the score;
- its weight leaves the target score;
- it never triggers the subcategory gate, the pillar critical cap or the pillar zero gate, and never enters the disposition; a missing one still counts as 0 points in the score and the maximum. Besides the checks judged against the declared target and the coherence rules, this is the one other way lowering a target can move a score: the caps apply only to checks the targets require, because a cap flags a missing foundation the estate needs;
- its failed finding has `info` severity and `aboveTarget: true`, and its recommendation comes after the required work.

A missing declaration makes the predicate false, so an undeclared estate is required to meet the check; the validators refuse conditions that could hold with nothing declared (`none_of`, `not_in`, `provided: false`). They also refuse `optional_when` on a check flagged `floor: true` (the PostgreSQL SSL checks: SSL is a floor on every environment), on a pillar-gate check and on a declaration itself. Each metric in the result carries `required` and, when false, `optional_because` (the declarations that made it so).

```json
{ "metric_id": "BAK-1.1", "legacy_name": "archive_mode", "criticality": "critical",
  "optional_when": { "metric": "rpo_target", "in": ["rpo_1440"] } }
```

A practice that brings its own checks (WAL archiving brings its command, failure count and timeout) adds them as not required too; they join their subcategory's weight, so the target can move slightly when the practice is switched on.

### License/pack applicability — `license_requirement` (v1.9.0+)

`applies_when` is value-driven; `license_requirement` is the **context-driven** sibling for licensed editions/options/packs (technology-agnostic; Oracle is the first user). A metric may declare a single recognized option (`enterprise_edition`, `diagnostic_pack`, `tuning_pack`, `advanced_security`, `advanced_compression`, `partitioning`, `rac`, `active_data_guard`). When the customer's owned set — `calculate(values, { licensedOptions: [...] })`, with `enterprise_edition` auto-derived from `systemFacts.edition === 'enterprise'` — does not include it, the metric is **not applicable** (same exclusion as `applies_when`: no points, no gate) and is reported in `result.licenseExcluded[]` with `exclusion_reason: 'license'`. This keeps the *full* catalog as the scoring basis while making the score relevant per license: a Standard-Edition estate is scored only on what it can run and is never penalized for an option it cannot license. Fail-closed — with no context, pack/EE metrics are simply out of scope. The field is also metadata the collector reads to avoid running unlicensed SQL.
