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

function makeCatalog(metrics, extra = {}) {
  return {
    version: '1.0.0',
    pillars: { test: { name: 'Test', maxPoints: 20, order: 1 } },
    subcategories: {
      test_sub: { pillar: 'test', name: 'Test Sub', maxPoints: 20, order: 1 },
    },
    metrics,
    ...extra,
  };
}

function makeEngine(catalogData) {
  const engine = new ScoringEngine();
  engine.catalog = MetricCatalog.fromData('test', catalogData);
  return engine;
}

// The gating signal's own check passes on `false` (pass_value: false) so the
// tests can flip applicability without also failing the signal metric itself.
function gatingSignal() {
  return makeMetric({ metric_id: 'G-1', legacy_name: 'gating_signal', evaluation_config: { pass_value: false } });
}

describe('applies_when (v1.8.0)', () => {
  it('excludes a critical metric when the predicate is false — no gate, no points at stake', () => {
    const engine = makeEngine(makeCatalog([
      gatingSignal(),
      makeMetric({
        metric_id: 'C-1', legacy_name: 'conditional_crit', display_name: 'Conditional Critical',
        criticality: 'critical',
        applies_when: { metric: 'gating_signal', is_truthy: true },
      }),
    ]));

    const result = engine.calculate({ gating_signal: false });
    assert.equal(result.totalScore, 20, 'remaining metric scores full, no gate cap');
    assert.equal(result.totalMaxScore, 20);
    const entry = result.allMetrics.find(m => m.name === 'conditional_crit');
    assert.equal(entry.applicable, false);
    assert.equal(entry.scored, false);
    assert.equal(entry.maxScore, 0);
    assert.equal(entry.value, 'not applicable');
    assert.ok(!result.allFindings.some(f => f.title.includes('critical gate')), 'no gate finding');
  });

  it('includes the metric (and its gate) when the predicate is true', () => {
    const engine = makeEngine(makeCatalog([
      gatingSignal(),
      makeMetric({
        metric_id: 'C-1', legacy_name: 'conditional_crit',
        criticality: 'critical',
        applies_when: { metric: 'gating_signal', is_truthy: true },
      }),
    ]));

    const result = engine.calculate({ gating_signal: true, conditional_crit: false });
    assert.ok(result.allFindings.some(f => f.title.includes('critical gate')), 'gate fires when applicable + failing');
    assert.ok(result.totalScore < 20);
  });

  it('treats a missing gating signal as not applicable (fail-safe idiom)', () => {
    const engine = makeEngine(makeCatalog([
      gatingSignal(),
      makeMetric({
        metric_id: 'C-1', legacy_name: 'conditional_crit',
        criticality: 'critical',
        applies_when: { metric: 'gating_signal', is_truthy: true },
      }),
    ]));

    const result = engine.calculate({});
    const entry = result.allMetrics.find(m => m.name === 'conditional_crit');
    assert.equal(entry.applicable, false, 'missing signal → metric not applicable');
  });

  it('supports the none_of idiom: missing signal → metric still applies', () => {
    const engine = makeEngine(makeCatalog([
      gatingSignal(),
      makeMetric({
        metric_id: 'C-1', legacy_name: 'conditional_crit',
        criticality: 'critical',
        applies_when: { none_of: [{ metric: 'gating_signal', equals: 'off' }] },
      }),
    ]));

    const result = engine.calculate({});
    const entry = result.allMetrics.find(m => m.name === 'conditional_crit');
    assert.notEqual(entry.applicable, false, 'missing signal under none_of → still applicable');
    assert.equal(entry.value, 'not provided');
  });

  it('computes derived metrics even when their own applies_when is false', () => {
    const engine = makeEngine(makeCatalog([
      makeMetric({ metric_id: 'L-1', legacy_name: 'some_list' }),
      makeMetric({
        metric_id: 'D-1', legacy_name: 'list_count', evaluation_type: 'threshold',
        evaluation_config: { min: 1 },
        derived: true,
        derived_from: { formula: 'count_csv', inputs: ['some_list'] },
        applies_when: { metric: 'some_list', equals: 'never-matches' },
      }),
    ]));

    const result = engine.calculate({ some_list: 'a,b,c' });
    const entry = result.allMetrics.find(m => m.name === 'list_count');
    assert.equal(entry.applicable, false);
    assert.equal(entry.value, 3, 'derived value is computed and visible despite non-applicability');
  });

  it('lets applies_when reference a derived value', () => {
    const engine = makeEngine(makeCatalog([
      makeMetric({ metric_id: 'L-1', legacy_name: 'standby_list' }),
      makeMetric({
        metric_id: 'D-1', legacy_name: 'standby_count', evaluation_type: 'threshold',
        evaluation_config: { min: 0 },
        derived: true,
        derived_from: { formula: 'count_csv', inputs: ['standby_list'] },
      }),
      makeMetric({
        metric_id: 'C-1', legacy_name: 'replication_check', criticality: 'critical',
        applies_when: { metric: 'standby_count', gte: 1 },
      }),
    ]));

    const withStandbys = engine.calculate({ standby_list: 's1,s2' });
    assert.notEqual(withStandbys.allMetrics.find(m => m.name === 'replication_check').applicable, false);

    const engine2 = makeEngine(makeCatalog([
      makeMetric({ metric_id: 'L-1', legacy_name: 'standby_list' }),
      makeMetric({
        metric_id: 'D-1', legacy_name: 'standby_count', evaluation_type: 'threshold',
        evaluation_config: { min: 0 },
        derived: true,
        derived_from: { formula: 'count_csv', inputs: ['standby_list'] },
      }),
      makeMetric({
        metric_id: 'C-1', legacy_name: 'replication_check', criticality: 'critical',
        applies_when: { metric: 'standby_count', gte: 1 },
      }),
    ]));
    const noStandbys = engine2.calculate({ standby_list: '' });
    assert.equal(noStandbys.allMetrics.find(m => m.name === 'replication_check').applicable, false,
      'count_csv("") = 0 → predicate false → not applicable');
  });

  it('drops an all-inapplicable subcategory from the pillar denominator', () => {
    const engine = makeEngine({
      version: '1.0.0',
      pillars: { test: { name: 'Test', maxPoints: 20, order: 1 } },
      subcategories: {
        live_sub: { pillar: 'test', name: 'Live', maxPoints: 10, order: 1 },
        gated_sub: { pillar: 'test', name: 'Gated', maxPoints: 10, order: 2 },
      },
      metrics: [
        makeMetric({ metric_id: 'L-1', legacy_name: 'live_metric', subcategory: 'live_sub' }),
        makeMetric({
          metric_id: 'G-1', legacy_name: 'gated_a', subcategory: 'gated_sub', criticality: 'critical',
          applies_when: { metric: 'live_metric', equals: 'never' },
        }),
        makeMetric({
          metric_id: 'G-2', legacy_name: 'gated_b', subcategory: 'gated_sub',
          applies_when: { metric: 'live_metric', equals: 'never' },
        }),
      ],
    });

    const result = engine.calculate({ live_metric: true, gated_a: false, gated_b: false });
    assert.equal(result.totalMaxScore, 10, 'gated subcategory excluded entirely');
    assert.equal(result.totalScore, 10);
    assert.equal(result.totalPercentage, 100);
  });

  it('does not zero a pillar when its gate_scope metric is not applicable', () => {
    const engine = makeEngine(makeCatalog([
      makeMetric({ metric_id: 'P-1', legacy_name: 'normal_metric' }),
      makeMetric({
        metric_id: 'V-1', legacy_name: 'version_gate', criticality: 'critical', gate_scope: 'pillar',
        applies_when: { metric: 'normal_metric', equals: 'never' },
      }),
    ]));

    const result = engine.calculate({ normal_metric: true, version_gate: false });
    assert.equal(result.pillars.test.score, 20, 'pillar survives — gate metric was not applicable');
  });

  it('emits no manual-missing finding for a not-applicable manual metric', () => {
    const engine = makeEngine(makeCatalog([
      gatingSignal(),
      makeMetric({
        metric_id: 'M-1', legacy_name: 'manual_metric', sources: ['manual'],
        applies_when: { metric: 'gating_signal', is_truthy: true },
      }),
    ]));

    const result = engine.calculate({ gating_signal: false });
    assert.ok(!result.allFindings.some(f => f.category === 'Manual Input'),
      'not-applicable precedes the missing branch — no "not provided" noise');
  });

  it('passes the collected value through on a not-applicable entry', () => {
    const engine = makeEngine(makeCatalog([
      gatingSignal(),
      makeMetric({
        metric_id: 'C-1', legacy_name: 'conditional', criticality: 'important',
        applies_when: { metric: 'gating_signal', is_truthy: true },
      }),
    ]));

    const result = engine.calculate({ gating_signal: false, conditional: 'collected-anyway' });
    const entry = result.allMetrics.find(m => m.name === 'conditional');
    assert.equal(entry.value, 'collected-anyway');
    assert.equal(entry.applicable, false);
  });
});
