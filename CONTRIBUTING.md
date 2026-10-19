# Contributing to db-health-scoring-core

This guide is for **technology leaders** who want to review, adjust, or extend the scoring system for their database technology.

## What You Can Change

The scoring system is defined in JSON catalog files at `data/metrics/`. Each technology has its own file:

```
data/metrics/
  postgresql.json
  oracle.json
  mysql.json
  mariadb.json
  mongodb.json
  sqlserver.json
```

Current metric counts and every metric's definition are in `docs/technologies/` (regenerated from the catalogs). The scoring rules you are asked to work within are in [docs/scoring-model.md](docs/scoring-model.md), and the input and output contract with collecting tools is in [docs/consumer-contract.md](docs/consumer-contract.md). Please read the [code of conduct](CODE_OF_CONDUCT.md); security problems go through [SECURITY.md](SECURITY.md).

### Common Changes

1. **Adjust a threshold**: Change when a metric passes or fails
2. **Change criticality**: Promote/demote a metric between `critical`, `important`, `advisory`
3. **Add a new metric**: Add a metric to an existing subcategory
4. **Modify remediation text**: Improve the guidance shown when a metric fails
5. **Adjust subcategory point allocation**: Rebalance points within a pillar
6. **Record how a metric is measured**: the `technical_anchor` (the literal SQL or command) and **why its threshold is what it is**: the `rationale`. See [Technical anchors and rationale](docs/guides/metric-technical-anchor.md).

## How to Make a Change

### 1. Find the Metric

Open `data/metrics/{your-technology}.json`. Metrics are in the `metrics` array. Each looks like:

```json
{
  "metric_id": "BAK-1.1",
  "subcategory": "backup_wal",
  "legacy_name": "archive_mode",
  "display_name": "Archive Mode Enabled",
  "description": "PostgreSQL archive_mode is set to on or always",
  "criticality": "critical",
  "weight": null,
  "evaluation_type": "enum",
  "evaluation_config": { "pass_values": ["on", "always"] },
  "sources": ["sql"],
  "agent_only": false,
  "deployment_profiles": null,
  "min_pg_version": null,
  "extension_requirement": null,
  "metric_tier": "baseline",
  "remediation": "Enable archive_mode in postgresql.conf: archive_mode = on",
  "cis_reference": null,
  "gate_scope": null,
  "technical_anchor": {
    "summary": "Reads the archive_mode setting from pg_settings.",
    "query": "SELECT setting FROM pg_settings WHERE name = 'archive_mode'"
  },
  "rationale": "Without WAL archiving there is no point-in-time recovery; PostgreSQL documentation, Continuous Archiving."
}
```

### 2. Edit the JSON

Make your change directly in the JSON file. Common edits:

**Change a threshold:**
```json
// Before: disk usage fails above 85%
"evaluation_config": { "max": 85 }

// After: more lenient at 90%
"evaluation_config": { "max": 90 }
```

**Change criticality:**
```json
// Before: advisory (1x weight)
"criticality": "advisory"

// After: important (2x weight)
"criticality": "important"
```

**Add enum values:**
```json
// Before
"evaluation_config": { "pass_values": ["on", "always"] }

// After: also accept "replica"
"evaluation_config": { "pass_values": ["on", "always", "replica"] }
```

### 3. Validate Your Change

Use the simulator to preview the scoring impact:

```bash
cd simulator
docker compose up --build
# Open http://localhost:3000
```

Or run the validation script:

```bash
npm run validate-catalogs
```

If your change touches what a collector must emit (a new metric, a changed unit or shape), check a real payload against the catalog and record the contract in `docs/consumer-contract.md`:

```bash
node scripts/check-payload.js postgresql my-payload.json
```

This checks that:
- Subcategory points still sum to 20 per pillar
- No duplicate metric IDs
- All references are valid

### 4. Update the Documentation

Regenerate the technology docs after editing the catalog:

```bash
npm run generate-docs
```

### 5. Submit a Pull Request

Create a PR with:
- The modified JSON catalog file
- The regenerated documentation
- A description of **why** the change is needed

## Rules to Follow

### Point Budget

Each pillar has exactly **20 points**. The subcategory maxPoints must sum to 20:

```json
"subcategories": {
  "backup_wal": { "maxPoints": 5 },
  "backup_dumps": { "maxPoints": 4 },
  "backup_tools": { "maxPoints": 4 },
  "backup_recovery": { "maxPoints": 4 },
  "backup_retention": { "maxPoints": 3 }
  // Total: 5+4+4+4+3 = 20
}
```

If you increase one subcategory, decrease another.

### Criticality Levels

| Level | Weight | Use For |
|-------|--------|---------|
| `critical` | 3x | Foundational requirements. Failure caps subcategory at 60%. |
| `important` | 2x | Best practices. Failure reduces score proportionally. |
| `advisory` | 1x | Nice-to-haves. Failure has minimal impact. |

Be thoughtful about promoting metrics to `critical`: a failure caps the subcategory, and a hard failure or a missing value caps the whole pillar (the exact shares are in the scoring policy block of `docs/scoring-model.md`). A critical metric that is legitimately absent on some estates needs an `applies_when` guard on its own `provided` state, never on a system fact.

### Evaluation Types

| Type | Config | Example |
|------|--------|---------|
| `boolean` | `{ "pass_value": true }` | Feature enabled/disabled |
| `enum` | `{ "pass_values": ["a", "b"] }` | Must be one of the listed values |
| `threshold` | `{ "max": 85 }` or `{ "min": 90 }` | Numeric bounds |
| `range` | `{ "min": 10, "max": 90 }` | Both bounds |

### v1.6.0 Catalog Features

Three newer capabilities are available when authoring catalogs (currently used by PostgreSQL):

- **Derived metrics**: mark a metric `"derived": true` with `"derived_from": { "formula": "...", "inputs": [...] }` and the engine computes its value from other collected values (no collector needed). Formulas are whitelisted in the engine: `memory_pressure_pct`, `wal_buffers_ratio`, `count_csv`. See [derived metrics](docs/scoring-model.md#derived-metrics-v160).
- **Score-moving consistency rules**: entries in the catalog's `consistency_rules` array can carry an `on_violation.score_adjustment` (`subcategory_deduction`, `subcategory_cap`, or `pillar_deduction`) instead of being findings-only; fired rules annotate their finding with `score_movement`. See the [authoring guide](docs/guides/cross-metric-rules.md).
- **Context-aware predicates and thresholds**: rules can branch on `system_fact` (RAM/CPU/storage) and `workload_profile` leaves; thresholds can be profile-keyed (`profiles.oltp/olap/...`) or size-relative (`min_pct`/`max_pct` of a systemFacts anchor). See [size-relative](docs/scoring-model.md#size-relative-thresholds-v150) and [workload-profile thresholds](docs/scoring-model.md#workload-profile-thresholds-v150).

### Adding a New Metric

1. Choose a subcategory and assign an ID following the pattern: `{PILLAR}-{SUBCAT}.{NUM}`
2. Pick a unique `legacy_name` (this is the key collectors use)
3. Set appropriate criticality and evaluation config
4. Specify which sources can provide the value
5. Write clear remediation guidance
6. Add the `technical_anchor` (how it is measured) and the `rationale` (where the threshold comes from)
7. Run `npm run validate-catalogs` to verify

## Reference Documentation

- [Scoring Model](docs/scoring-model.md): How the scoring algorithm works
- [Per-technology docs](docs/technologies/): Auto-generated metric reference for each technology
- [Adding a Metric](docs/guides/adding-a-metric.md): Detailed walkthrough
- [Technical anchors and rationale](docs/guides/metric-technical-anchor.md): How a metric is measured and why its threshold is what it is
- [Reading a catalog](docs/reading-a-catalog.md): One metric walked field by field
- [Authoring Cross-Metric Rules](docs/guides/cross-metric-rules.md): Consistency rules that fire findings and move scores
- [Reviewing Weights](docs/guides/reviewing-weights.md): How to evaluate weight balance
