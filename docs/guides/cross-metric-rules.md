# Authoring Cross-Metric Consistency Rules

A consistency rule encodes a *relation between metrics* that no single metric can express on its own: "PITR requires `wal_level=replica`", "synchronous_commit must match the replication topology", "huge_pages should be enabled when shared_buffers is large". Rules live in each catalog's `consistency_rules` array and fire at scoring time.

This guide is for **technology leaders** authoring or reviewing rules.

## When to write a rule vs. a derived metric

Both shapes encode multi-input logic. Pick by the *shape of the answer*:

- **Derived metric**: the answer is a *number* with a threshold (e.g., memory pressure percent, WAL buffer ratio). Inputs are arithmetic. The result wants to be visible as a first-class metric — it appears in the simulator's metric table, has a description and remediation, contributes to its subcategory's score normally. Add a formula to `DERIVED_FORMULAS` in `src/scoring/engine.js`, declare `derived: true` and `derived_from` in the catalog metric.
- **Consistency rule**: the answer is a *condition* (one configuration contradicts another). Inputs are categorical. The result wants to be a finding with severity and remediation, and may move the score via `score_adjustment`. Add a rule to `consistency_rules`.

If you find yourself writing arithmetic inside a rule predicate (e.g., comparing `metric_a + metric_b` to a constant), that's the signal that the right shape is a derived metric. The rule that wants to fire is then a simple threshold check against the derived value, optionally combined with a second metric.

## Rule anatomy

```json
{
  "rule_id": "PG-CR-MEM-1",
  "title": "Memory pressure compounded by huge_pages=off",
  "description": "Reserved PostgreSQL memory is past the safe headroom AND the kernel is serving it with 4 KB pages.",
  "applies_when": { /* predicate */ },
  "on_violation": {
    "severity": "warning",
    "score_adjustment": { "type": "subcategory_deduction", "target": "perf_cache", "points": 1 },
    "title": "Memory budget tight with huge_pages=off",
    "description": "memory_pressure_pct={value:memory_pressure_pct}% with huge_pages={value:huge_pages}; TLB misses compound the budget pressure.",
    "remediation": "Reduce shared_buffers, lower max_connections × work_mem, or enable huge_pages=try with vm.nr_hugepages = shared_buffers / 2 MB."
  },
  "tags": ["memory", "huge-pages"],
  "pillar_hint": "performance"
}
```

| Field | Required? | Notes |
|-------|-----------|-------|
| `rule_id` | yes | Unique across the catalog. Convention: `<TECH>-CR-<TOPIC>-<N>`, e.g., `PG-CR-HP-1`. |
| `title`, `description` | yes | Plain English summary. Shown in the simulator and benchmark report. |
| `applies_when` | yes | The predicate. See *Predicate DSL* below. |
| `on_violation.severity` | yes | `critical` / `warning` / `info`. Drives finding color and the recommendation ordering. |
| `on_violation.score_adjustment` | yes | `{ type: 'none' }` for findings-only. Otherwise `subcategory_cap`, `subcategory_deduction`, or `pillar_deduction`. See *Score adjustments* below. |
| `on_violation.title/description/remediation` | yes | Finding text. Supports `{value:metric_name}` interpolation. |
| `tags` | optional | Free-form, used for filtering in tooling. |
| `pillar_hint` | optional | Used to attribute the finding to a pillar when `score_adjustment.type` doesn't already point to one (e.g., type `none`). |

## Predicate DSL

A predicate is a tree of composites and leaves. The shape invariant is enforced by `scripts/validate-catalogs.js`:

- **Composite nodes** carry exactly one of `all_of`, `any_of`, `none_of` (each an array of children). Composites do not mix with leaf operators.
- **Leaf nodes** carry exactly one operator from exactly one operand family (metric, system_fact, or workload_profile).

### Metric-value leaves

Read `values[node.metric]`. Most rules use these.

```json
{ "metric": "huge_pages",          "in": ["off"] }
{ "metric": "shared_buffers_bytes","gte": 8589934592 }
{ "metric": "pitr_enabled",        "is_truthy": true }
{ "metric": "archive_command",     "provided": false }
```

Available operators: `equals`, `in`, `not_in`, `gt`, `gte`, `lt`, `lte`, `is_truthy`, `provided`.

### System-fact leaves (v1.6.0+)

Read `ctx.systemFacts[node.system_fact]`. Use these when the rule needs to know about the host: "only fire on hosts with ≥ 8 GB RAM", "only fire on multi-CPU hosts".

```json
{ "system_fact": "ram_kb",       "gte": 8388608 }
{ "system_fact": "cpu_count",    "lt":  4 }
{ "system_fact": "storage_type", "in": ["ssd", "nvme"] }
{ "system_fact": "edition",      "equals": "enterprise" }
```

Two fact families, each with its own operator family (the validator fails closed on mismatches):

- **Numeric anchors** (`ram_kb`, `ram_bytes`, `cpu_count`, `storage_size_kb`, `storage_size_bytes`) — numeric comparators only (`equals`, `gt`, `gte`, `lt`, `lte`). Same whitelist as size-relative thresholds.
- **String facts** (v1.8.0: `storage_type`, `edition`) — case-insensitive `equals` / `in` / `not_in`. Never valid as `*_pct_of` anchors or derived-formula inputs. Typical values: `ssd|nvme|hdd|san` for storage_type, `enterprise|standard|se2|express` for edition (names are whitelisted, values are free).

The single source for both whitelists is `src/catalog/validation.js` (consumed by the evaluator, the CI validator, and the simulator).

### Workload-profile leaves (v1.6.0+)

Read `ctx.workloadProfile`. Use these when the right answer depends on workload type.

```json
{ "workload_profile": "olap" }                            // sugar for equals
{ "workload_profile": { "equals": "oltp" } }
{ "workload_profile": { "in":    ["olap", "mixed"] } }
{ "workload_profile": { "not_in": ["oltp"] } }
```

Allowed values: `oltp`, `olap`, `mixed`, `default`.

### Composites

```json
{
  "all_of": [
    { "workload_profile": "olap" },
    { "metric": "jit", "is_truthy": false }
  ]
}
```

`all_of` = AND, `any_of` = OR, `none_of` = NAND (none of the children may be true).

### When predicates evaluate to false

A predicate evaluates to **false** (rule does NOT fire) in any of these cases:

- Required metric value is missing/empty.
- Required `system_fact` is absent from `ctx.systemFacts`.
- Required `workloadProfile` was not declared on the engine call.
- A metric value coerces to NaN against a numeric comparator.

This is intentional: a rule that depends on data the operator didn't supply should not fire (no false positives), and the engine emits no finding. If you want to *require* a value, write a separate boolean metric instead.

## Score adjustments

`on_violation.score_adjustment.type` selects how the rule's firing moves the score.

### `none` — findings-only

Default for Phase 1 rules. The rule emits a finding with severity/title/description but does not touch the score. Useful when the relation is informational, or when you're not yet confident in the magnitude.

```json
{ "type": "none" }
```

### `subcategory_deduction` — subtract from a subcategory

```json
{ "type": "subcategory_deduction", "target": "perf_cache", "points": 1.5 }
```

Subtracts `points` from the subcategory's score. Floors at 0. Multiple deductions on the same subcategory sum.

**When to use**: the rule identifies a *concrete cost* that's worth N points of score. The magnitude should be calibrated against the subcategory's `maxPoints` — for a 5-point subcategory, deducting 1 point ≈ 20% of the subcategory; deducting 3 points is severe.

### `subcategory_cap` — ceiling at cap_pct%

```json
{ "type": "subcategory_cap", "target": "perf_cache", "cap_pct": 60 }
```

Sets the subcategory score to `min(currentScore, cap_pct/100 × maxPoints)`. Multiple caps on the same subcategory: **lowest cap wins**.

**When to use**: the rule says "this subcategory cannot be considered fully healthy while X is true, regardless of the per-metric scores." Mirrors the engine's critical-tier 60% cap, but driven by a relation rather than a single metric.

### `pillar_deduction` — subtract from a pillar's rollup

```json
{ "type": "pillar_deduction", "target": "backup", "points": 4 }
```

Subtracts `points` from the pillar's accumulated score *before* the maxPoints cap is applied. Floors at 0. Use sparingly — pillar-level adjustments are the strongest opinion.

**When to use**: the rule identifies a foundational pillar-wide failure that no individual metric captures. Example: synchronous_commit=off with sync standbys declared undermines the entire Backup & Recovery pillar's declared RPO, even though no individual backup metric is failing.

### `metric_zero` — invalidate a declared metric's points (v1.8.0)

```json
{ "type": "metric_zero", "target": "rpo_target" }
```

The targeted metric (`target` = its `legacy_name`) earns **0 points while its weight stays in the denominator**. This is the punitive counterpart to per-metric `applies_when` (which *excludes* — neither credit nor penalty).

**When to use**: a *declared intent* — typically a manual input — is contradicted by the technical evidence. The canonical case: `rpo_target=rpo_5` is declared but `archive_mode=off`; the operator should not collect the RPO points for a claim the configuration cannot honor. The rule's own finding explains why; the metric entry gains `zeroed_by_rules: [rule_id, …]` and `natural_score` (what it would have earned).

**Gate semantics — deliberate**: a zeroed-but-naturally-passing **critical** does *not* fire the 60% gate. The gate means "a foundational requirement failed on its own evidence"; `metric_zero` means "these points are invalidated by a contradiction" — the severity of that contradiction is the rule author's call. When you *do* want the gate effect, compose it explicitly:

```json
"score_adjustments": [
  { "type": "metric_zero",      "target": "rpo_target" },
  { "type": "subcategory_cap",  "target": "backup_recovery", "cap_pct": 60 }
]
```

No-op cases (finding still emitted, no score movement): target missing, target not applicable (`applies_when` wins), target filtered out. Multiple zero-rules on one metric are idempotent on the score; each finding gets its own annotation. *(A `metric_cap` partial-invalidation shape was considered and deferred — approximate it with a `subcategory_deduction` sized to the metric's weight share.)*

### Multiple adjustments per rule (v1.8.0)

`on_violation.score_adjustments: [ … ]` (plural) lets one rule move several targets without duplicating the predicate:

```json
{
  "rule_id": "PG-CR-CONN-LOCK-1",
  "applies_when": {
    "all_of": [
      { "metric": "connection_usage_pct", "gte": 95 },
      { "metric": "blocked_queries",      "gte": 10 }
    ]
  },
  "on_violation": {
    "severity": "critical",
    "score_adjustments": [
      { "type": "subcategory_deduction", "target": "capacity_connections", "points": 2 },
      { "type": "subcategory_deduction", "target": "perf_locks",           "points": 2 }
    ],
    "title": "Connection saturation is amplifying lock contention"
  }
}
```

Rules (validator-enforced): plural is XOR with the singular `score_adjustment`; the array must be non-empty; `type: "none"` is not allowed inside it; exact duplicate `(type, target)` pairs are an error (distinct types on the same target — the metric_zero + cap idiom above — are fine). The finding's pillar/category attribution follows the **first** entry, so order the primary target first.

### Composition order

`metric_zero` applies inside the weighted normalization (it changes the numerator before anything else) → the critical-tier 60% gate (driven by **natural** per-metric results, not rules) → **deductions sum**, then **caps (lowest wins)** per subcategory → pillar deductions during rollup.

### Score movement annotation

Every firing rule whose adjustment type ≠ `none` augments its finding so the operator can see exactly which rule moved the score and by how much. Singular-form rules write a `score_movement` object; plural-form rules append to a `score_movements` **array** in application order:

```json
"score_movement": {
  "type": "subcategory_deduction",
  "target": "perf_cache",
  "requested": 2,
  "applied": 2,
  "prior_score": 3.61,
  "new_score": 1.61
}
```

`metric_zero` movements carry `target` (legacy_name), `subcategory`, `metric_prior_score`, `metric_max`, `applied` (points removed at metric level — 0 when the metric failed naturally anyway), and the counterfactual subcategory `prior_score` → `new_score`. All annotation fields are optional and additive — pre-v1.6.0 consumers that don't read them continue to work.

## Worked examples from the PostgreSQL catalog

### `PG-CR-OLAP-JIT-1` — workload-conditioned deduction

```json
{
  "rule_id": "PG-CR-OLAP-JIT-1",
  "applies_when": {
    "all_of": [
      { "workload_profile": "olap" },
      { "metric": "jit", "is_truthy": false }
    ]
  },
  "on_violation": {
    "severity": "warning",
    "score_adjustment": { "type": "subcategory_deduction", "target": "perf_queries", "points": 1.5 }
  }
}
```

Pattern: gate the rule on the workload profile; the magnitude is constant. To make a deduction "stronger under OLAP" you write a second rule with a different gate — don't try to parameterise the magnitude per profile.

### `PG-CR-HP-1` — system-conditioned deduction

```json
{
  "applies_when": {
    "all_of": [
      { "metric": "shared_buffers_bytes", "gte": 8589934592 },
      { "metric": "huge_pages", "in": ["off"] }
    ]
  },
  "on_violation": {
    "score_adjustment": { "type": "subcategory_deduction", "target": "perf_cache", "points": 2 }
  }
}
```

Pattern: only deduct when the host condition matters. A small instance with `huge_pages=off` may genuinely not need huge pages.

### `PG-CR-SYNC-1` — pillar-level critical

```json
{
  "applies_when": {
    "all_of": [
      { "metric": "synchronous_commit", "in": ["off", "local"] },
      { "metric": "synchronous_standby_names_count", "gte": 1 }
    ]
  },
  "on_violation": {
    "severity": "critical",
    "score_adjustment": { "type": "pillar_deduction", "target": "backup", "points": 4 }
  }
}
```

Pattern: when the failure invalidates an entire pillar's claim (here, the declared durability tier), a pillar deduction is the right shape. 4 points = 20% of the 20-point pillar.

## Calibration notes

- **Start with `type: 'none'`** while iterating on the predicate. Once the rule fires only when it should, decide whether the score deserves to move and what magnitude is justifiable.
- **Magnitudes**: for a 5-point subcategory, 0.5–1 point is a "concrete nudge", 2 points is "significant", 3+ is "heavy". For a 20-point pillar, 4 points (= 20%) is already strong.
- **Severity vs magnitude are independent**. A rule can be `severity: critical` with `type: none` (informational only) or `severity: warning` with a `pillar_deduction` (warning that costs the score). Pick severity by *what the operator needs to know*, magnitude by *how much it should hurt the score*.
- **Test the rule on the catalog's healthy + critical samples** before merging. Healthy samples should not fire the rule; critical samples should.

## Adding a rule — checklist

1. Decide: rule, derived metric, or both? (Most pgtune-style relations end up as a derived metric *plus* a couple of rules that gate score movement on combinations.)
2. Write the predicate. Validate it: `npm run validate-catalogs`.
3. Pick the score_adjustment shape. Start with `type: 'none'` if unsure.
4. Calibrate magnitude against the target subcategory/pillar `maxPoints`.
5. Test on healthy and critical samples (or write a new sample if a scenario isn't covered): `npm test` and `node scripts/benchmark-catalog.js <tech> ./modified-catalog.json`.
6. Document in the catalog's `release_notes`.

## Validator enforcement

The shared module `src/catalog/validation.js` (consumed by `scripts/validate-catalogs.js` AND the simulator's pre-export validation — identical semantics) enforces:

- Unique `rule_id` across the catalog.
- `on_violation.severity ∈ {critical, warning, info}`.
- Adjustment `type ∈ {subcategory_cap, subcategory_deduction, pillar_deduction, metric_zero, none}`.
- `subcategory_cap.target` references an existing subcategory; `cap_pct ∈ [0, 100]`.
- `subcategory_deduction.target` references an existing subcategory; `points ≥ 0`.
- `pillar_deduction.target` references an existing pillar; `points ≥ 0`.
- `metric_zero.target` references an existing metric `legacy_name`.
- `score_adjustment` (singular) XOR `score_adjustments` (plural, non-empty, no `none`, no duplicate `(type, target)` pairs).
- Each leaf carries exactly one of `metric`, `system_fact`, `workload_profile` — and exactly one operator.
- Numeric `system_fact` anchors take numeric operators; string facts (`storage_type`, `edition`) take `equals`/`in`/`not_in`; `workload_profile` values are in the profile whitelist.
- Metric leaves reference an existing `legacy_name` in the same catalog.
- Per-metric `applies_when` predicates (v1.8.0) pass the same predicate checks.

CI runs the validator on every PR; a malformed rule fails the build. The simulator rejects the same shapes before export.
