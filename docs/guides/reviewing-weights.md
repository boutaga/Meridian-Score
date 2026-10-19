# Reviewing Weights and Balance

This guide helps technology leaders evaluate whether the scoring weights are well-balanced for their technology.

## What Determines a Metric's Influence

A metric's influence on the final score depends on three factors:

1. **Criticality** — critical (3x), important (2x), advisory (1x)
2. **Subcategory maxPoints** — how many points the subcategory is worth
3. **Number of siblings** — how many other metrics share the subcategory

### Formula

Within a subcategory:

```
metric_influence = (metric_weight / total_subcategory_weight) * subcategory_maxPoints
```

**Example**: A subcategory with 5 maxPoints and 4 metrics:
- 1 critical (weight 3): influence = 3/8 * 5 = **1.875 pts**
- 2 important (weight 2 each): influence = 2/8 * 5 = **1.25 pts** each
- 1 advisory (weight 1): influence = 1/8 * 5 = **0.625 pts**

## Questions to Ask

### 1. Are critical metrics truly critical?

A `critical` metric triggers the 60% cap if it fails. Ask:
- Would a failure here indicate a fundamental problem?
- Should the entire subcategory be penalized if this one metric fails?
- Example: `archive_mode = off` is genuinely critical for backup. `log_rotation_age` might be important but not gate-worthy.

### 2. Is the point distribution balanced across pillars?

Each pillar gets 20 points. Check if the distribution matches your organization's priorities:
- Security-focused org might want more weight on Security
- Currently all pillars are equal — this is intentional for a universal baseline
- Custom weighting can be applied by consumers on top of raw scores

### 3. Are subcategory budgets proportional to importance?

Within a pillar, subcategories have different point allocations. Ask:
- Does a subcategory with 3 points deserve less influence than one with 7 points?
- Are the relative sizes justified by the importance of each area?

### 4. Is there metric bloat?

Adding many advisory metrics to a subcategory dilutes the influence of critical ones (through weighted normalization). Ask:
- Do all metrics in this subcategory add meaningful signal?
- Would removing a low-value advisory metric improve scoring accuracy?

### 5. Are thresholds appropriate?

Threshold metrics (e.g., `max: 85` for disk usage) need to match your environment:
- Are the thresholds too strict or too lenient for production?
- Does the 50% partial credit range make sense?

## Using the Simulator

The **Weight Impact Analyzer** (simulator page) lets you:

1. Select a technology
2. Modify a metric's criticality or a subcategory's maxPoints
3. See side-by-side score comparison
4. Identify which metrics gain or lose influence

This is the best tool for evaluating proposed weight changes before making a PR.

## Rebalancing Subcategory Points

If you need to change subcategory point allocations:

1. Open `data/metrics/{technology}.json`
2. Find the `subcategories` section
3. Adjust `maxPoints` values — they **must sum to 20** per pillar
4. Run `npm run validate-catalogs` to verify
5. Use the simulator to check the impact

Example — giving more weight to recovery readiness:

```json
// Before
"backup_recovery": { "maxPoints": 4 }
"backup_retention": { "maxPoints": 3 }

// After — moved 1 point from retention to recovery
"backup_recovery": { "maxPoints": 5 }
"backup_retention": { "maxPoints": 2 }
```

## Review Checklist

When reviewing a scoring PR, verify:

- [ ] Subcategory points sum to 20 per pillar
- [ ] `npm run validate-catalogs` passes
- [ ] Criticality level is justified (especially `critical` promotions)
- [ ] Threshold values match real-world expectations
- [ ] Remediation text is actionable
- [ ] No duplicate metric IDs or legacy names
- [ ] Documentation regenerated (`npm run generate-docs`)
