'use strict';

/**
 * Phase 2 (v1.6.0) — score adjustments end-to-end.
 *
 * These tests build a tiny synthetic catalog via MetricCatalog.fromData, score
 * it to a known baseline, then verify that consistency rules with non-'none'
 * score_adjustment.type values actually move the score by the expected amount
 * and annotate the originating finding with a `score_movement` field.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { ScoringEngine, MetricCatalog } = require('../src');

function buildCatalog({ rules = [] } = {}) {
  return {
    version: '1.6.0',
    pillars: {
      perf:   { name: 'Performance', maxPoints: 20, order: 1 },
      backup: { name: 'Backup',      maxPoints: 20, order: 2 },
    },
    subcategories: {
      perf_cache:   { pillar: 'perf',   name: 'Cache',     maxPoints: 10, order: 1 },
      perf_queries: { pillar: 'perf',   name: 'Queries',   maxPoints: 10, order: 2 },
      backup_main:  { pillar: 'backup', name: 'Backup',    maxPoints: 20, order: 1 },
    },
    metrics: [
      makeBoolMetric('CACHE-1', 'perf_cache',   'cache_a'),
      makeBoolMetric('CACHE-2', 'perf_cache',   'cache_b'),
      makeBoolMetric('Q-1',     'perf_queries', 'q_a'),
      makeBoolMetric('Q-2',     'perf_queries', 'q_b'),
      makeBoolMetric('BAK-1',   'backup_main',  'b_a'),
      makeBoolMetric('BAK-2',   'backup_main',  'b_b'),
    ],
    consistency_rules: rules,
  };
}

function makeBoolMetric(metricId, subcategory, legacyName) {
  return {
    metric_id: metricId,
    subcategory,
    legacy_name: legacyName,
    display_name: metricId,
    description: `${metricId} description`,
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
    remediation: 'flip it',
    cis_reference: null,
  };
}

function makeEngine(catalogData) {
  const engine = new ScoringEngine('postgresql');
  engine.catalog = MetricCatalog.fromData('synthetic', catalogData);
  return engine;
}

const ALL_TRUE = { cache_a: true, cache_b: true, q_a: true, q_b: true, b_a: true, b_b: true };

describe('Phase 2 adjustments — subcategory_deduction', () => {
  it('subtracts points from the targeted subcategory and floors at 0', () => {
    const cat = buildCatalog({
      rules: [{
        rule_id: 'TEST-DED-1',
        applies_when: { metric: 'cache_a', is_truthy: true },
        on_violation: {
          severity: 'warning',
          score_adjustment: { type: 'subcategory_deduction', target: 'perf_cache', points: 3 },
          title: 'fires', description: 'd', remediation: 'r',
        },
      }],
    });
    const engine = makeEngine(cat);
    const result = engine.calculate(ALL_TRUE);
    const finding = result.allFindings.find(f => f.rule_id === 'TEST-DED-1');
    assert.ok(finding, 'rule should fire');
    assert.ok(finding.score_movement, 'finding should be annotated');
    assert.equal(finding.score_movement.type, 'subcategory_deduction');
    assert.equal(finding.score_movement.target, 'perf_cache');
    assert.equal(finding.score_movement.prior_score, 10);
    assert.equal(finding.score_movement.new_score, 7);
  });

  it('multiple deductions on the same subcategory sum', () => {
    const cat = buildCatalog({
      rules: [
        {
          rule_id: 'DED-A',
          applies_when: { metric: 'cache_a', is_truthy: true },
          on_violation: {
            severity: 'warning',
            score_adjustment: { type: 'subcategory_deduction', target: 'perf_cache', points: 2 },
            title: 'a', description: '', remediation: '',
          },
        },
        {
          rule_id: 'DED-B',
          applies_when: { metric: 'cache_b', is_truthy: true },
          on_violation: {
            severity: 'warning',
            score_adjustment: { type: 'subcategory_deduction', target: 'perf_cache', points: 3 },
            title: 'b', description: '', remediation: '',
          },
        },
      ],
    });
    const result = makeEngine(cat).calculate(ALL_TRUE);
    assert.equal(result.pillars.perf.score, 15);
    // perf_cache should be 10 - 2 - 3 = 5; perf_queries untouched at 10
  });

  it('floors at zero when deduction exceeds the prior score', () => {
    const cat = buildCatalog({
      rules: [{
        rule_id: 'OVER',
        applies_when: { metric: 'cache_a', is_truthy: true },
        on_violation: {
          severity: 'warning',
          score_adjustment: { type: 'subcategory_deduction', target: 'perf_cache', points: 999 },
          title: 'a', description: '', remediation: '',
        },
      }],
    });
    const result = makeEngine(cat).calculate(ALL_TRUE);
    const finding = result.allFindings.find(f => f.rule_id === 'OVER');
    assert.equal(finding.score_movement.new_score, 0);
    assert.equal(finding.score_movement.applied, 10);
    assert.equal(result.pillars.perf.score, 10);
  });
});

describe('Phase 2 adjustments — subcategory_cap', () => {
  it('caps to cap_pct × maxPoints when prior_score is higher', () => {
    const cat = buildCatalog({
      rules: [{
        rule_id: 'CAP-1',
        applies_when: { metric: 'cache_a', is_truthy: true },
        on_violation: {
          severity: 'warning',
          score_adjustment: { type: 'subcategory_cap', target: 'perf_cache', cap_pct: 60 },
          title: 't', description: '', remediation: '',
        },
      }],
    });
    const result = makeEngine(cat).calculate(ALL_TRUE);
    const finding = result.allFindings.find(f => f.rule_id === 'CAP-1');
    assert.equal(finding.score_movement.cap_points, 6);
    assert.equal(finding.score_movement.new_score, 6);
  });

  it('lowest cap wins when multiple rules target the same subcategory', () => {
    const cat = buildCatalog({
      rules: [
        {
          rule_id: 'CAP-80',
          applies_when: { metric: 'cache_a', is_truthy: true },
          on_violation: {
            severity: 'warning',
            score_adjustment: { type: 'subcategory_cap', target: 'perf_cache', cap_pct: 80 },
            title: 't', description: '', remediation: '',
          },
        },
        {
          rule_id: 'CAP-40',
          applies_when: { metric: 'cache_b', is_truthy: true },
          on_violation: {
            severity: 'warning',
            score_adjustment: { type: 'subcategory_cap', target: 'perf_cache', cap_pct: 40 },
            title: 't', description: '', remediation: '',
          },
        },
      ],
    });
    const result = makeEngine(cat).calculate(ALL_TRUE);
    // The 40% cap should win (lower); perf_cache = 4, perf_queries = 10, perf = 14.
    assert.equal(result.pillars.perf.score, 14);
    const winner = result.allFindings.find(f => f.rule_id === 'CAP-40');
    assert.equal(winner.score_movement.new_score, 4);
  });

  it('deduction runs first, then cap (deduction is the strongest opinion)', () => {
    const cat = buildCatalog({
      rules: [
        {
          rule_id: 'DED-3',
          applies_when: { metric: 'cache_a', is_truthy: true },
          on_violation: {
            severity: 'warning',
            score_adjustment: { type: 'subcategory_deduction', target: 'perf_cache', points: 3 },
            title: 'd', description: '', remediation: '',
          },
        },
        {
          rule_id: 'CAP-50',
          applies_when: { metric: 'cache_b', is_truthy: true },
          on_violation: {
            severity: 'warning',
            score_adjustment: { type: 'subcategory_cap', target: 'perf_cache', cap_pct: 50 },
            title: 'c', description: '', remediation: '',
          },
        },
      ],
    });
    const result = makeEngine(cat).calculate(ALL_TRUE);
    // prior = 10; after deduction = 7; cap at 50% (= 5 points) → 5.
    assert.equal(result.pillars.perf.score, 15); // perf_cache=5 + perf_queries=10
    const capFinding = result.allFindings.find(f => f.rule_id === 'CAP-50');
    assert.equal(capFinding.score_movement.prior_score, 7);
    assert.equal(capFinding.score_movement.new_score, 5);
  });
});

describe('Phase 2 adjustments — pillar_deduction', () => {
  it('subtracts points from the pillar score during rollup', () => {
    const cat = buildCatalog({
      rules: [{
        rule_id: 'PD-1',
        applies_when: { metric: 'b_a', is_truthy: true },
        on_violation: {
          severity: 'critical',
          score_adjustment: { type: 'pillar_deduction', target: 'backup', points: 4 },
          title: 't', description: '', remediation: '',
        },
      }],
    });
    const result = makeEngine(cat).calculate(ALL_TRUE);
    assert.equal(result.pillars.backup.score, 16);
    const finding = result.allFindings.find(f => f.rule_id === 'PD-1');
    assert.equal(finding.score_movement.type, 'pillar_deduction');
    assert.equal(finding.score_movement.applied, 4);
    assert.equal(finding.score_movement.new_score, 16);
  });

  it('floors pillar deduction at zero', () => {
    const cat = buildCatalog({
      rules: [{
        rule_id: 'PD-BIG',
        applies_when: { metric: 'b_a', is_truthy: true },
        on_violation: {
          severity: 'critical',
          score_adjustment: { type: 'pillar_deduction', target: 'backup', points: 999 },
          title: 't', description: '', remediation: '',
        },
      }],
    });
    const result = makeEngine(cat).calculate(ALL_TRUE);
    assert.equal(result.pillars.backup.score, 0);
    const finding = result.allFindings.find(f => f.rule_id === 'PD-BIG');
    assert.equal(finding.score_movement.applied, 20);
    assert.equal(finding.score_movement.new_score, 0);
  });
});

describe('Phase 2 adjustments — backward compatibility', () => {
  it('rules with score_adjustment.type=none still emit findings without score_movement', () => {
    const cat = buildCatalog({
      rules: [{
        rule_id: 'PHASE-1-STYLE',
        applies_when: { metric: 'cache_a', is_truthy: true },
        on_violation: {
          severity: 'warning',
          score_adjustment: { type: 'none' },
          title: 't', description: '', remediation: '',
        },
      }],
    });
    const result = makeEngine(cat).calculate(ALL_TRUE);
    assert.equal(result.pillars.perf.score, 20);
    const finding = result.allFindings.find(f => f.rule_id === 'PHASE-1-STYLE');
    assert.ok(finding, 'rule should still fire');
    assert.equal(finding.score_movement, undefined, 'no score_movement annotation when type=none');
  });
});
