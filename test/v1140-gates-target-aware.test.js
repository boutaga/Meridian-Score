'use strict';

/**
 * v1.14.0 — pillar criticality cap (O2h), declaration-keyed thresholds
 * (by_declaration), and the gate_scope / by_declaration validators.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const ScoringEngine = require('../src/scoring/engine');
const { MetricCatalog } = require('../src/catalog');
const {
  buildLookups,
  validateByDeclaration,
  validateGateScope,
  validateEvaluationConfig,
} = require('../src/catalog/validation');
const { resolveThresholdConfig } = require('../src/scoring/evaluator');

// A pillar with two subcategories so a pillar-level cap is distinguishable from
// the subcategory 60% cap: subcat A (5 pts) holds the critical, subcat B (15
// pts) is all-passing, so an uncapped pillar sits well above 12.
function twoSubcatCatalog() {
  return {
    version: '1.0.0',
    pillars: { test: { name: 'Test', maxPoints: 20, order: 1 } },
    subcategories: {
      sub_a: { pillar: 'test', name: 'Sub A', maxPoints: 5, order: 1 },
      sub_b: { pillar: 'test', name: 'Sub B', maxPoints: 15, order: 2 },
    },
    metrics: [
      {
        metric_id: 'A-1', subcategory: 'sub_a', legacy_name: 'crit_metric',
        display_name: 'Critical Metric', description: 'must pass', criticality: 'critical',
        weight: null, evaluation_type: 'boolean', evaluation_config: { pass_value: true },
        sources: ['sql'], agent_only: false, metric_tier: 'baseline', remediation: 'fix',
      },
      {
        metric_id: 'A-2', subcategory: 'sub_a', legacy_name: 'adv_metric',
        display_name: 'Advisory Metric', description: 'nice', criticality: 'advisory',
        weight: null, evaluation_type: 'boolean', evaluation_config: { pass_value: true },
        sources: ['sql'], agent_only: false, metric_tier: 'baseline', remediation: 'fix',
      },
      {
        metric_id: 'B-1', subcategory: 'sub_b', legacy_name: 'imp_metric',
        display_name: 'Important Metric', description: 'should pass', criticality: 'important',
        weight: null, evaluation_type: 'boolean', evaluation_config: { pass_value: true },
        sources: ['sql'], agent_only: false, metric_tier: 'baseline', remediation: 'fix',
      },
    ],
  };
}

function partialCritCatalog() {
  const cat = twoSubcatCatalog();
  cat.metrics[0].evaluation_type = 'threshold';
  cat.metrics[0].evaluation_config = { max: 5 };
  delete cat.metrics[0].evaluation_config.pass_value;
  return cat;
}

function engineFor(data) {
  const engine = new ScoringEngine();
  engine.catalog = MetricCatalog.fromData('test', data);
  return engine;
}

describe('v1.14.0 pillar criticality cap (O2h)', () => {
  it('caps the whole pillar at 12/20 when a critical hard-fails in one subcategory', () => {
    const engine = engineFor(twoSubcatCatalog());
    // crit fails, everything else passes: sub_a ~1.25, sub_b 15 -> 16.25 uncapped.
    const result = engine.calculate({ crit_metric: false, adv_metric: true, imp_metric: true });
    assert.equal(result.pillars.test.score, 12, 'pillar must be capped at 60% of 20');
    const cap = result.allFindings.find(f => f.title.includes('pillar capped at 60% — critical gate'));
    assert.ok(cap, 'a pillar critical-gate finding must be emitted');
    assert.ok(cap.description.includes('Critical Metric (failed)'));
  });

  it('caps the pillar when a critical is MISSING (A6 fix)', () => {
    const engine = engineFor(twoSubcatCatalog());
    const result = engine.calculate({ adv_metric: true, imp_metric: true }); // crit_metric missing
    assert.equal(result.pillars.test.score, 12);
    const cap = result.allFindings.find(f => f.title.includes('pillar capped at 60% — critical gate'));
    assert.ok(cap && cap.description.includes('Critical Metric (missing)'));
  });

  it('does NOT cap the pillar on partial credit (hard-fail only)', () => {
    const engine = engineFor(partialCritCatalog());
    // value=8, max=5: within 2x -> partial credit, natural score > 0, not a hard fail.
    const result = engine.calculate({ crit_metric: 8, adv_metric: true, imp_metric: true });
    assert.ok(result.pillars.test.score > 12,
      `partial credit must not trip the pillar cap (got ${result.pillars.test.score})`);
    assert.ok(!result.allFindings.some(f => f.title.includes('pillar capped at 60% — critical gate')),
      'no pillar-cap finding on partial credit');
  });

  it('does not cap when all criticals pass', () => {
    const engine = engineFor(twoSubcatCatalog());
    const result = engine.calculate({ crit_metric: true, adv_metric: true, imp_metric: true });
    assert.equal(result.pillars.test.score, 20);
    assert.ok(!result.allFindings.some(f => f.title.includes('pillar capped at 60% — critical gate')));
  });
});

describe('v1.14.0 declaration-keyed thresholds (by_declaration)', () => {
  const cfg = {
    max: 24,
    unit: 'hours',
    by_declaration: {
      metric: 'rpo_target',
      bands: {
        rpo_60: { max: 1 },
        rpo_1440: { max: 24 },
        default: { max: 24 },
      },
    },
  };

  it('undeclared falls back to the base bound (unchanged behaviour)', () => {
    const r = resolveThresholdConfig(cfg, { values: {} });
    assert.equal(r.max, 24);
  });

  it('a declared value selects its band', () => {
    const r = resolveThresholdConfig(cfg, { values: { rpo_target: 'rpo_60' } });
    assert.equal(r.max, 1);
    assert.ok(r._derivation.includes('rpo_target'));
  });

  it('a declared-but-unmatched value uses the default band', () => {
    const r = resolveThresholdConfig(cfg, { values: { rpo_target: 'yes' } });
    assert.equal(r.max, 24);
  });

  it('drives the real engine: declaring a tight RPO fails a backup that the default would pass', () => {
    const data = twoSubcatCatalog();
    data.metrics[2].evaluation_type = 'threshold';
    data.metrics[2].legacy_name = 'backup_age';
    data.metrics[2].evaluation_config = {
      max: 24, unit: 'hours',
      by_declaration: { metric: 'rpo_target', bands: { rpo_60: { max: 1 }, default: { max: 24 } } },
    };
    const engine = engineFor(data);
    const base = { crit_metric: true, adv_metric: true, backup_age: 8 };
    // Undeclared: 8h <= 24 default -> important passes -> sub_b full.
    const undeclared = engine.calculate(base);
    // Declared rpo_60: ceiling drops to 1h -> 8h fails.
    const declared = engine.calculate({ ...base, rpo_target: 'rpo_60' });
    assert.ok(declared.pillars.test.score < undeclared.pillars.test.score,
      'a tighter declared RPO must lower the score for the same measured backup age');
  });
});

describe('v1.14.0 validators', () => {
  function errsFor(metric) {
    const data = { pillars: { p: {} }, subcategories: { s: {} }, metrics: [metric, { legacy_name: 'rpo_target' }] };
    const errors = [];
    validateEvaluationConfig(metric, errors);
    validateByDeclaration(metric, buildLookups(data), errors);
    validateGateScope(metric, errors);
    return errors;
  }

  it('accepts a valid by_declaration block with a fallback', () => {
    const errors = errsFor({
      metric_id: 'M-1', legacy_name: 'x', evaluation_type: 'threshold',
      evaluation_config: { max: 24, by_declaration: { metric: 'rpo_target', bands: { rpo_60: { max: 1 }, default: { max: 24 } } } },
    });
    assert.equal(errors.length, 0, errors.join('; '));
  });

  it('rejects by_declaration referencing an unknown metric', () => {
    const errors = errsFor({
      metric_id: 'M-2', legacy_name: 'x', evaluation_type: 'threshold',
      evaluation_config: { max: 24, by_declaration: { metric: 'ghost', bands: { default: { max: 24 } } } },
    });
    assert.ok(errors.some(e => e.includes('by_declaration.metric')));
  });

  it('rejects by_declaration without an undeclared fallback', () => {
    const errors = errsFor({
      metric_id: 'M-3', legacy_name: 'x', evaluation_type: 'threshold',
      evaluation_config: { by_declaration: { metric: 'rpo_target', bands: { rpo_60: { max: 1 } } } },
    });
    assert.ok(errors.some(e => e.includes('undeclared fallback')));
  });

  it('rejects an unrecognized gate_scope', () => {
    const errors = errsFor({
      metric_id: 'M-4', legacy_name: 'x', evaluation_type: 'boolean',
      evaluation_config: { pass_value: true }, gate_scope: 'subcategory',
    });
    assert.ok(errors.some(e => e.includes('gate_scope')));
    assert.equal(errsFor({
      metric_id: 'M-5', legacy_name: 'x', evaluation_type: 'boolean',
      evaluation_config: { pass_value: true }, gate_scope: 'pillar',
    }).length, 0);
  });
});
