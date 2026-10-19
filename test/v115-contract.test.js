'use strict';

/**
 * v1.15.0 contract pieces shared by the public-release cycle:
 *  - restore_time_estimate_minutes derived formula (database size vs RTO)
 *  - oracle_memory_pct_of_ram prefers PGA_AGGREGATE_LIMIT when set
 *  - technical_anchor / rationale validators (shared by CI and simulator)
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { ScoringEngine, MetricCatalog } = require('../src');
const v = require('../src/catalog/validation');

function synthetic(metric) {
  return {
    version: '1.15.0',
    pillars: { backup: { name: 'Backup', maxPoints: 20, order: 1 } },
    subcategories: { backup_recovery: { pillar: 'backup', name: 'Recovery', maxPoints: 20, order: 1 } },
    metrics: [metric],
    consistency_rules: [],
  };
}
function engineFor(cat) {
  const e = new ScoringEngine('postgresql');
  e.catalog = MetricCatalog.fromData('synthetic', cat);
  return e;
}
function derivedValue(result, name) {
  const m = result.allMetrics.find(x => x.name === name) || {};
  return m.value;
}

describe('restore_time_estimate_minutes', () => {
  const metric = {
    metric_id: 'BAK-9.1', subcategory: 'backup_recovery', legacy_name: 'restore_time_estimate_minutes',
    display_name: 'Restore time', criticality: 'important', weight: null,
    evaluation_type: 'threshold', evaluation_config: { max: 60, unit: 'minutes' },
    sources: ['sql'], derived: true,
    derived_from: { formula: 'restore_time_estimate_minutes', inputs: ['database_size', 'restore_throughput_mb_s'] },
  };
  const engine = engineFor(synthetic(metric));

  it('uses the 200 MB/s default when no throughput is attested (43 GB -> 3.7 min)', () => {
    const r = engine.calculate({ database_size: 43 });
    assert.equal(derivedValue(r, 'restore_time_estimate_minutes'), 3.7);
  });
  it('uses the attested throughput when provided (1024 GB at 100 MB/s -> 174.8 min)', () => {
    const r = engine.calculate({ database_size: 1024, restore_throughput_mb_s: 100 });
    assert.equal(derivedValue(r, 'restore_time_estimate_minutes'), 174.8);
  });
  it('is not provided when database_size is missing', () => {
    const r = engine.calculate({ restore_throughput_mb_s: 100 });
    const m = r.allMetrics.find(x => x.name === 'restore_time_estimate_minutes');
    assert.equal(m.scored, false);
    assert.equal(m.value, 'not provided');
  });
  it('is whitelisted by the validator', () => {
    assert.ok(v.SUPPORTED_DERIVED_FORMULAS.has('restore_time_estimate_minutes'));
  });
});

describe('oracle_memory_pct_of_ram input preference', () => {
  const metric = {
    metric_id: 'PERF-9.1', subcategory: 'backup_recovery', legacy_name: 'oracle_memory_pct_of_ram',
    display_name: 'Mem', criticality: 'important', weight: null,
    evaluation_type: 'range', evaluation_config: { min: 40, max: 80 },
    sources: ['sql'], derived: true,
    derived_from: { formula: 'oracle_memory_pct_of_ram', inputs: ['sga_target', 'pga_aggregate_target', 'ram_bytes'] },
  };
  const engine = engineFor(synthetic(metric));
  const ram = 16 * 1024 ** 3;
  it('prefers pga_aggregate_limit when set', () => {
    const r = engine.calculate({ sga_target: 8 * 1024 ** 3, pga_aggregate_target: 2 * 1024 ** 3, pga_aggregate_limit: 4 * 1024 ** 3 }, { systemFacts: { ram_bytes: ram } });
    assert.equal(derivedValue(r, 'oracle_memory_pct_of_ram'), 75);
  });
  it('falls back to pga_aggregate_target when the limit is absent', () => {
    const r = engine.calculate({ sga_target: 8 * 1024 ** 3, pga_aggregate_target: 2 * 1024 ** 3 }, { systemFacts: { ram_bytes: ram } });
    assert.equal(derivedValue(r, 'oracle_memory_pct_of_ram'), 62.5);
  });
});

describe('technical_anchor and rationale validators', () => {
  const base = { metric_id: 'X-1.1' };
  it('accepts an absent anchor', () => {
    const errors = []; v.validateTechnicalAnchor({ ...base }, errors); assert.deepEqual(errors, []);
  });
  it('accepts a well-formed anchor', () => {
    const errors = []; v.validateTechnicalAnchor({ ...base, technical_anchor: { summary: 'Reads x', query: 'SELECT 1' } }, errors); assert.deepEqual(errors, []);
  });
  it('rejects a missing query or an empty summary', () => {
    const errors = [];
    v.validateTechnicalAnchor({ ...base, technical_anchor: { summary: '   ' } }, errors);
    assert.equal(errors.length, 2);
  });
  it('rejects a non-object anchor', () => {
    const errors = []; v.validateTechnicalAnchor({ ...base, technical_anchor: 'SELECT 1' }, errors); assert.equal(errors.length, 1);
  });
  it('warns, not errors, on soft length caps', () => {
    const errors = []; const warnings = [];
    v.validateTechnicalAnchor({ ...base, technical_anchor: { summary: 'x'.repeat(300), query: 'SELECT 1' } }, errors, warnings);
    assert.deepEqual(errors, []); assert.equal(warnings.length, 1);
  });
  it('rationale must be a non-empty string when present', () => {
    const e1 = []; v.validateRationale({ ...base, rationale: 'PostgreSQL docs' }, e1); assert.deepEqual(e1, []);
    const e2 = []; v.validateRationale({ ...base, rationale: '' }, e2); assert.equal(e2.length, 1);
    const e3 = []; v.validateRationale({ ...base }, e3); assert.deepEqual(e3, []);
  });
});
