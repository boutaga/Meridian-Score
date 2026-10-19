'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { evaluateMetric } = require('../src/scoring/evaluator');
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

function makeCatalog(metrics, subcategories) {
  return {
    version: '1.0.0',
    pillars: { test: { name: 'Test', maxPoints: 20, order: 1 } },
    subcategories: subcategories || {
      test_sub: { pillar: 'test', name: 'Test Sub', maxPoints: 20, order: 1 },
    },
    metrics,
  };
}

function makeEngine(catalogData) {
  const engine = new ScoringEngine();
  engine.catalog = MetricCatalog.fromData('test', catalogData);
  return engine;
}

describe('v1.7.1 — not_empty boolean check', () => {
  const metric = {
    evaluation_type: 'boolean',
    evaluation_config: { pass_value: true, check: 'not_empty' },
  };

  it('passes any non-empty string (Oracle BAK-1.2 case)', () => {
    assert.equal(evaluateMetric(metric, '+ASM/DATA/loc', 3).passed, true);
    assert.equal(evaluateMetric(metric, '/u01/app/oracle/arch', 3).score, 3);
  });

  it('passes literal booleans coerced to strings', () => {
    assert.equal(evaluateMetric(metric, true, 3).passed, true);
  });

  it('fails empty and whitespace-only values', () => {
    assert.equal(evaluateMetric(metric, '', 3).score, 0);
    assert.equal(evaluateMetric(metric, '   ', 3).score, 0);
  });
});

describe('v1.7.1 — not_empty_or_dummy extended sentinels', () => {
  const metric = {
    evaluation_type: 'boolean',
    evaluation_config: { pass_value: true, check: 'not_empty_or_dummy' },
  };

  it('rejects the ported sentinel values case-insensitively', () => {
    for (const v of ['none', 'N/A', 'na', 'unavailable', 'Error', 'unknown', 'NULL', 'undefined', '/bin/true', '(disabled)']) {
      assert.equal(evaluateMetric(metric, v, 3).score, 0, `expected '${v}' to be treated as dummy`);
    }
  });

  it('still passes real values', () => {
    assert.equal(evaluateMetric(metric, 'cp %p /archive/%f', 3).score, 3);
    assert.equal(evaluateMetric(metric, 'barman-wal-archive', 3).passed, true);
  });
});

describe('v1.7.1 — unknown evaluation_type fails closed', () => {
  it('awards 0 even for truthy values', () => {
    const metric = { evaluation_type: 'mystery', evaluation_config: {} };
    const result = evaluateMetric(metric, 'anything', 3);
    assert.equal(result.score, 0);
    assert.equal(result.passed, false);
  });
});

describe('v1.7.1 — dynamic subcategory denominator', () => {
  const subcats = {
    provided_sub: { pillar: 'test', name: 'Provided', maxPoints: 10, order: 1 },
    silent_sub: { pillar: 'test', name: 'Silent', maxPoints: 10, order: 2 },
  };

  // Superseded in 1.17.0 (absolute target): a subcategory whose checks were
  // all left uncollected stays on the ruler at 0 points, reported as not
  // assessed; only a subcategory where nothing applies leaves the maximum.
  it('keeps a subcategory whose non-critical metrics are all unprovided, as not assessed (1.17.0)', () => {
    const engine = makeEngine(makeCatalog([
      makeMetric({ metric_id: 'P-1', legacy_name: 'provided_val', subcategory: 'provided_sub' }),
      makeMetric({ metric_id: 'S-1', legacy_name: 'silent_a', subcategory: 'silent_sub' }),
      makeMetric({ metric_id: 'S-2', legacy_name: 'silent_b', subcategory: 'silent_sub', criticality: 'important' }),
    ], subcats));

    const result = engine.calculate({ provided_val: true });
    assert.equal(result.totalMaxScore, 20, 'an uncollected subcategory stays on the ruler');
    assert.equal(result.totalScore, 10);
    assert.equal(result.pointsNotAssessed, 10);
    assert.equal(result.subcategories.silent_sub.pointsNotAssessed, 10);
    assert.equal(result.allFindings.filter(f => f.title.includes('critical gate')).length, 0, 'non-critical gaps never gate');
  });

  it('excludes a subcategory where nothing applies', () => {
    const engine = makeEngine(makeCatalog([
      makeMetric({ metric_id: 'P-1', legacy_name: 'provided_val', subcategory: 'provided_sub' }),
      makeMetric({ metric_id: 'S-1', legacy_name: 'silent_a', subcategory: 'silent_sub', applies_when: { metric: 'feature_on', is_truthy: true } }),
    ], subcats));

    const result = engine.calculate({ provided_val: true, feature_on: false });
    assert.equal(result.totalMaxScore, 10, 'a subcategory with no applicable check leaves the maximum');
    assert.equal(result.totalScore, 10);
    assert.equal(result.pointsNotAssessed, 0);
  });

  it('keeps the denominator when a missing metric is critical (still punishes)', () => {
    const engine = makeEngine(makeCatalog([
      makeMetric({ metric_id: 'P-1', legacy_name: 'provided_val', subcategory: 'provided_sub' }),
      makeMetric({ metric_id: 'S-1', legacy_name: 'silent_crit', subcategory: 'silent_sub', criticality: 'critical' }),
    ], subcats));

    const result = engine.calculate({ provided_val: true });
    assert.equal(result.totalMaxScore, 20, 'missing critical keeps the subcategory in the denominator');
    assert.equal(result.totalScore, 10);
    const gateFinding = result.allFindings.find(f => f.title.includes('critical gate'));
    assert.ok(gateFinding, 'missing critical still raises the gate finding');
  });
});

describe('v1.7.1 — recommendations sort criticals first', () => {
  it('orders critical findings before warnings', () => {
    const engine = makeEngine(makeCatalog([
      makeMetric({ metric_id: 'W-1', legacy_name: 'warn_metric', display_name: 'Warn Metric', criticality: 'important', remediation: 'Fix warning' }),
      makeMetric({ metric_id: 'C-1', legacy_name: 'crit_metric', display_name: 'Crit Metric', criticality: 'critical', remediation: 'Fix critical' }),
    ]));

    // Both fail; catalog order lists the important metric first. Pre-fix, the
    // falsy-zero severityOrder lookup sorted warnings ahead of criticals.
    const result = engine.calculate({ warn_metric: false, crit_metric: false });
    assert.equal(result.recommendations[0].title, 'Crit Metric');
    assert.equal(result.recommendations[0].priority, 'high');
    const critIdx = result.recommendations.findIndex(r => r.title === 'Crit Metric');
    const warnIdx = result.recommendations.findIndex(r => r.title === 'Warn Metric');
    assert.ok(warnIdx > critIdx, 'warning recommendation must come after the critical one');
  });
});

describe('v1.7.1 — finding.source stamping', () => {
  it('stamps metric-failure findings with the value source', () => {
    const engine = makeEngine(makeCatalog([
      makeMetric({ metric_id: 'C-1', legacy_name: 'crit_metric', criticality: 'critical' }),
    ]));
    const result = engine.calculate({ crit_metric: false }, { valueSources: { crit_metric: 'zabbix' } });
    const failure = result.allFindings.find(f => f.title === 'Test Metric');
    assert.equal(failure.source, 'zabbix');
    const gate = result.allFindings.find(f => f.title.includes('critical gate'));
    assert.equal(gate.source, 'engine');
  });

  it('falls back to the metric catalog source and stamps manual-missing findings', () => {
    const engine = makeEngine(makeCatalog([
      makeMetric({ metric_id: 'M-1', legacy_name: 'manual_metric', sources: ['manual'] }),
      makeMetric({ metric_id: 'S-1', legacy_name: 'sql_metric' }),
    ]));
    const result = engine.calculate({ sql_metric: false });
    const missing = result.allFindings.find(f => f.category === 'Manual Input');
    assert.equal(missing.source, 'manual');
    const failure = result.allFindings.find(f => f.title === 'Test Metric');
    assert.equal(failure.source, 'sql');
  });
});
