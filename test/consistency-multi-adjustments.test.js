'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { MetricCatalog } = require('../src/catalog');
const ScoringEngine = require('../src/scoring/engine');

function makeMetric(overrides) {
  return {
    metric_id: 'T-1',
    subcategory: 'sub_a',
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

function makeCatalog(rules) {
  return {
    version: '1.0.0',
    pillars: {
      capacity: { name: 'Capacity', maxPoints: 20, order: 1 },
      performance: { name: 'Performance', maxPoints: 20, order: 2 },
    },
    subcategories: {
      sub_a: { pillar: 'capacity', name: 'Connections', maxPoints: 20, order: 1 },
      sub_b: { pillar: 'performance', name: 'Locks', maxPoints: 20, order: 1 },
    },
    metrics: [
      // important (weight 2) so 50% partial credit is visible — on a weight-1
      // metric Math.round(0.5) rounds partial credit up to full points.
      makeMetric({ metric_id: 'A-1', legacy_name: 'connection_usage', subcategory: 'sub_a', criticality: 'important', evaluation_type: 'threshold', evaluation_config: { max: 80 } }),
      makeMetric({ metric_id: 'B-1', legacy_name: 'blocked_sessions', subcategory: 'sub_b', evaluation_type: 'threshold', evaluation_config: { max: 5 } }),
    ],
    consistency_rules: rules,
  };
}

function makeEngine(catalogData) {
  const engine = new ScoringEngine();
  engine.catalog = MetricCatalog.fromData('test', catalogData);
  return engine;
}

const SATURATION_RULE = {
  rule_id: 'TEST-MULTI-1',
  title: 'Connection saturation with lock contention',
  applies_when: {
    all_of: [
      { metric: 'connection_usage', gte: 95 },
      { metric: 'blocked_sessions', gte: 10 },
    ],
  },
  on_violation: {
    severity: 'critical',
    score_adjustments: [
      { type: 'subcategory_deduction', target: 'sub_a', points: 3 },
      { type: 'subcategory_deduction', target: 'sub_b', points: 2 },
    ],
    title: 'Saturated connections are blocking each other',
    description: 'test',
    remediation: 'test',
  },
};

describe('score_adjustments[] — multi-adjustment rules (v1.8.0)', () => {
  it('applies every adjustment of one fired rule across targets', () => {
    const engine = makeEngine(makeCatalog([SATURATION_RULE]));
    // Both metrics fail naturally (100 > 2×80 → 0; 12 > 2×5... 12 > 10 → 0).
    // Natural subcat scores: 0/20 each; deductions floor at 0 — use passing-ish
    // values instead so the deduction is visible:
    const result = engine.calculate({ connection_usage: 96, blocked_sessions: 11 });
    // 96 vs max 80: partial (within 2x) → 1/2 weight → 10/20 → minus 3 → 7
    // 11 vs max 5: beyond 2x → 0/20 → minus 2 → 0 (floored)
    assert.equal(result.pillars.capacity.score, 7);
    assert.equal(result.pillars.performance.score, 0);
  });

  it('annotates score_movements as an array in application order', () => {
    const engine = makeEngine(makeCatalog([SATURATION_RULE]));
    const result = engine.calculate({ connection_usage: 96, blocked_sessions: 11 });
    const finding = result.allFindings.find(f => f.rule_id === 'TEST-MULTI-1');
    assert.ok(finding, 'one finding per rule');
    assert.equal(finding.score_movement, undefined, 'plural form never writes the singular field');
    assert.equal(finding.score_movements.length, 2);
    assert.deepEqual(finding.score_movements.map(m => m.target), ['sub_a', 'sub_b']);
    assert.equal(finding.score_movements[0].type, 'subcategory_deduction');
  });

  it('attributes pillar/category from the first adjustment', () => {
    const engine = makeEngine(makeCatalog([SATURATION_RULE]));
    const result = engine.calculate({ connection_usage: 96, blocked_sessions: 11 });
    const finding = result.allFindings.find(f => f.rule_id === 'TEST-MULTI-1');
    assert.equal(finding.pillar, 'capacity');
    assert.equal(finding.category, 'Connections');
  });

  it('supports metric_zero + subcategory_cap composition in one rule', () => {
    const rule = {
      rule_id: 'TEST-COMBO-1',
      title: 'Zero and cap',
      applies_when: { metric: 'blocked_sessions', gte: 10 },
      on_violation: {
        severity: 'critical',
        score_adjustments: [
          { type: 'metric_zero', target: 'connection_usage' },
          { type: 'subcategory_cap', target: 'sub_a', cap_pct: 60 },
        ],
        title: 'combo',
      },
    };
    const engine = makeEngine(makeCatalog([rule]));
    const result = engine.calculate({ connection_usage: 50, blocked_sessions: 11 });
    // connection_usage passes naturally (50 ≤ 80) but is zeroed → sub_a 0/20;
    // cap 60% (12) doesn't bite below it. blocked_sessions fails on its own.
    assert.equal(result.pillars.capacity.score, 0);
    const finding = result.allFindings.find(f => f.rule_id === 'TEST-COMBO-1');
    assert.equal(finding.score_movements.length, 2);
    assert.equal(finding.score_movements[0].type, 'metric_zero');
    assert.equal(finding.score_movements[1].type, 'subcategory_cap');
  });

  it('keeps singular-form rules on the legacy score_movement field', () => {
    const rule = {
      rule_id: 'TEST-SINGULAR-1',
      title: 'Old style',
      applies_when: { metric: 'blocked_sessions', gte: 10 },
      on_violation: {
        severity: 'warning',
        score_adjustment: { type: 'subcategory_deduction', target: 'sub_b', points: 1 },
        title: 'old',
      },
    };
    const engine = makeEngine(makeCatalog([rule]));
    const result = engine.calculate({ connection_usage: 50, blocked_sessions: 4 });
    // Rule does not fire (4 < 10): no finding at all
    assert.ok(!result.allFindings.some(f => f.rule_id === 'TEST-SINGULAR-1'));

    const engine2 = makeEngine(makeCatalog([rule]));
    const result2 = engine2.calculate({ connection_usage: 50, blocked_sessions: 11 });
    const finding = result2.allFindings.find(f => f.rule_id === 'TEST-SINGULAR-1');
    assert.equal(finding.score_movements, undefined);
    assert.equal(finding.score_movement.type, 'subcategory_deduction');
  });
});
