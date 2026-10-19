'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { MetricCatalog } = require('../src/catalog');
const ScoringEngine = require('../src/scoring/engine');

function makeMetric(overrides) {
  return {
    metric_id: 'T-1',
    subcategory: 'test_sub',
    legacy_name: 'test_metric',
    display_name: 'Test Metric',
    description: 'Test',
    criticality: 'advisory',
    weight: null,
    evaluation_type: 'boolean',
    evaluation_config: { pass_value: true },
    sources: ['sql'],
    agent_only: false,
    deployment_profiles: null,
    min_pg_version: null,
    extension_requirement: null,
    metric_tier: 'baseline',
    remediation: 'Fix it',
    ...overrides,
  };
}

function zeroRule(target, overrides = {}) {
  return {
    rule_id: 'TEST-ZERO-1',
    title: 'Claim invalidated',
    applies_when: { metric: 'contradiction', is_truthy: true },
    on_violation: {
      severity: 'warning',
      score_adjustment: { type: 'metric_zero', target },
      title: 'Declared intent has no technical basis',
      description: 'test',
      remediation: 'test',
    },
    pillar_hint: 'test',
    ...overrides,
  };
}

function makeCatalog(metrics, rules) {
  return {
    version: '1.0.0',
    pillars: { test: { name: 'Test', maxPoints: 20, order: 1 } },
    subcategories: {
      test_sub: { pillar: 'test', name: 'Test Sub', maxPoints: 20, order: 1 },
    },
    metrics,
    consistency_rules: rules || [],
  };
}

function makeEngine(catalogData) {
  const engine = new ScoringEngine();
  engine.catalog = MetricCatalog.fromData('test', catalogData);
  return engine;
}

// Base fixture: contradiction (the rule trigger), claim (the target), bystander.
function baseMetrics(claimOverrides = {}) {
  return [
    makeMetric({ metric_id: 'X-1', legacy_name: 'contradiction', evaluation_config: { pass_value: false } }),
    makeMetric({ metric_id: 'C-1', legacy_name: 'claim', display_name: 'The Claim', ...claimOverrides }),
    makeMetric({ metric_id: 'B-1', legacy_name: 'bystander' }),
  ];
}

describe('metric_zero (v1.8.0)', () => {
  it('zeroes a passing metric and renormalizes the subcategory', () => {
    const engine = makeEngine(makeCatalog(baseMetrics(), [zeroRule('claim')]));
    // All three pass naturally (contradiction=true violates its own pass_value=false,
    // but it is advisory weight 1). Weights: 1+1+1. Natural: contradiction fails
    // its own check (0) + claim 1 + bystander 1 = 2/3. Zeroed: claim → 0 → 1/3.
    const result = engine.calculate({ contradiction: true, claim: true, bystander: true });

    const entry = result.allMetrics.find(m => m.name === 'claim');
    assert.equal(entry.score, 0);
    assert.equal(entry.maxScore, 1, 'weight stays in the denominator (punitive)');
    assert.deepEqual(entry.zeroed_by_rules, ['TEST-ZERO-1']);
    assert.equal(entry.natural_score, 1);
    assert.equal(entry.scored, true);

    // Subcategory: (0 + 0 + 1) / 3 × 20 = 6.67 (vs counterfactual 13.33)
    assert.equal(result.pillars.test.score, 6.67);

    const finding = result.allFindings.find(f => f.rule_id === 'TEST-ZERO-1');
    assert.ok(finding, 'rule finding emitted');
    assert.equal(finding.score_movement.type, 'metric_zero');
    assert.equal(finding.score_movement.target, 'claim');
    assert.equal(finding.score_movement.metric_prior_score, 1);
    assert.equal(finding.score_movement.applied, 1);
    assert.equal(finding.score_movement.prior_score, 13.33);
    assert.equal(finding.score_movement.new_score, 6.67);
  });

  it('does NOT fire the 60% gate for a zeroed-but-naturally-passing critical', () => {
    const engine = makeEngine(makeCatalog(
      baseMetrics({ criticality: 'critical' }),
      [zeroRule('claim')]
    ));
    const result = engine.calculate({ contradiction: false, claim: true, bystander: true });
    // Rule does not fire (contradiction falsy) → control run
    assert.equal(result.pillars.test.score, 20);

    const engine2 = makeEngine(makeCatalog(
      baseMetrics({ criticality: 'critical' }),
      [zeroRule('claim')]
    ));
    const result2 = engine2.calculate({ contradiction: true, claim: true, bystander: true });
    // contradiction fails its own check (advisory) AND triggers the zero rule.
    // Weights: 1 + 3 + 1 = 5; awarded: 0 + 0 + 1 = 1 → 4/20. No gate cap
    // (4 < 12 anyway) and crucially NO gate finding.
    assert.ok(!result2.allFindings.some(f => f.title.includes('critical gate')),
      'zeroed naturally-passing critical must not raise the gate');
    const entry = result2.allMetrics.find(m => m.name === 'claim');
    assert.equal(entry.natural_score, 3);
    assert.equal(entry.score, 0);
  });

  it('keeps the natural gate when a zeroed critical also fails naturally', () => {
    const engine = makeEngine(makeCatalog(
      baseMetrics({ criticality: 'critical' }),
      [zeroRule('claim')]
    ));
    const result = engine.calculate({ contradiction: true, claim: false, bystander: true });
    assert.ok(result.allFindings.some(f => f.title.includes('critical gate')),
      'natural failure still gates');
    const finding = result.allFindings.find(f => f.rule_id === 'TEST-ZERO-1');
    assert.equal(finding.score_movement.applied, 0, 'nothing to remove — it scored 0 naturally');
  });

  it('no-ops (finding kept, no annotation) when the target is missing', () => {
    const engine = makeEngine(makeCatalog(baseMetrics(), [zeroRule('claim')]));
    const result = engine.calculate({ contradiction: true, bystander: true });
    const finding = result.allFindings.find(f => f.rule_id === 'TEST-ZERO-1');
    assert.ok(finding, 'rule finding still emitted');
    assert.equal(finding.score_movement, undefined, 'no movement — nothing was zeroed');
  });

  it('no-ops when the target is not applicable (applies_when wins)', () => {
    const metrics = baseMetrics({ applies_when: { metric: 'bystander', equals: 'never' } });
    const engine = makeEngine(makeCatalog(metrics, [zeroRule('claim')]));
    const result = engine.calculate({ contradiction: true, claim: true, bystander: true });
    const entry = result.allMetrics.find(m => m.name === 'claim');
    assert.equal(entry.applicable, false);
    assert.equal(entry.zeroed_by_rules, undefined);
    const finding = result.allFindings.find(f => f.rule_id === 'TEST-ZERO-1');
    assert.equal(finding.score_movement, undefined);
  });

  it('is idempotent across multiple zero rules on the same metric', () => {
    const rules = [
      zeroRule('claim'),
      zeroRule('claim', { rule_id: 'TEST-ZERO-2' }),
    ];
    const engine = makeEngine(makeCatalog(baseMetrics(), rules));
    const result = engine.calculate({ contradiction: true, claim: true, bystander: true });
    const entry = result.allMetrics.find(m => m.name === 'claim');
    assert.deepEqual(entry.zeroed_by_rules, ['TEST-ZERO-1', 'TEST-ZERO-2']);
    assert.equal(result.pillars.test.score, 6.67, 'same score as a single zero rule');
    const f1 = result.allFindings.find(f => f.rule_id === 'TEST-ZERO-1');
    const f2 = result.allFindings.find(f => f.rule_id === 'TEST-ZERO-2');
    assert.ok(f1.score_movement && f2.score_movement, 'each finding annotated');
  });

  it('does not nuke a pillar via a zeroed gate_scope metric', () => {
    const engine = makeEngine(makeCatalog(
      baseMetrics({ criticality: 'critical', gate_scope: 'pillar' }),
      [zeroRule('claim')]
    ));
    const result = engine.calculate({ contradiction: true, claim: true, bystander: true });
    assert.ok(result.pillars.test.score > 0, 'pillar zero gate follows the natural score');
  });

  it('composes with subcategory_deduction (deduction lands on the post-zero score)', () => {
    const rules = [
      zeroRule('claim'),
      {
        rule_id: 'TEST-DED-1',
        title: 'Extra deduction',
        applies_when: { metric: 'contradiction', is_truthy: true },
        on_violation: {
          severity: 'warning',
          score_adjustment: { type: 'subcategory_deduction', target: 'test_sub', points: 2 },
        },
        pillar_hint: 'test',
      },
    ];
    const engine = makeEngine(makeCatalog(baseMetrics(), rules));
    const result = engine.calculate({ contradiction: true, claim: true, bystander: true });
    // Post-zero subcategory: 6.67 → deduction 2 → 4.67
    assert.equal(result.pillars.test.score, 4.67);
    const ded = result.allFindings.find(f => f.rule_id === 'TEST-DED-1');
    assert.equal(ded.score_movement.prior_score, 6.67);
    assert.equal(ded.score_movement.new_score, 4.67);
  });
});
