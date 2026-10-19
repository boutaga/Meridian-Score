'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const validation = require('../src/catalog/validation');
const ScoringEngine = require('../src/scoring/engine');
const { validateCatalog } = require('../simulator/lib/catalog-builder');

const {
  buildLookups,
  validatePredicate,
  validateRule,
  validateRuleAdjustments,
  validateDerivedFrom,
  validateMetricAppliesWhen,
  validateEvaluationConfig,
  validateThresholdShape,
  SUPPORTED_DERIVED_FORMULAS,
} = validation;

const CAT_DATA = {
  pillars: { backup: { name: 'Backup', maxPoints: 20 } },
  subcategories: { backup_sub: { pillar: 'backup', name: 'Sub', maxPoints: 20 } },
  metrics: [
    { metric_id: 'B-1', legacy_name: 'rpo_target', subcategory: 'backup_sub', criticality: 'critical', evaluation_type: 'enum', evaluation_config: { pass_values: ['rpo_5'] }, sources: ['manual'] },
    { metric_id: 'B-2', legacy_name: 'archive_mode', subcategory: 'backup_sub', criticality: 'critical', evaluation_type: 'enum', evaluation_config: { pass_values: ['on'] }, sources: ['sql'] },
  ],
};

function lookups() {
  return buildLookups(CAT_DATA);
}

function rule(overrides) {
  return {
    rule_id: 'R-1',
    applies_when: { metric: 'archive_mode', equals: 'off' },
    on_violation: { severity: 'warning', score_adjustment: { type: 'none' }, ...((overrides || {}).on_violation || {}) },
    ...overrides,
  };
}

describe('validation module — fail-closed shapes', () => {
  it('rejects unknown adjustment types', () => {
    const errors = [];
    validateRule(rule({ on_violation: { severity: 'warning', score_adjustment: { type: 'metric_double' } } }), lookups(), errors);
    assert.ok(errors.some(e => e.includes("type 'metric_double' is invalid")));
  });

  it('rejects metric_zero with an unknown target', () => {
    const errors = [];
    validateRule(rule({ on_violation: { severity: 'warning', score_adjustment: { type: 'metric_zero', target: 'ghost_metric' } } }), lookups(), errors);
    assert.ok(errors.some(e => e.includes("'ghost_metric' is not a known metric legacy_name")));
  });

  it('accepts a valid metric_zero rule', () => {
    const errors = [];
    validateRule(rule({ on_violation: { severity: 'critical', score_adjustment: { type: 'metric_zero', target: 'rpo_target' } } }), lookups(), errors);
    assert.deepEqual(errors, []);
  });

  it('rejects both singular and plural adjustment forms together', () => {
    const errors = [];
    validateRuleAdjustments({
      score_adjustment: { type: 'none' },
      score_adjustments: [{ type: 'metric_zero', target: 'rpo_target' }],
    }, lookups(), 'R-1', errors);
    assert.ok(errors.some(e => e.includes('use exactly one form')));
  });

  it('rejects an empty plural array and none-inside-array', () => {
    const errors = [];
    validateRuleAdjustments({ score_adjustments: [] }, lookups(), 'R-1', errors);
    assert.ok(errors.some(e => e.includes('non-empty array')));

    const errors2 = [];
    validateRuleAdjustments({ score_adjustments: [{ type: 'none' }] }, lookups(), 'R-1', errors2);
    assert.ok(errors2.some(e => e.includes("'none' is not allowed")));
  });

  it('rejects duplicate (type,target) pairs in the plural form', () => {
    const errors = [];
    validateRuleAdjustments({
      score_adjustments: [
        { type: 'subcategory_deduction', target: 'backup_sub', points: 1 },
        { type: 'subcategory_deduction', target: 'backup_sub', points: 2 },
      ],
    }, lookups(), 'R-1', errors);
    assert.ok(errors.some(e => e.includes('duplicate adjustment')));
  });

  it('allows distinct types on the same target in the plural form', () => {
    const errors = [];
    validateRuleAdjustments({
      score_adjustments: [
        { type: 'subcategory_deduction', target: 'backup_sub', points: 1 },
        { type: 'subcategory_cap', target: 'backup_sub', cap_pct: 60 },
      ],
    }, lookups(), 'R-1', errors);
    assert.deepEqual(errors, []);
  });

  it('rejects predicates referencing unknown metrics, anchors, and profiles', () => {
    const e1 = [];
    validatePredicate({ metric: 'ghost', is_truthy: true }, lookups(), 'p', e1);
    assert.ok(e1.some(e => e.includes("unknown metric 'ghost'")));

    const e2 = [];
    validatePredicate({ system_fact: 'disk_rpm', gte: 1 }, lookups(), 'p', e2);
    assert.ok(e2.some(e => e.includes("system_fact='disk_rpm' is not recognized")));

    const e3 = [];
    validatePredicate({ workload_profile: 'batchy' }, lookups(), 'p', e3);
    assert.ok(e3.some(e => e.includes("'batchy' is not a recognized profile")));
  });

  it('enforces operator families: numeric anchors vs string facts', () => {
    const e1 = [];
    validatePredicate({ system_fact: 'storage_type', gte: 3 }, lookups(), 'p', e1);
    assert.ok(e1.some(e => e.includes('string fact and must carry exactly one of equals/in/not_in')));

    const e2 = [];
    validatePredicate({ system_fact: 'ram_kb', in: ['16'] }, lookups(), 'p', e2);
    assert.ok(e2.some(e => e.includes('numeric and must carry exactly one numeric operator')));

    const e3 = [];
    validatePredicate({ system_fact: 'storage_type', in: ['ssd', 'nvme'] }, lookups(), 'p', e3);
    assert.deepEqual(e3, []);

    const e4 = [];
    validatePredicate({ system_fact: 'edition', equals: 'enterprise' }, lookups(), 'p', e4);
    assert.deepEqual(e4, []);
  });

  it('rejects string facts as size-relative anchors and derived inputs', () => {
    const e1 = [];
    validateThresholdShape('M-1', { min_pct: 25, min_pct_of: 'storage_type' }, e1);
    assert.ok(e1.some(e => e.includes("min_pct_of='storage_type' is not a recognized anchor")));

    const e2 = [];
    validateDerivedFrom({
      metric_id: 'M-1', derived: true,
      derived_from: { formula: 'count_csv', inputs: ['storage_type'] },
    }, lookups(), e2);
    assert.ok(e2.some(e => e.includes("unknown name 'storage_type'")));
  });

  it('rejects unknown boolean checks and non-boolean derived flags', () => {
    const e1 = [];
    validateEvaluationConfig({ metric_id: 'M-1', evaluation_type: 'boolean', evaluation_config: { check: 'is_shiny' } }, e1);
    assert.ok(e1.some(e => e.includes("check='is_shiny' is not implemented")));

    const e2 = [];
    validateDerivedFrom({ metric_id: 'M-1', derived: 1, derived_from: { formula: 'count_csv', inputs: ['rpo_target'] } }, lookups(), e2);
    assert.ok(e2.some(e => e.includes('derived must be boolean true')));
  });

  it('validates metric applies_when through the same walker', () => {
    const errors = [];
    validateMetricAppliesWhen({
      metric_id: 'M-1',
      applies_when: { metric: 'ghost', is_truthy: true },
    }, lookups(), errors);
    assert.ok(errors.some(e => e.includes("unknown metric 'ghost'")));

    const ok = [];
    validateMetricAppliesWhen({
      metric_id: 'M-1',
      applies_when: { all_of: [{ metric: 'archive_mode', equals: 'on' }, { system_fact: 'edition', equals: 'enterprise' }] },
    }, lookups(), ok);
    assert.deepEqual(ok, []);
  });

  it('whitelists wal_buffers_ratio_capped and stays in lockstep with the engine formulas', () => {
    assert.ok(SUPPORTED_DERIVED_FORMULAS.has('wal_buffers_ratio_capped'));
    const moduleNames = [...SUPPORTED_DERIVED_FORMULAS].sort();
    const engineNames = [...ScoringEngine.DERIVED_FORMULA_NAMES].sort();
    assert.deepEqual(engineNames, moduleNames,
      'engine DERIVED_FORMULAS and validation SUPPORTED_DERIVED_FORMULAS must not drift');
  });
});

describe('validation module — simulator delegation parity', () => {
  it('the simulator validateCatalog rejects the same bad rule the CI gate rejects', () => {
    const badCat = JSON.parse(JSON.stringify(CAT_DATA));
    badCat.consistency_rules = [{
      rule_id: 'BAD-1',
      applies_when: { metric: 'ghost', is_truthy: true },
      on_violation: { severity: 'warning', score_adjustment: { type: 'metric_zero', target: 'ghost' } },
    }];
    const result = validateCatalog(badCat);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes("unknown metric 'ghost'")));
    assert.ok(result.errors.some(e => e.includes('not a known metric legacy_name')));
  });

  it('the simulator validateCatalog now enforces threshold shapes (was a gap)', () => {
    const badCat = JSON.parse(JSON.stringify(CAT_DATA));
    badCat.metrics.push({
      metric_id: 'T-9', legacy_name: 'shapeless', subcategory: 'backup_sub',
      criticality: 'advisory', evaluation_type: 'threshold', evaluation_config: {}, sources: ['sql'],
    });
    const result = validateCatalog(badCat);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('missing min/max, profiles, *_pct, or by_declaration config')));
  });
});
