# Validating a catalog

## Why this exists

The scoring engine is stable and tested; the catalogs (one per technology under `data/metrics/`) are the part that needs the judgement of people who run these databases. Validating a catalog means confirming, metric by metric, that what is checked, how it is measured, how much it weighs and what a failure costs match production reality. The output of a validation round ships as a new catalog version.

## Tools

The simulator is the primary working surface:

```bash
npm run simulator:docker     # then open http://localhost:3000
```

- **How the score works** (`/model/<tech>`): the weights, the gates, the partial-credit rule, the status bands and the point budget of the catalog, rendered from the scoring policy the engine reads.
- **Metrics** (`/metrics/<tech>`): every metric; open one to read what is checked, the SQL that measures it (technical anchor), its share of the points, the gate it trips and the rules that reference it.
- **Simulator** (`/simulate/<tech>`): load a sample estate, override values, watch the score, the findings and the maturity ladder; paste a real collector payload, check its shape, score it.
- **Impact Analyzer** (`/impact/<tech>`): change a criticality, a flat threshold or a point budget, disable a metric, add one, compare, then export the modified catalog as JSON for a pull request.

Command-line companions:

```bash
npm run validate-catalogs                              # structural checks and vocabularies
node scripts/check-payload.js <tech> <payload.json>    # a real collection against the catalog
npm run benchmark -- <tech> <modified-catalog.json>    # before/after on the samples
npm test                                               # the full suite, including content locks
```

## Five activities

### A. Metric review (every metric)

For each metric check:

1. **Measurement**: does the `technical_anchor` query measure what the description says, on the versions in the field? If it is missing or wrong, supply the query; it becomes the anchor.
2. **Threshold realism**: does the pass criterion reflect current major versions and modern hardware? Where a threshold depends on the estate, prefer a declared target (`by_declaration`), a workload profile or a size-relative bound over a fixed number.
3. **Criticality**: critical means must-have (a failure caps the subcategory, a hard failure or a missing value caps the pillar); important means should-have; advisory is nice-to-have. Promoting to critical is a strong statement; a critical metric that is legitimately absent on some estates needs an `applies_when` guard on its own presence.
4. **Provenance**: the `rationale` names where the bound comes from (vendor documentation, a benchmark such as CIS or MAA, field practice). "Where does this number come from" must always have an answer.
5. **Remediation**: concrete enough to act on.
6. **Placement**: the right subcategory and pillar.

### B. Weight and budget review (per pillar)

Each pillar carries 20 points split across its subcategories. Check that the split reflects operational impact, and that no subcategory's weight pool is dominated by one metric. The guide [Reviewing weights](reviewing-weights.md) has the method.

### C. Coherence rules (per catalog)

Each declared target (RPO, RTO, security posture, growth headroom, HA or DR topology) must be linked to the evidence that backs it by a consistency rule. Read the rules on `/metrics/<tech>/rules`, then try the maturity ladder on a sample estate: declare a tighter target and check that the rule that should invalidate it does, with an explanation an operator can act on. The guide [Authoring cross-metric rules](cross-metric-rules.md) has the shapes.

### D. Scenario test (three estates)

Score three contrasted estates you know: a strong one, an average one, a weak one. The samples under `data/samples/` (`healthy`, `average`, `uneven`, `almost-there`, `critical`) are a starting point. Does the total feel right? Does the pillar breakdown point at the real weaknesses? Do the findings say what you would say? Note every disagreement with the metric id.

### E. Collector contract (with the checker team)

Run `scripts/check-payload.js` on a real collection. Anything reported as unparseable, unit suspect or enum mismatch is a contract disagreement between the collector and the catalog, and goes into `docs/consumer-contract.md` and the collector's backlog (three such disagreements were found in 2026-08 and 2026-09).

## Status bands

The status of a score follows the bands in the scoring policy (rendered in `docs/scoring-model.md` and on the "How the score works" page):

| Status | Total score |
|---|---|
| excellent | 90 percent or more |
| good | 70 to 89 percent |
| needs improvement | 50 to 69 percent |
| critical | below 50 percent |

## How to hand back a review

Either open a pull request with the exported catalog JSON and the benchmark output, or annotate the scoring-spec workbook of the technology (`docs/scoring-spec/<tech>.xlsx`, which carries the anchor SQL and the rationale per metric) and send it back. Every remark gets a recorded disposition in the release notes of the next catalog version.
