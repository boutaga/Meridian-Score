'use strict';

/**
 * Oracle catalog v1.6.0 — manual-metric gaps reported by the collector (2026-07-01).
 * Locks the four accepted changes against the REAL shipped oracle.json:
 *   - C2  the duplicate memory-of-RAM metric (PERF-1.7) is retired; the derived
 *         PERF-1.11 oracle_memory_pct_of_ram is the sole memory-of-RAM scorer.
 *   - D   autoupgrade_readiness + config_backup_exists are manual, not sql
 *         (operational attestations, not SQL-queryable).
 *   - A1  offsite_backup added (BAK-5.4, important, backup_retention).
 *   - A3  dr_plan_documented added (BAK-4.10, advisory, backup_recovery),
 *         distinct from dataguard_configured.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { getCatalog } = require('../src');
const ScoringEngine = require('../src/scoring/engine');

const cat = getCatalog('oracle');
const byLegacy = (ln) => cat.metrics.find((m) => m.legacy_name === ln);

describe('Oracle v1.6.0 — C2 memory double-count removed', () => {
  it('retires PERF-1.7 memory_config_pct_of_ram', () => {
    assert.equal(byLegacy('memory_config_pct_of_ram'), undefined, 'memory_config_pct_of_ram gone');
    assert.equal(cat.metrics.find((m) => m.metric_id === 'PERF-1.7'), undefined, 'PERF-1.7 id gone');
  });

  it('keeps the derived oracle_memory_pct_of_ram as the sole memory-of-RAM scorer in perf_cache', () => {
    const memScorers = cat.metrics.filter(
      (m) => m.subcategory === 'perf_cache' && (m.evaluation_config || {}).unit === 'percent_ram',
    );
    assert.equal(memScorers.length, 1, 'exactly one percent_ram metric in perf_cache');
    const m = memScorers[0];
    assert.equal(m.legacy_name, 'oracle_memory_pct_of_ram');
    assert.equal(m.derived, true, 'the survivor is the engine-derived metric');
  });
});

describe('Oracle v1.6.0 — D dead sql attestations re-tagged manual', () => {
  for (const [ln, id] of [['autoupgrade_readiness', 'FUT-3.7'], ['config_backup_exists', 'FUT-4.5']]) {
    it(`${ln} (${id}) is manual, not sql`, () => {
      const m = byLegacy(ln);
      assert.ok(m, `${ln} present`);
      assert.equal(m.metric_id, id);
      assert.deepEqual(m.sources, ['manual'], `${ln} sources are ["manual"]`);
      assert.ok(!m.sources.includes('sql'), `${ln} no longer claims sql`);
    });
  }
});

describe('Oracle v1.6.0 — A1/A3 manual-set parity with PostgreSQL', () => {
  it('adds offsite_backup (BAK-5.4, important, backup_retention, manual boolean)', () => {
    const m = byLegacy('offsite_backup');
    assert.ok(m, 'offsite_backup present');
    assert.equal(m.metric_id, 'BAK-5.4');
    assert.equal(m.subcategory, 'backup_retention');
    assert.equal(m.criticality, 'important');
    assert.equal(m.evaluation_type, 'boolean');
    assert.deepEqual(m.sources, ['manual']);
  });

  it('adds dr_plan_documented (BAK-4.10, advisory, backup_recovery, manual boolean), distinct from dataguard_configured', () => {
    const m = byLegacy('dr_plan_documented');
    assert.ok(m, 'dr_plan_documented present');
    assert.equal(m.metric_id, 'BAK-4.10');
    assert.equal(m.subcategory, 'backup_recovery');
    assert.equal(m.criticality, 'advisory');
    assert.equal(m.evaluation_type, 'boolean');
    assert.deepEqual(m.sources, ['manual']);
    // the pre-existing dataguard_configured stays a separate metric
    const dg = byLegacy('dataguard_configured');
    assert.ok(dg && dg.metric_id === 'BAK-4.4', 'dataguard_configured untouched at BAK-4.4');
  });

  it('scores both new attestations when provided (not orphaned)', () => {
    const engine = new ScoringEngine('oracle');
    const result = engine.calculate({ offsite_backup: false, dr_plan_documented: false });
    const scored = result.allMetrics.map((m) => m.name);
    assert.ok(scored.includes('offsite_backup'), 'offsite_backup is scored');
    assert.ok(scored.includes('dr_plan_documented'), 'dr_plan_documented is scored');
  });
});
