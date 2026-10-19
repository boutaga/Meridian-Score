# Consumer Contract — package v1.17.0 · catalogs PG v1.14.0 / Oracle v1.11.0

This document is the contract between `@dbi-services/scoring-core` (this package) and its two production consumers:

- **`db-health-checker`** — dbi's standalone agent + field tool (not public). Collects values from the database, calls `ScoringEngine.calculate(values, options)`, ships results.
- **`db-health-platform`** — a private consumer (the OpsHub platform). Receives collected values from the agent (or runs SQL directly), calls the same engine, persists assessment history, renders the dashboard.

The engine itself is **technology-agnostic**. The contract is therefore split into three parts: (1) what the engine expects on input, (2) what the engine returns, (3) what's new in v1.6.0 that consumers need to know.

---

## 1. Engine input

### `ScoringEngine.calculate(collectedValues, options)`

```js
const { ScoringEngine } = require('@dbi-services/scoring-core');

const engine = new ScoringEngine('postgresql');  // or 'mysql', 'mariadb', etc.
const result = engine.calculate(collectedValues, {
  // — Existing options (pre-v1.6.0) —
  mode: 'standalone' | 'agent',          // default 'standalone'
  pgVersion: 16,                          // integer
  deploymentProfile: 'self-managed' | 'azure-flexible' | …,
  installedExtensions: ['pg_stat_statements', 'pgaudit', …],
  availableSources: ['sql', 'manual', 'zabbix', 'worker'],
  valueSources: { 'archive_mode': 'sql', 'rpo_target': 'manual', … },

  // — v1.5.0 additions —
  systemFacts: { ram_kb: 16777216, cpu_count: 8, storage_size_kb: 209715200 },
  workloadProfile: 'oltp' | 'olap' | 'mixed' | 'default',  // default 'mixed'
});
```

### `collectedValues` — keyed by `legacy_name`

A plain object (or `Map`) where the key is the metric's `legacy_name` (e.g., `archive_mode`, `shared_buffers_bytes`) and the value is the collected raw value. The engine **does not validate the source** — it trusts the caller.

### `systemFacts` (v1.5.0+, required for size-relative thresholds and `system_fact` predicates)

The engine auto-derives byte siblings: if `ram_kb` is provided, `ram_bytes` is computed; same for `storage_size_kb` → `storage_size_bytes`.

| Key | Unit | When it's used |
|-----|------|----------------|
| `ram_kb`             | kilobytes | size-relative thresholds anchored on `ram_kb`; auto-derives `ram_bytes` |
| `ram_bytes`          | bytes     | derived metrics that need RAM in bytes (e.g., `memory_pressure_pct`); set explicitly if `ram_kb` is not also being sent |
| `cpu_count`          | integer   | size-relative thresholds anchored on `cpu_count` |
| `storage_size_kb`    | kilobytes | size-relative thresholds anchored on storage; auto-derives `storage_size_bytes` |
| `storage_size_bytes` | bytes     | as above |

Missing facts → metrics that require them fall back to `absolute_floor` (with an `info` finding) or are unresolved (score 0, `info` finding). Same for `system_fact` predicates — a missing fact silently makes the predicate false, no finding emitted.

### `workloadProfile` (v1.5.0+)

`'oltp' | 'olap' | 'mixed' | 'default'`. Default is `'mixed'`. Drives profile-keyed threshold selection AND any consistency rule that uses the `workload_profile` predicate operand.

If the platform/UI doesn't know the workload type, pass `'mixed'` explicitly (matches the default). Do not pass `'default'` — it's an internal fallback inside metric definitions, not a recommended public value.

---

## 2. Engine output

```js
{
  totalScore: 86.4,                  // 0..100
  totalMaxScore: 100,                // depends on active metrics
  totalPercentage: 86,
  targetScore: 96.3,                 // v1.16.0 — points of the checks the declared targets require (see §13)
  requiredScore: 85.2,               // v1.16.0 — points earned on those required checks
  targetAttainment: 88,              // v1.16.0 — requiredScore / targetScore, percent; 100 only when onTarget
  onTarget: false,                   // v1.16.0 — every assessed required check fully met and no rule took required points
  requiredMissed: [ { id, name, pillar, subcategory, reason } ],  // v1.16.0 — why onTarget is false (see §13)
  status: 'good',                    // follows targetAttainment since v1.16.0, 'excellent' only when onTarget: 'excellent' | 'good' | 'needs_improvement' | 'critical'
  context: {                         // v1.12.0 — conditions this score was produced under (see §8)
    technology, catalogVersion, engineVersion, mode, workloadProfile,
    deploymentProfile, pgVersion, licensedOptions, availableSources, systemFactsProvided,
    declarations,                    // v1.16.0 — { rpo_target: 'rpo_60', ha_topology: null, ... } (see §13)
    fingerprint,                     // v1.16.0 — { algorithm, canonicalVersion, rules, rulesShort, declarations, declarationsShort }
  },
  coverage: {                        // v1.12.0 — how much of the applicable catalog was assessed (see §8)
    assessedWeight, applicableWeight, percentage, counts, perPillar,
  },
  pillars: {
    backup:      { name, score, maxScore, percentage, target, targetAttainment, onTarget, status, metrics: [...], findings: [...], criticalGated? },
    security:    { … },
    capacity:    { … },
    performance: { … },
    futureproof: { … },
  },
  allMetrics:  [ /* per-metric scoring detail */ ],
  allFindings: [ /* warning/critical/info entries with remediation */ ],
  recommendations: [ /* top 15 actionable items, sorted by severity */ ],
}
```

### `allMetrics[i]` shape

```js
{
  name: 'shared_buffers_bytes',
  metric_id: 'PER-1.13',
  display_name: 'Shared Buffers (Bytes)',
  value: 4294967296,                 // collected or derived value
  source: 'sql',
  description: '…',
  scored: true,                      // false when missing
  score: 1,
  maxScore: 1,
  criticality: 'advisory',
  subcategory: 'perf_cache',
  pillar: 'performance',
  derivation: 'min = 25% of ram_kb=16777216',  // optional, v1.5.0+
}
```

### `allFindings[i]` shape

```js
{
  pillar: 'performance',
  category: 'Caching',
  severity: 'warning',                // 'critical' | 'warning' | 'info'
  title: '…',
  description: '…',
  remediation: '…',

  // — Optional fields —
  rule_id: 'PG-CR-HP-1',              // present for consistency-rule findings
  kind: 'consistency',                // present for consistency-rule findings
  score_movement: {                   // present iff a Phase-2 rule fired (v1.6.0+)
    type: 'subcategory_deduction',    // | 'subcategory_cap' | 'pillar_deduction'
    target: 'perf_cache',
    requested: 2,
    applied: 2,
    prior_score: 3.61,
    new_score: 1.61,
    cap_pct: undefined,               // present only for subcategory_cap
    cap_points: undefined,            // present only for subcategory_cap
  },
}
```

**Backward compatibility**: pre-v1.6.0 consumers that read `allFindings[i]` see only the fields they already knew. The new `score_movement`, `rule_id`, and `kind` fields are optional and additive.

---

## 3. What's new in v1.6.0

### A. New PostgreSQL collected metrics (Tier-1 sizing)

`db-health-checker` should collect these in addition to the existing PG metric set:

| Metric | Source | How to collect |
|--------|--------|----------------|
| `huge_pages`                  | `sql`    | `SHOW huge_pages` |
| `vm_nr_hugepages`             | `manual` | OS-side; agent collector deferred to a follow-up release. Pass via the manual-inputs form for now. |
| `jit`                         | `sql`    | `SHOW jit` |
| `shared_buffers_bytes`        | `sql`    | `SELECT setting::bigint * 8192 FROM pg_settings WHERE name='shared_buffers'` (or use `pg_size_bytes(current_setting('shared_buffers'))` on PG 9.6+). |
| `wal_buffers_bytes`           | `sql`    | `SELECT setting::bigint * 8192 FROM pg_settings WHERE name='wal_buffers'`. |
| `work_mem_bytes`              | `sql`    | `SELECT setting::bigint * 1024 FROM pg_settings WHERE name='work_mem'` (work_mem unit is kB). |
| `max_connections`             | `sql`    | `SHOW max_connections` — this is the *cap* value, distinct from `connection_usage_pct` (utilisation). |
| `default_statistics_target`   | `sql`    | `SHOW default_statistics_target`. Profile-keyed scoring (OLAP needs 500+). |
| `synchronous_commit`          | `sql`    | `SHOW synchronous_commit`. |
| `synchronous_standby_names`   | `sql`    | `SHOW synchronous_standby_names`. Raw CSV — the engine computes the count via `count_csv`. |

### B. New PostgreSQL derived metrics (engine-computed)

These are **not collected** — the engine computes them from the inputs above + `systemFacts`. Consumers don't ship anything new for these.

| Metric | Formula | Inputs |
|--------|---------|--------|
| `memory_pressure_pct`           | `(shared_buffers + max_connections × work_mem) / RAM × 100` | `shared_buffers_bytes`, `max_connections`, `work_mem_bytes`, `systemFacts.ram_bytes` |
| `wal_buffers_ratio`             | `wal_buffers / shared_buffers` | `wal_buffers_bytes`, `shared_buffers_bytes` |
| `synchronous_standby_names_count` | CSV token count | `synchronous_standby_names` |

If an operator explicitly supplies a value for one of these (e.g., from a manual-input override), the engine **does not recompute it** — the explicit value wins.

### C. Score-moving consistency rules

Five new PostgreSQL `consistency_rules` carry non-`'none'` `score_adjustment.type` values. They actually move the score (v1.5.0 rules were all findings-only).

| Rule | Effect on score |
|------|-----------------|
| `PG-CR-MEM-1` | `subcategory_deduction` 1 point on `perf_cache` |
| `PG-CR-HP-1`  | `subcategory_deduction` 2 points on `perf_cache` |
| `PG-CR-SSD-1` | `subcategory_deduction` 1 point on `perf_queries` |
| `PG-CR-OLAP-JIT-1` | `subcategory_deduction` 1.5 points on `perf_queries` (uses `workload_profile: 'olap'` operand) |
| `PG-CR-SYNC-1` | `pillar_deduction` 4 points on `backup` (severity critical) |

Findings emitted by these rules include the new `score_movement` annotation field — see *2. Engine output* above.

### D. Consumer-side UI changes

`db-health-platform`:
- Render `finding.score_movement` as an annotation on the finding badge ("this rule reduced *Caching* by 1.0 points"). Recommended placement: tooltip on the finding row, or inline next to the severity label.
- Consider sorting findings with `score_movement` above findings without when the operator is triaging a degraded score.

`db-health-checker`:
- Ensure the new collectors above run on PG 12+ (matching the catalog's `min_pg_version` gates).
- Surface `result.allFindings[i].score_movement` in the report HTML/CLI output.
- The manual-inputs form should include a field for `vm_nr_hugepages` (Linux only) so operators on tuned hosts can supply the OS-side huge pages allocation.

### E. Backward compatibility

- Pre-v1.6.0 consumers calling the engine with no new fields see no behavioural change: the new metrics report as not-provided (excluded from the subcategory denominator, no penalty), and the new rules don't fire because their predicates depend on metrics that aren't supplied.
- The engine's return shape gains optional fields only — `result.allFindings[i].score_movement`, `result.allMetrics[i].derivation` (the latter already existed in v1.5.0). No fields were removed or renamed.

---

## 4. Catalog releases PG v1.7.0 / Oracle v1.3.0 (2026-06, catalog-only — engine unchanged)

Full-audit content releases; the complete change lists live in each catalog's `release_notes`. What consumers must know:

### A. New collected inputs (emit by `legacy_name`)

**PostgreSQL v1.7.0** (all plain GUC/SQL reads unless noted): `fsync`, `full_page_writes`, `track_counts`, `wal_compression`, `min_wal_size`, `idle_in_transaction_session_timeout`, `statement_timeout`, `temp_file_limit` (map *unlimited* to 0), `autovacuum_max_workers`, `autovacuum_vacuum_cost_limit` (emit the **effective** value — resolve `-1` inheritance), `logical_subscription_failures` (count of subscriptions disabled or in error, PG 10+), `disk_usage_pct` (**agent-only**: filesystem stat via worker/Zabbix).

**Oracle v1.3.0**: `force_logging`, `pdb_violations` (CDB only — omit on non-CDB), `multitenant_architecture`, `memory_config_pct_of_ram` (collector computes (SGA+PGA targets)/RAM × 100), `block_change_tracking`, `log_switch_rate_hourly`, `awr_snapshot_interval`, `audit_trail_purge_job`, `o7_dictionary_accessibility`, `dataguard_broker` (omit when no Data Guard), `use_large_pages`.

### B. Changed semantics (collector coordination)

| Metric | Was | Now |
|---|---|---|
| PG `database_size` | scored as percent (bug) | informational GB ceiling; real disk fullness is the new `disk_usage_pct` |
| PG `growth_rate` | `max:180` (inverted) | `min:90` days-to-full — higher is healthier |
| Oracle `db_version` | passed any non-empty string | parsed numerically, `min:19` (works with `"19.21.0.0.0"`-style values) |
| Oracle `latest_patch` | passed any non-empty string | months since last RU, `max:12` — emit a number |
| Oracle `tablespace_usage` | presence check | leading critical-count of the existing `"N critical, M warning"` value, `max:0` |
| Oracle `invalid_registry_components` | *(new key — replaces `registry_component_count`)* | count of non-VALID DBA_REGISTRY components, `max:0` |

Dropped keys (stop sending; ignored if sent): PG `max_wal_size_check`, `pgbouncer_enabled`, `pgbouncer_detected`, `pgcrypto_installed`, `extensions_count`, `wal_buffers_ratio`; Oracle `max_connections_headroom`, `registry_component_count`.

### C. Collector contracts (now normative)

1. **Omission contract** — collectors must *omit* not-applicable metrics (replication/Data Guard on standalone, PgBouncer config when absent, PDB metrics on non-CDB, wallet state without TDE) rather than emit failing values. **Since 1.17.0 an omitted value counts 0 points and is reported as not assessed, unless the catalog says the check does not apply** (`applies_when`): every check a collector omits because it does not apply must carry such a guard (section 14). Before 1.17.0 a missing non-critical metric was excluded from scoring.
2. **Display-window contract** — time windows baked into display names ("1h", "24h", "90d") are collector contracts: changing a collection window requires a display rename in the catalog.

### D. Criticality changes consumers may notice

Reclassified critical → important pending engine-level applicability (`applies_when`, planned): PG `replication_lag_seconds`; Oracle `standby_health`, `dataguard_apply_lag`, `dataguard_archive_gap`, `wallet_status` (rule `OR-CR-TDE-1` now carries the conditional critical), `awr_enabled` (Diagnostics Pack licensing), `alerting_configured`. Standalone/SE2/no-TDE estates stop being gated for features they never claimed; affected fleets keep proportional scoring plus rule-driven findings.

### E. Backward compatibility

Same guarantee as v1.6.0: new metrics report as not-provided when absent (no penalty), new rules don't fire without their inputs, and the engine return shape is unchanged (catalog-only release).

---

## 5. Engine v1.7.1 (2026-06-10, patch — behavior fixes)

Four fixes ported from field experience (three originated in `db-health-checker`'s fork) plus two review findings:

1. **Dynamic subcategory denominator** — a subcategory whose metrics are *all missing and non-critical* now reports `maxScore: 0` and drops out of the pillar denominator (previously `0/maxPoints`, deflating percentages on sparse/partial collections). Missing **critical** metrics still count and still gate. Consumers scoring partial data will see higher (more honest) `totalPercentage`.
2. **`not_empty_or_dummy` sentinel list extended** — `none`, `unavailable`, `n/a`, `na`, `error`, `unknown`, `null`, `undefined` (case-insensitive) now count as dummy alongside `''`, `/bin/true`, `(disabled)`.
3. **New boolean check `not_empty`** — passes any non-empty value (fixes Oracle `BAK-1.2 archive_dest_configured`, which previously false-failed on real archive destinations). The validator now rejects unknown `check` values.
4. **Unknown `evaluation_type` fails closed** (score 0; previously awarded full points on truthy values).
5. **Recommendations order** — critical-severity recommendations now sort before warnings (a falsy-zero lookup inverted the order).
6. **`finding.source`** — every engine finding now carries a `source` field (`'engine'` for gates/rules/info findings, `'manual'` for missing-manual-input findings, the collector source for metric failures). Additive; UIs that already render a Source column pick it up automatically.

## 6. Engine v1.8.0 (mechanism release)

Five engine mechanisms (the PG v1.8.0 / Oracle v1.4.0 catalogs in §7 are the first to use them):

1. **Per-metric `applies_when`** — optional predicate (same DSL as rules) making a metric *not applicable* when false: excluded from numerator, denominator, and gates, even when critical. Output: the metric entry carries `applicable: false`, `maxScore: 0`, `scored: false`, and `value: "not applicable"` (or the collected value if one arrived anyway). **UI guidance**: render "not applicable" distinctly from "not provided"; don't count these toward failure tallies. `totalMaxScore` can shrink when whole subcategories become inapplicable — trend charts should key on `totalPercentage`.
2. **`metric_zero` rule adjustment** — a fired rule invalidates a specific metric's points (weight stays in the denominator). The zeroed entry carries `zeroed_by_rules: [rule_id, …]` and `natural_score`. Gates follow the natural evaluation (a zeroed-but-naturally-passing critical does not fire the 60 % gate).
3. **Multi-adjustment rules** — `on_violation.score_adjustments: []` (plural, XOR with singular). Findings from plural rules annotate **`score_movements` (array, application order)** instead of `score_movement`. Consumers reading only the singular field keep working for all existing rules; render the array before any catalog ships a plural rule.
4. **String system facts** — `systemFacts.storage_type` (e.g. `ssd|nvme|hdd|san`) and `systemFacts.edition` (e.g. `enterprise|standard|se2|express`) usable in predicates with case-insensitive `equals`/`in`/`not_in`. Optional inputs; collectors may supply them when known.
5. **`wal_buffers_ratio_capped` derived formula** — `wb / min(sb/32, 16MB)`; `1.0` = PostgreSQL's auto-tuned value. Re-enables a correct PER-1.12 in a future PG catalog.

Also: catalog validation is now importable — `require('@dbi-services/scoring-core/validation')` exposes the exact CI-gate walkers/whitelists (the simulator uses the same module).

## 7. Catalog releases PG v1.8.0 / Oracle v1.4.0 (2026-06 — first to use the §6 mechanisms)

These catalogs are the **upstream source of truth** for scoring. The PostgreSQL changes are self-contained (every gate references fields collectors already emit). The Oracle changes encode the correct scoring spec ahead of the collector; **the collector must be patched to emit the fields below** or the new Oracle gates/criticals will misfire on healthy estates.

### A. New / changed collector field contracts (normative)

| Field | Requirement | Why |
|-------|-------------|-----|
| Oracle `systemFacts.edition` | Emit `enterprise` / `standard` / `se2` / `express`. | EE-only metrics (AWR, flashback, BCT, tuning/diagnostics pack, RAC/DG, …) are gated `applies_when edition=enterprise` **fail-closed**: absent ⇒ those metrics are *not applicable* everywhere (no SE2 penalty, but EE estates lose the AWR critical until the fact ships). |
| Oracle `wallet_status` | Emit the `V$ENCRYPTION_WALLET.STATUS` **string** (`OPEN` / `OPEN_NO_MASTER_KEY` / `CLOSED` / …), not a boolean. | SEC-2.2 is now a conditional critical (gated on `tde_encrypted_tablespaces ≥ 1`); a boolean both fails the enum and made OR-CR-TDE-1 misfire on healthy TDE estates. |
| Oracle `standby_health` | Emit the `V$DATABASE.OPEN_MODE` enum (`MOUNTED` / `READ ONLY WITH APPLY` / `READ ONLY`), not `configured`/`active`. | BAK-4.5 is now critical (gated on `dataguard_configured`); the wrong enum gates healthy standbys at 60 %. |
| Oracle `dataguard_apply_lag`, `dataguard_transport_lag` | Emit **numeric seconds**, not a `V$DATAGUARD_STATS` interval string. | These thresholds compare numerically; a string is unresolvable. |
| PostgreSQL replication presence | On replicated instances emit `streaming_status` (truthy) or `ha_standby_count` (≥1). | PER-4.1 is now critical but `applies_when(streaming_status OR ha_standby_count≥1)`; standalone primaries (neither signal) are *not applicable* and never gated for replication. |

### B. Criticality changes consumers may notice

- **PostgreSQL**: PER-4.1 `replication_lag_seconds` important→**critical** (gated); BAK-5.2 `offsite_backup` advisory→**important**. Budget rebalances shift effective points within Backup/Performance/Future-Proofing (all-pass instances still score 100). Nine advisory capture metrics now carry `weight: 0.5`.
- **Oracle**: `standby_health`, `dataguard_apply_lag`, `dataguard_archive_gap`, `wallet_status`, `awr_enabled` important→**critical** (each gated, see §7.A). EE-only and Data-Guard/CDB metrics now report *not applicable* off their respective estates instead of failing or trivially passing. FUT-4.5 re-IDs to **FUT-1.5** (moved to Version Currency).

### C. New consistency rules

- **PG-CR-RPO-2** — aggressive RPO (`rpo_5`/`rpo_15`) with `archive_mode=off` and no streaming standby ⇒ `metric_zero(rpo_target)` + `subcategory_cap(backup_recovery, 60)`.
- **PG-CR-CONN-LOCK-1** / **OR-CR-CONN-LOCK-1** — connection/session saturation amplifying lock contention ⇒ two `subcategory_deduction`s (capacity + locking). Findings carry `score_movements` (array).
- **BAK-CR-1 / BAK-CR-1B** upgraded warning→critical with `metric_zero(rpo_target)`.
- **OR-CR-TDE-1** → findings-only (`type: none`): SEC-2.2 now carries the TDE critical, so the rule annotates the condition without double-counting.

### D. Backward compatibility

PostgreSQL is additive and safe with today's collectors. Oracle gates depend on the §7.A field contract; until the checker ships it, treat Oracle Data-Guard / TDE / Enterprise-edition scoring as pending (the catalog is correct upstream, the collector follows).

## 8. Engine v1.8.1 (additive output — sub-category rollup)

`ScoringEngine.calculate()` now returns a top-level **`subcategories`** map alongside
`pillars` — the realised, post-gate / post-cap score of each sub-category (the engine
already computed these internally for the pillar rollup; v1.8.1 simply exposes them):

```js
result.subcategories = {
  backup_wal: {
    name: 'Log Archiving', pillar: 'backup',
    score: 3, maxScore: 5, percentage: 60,
    status: 'needs_improvement',   // excellent | good | needs_improvement | critical
    hasCriticalFailure: true,      // a critical metric failed → the 60% cap is active
  },
  // … one entry per sub-category
};
```

**Pillar criticality cap (v1.14.0).** Each `pillars[id]` now carries a sparse **`criticalGated: true`** flag when a critical metric in that pillar hard-failed (natural score 0) or is missing, or when the pillar zero gate fired. In the hard-fail/missing case the pillar `score` is capped at 60% of `maxScore` (12/20) on top of the subcategory 60% gate; partial credit does not trigger it. **UI guidance**: render a "critical gate" chip on the pillar tile when `criticalGated` is set. Like `pillar_deduction`, this cap is pillar-scoped, so a capped pillar can show less than the sum of its `subcategories`. Additive and sparse — existing consumers are unaffected.

This is the only source of the true sub-category number once the 60 % criticality gate
and `subcategory_cap` / `subcategory_deduction` rules have applied — per-metric scores
alone overstate gated/capped sub-categories. **Additive and backward-compatible**:
consumers reading `pillars` / `allMetrics` are unaffected.

The bundled **simulator** Score Map consumes this. Its `/simulate/<tech>/calculate` and
`/score-map/<tech>` responses also forward the per-metric `score` / `maxScore` / `value`
(already present on `result.allMetrics[i]`) plus a compact `subcategories` map and
`firedRules`, so the map can render live points, per-metric pass/fail, and the gated
sub-category scores. These are simulator-route conveniences, not new engine fields.

## 9. Engine v1.9.0 (license/pack applicability)

A generic, technology-agnostic mechanism for **licensed editions / options / packs**. A
metric may declare a single-string **`license_requirement`**; when the customer doesn't own
that license, the metric is **not-applicable** — excluded from numerator, denominator, and
gates (no penalty) — and listed in a new **`result.licenseExcluded[]`** for relevance
transparency. The full catalog stays the scoring basis; license determines per-customer
relevance, so a Standard-Edition estate can still reach 100 % on its applicable subset.
(Oracle is the first populator.)

### Metric field
`license_requirement` (optional string). Recognized values: `enterprise_edition`,
`diagnostic_pack`, `tuning_pack`, `advanced_security`, `advanced_compression`,
`partitioning`, `rac`, `active_data_guard`. Validated by the shared validator (fail-closed on
unknown values). Distinct from `applies_when` (which is value-driven); license is external
context.

### Engine input — `options.licensedOptions`

```js
engine.calculate(values, {
  systemFacts: { edition: 'enterprise' },               // EE auto-derives enterprise_edition ownership
  licensedOptions: ['diagnostic_pack', 'tuning_pack'],  // the customer's OWNED options/packs
});
```

- `licensedOptions` is the customer's owned set (case-insensitive).
- `enterprise_edition` is auto-added to the owned set when `systemFacts.edition === 'enterprise'`.
- Options/packs beyond edition are **config-supplied** — Oracle entitlement isn't reliably
  queryable (`DBA_FEATURE_USAGE_STATISTICS` shows *usage*, not *entitlement*). The
  platform/checker passes them from estate config.
- **Fail-closed**: with no `licensedOptions` and a non-enterprise edition, pack/EE metrics are
  out of scope (not-applicable, no penalty) and reported in `licenseExcluded`.

### Engine output
- New top-level `result.licenseExcluded`:
  `[{ name, metric_id, display_name, license_requirement, subcategory, pillar }]`.
- Each excluded metric also appears in `allMetrics[i]` with `applicable: false`,
  `exclusion_reason: 'license'`, and `license_requirement`. Metrics excluded by a value-driven
  `applies_when` instead carry `exclusion_reason: 'applies_when'`. No findings or
  recommendations are emitted for license exclusions.

### Checker responsibility
The collector reads `license_requirement` from the catalog to **skip running the metric's SQL
when the option isn't owned** — querying e.g. AWR/ASH (`dba_hist_*`) or Tuning-Pack views
without the license is a licensing exposure (Oracle records the feature use). It relays the
owned set as `licensedOptions`.

### Backward compatibility
Additive. Catalogs with no `license_requirement` behave exactly as before; `licenseExcluded`
is `[]` and no metric gains an `exclusion_reason`. The new option, output list, and per-metric
fields are optional.

## 10. Catalog release Oracle v1.5.0 + engine v1.10.0 (2026-06 — PG-parity + license model)

**Engine v1.10.0** adds one technology-agnostic derived formula, `oracle_memory_pct_of_ram`
= `(sga_target + pga_aggregate_target) / ram_bytes × 100`. Like the other derived metrics it
computes only when its inputs are present (`sga_target` + `pga_aggregate_target` collected, plus
`ram_kb`/`ram_bytes` in `systemFacts`); missing inputs → not-provided. No other engine change.

**Oracle catalog 1.4.0 → 1.5.0** (113 → **160** metrics, 9 → **13** rules):
- **License migration** — the 10 coarse `applies_when {edition=enterprise}` gates are replaced by
  precise `license_requirement` (AWR trio → `diagnostic_pack`; SQL Tuning/Plan → `tuning_pack`;
  Flashback DB, BCT, FGA, DBRM, RAC/DG → `enterprise_edition`). Consumers SHOULD pass
  `licensedOptions` so pack-gated metrics are scored only where owned (otherwise not-applicable,
  reported in `licenseExcluded`, no penalty). Wallet/TDE and PDB checks stay value-driven
  `applies_when` (collected state, not entitlement).
- **+47 metrics** across all five pillars: license-expressible coverage (Partitioning, RAC, ADG,
  Advanced Security/Compression), MAA backup/DG (redo-member redundancy, standby redo logs, RMAN
  catalog, ADG real-time apply, Fast-Start Failover), CIS hardening (listener, profile limits,
  network ACLs, SYS-operation audit, audit destination, UTL_FILE_DIR), capacity (SYSAUX growth,
  undo headroom, PDB resource-plan & count, datafile autoextend), performance (instance-memory-vs-RAM
  derived, SQL Plan Baselines, adaptive plans, single-block I/O latency, RAC GC latency/services),
  and future-proofing (management-pack-access, SecureFiles, hidden parameters, AutoUpgrade, DST).
- **+4 cross-metric rules** (→13): `OR-CR-TDE-2` (TDE in use + no keystore backup → critical, −2
  security_encrypt), `OR-CR-HP-1` (large SGA/PGA + no HugePages → −1 perf_cache), `OR-CR-PDB-1` (PDB
  density + no resource plan → −1 capacity_planning), `OR-CR-SYSAUX-1` (SYSAUX growth + no audit
  purge → −1 capacity_storage).
- **Calibration** — `weight: 0.5` on genuine always-pass captures only (`top_wait_events` +
  `sga_target`/`pga_aggregate_target`); `undo_retention` is now workload-profile-keyed.

**New collected inputs (checker)** — most additions need new collectors; until they ship they read
not-provided (excluded from the denominator, no penalty). `oracle_memory_pct_of_ram` requires
`sga_target` + `pga_aggregate_target` (bytes) and host RAM. Thresholds are calibrated from the CIS Oracle Benchmark + Oracle MAA/docs and remain
subject to TL refinement.

## 11. Catalog release Oracle v1.6.0 (2026-07 — manual-metric gaps, catalog-only, engine unchanged)

Follow-up to the collector's 2026-07-01 manual-metric review. **Engine unchanged (1.10.0).**
Oracle catalog **1.5.0 → 1.6.0** (160 → **161** metrics; subcategory budgets unchanged — fixed `maxPoints`):

- **Removed the duplicate memory metric** — `PERF-1.7 memory_config_pct_of_ram` (threshold) is retired;
  the v1.10.0 derived `PERF-1.11 oracle_memory_pct_of_ram` (range 40–80) is now the **single**
  memory-of-RAM scorer in `perf_cache`. Both previously scored the same quantity, so a mis-sized
  instance was penalised twice. A collector still emitting `memory_config_pct_of_ram` does no harm
  (the value is simply unused).
- **Re-tagged two attestations `["sql"] → ["manual"]`** — `autoupgrade_readiness` (FUT-3.7) and
  `config_backup_exists` (FUT-4.5) are operational checks that are **not SQL-queryable**; they
  previously read not-provided forever and never rendered in the manual UI. They now surface in the
  technology-aware manual-inputs form.
- **Added two manual attestations** for PostgreSQL parity — `offsite_backup` (BAK-5.4, important,
  `backup_retention`) and `dr_plan_documented` (BAK-4.10, advisory, `backup_recovery`).
  `dr_plan_documented` is a written-plan attestation, **distinct from** `dataguard_configured`
  (a shop can run standby-site / RMAN-restore DR without Data Guard).

**Checker impact — dependency bump only.** The manual-inputs form is catalog-derived, so the two
new manual fields appear automatically once the checker resolves Oracle catalog 1.6.0 — no checker
code change. Emitting `sga_target` + `pga_aggregate_target` (bytes) + host RAM lets the derived
memory metric resolve (else not-provided, no penalty). Re-baseline is **score-neutral** on the
sample set (healthy/olap/se2 = 100, oltp = 99.6 unchanged, critical = 61.74 unchanged).
Thresholds/weights remain subject to TL refinement.

## 8. Package v1.12.0 — coherence expansion + self-describing output (PG catalog 1.9.0 / Oracle 1.7.0)

Two parts: **catalog-only** coherence rules and declared targets (PG 1.8.0→1.9.0, Oracle 1.6.0→1.7.0), and an **additive** engine output (engine 1.10.0→1.11.0, shipped in package 1.12.0).

### A. New declared-target manual metrics (checker must surface them)

The manual-inputs form is catalog-derived, so these appear automatically once the checker resolves the new catalog versions — **no checker code change**, just the dependency bump. They are `important`, enum, and **all-pass** (declaring any value earns full points; only incoherence with evidence is penalised, via the rules in §8.B).

| `legacy_name` | Catalog(s) | Declarable values | Subcategory |
|---|---|---|---|
| `security_posture`       | PG (SEC-4.7), Oracle (SEC-4.9)   | `baseline` / `hardened` / `regulated` | Access Control |
| `growth_headroom_target` | PG (CAP-4.7), Oracle (CAP-4.9)   | `months_3` / `months_6` / `months_12` | Planning |
| `ha_topology`            | PG (PER-4.6)                     | `none` / `async_standby` / `sync_standby` / `cluster_managed` | Replication |
| `dr_topology`            | Oracle (PERF-4.7)                | `none` / `dg_async` / `dg_sync` / `rac_dg` | Replication |

### B. New coherence rules (link declarations to evidence)

The score moves only when a declaration is **contradicted by observed evidence**. All use existing mechanisms (`metric_zero`, plus `subcategory_cap` where the incoherence invalidates the subcategory). PG: `PG-CR-RTO-1/2` (RTO ↔ recovery evidence), `PG-CR-SECPOST-1/2`, `PG-CR-CAP-1`, `PG-CR-HA-1/2`, `PG-CR-FUT-1` — 16→24 rules. Oracle: `OR-CR-RTO-1/2`, `OR-CR-ATT-1/2` (attestation corroboration), `OR-CR-SECPOST-1/2`, `OR-CR-CAP-1`, `OR-CR-DR-1/2`, `OR-CR-FUT-1` — 13→23 rules. `OR-CR-SECPOST-1` gates on `systemFacts.edition === 'enterprise'` so Standard Edition is never penalised for TDE it cannot license.

**Score impact on the sample sets**: PG healthy/critical **unchanged** (100 / 59.11 — declarations are coherent in the samples). Oracle critical **61.74 → 59.17** (the critical sample's incoherent `growth_headroom_target` + `upgrade_plan` now fire `OR-CR-CAP-1` / `OR-CR-FUT-1`); Oracle healthy unchanged (100).

### C. New engine output — `context` and `coverage` (additive)

Every result now carries two additive top-level keys so a stored/shared score is reproducible and its completeness is visible:

- **`context`** — the conditions the score was produced under: `{ technology, catalogVersion, engineVersion, mode, workloadProfile, deploymentProfile, pgVersion, licensedOptions, availableSources, systemFactsProvided }`. `licensedOptions` is normalised and includes the auto-derived `enterprise_edition` when `systemFacts.edition === 'enterprise'`.
- **`coverage`** — how much of the *applicable* catalog was actually assessed: `{ assessedWeight, applicableWeight, percentage, counts: { scored, missingCritical, missingNonCritical, notApplicable, licenseExcluded }, perPillar: { <pillarId>: percentage } }`. Weights are per-metric effective weights; not-applicable and license-excluded metrics sit outside the denominator. A **missing critical both punishes the score and lowers coverage** (both are visible). A sparse assessment reads as sparse rather than silently out-scoring a fully-collected one.

**UI guidance**: show `coverage.percentage` next to the total (a 92/100 at 40 % coverage is a different claim than 92/100 at 100 %); echo `context` in report headers / audit views for reproducibility.

### D. Backward compatibility

Catalog side: same guarantee as prior releases — new metrics report as not-provided when absent (no penalty), new rules don't fire without their inputs. Engine side: `context` and `coverage` are additive keys; no field was removed or renamed. Pre-v1.12.0 consumers reading a closed key-set are unaffected.

## 12. Package v1.15.0, catalogs PG 1.12.0 / Oracle 1.9.0 (2026-09, Technology Leader reviews)

Engine output gains three additive keys and one scoring correction, listed under "Adoption review changes" below; nothing is removed or renamed. The package adds the `SCORING_POLICY` export (the shared scoring rules as one frozen object, also under `@dbi-services/scoring-core/policy`), the optional per-metric `technical_anchor` and `rationale` catalog fields, and the `restore_time_estimate_minutes` derived formula. `oracle_memory_pct_of_ram` now prefers `pga_aggregate_limit` when the collector provides it.

### New inputs

| Metric | legacy_name | Type / unit | Source | Notes |
|---|---|---|---|---|
| PG BAK-4.8 | `restore_throughput_mb_s` | number, MB per second | manual | Attested from the last restore test. Declared, never graded. Feeds BAK-4.9. |
| PG BAK-4.9 | `restore_time_estimate_minutes` | derived (engine) | none | `database_size` GB times 1024 divided by the attested throughput (or 200 MB/s) divided by 60. Scored against the declared `rto_target` rung; since 1.16.0 it counts everywhere and is required only without a declared standby or cluster (`optional_when`). Rules PG-CR-RTO-3 and PG-CR-RTO-4 zero `rto_target` and cap `backup_recovery` at 60 percent when the estimate exceeds the rung. |
| Oracle PERF-1.13 | `pga_aggregate_limit` | number, bytes | sql | Capture; preferred over `pga_aggregate_target` in PERF-1.11. |
| Oracle CAP-3.11 | `system_stats_at_defaults` | boolean | sql | Replaces CAP-3.8 `system_stats_gathered` with the inverse expectation (defaults in place). |

### Changed contracts (shape and unit)

These three were found live in 2026-08 and 2026-09. `scripts/check-payload.js <tech> <payload.json>` reports every one of them on a real payload.

| Metric | Catalog expects | Checker emits today | Action |
|---|---|---|---|
| Oracle BAK-1.5 `redo_log_size` | number, **megabytes**, `min: 512` (was 536870912 bytes) | megabytes (`MIN(BYTES)/1024/1024`) | Fixed catalog-side in Oracle 1.9.0. |
| PG CAP-3.1 `autovacuum_health` (critical) | enum, the `autovacuum` GUC: `on` or `off` | prose (`healthy`, `N tables need attention (...)`) | Checker must emit the GUC value. Until then every real assessment fails this critical and the Capacity pillar is capped. |
| PG PER-2.9 `temp_file_usage` | number, **bytes** (`pg_stat_database.temp_bytes`) | `"N files (size)"` string | Checker must emit bytes; the file count is currently scored against a bytes bound. |

Other changed semantics: Oracle PERF-1.4 `sga_auto_management` passes only for ASMM (`memory_target` 0 and `sga_target` above 0; AMM fails); Oracle CAP-1.2 `asm_diskgroup_usage` is critical and counts only when the collector provides a value (`applies_when provided`); Oracle SEC-3.8 `audit_trail_destination` applies only when `unified_auditing_enabled` is not `TRUE`; Oracle BAK-2.6 `rman_catalog` and SEC-1.7 `listener_hardening` are manual attestations; PG SEC-3.4 `pgaudit_installed` applies only when `security_posture` is `regulated`; PG CAP-1.1 `database_size` is a capture (`min: 0`, GB) and never fails; PG CAP-3.2 `table_bloat_avg_pct` is defined as size-weighted dead space (collector change pending).

### Retired legacy_names

Oracle: `archive_lag` (BAK-1.3), `archive_multiplexing` (BAK-1.4), `buffer_cache_hit_ratio` (PERF-1.1), `tablespace_fragmentation` (CAP-1.10), `system_stats_gathered` (CAP-3.8). PostgreSQL: none. Emitting a retired name is harmless (reported as an unknown key by the payload checker, ignored by the engine).

### Adoption review changes (review of 2026-09-04)

| Change | What a consumer sees | What a consumer should do |
|---|---|---|
| `disposition` (new result key) | `{ state: 'clear' \| 'critical_unresolved', items: [...], unassessed: [...] }`. Each item is one problem: `{ kind: 'metric', id, name, pillar, reason, rules? }` with `reason` `failed`, `missing`, `unresolved` (a size-relative bound whose system fact is missing) or `invalidated` (zeroed by a non-critical rule, rule ids in `rules`), or `{ kind: 'rule', id, name, pillar, reason: 'rule', invalidates: [metric ids] }` for a critical-severity rule. `unassessed` lists critical metrics whose collector did not run (`reason` `mode` or `source`): `clear` covers assessed metrics only. | Show it next to `status`, and show `unassessed` when it is not empty. `status` still follows the band, so a failed critical can sit inside an "excellent" total. |
| `coverage.collectionScope`, `coverage.outOfScope` (new) | `full` or `partial`; `outOfScope = { count, critical: [metric ids], metricIds, byReason: { mode, source } }` lists applicable metrics whose evidence source was not in `availableSources` (`source`) or that need the agent in standalone mode (`mode`). A metric whose `applies_when` reads a value that was never collected stays listed. | Pass the real `availableSources` and `mode`; show the scope next to any coverage figure; show the score as `totalScore` out of `totalMaxScore`. |
| `serverVersion` (new option), `context.serverVersion` | Filters each catalog's minimum-version field: PostgreSQL `min_pg_version` (server_version_num, 170000), MySQL `min_mysql_version` and MariaDB `min_mariadb_version` (dotted, `8.0.35`). MongoDB `min_mongo_version` and the Oracle and SQL Server `min_version` are registered but empty today, so they filter nothing yet. `pgVersion` stays its alias and now also filters MySQL and MariaDB when passed to those engines; an empty `serverVersion` never masks a valid `pgVersion`. A version that cannot be read or compared (`PostgreSQL 17.2`, `17.2` against 170000) filters nothing. | Pass the server version for every technology, in the catalog's own format; MySQL 8.0-only metrics now drop on a 5.7 server. |
| Exact partial credit | A threshold metric within the partial band earns exactly the policy's partial-credit share of its weight, never rounded, and `passed: false` (passed follows the bound itself). What a rerun of the same payload shows changes: totals can move by fractions of a point; a weight-1 metric in that band now emits a finding where it silently passed (the critical PostgreSQL sample goes from 36 to 37 findings), so recommendations can move; a critical in that band can now read "critical gate active (score already below ...)" instead of "capped at ...". | Nothing, unless a consumer re-derives pass or fail from rounded points or keys on finding titles. |
| `by_declaration.unless` (catalog) | PostgreSQL BAK-2.2 `last_backup_age_hours` ignores the declared RPO when `archive_mode` is `on` or `always`, and keeps its 24-hour bound. | Keep sending `archive_mode` whenever the backup age is sent. |
| Catalog `maturity` | Top-level catalog field and `MetricCatalog#maturity`. | Show it beside the catalog version. |

### Collector work handed to the checker

The reviews also produced about forty collector fixes (Oracle role-aware Data Guard queries, FRA reclaimable space, session banner checks for encryption and checksumming, ORACLE_MAINTAINED filters, the ORA-00937 open-cursors query, PDB violations, the registry filter; PostgreSQL vacuum trigger arithmetic instead of fixed 7 days / 100 / 1000, size-weighted bloat, temp bytes, work_mem and worker-process wording, the allow-listed-extensions finding removal, profile-neutral pgaudit remediation).

## 13. Package v1.16.0, catalogs PG 1.13.0 / Oracle 1.10.0 (2026-09, one ruler and a target per estate)

Every check counts for every estate, so 100 always means best practice everywhere. The declared targets never switch a check off: they decide which checks are **required**, and the points of the required checks form the estate's **target score**. A check the targets do not require still earns or loses its own points (doing more than the policy asks shows in the score), but it leaves the target and never triggers a criticality gate, a pillar cap or a disposition item. Status follows the share of the target reached. An estate that declares nothing is required to meet every check, so its target equals its maximum; it reads "excellent" only with every check met (see Changed contract).

### PostgreSQL: not required when (catalog field `optional_when`)

| Metric | Not required when |
|---|---|
| BAK-1.1 `archive_mode` (critical), BAK-1.2 `archive_command`, BAK-1.3 `archive_failures`, BAK-1.7 `archive_timeout`, BAK-1.5 `summarize_wal`, CHK-BAK-2 `backup_tool_detection` | `rpo_target=rpo_1440` |
| BAK-3.1 `external_backup_tool`, BAK-3.2 `pitr_enabled` | `rpo_target=rpo_1440` and `rto_target` is `rto_480` or `rto_1440` |
| BAK-3.3 `backup_encryption`, SEC-2.4 `encryption_at_rest` | `security_posture=baseline` |
| SEC-3.4 `pgaudit_installed` | `security_posture` is `baseline` or `hardened` |
| BAK-4.5 `streaming_status`, BAK-4.7 `ha_standby_count` | `ha_topology=none` |
| PER-4.4 `synchronous_standby_names` | `ha_topology` is `none` or `async_standby` |
| BAK-4.9 `restore_time_estimate_minutes` | a standby or cluster is declared (`async_standby`, `sync_standby`, `cluster_managed`) |

Oracle: BAK-4.4 `dataguard_configured` counts on every Enterprise Edition estate and is not required when `dr_topology=none`. An undeclared Enterprise Edition estate is now required to have Data Guard (before, it was judged only under a declared Data Guard topology), so its score can move.

`dump_schedule` no longer decides anything: WAL archiving is required below a 24-hour RPO whatever the dump cadence. BAK-1.3 `archive_failures` applies only with archiving on. The rule PG-CR-HA-2 (standby declared, none streaming) fires only on a collected `streaming_status`. SSL stays a floor on every environment: the PostgreSQL SSL checks carry the new catalog flag `floor: true`, and the validators refuse `optional_when` on any floor check. The other catalogs have no declaration-driven checks yet; their SSL/TLS checks get the flag with their own target-model release.

Consistency rules reviewed against the target model: the nine rules that read a check which can now be optional (archive command placeholder, PITR with a minimal WAL level, the two recovery point and three recovery time coherence rules, the regulated posture rule, the standby rule) fire only when the declaration requires the practice, or when a practice is present but broken, and are unchanged, except the standby rule, which now needs a collected `streaming_status`. A broken practice keeps firing even where the targets do not require it (for example archiving switched on with a placeholder command on a 24-hour-RPO DEV still deducts and enters the disposition), because a broken safety net misleads more than a missing one.

### Changed contract

- New result fields `targetScore`, `requiredScore` (points earned on required checks), `targetAttainment` (`requiredScore` divided by the target, percent), `onTarget` and `requiredMissed` at the top level, and `target`, `requiredScore`, `targetAttainment`, `onTarget` on every pillar and subcategory. `percentage` and `totalPercentage` keep their meaning (score divided by maximum).
- `status` follows the share of the target reached, and **"excellent" requires being on target: every assessed check the declared targets require fully met, and no rule deduction or cap taking required points** (the required points reach the target). A required non-critical check with no value leaves the target and the score as before (a missing critical always counts), so show `coverage` next to the status. Below that the bands apply with "good" as the ceiling, and `targetAttainment` never reads 100. Extra effort on checks the targets do not require raises the score but never makes up for a missed required check. An undeclared estate is required to meet every check, so "excellent" means every check met: undeclared estates that read "excellent" with a gap in 1.15.0 now read "good".
- `requiredMissed` lists each required check missed: `{ id, name, pillar, subcategory, reason }`, `reason` being `failed`, `partial`, `invalidated` (zeroed by a rule), `missing` (a critical with no value) or `rule` (a rule deduction or cap took points in a pillar where no required check is missed; `id` and `name` are the rule's, `subcategory` names the section it acted on, null for a pillar deduction; one entry per section the rule acted on in such a pillar, so a rule acting on two pillars is listed under each). A listed rule took points in that pillar; where several rules did, each is listed even if another caused the shortfall. `onTarget` is false exactly when the list is non-empty, and every pillar off target has at least one entry. A check whose size-relative bound could not be resolved (system fact missing) reads `failed` here and `unresolved` in the disposition. Flag "target not reached" with it whenever `onTarget` is false. A subcategory zeroed by its pillar gate reads 0 and is never on target.
- A critical check that is not required and not collected still counts as 0 points in the score and the maximum, so a declaration cannot hide a missing value; it leaves the target and the gates, which is how lowering a target can lift a cap (see "Comparing scores"). Critical checks that are not required are also left out of `disposition.unassessed`.
- Declared targets are read in the catalog spelling before scoring (`RPO_1440` is scored as `rpo_1440`); a value with other characters, such as a leading space, stays out of vocabulary and is echoed as sent.
- Each `allMetrics[i]` carries `required` (true or false) and, when false, `optional_because` (the declarations that made it so). A failed check that is not required has an `info` finding with `aboveTarget: true` and `metric`, and a `low` recommendation with `aboveTarget: true` after the required ones.
- `context.fingerprint`: `rules` identifies the ruler (engine version, scoring policy, whole catalog); `declarations` identifies the declared targets (in the catalog spelling). Collected values never enter either code. `rulesShort` and `declarationsShort` are the first 12 characters, for people. The rules code includes the package version, so every release, even a documentation-only one, changes every rules code. It is computed once per catalog object: a consumer that edits a `MetricCatalog` in place after scoring with it keeps the old code, so build a new one with `MetricCatalog.fromData` for every edit.
- `context.declarations` echoes each declared target in the catalog spelling (`Baseline` becomes `baseline`; an out-of-vocabulary value such as `"yes"` is echoed as sent), `null` when not declared.
- `rpo_target` and `rto_target` no longer accept `"yes"`: it scores as a failed critical declaration, and the payload checker lists the rungs. Send a bucket (`rpo_5` … `rpo_1440`, `rto_5` … `rto_1440`). Oracle still accepts `"yes"` until its own release.
- New catalog fields: `declared_target: true` marks a declaration (manual enum only); `optional_when` may read declared targets only; `applies_when` may no longer read a declared target. Both validators enforce it.
- `new ScoringEngine(technology, { catalog })` scores with a given catalog (an edited one or an imported bundle). Replacing `engine.catalog` after construction still works but is no longer the supported path.
- Rules bundle: `exportRulesBundle(technology, { catalog, declarations })` and `loadRulesBundle(json)` (package root, or `@dbi-services/scoring-core/bundle`), and `scripts/rules-bundle.js export | verify | score` (installed as the `scoring-rules-bundle` command). Format id `scoring-core-rules-bundle`, version 1. A bundle carries the catalog, the exporter's declared targets when given, and the rules, catalog and declarations codes. Loading refuses a file whose catalog or declarations do not match their codes, declarations without their code, and any declaration that is not a declared target of the catalog; export refuses declarations in which no declared target is recognised. The codes are checksums, not signatures: they catch a damaged file or a naive edit, not someone who recomputes them, so where the file came from still matters. A bundle from another engine version imports, with a note that the rules code differs because engine code can change scoring (`verify` then prints "rules code not verified"). By default `score` applies the bundle's declared targets (the exporter's bar) and keeps the payload's value where the bundle declares nothing; `--own-declarations` keeps all of the payload's. `score` forwards the payload's run options (mode, sources, licensed options, deployment profile, server version, extensions). The Impact Analyzer marks an edited catalog's version with `+edited`.

### Comparing scores

- Same rules code: the same ruler. Same declarations code: the same declared targets, so the same checks are required. The target score itself also reflects what was collected (a practice switched on brings its own not-required sub-checks into its section, a missing value leaves its section), so compare `targetScore` values only between results of the same estate. Two results with both codes equal are judged on the same rules and the same declared targets.
- A declarations code that changes on one estate is the "declaration changed" event. The engine does not see history, so only a platform comparing successive results can flag a target that was lowered after a practice broke; lowering a target moves the target, and the score moves in only three ways: the checks judged against the declared target and the coherence rules (below), and the criticality caps, which apply only to checks the targets require. Lowering a target lifts the caps on the checks it stops requiring, so an estate missing a practice it no longer needs can gain points: the healthy sample with `archive_mode` off, `archive_command` `(disabled)` and `rto_target` `rto_1440` scores 92 at `rpo_240` (target 97.54, Backup capped) and 97.86 at `rpo_1440` (target 92.18, not capped), locked by a test. Flag a lowered declaration together with the score change it caused.
- Five checks compare the estate with its own declared target and can move the score when the declaration changes: BAK-2.2 `last_backup_age_hours`, BAK-4.9 `restore_time_estimate_minutes`, BAK-1.7 `archive_timeout`, CAP-1.2 `growth_rate` and PER-4.1 `replication_lag_seconds`. The coherence rules also read declarations (a declared RPO that archiving cannot meet is invalidated).
- Score trends across the 1.16.0 boundary move without any change on the instance: undeclared estates now count pgAudit and the restore estimate; estates with declarations count again the checks the 1.16.0 branch had switched off. Compare within one rules code.

### What consumers should do

- Show the score out of 100 with the target beside it ("88.4, target 91.2"), the status, and a "target not reached" flag listing `requiredMissed` whenever `onTarget` is false. Print both short codes with any exported or shared score.
- Store `context.fingerprint` and `context.declarations` with every score.
- The simulator's maturity ladder shows, per rung, the score change and the target change. Under an honored declaration it never recommends a rung that lowers the target; when the declaration is missing, failed or invalidated, stepping to the honest rung is the fix, and the ladder says when that lowers the target.

## 14. Package v1.17.0, catalogs PG 1.14.0 / Oracle 1.11.0 (2026-10, absolute target)

The target is the estate's wishlist: it depends on the catalog, the declared targets and the applicability facts (server version, deployment profile, extensions, licences, and the collected values that say whether a practice is on: archiving, SSL, a standby, a pooler, Data Guard, TDE, multitenant), never on what a run managed to collect. An uncollected check stays on the ruler at 0 points, so the maximum minus the score is the full gap: points lost on assessed checks plus points not assessed.

### Changed contract

- **An uncollected check counts 0 points**, whatever its criticality (before, a missing non-critical check left its section and its neighbours absorbed its points). It stays in the target when required and appears in `requiredMissed` with reason `missing`. A section where nothing was collected keeps its points in the maximum and the target; only a section where nothing applies leaves the maximum. A missing required critical the run could collect still triggers its gates, as before. An empty string is a missing value, as before. A derived check whose inputs are missing (for example the memory checks without `systemFacts`) is an uncollected check too.
- **A non-critical declared target left blank costs nothing** (Adrien, 2026-10-08): `security_posture`, `growth_headroom_target`, `ha_topology` and `upgrade_plan` (Oracle: `security_posture`, `growth_headroom_target`, `dr_topology`) keep their full points, exactly as any declared value would (the declaration itself is never graded), so the declaration itself earns the same points blank or declared and a section never empties (declaring can still move the score through the coherence rules and the declaration-keyed thresholds, for example an honest `upgrade_plan: "no"` three majors behind); they carry `undeclared: true` and `value: 'not declared'` in `allMetrics` (not counted in `pointsNotAssessed`) and are not listed in `requiredMissed`. An undeclared estate already pays through a target at its maximum. A blank `rpo_target` or `rto_target` (critical) counts 0 and gates, as before.
- **Checks outside the run's collection scope** (agent-only checks in a standalone run, a source not in `availableSources`) are part of the ruler: they count 0 points, stay in the target, and appear in `allMetrics` with `scored: false, outOfScope: true, value: 'not in scope'` and in `requiredMissed` with `reason: 'missing', outOfScope: true` (show "run with the agent", not "collection failed"). They never trigger a criticality gate or cap and never enter `disposition.items`; `disposition.unassessed` keeps listing the critical ones. A value sent for such a check is not scored. Their applicability is judged like `coverage.outOfScope`: an `applies_when` that reads an uncollected value keeps them on the ruler. Consequence: a standalone PostgreSQL, MySQL, MariaDB, MongoDB or SQL Server run never reads "excellent", because the agent-only checks are required and not assessed.
- **New field `pointsNotAssessed`** at the top level, on every pillar and on every entry of `subcategories`: the points of the applicable checks with no value. Score plus `pointsNotAssessed` never exceeds the maximum. `100 - totalMaxScore` is **not** this figure: the maximum shrinks only when a whole section does not apply. `coverage` keeps its 1.15.0 meaning (scope outside its denominator).
- **Unknown server version**: a check with a minimum version applies when its value was collected (the collector omits settings an older server lacks) and does not apply when absent (`exclusion_reason: 'version_unknown'`, `value: 'version unknown'`), and an info finding per pillar ("Server version unknown: N version-gated checks not judged") names them. Confirmed by Adrien on 2026-10-08. This includes the critical `stale_replication_slots` (PostgreSQL 17 and later): with no version and no value it is not judged, where 1.16.0 counted it as a missing critical; it is listed in `disposition.unassessed` with reason `version_unknown`. A known version filters as before. Pass `serverVersion`.
- The synchronous standby count derived from `synchronous_standby_names` (PostgreSQL PER-4.3) is unknown when the list was not collected (an empty list still counts 0), so the synchronous-standby coherence rule no longer fires on an uncollected value, and PER-4.3 itself is then a missing check (0 points, not assessed) while PER-4.4 does not apply.
- Comparing scores: the sentence in section 13 that the target "also reflects what was collected" no longer holds. Same rules code and same declarations code now mean the same target, unless an applicability fact changed (a practice switched on brings its own checks into its section, a guarded check below is present or not, the server version is known or not). The contract example of section 13 is unchanged as an agent run: 92 at `rpo_240` (target 97.54) and 97.86 at `rpo_1440` (target 92.18).

### Catalog guards (checks the collector omits because they do not apply)

| Catalog | Metric | Applies only when |
|---|---|---|
| Oracle 1.11.0 | BAK-4.5 `standby_health` | Data Guard configured **and** its own value present (the collector reports it on a standby only) |
| Oracle 1.11.0 | PERF-4.1 `dataguard_apply_lag`, PERF-4.2 `dataguard_transport_lag`, PERF-4.3 `dataguard_archive_gap`, PERF-4.4 `dataguard_protection_mode`, PERF-4.6 `dataguard_apply_rate` (local apply processes, none on a primary) | Data Guard configured **and** `standby_health` present, that is on a standby; a failed statistics query on a standby still reads as missing. Together with BAK-4.5 this fixes a healthy Data Guard primary scoring 84 instead of 100 |
| Oracle 1.11.0 | SEC-3.8 `audit_trail_destination` | traditional auditing **and** its own value present |
| Oracle 1.11.0 | BAK-5.2 `fra_usage_pct` (critical), CAP-4.3 `archive_log_volume_daily`, CAP-4.2 `sequence_cache_size`, PERF-1.9 `sga_target`, PERF-1.10 `pga_aggregate_target`, PERF-2.11 `adaptive_plans`, PERF-2.13 `cursor_sharing_exact`, SEC-3.7 `audit_sys_operations`, FUT-2.5 `control_mgmt_pack_access`, FUT-2.6 `securefiles_adoption` | its own value present (no recovery area, NOARCHIVELOG, no busy sequence, the other memory management mode, a parameter absent on this version) |
| PostgreSQL 1.14.0 | SEC-2.3 `ssl_cert_days_remaining` | SSL on (like SEC-2.2) |
| PostgreSQL 1.14.0 | PER-4.4 `synchronous_standby_names` | its own value present and not empty (empty is correct for asynchronous-only replication; a declared synchronous standby without names is caught by PG-CR-HA-1) |
| PostgreSQL 1.14.0 | CAP-1.3 `tablespace_headroom`, PER-2.16 `query_store_mode`, PER-2.17 `wait_sampling_mode`, PER-2.18 `intelligent_tuning`, CAP-2.9 `pgbouncer_min_pool_size`, CAP-2.10 `pgbouncer_ignore_startup_params` | its own value present (no non-default tablespace, the Azure extension not loaded, the PgBouncer setting left at its default) |

A check guarded on its own value reads "does not apply" when the collector could not read it either: for these checks, including the critical BAK-5.2 and BAK-4.5, a failed query produces no gate, no disposition item and no not-assessed points, and the target moves with them. Until a collector tells "does not apply" from "could not collect" for these checks, that is the cost of the guard; Adrien accepted it for the two critical checks (BAK-5.2, BAK-4.5) for 1.17.0 on 2026-10-08; the next release guards them on facts the collector reports (recovery area configured, database role). PostgreSQL SEC-2.4 `encryption_at_rest` is deliberately not guarded: encryption at rest applies to every estate, so off Azure it is a manual attestation, and when it is not attested its points are not assessed.

### What consumers should do

- Show the score, the target and `pointsNotAssessed` together ("84.3, target 91.2, 5.6 not assessed"), and in the "target not reached" box say for each `outOfScope` entry that it needs the agent or another source.
- Pass `serverVersion` and `systemFacts`. Collect what the catalog names: every value the collector never sends now costs its points.
- Compare scores within one rules code: trends across 1.17.0 move without any change on the instance.

## Versions

| Component | Version |
|-----------|---------|
| `@dbi-services/scoring-core` (engine package) | 1.17.0 |
| PostgreSQL catalog                            | 1.14.0 |
| Oracle catalog                                | 1.11.0 |
| MySQL catalog                                 | 1.3.1 (maturity field only) |
| MariaDB catalog                               | 1.3.1 (maturity field only) |
| SQL Server, MongoDB catalogs                  | 1.2.1 (maturity field only) |

The v1.6.0 engine changes (derived metrics, score-moving consistency, predicate DSL extensions) are technology-agnostic — Oracle v1.3.0 is the first non-PostgreSQL catalog to adopt them (first rule set, workload profiles, size-relative thresholds), and required no engine change, as designed.
