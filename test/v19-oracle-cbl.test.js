'use strict';

/**
 * Oracle catalog 1.9.0 content lock: the changes taken from the Oracle
 * Technology Leader review (2026-08-27).
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { ScoringEngine, getCatalog } = require('../src');

const cat = getCatalog('oracle');
const byId = id => cat.metrics.find(m => m.metric_id === id);
const engine = new ScoringEngine('oracle');
function scoreSample(name, mutate) {
  const s = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'samples', name), 'utf8'));
  const values = { ...s.values };
  if (mutate) mutate(values);
  return engine.calculate(values, { systemFacts: s.systemFacts, workloadProfile: s.workloadProfile, licensedOptions: s.licensedOptions });
}

describe('Oracle catalog 1.9.0 (CBL review)', () => {
  it('is version 1.9.0 or later with 160 metrics', () => {
    const [major, minor] = cat.version.split('.').map(Number);
    assert.ok(major === 1 && minor >= 9, `expected 1.9.x or later, got ${cat.version}`);
    assert.equal(cat.metrics.length, 160);
  });

  it('retired the five metrics the reviewer rejected', () => {
    for (const id of ['BAK-1.3', 'BAK-1.4', 'PERF-1.1', 'CAP-1.10', 'CAP-3.8']) assert.equal(byId(id), undefined, id);
    for (const n of ['archive_lag', 'archive_multiplexing', 'buffer_cache_hit_ratio', 'tablespace_fragmentation', 'system_stats_gathered']) {
      assert.ok(!cat.getByLegacyName(n), n);
    }
  });

  it('replaced system statistics with the defaults check (CAP-3.11)', () => {
    const m = byId('CAP-3.11');
    assert.equal(m.legacy_name, 'system_stats_at_defaults');
    assert.equal(m.criticality, 'advisory');
    assert.ok(m.technical_anchor && /aux_stats\$/i.test(m.technical_anchor.query));
  });

  it('CAP-1.2 is critical, guarded on its own presence, and not applicable when absent', () => {
    const m = byId('CAP-1.2');
    assert.equal(m.criticality, 'critical');
    assert.deepEqual(m.applies_when, { metric: 'asm_diskgroup_usage', provided: true });
    const withValue = scoreSample('oracle-healthy.json');
    const without = scoreSample('oracle-healthy.json', v => { delete v.asm_diskgroup_usage; });
    assert.equal(withValue.totalScore, 100);
    assert.equal(without.totalScore, 100);
    assert.equal(without.pillars.capacity.criticalGated, undefined);
    const entry = without.allMetrics.find(x => x.name === 'asm_diskgroup_usage');
    assert.equal(entry.applicable, false);
  });

  it('BAK-1.5 is scored in megabytes (the collector emits MB)', () => {
    assert.deepEqual(byId('BAK-1.5').evaluation_config, { min: 512, unit: 'mb' });
    const r = scoreSample('oracle-healthy.json');
    const e = r.allMetrics.find(x => x.name === 'redo_log_size');
    assert.equal(e.scored, true);
    assert.equal(e.score, e.maxScore);
  });

  it('PERF-1.4 means ASMM only and SEC-3.8 applies only under traditional auditing', () => {
    assert.equal(byId('PERF-1.4').display_name, 'ASMM in Use');
    // 1.11.0: also needs its own value (the parameter is absent on some versions).
    assert.deepEqual(byId('SEC-3.8').applies_when, { all_of: [{ metric: 'unified_auditing_enabled', not_in: ['TRUE'] }, { metric: 'audit_trail_destination', provided: true }] });
  });

  it('PERF-1.11 prefers the PGA hard limit captured by PERF-1.13', () => {
    assert.ok(byId('PERF-1.11').derived_from.inputs.includes('pga_aggregate_limit'));
    assert.equal(byId('PERF-1.13').legacy_name, 'pga_aggregate_limit');
  });

  it('BAK-2.6 and SEC-1.7 became attestations', () => {
    assert.deepEqual(byId('BAK-2.6').sources, ['manual']);
    assert.deepEqual(byId('SEC-1.7').sources, ['manual']);
  });

  it('every technical anchor has a summary and a query, and the reviewer SQL is present', () => {
    const anchored = cat.metrics.filter(m => m.technical_anchor);
    assert.ok(anchored.length >= 30, `only ${anchored.length} anchors`);
    for (const m of anchored) {
      assert.ok(m.technical_anchor.summary.trim().length > 0, m.metric_id);
      assert.ok(m.technical_anchor.query.trim().length > 0, m.metric_id);
    }
    assert.ok(/SPACE_RECLAIMABLE/.test(byId('BAK-5.2').technical_anchor.query));
    assert.ok(/Crypto-checksumming/.test(byId('SEC-2.3').technical_anchor.query));
  });

  // 1.15.0 exact partial credit (adoption review) moved almost-there 95.26 -> 94.95,
  // average 82.46 -> 82.32 and uneven 63.27 -> 62.47; no status band changed.
  it('keeps the eight samples where the review left them', () => {
    // 1.17.0 (an uncollected check counts 0): average 82.32 -> 81.72 (two
    // uncollected checks), critical 54.99 -> 51.51 (30 uncollected values;
    // the catalog 1.11.0 guards take the ones that do not apply out).
    const expected = { 'oracle-healthy.json': 100, 'oracle-oltp.json': 99.58, 'oracle-olap.json': 100, 'oracle-se2.json': 100, 'oracle-almost-there.json': 94.95, 'oracle-average.json': 81.72, 'oracle-uneven.json': 62.47, 'oracle-critical.json': 51.51 };
    for (const [f, total] of Object.entries(expected)) {
      const r = scoreSample(f);
      assert.ok(Math.abs(r.totalScore - total) <= 0.05, `${f}: ${r.totalScore} vs ${total}`);
    }
  });
});
