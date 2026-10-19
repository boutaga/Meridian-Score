'use strict';

/**
 * PostgreSQL catalog 1.12.0 content lock: the changes taken from the
 * PostgreSQL Technology Leader review (2026-09-03) and the "database size is
 * a coherence input" decision (plan 7.8).
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { ScoringEngine, getCatalog } = require('../src');

const cat = getCatalog('postgresql');
const byId = id => cat.metrics.find(m => m.metric_id === id);
const engine = new ScoringEngine('postgresql');
function loadSample(name) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'samples', name), 'utf8'));
}
function scoreSample(name, mutate) {
  const s = loadSample(name);
  const values = { ...s.values };
  if (mutate) mutate(values);
  return engine.calculate(values, { systemFacts: s.systemFacts, workloadProfile: s.workloadProfile, licensedOptions: s.licensedOptions });
}
const firedRules = r => r.allFindings.map(f => f.rule_id).filter(Boolean);

describe('PostgreSQL catalog 1.12.0 (Technology Leader review + size as a coherence input)', () => {
  it('is version 1.12.0 or later with 172 metrics and 29 rules', () => {
    const [major, minor] = cat.version.split('.').map(Number);
    assert.ok(major === 1 && minor >= 12, `expected 1.12.x or later, got ${cat.version}`);
    assert.equal(cat.metrics.length, 172);
    assert.equal(cat.consistencyRules.length, 29);
  });

  it('CAP-1.1 database_size is a capture metric (never penalised by itself)', () => {
    const m = byId('CAP-1.1');
    assert.deepEqual(m.evaluation_config, { min: 0, unit: 'gb' });
    assert.ok(m.rationale && m.technical_anchor);
    const r = scoreSample('postgresql-healthy.json', v => { v.database_size = 50000; });
    const e = r.allMetrics.find(x => x.name === 'database_size');
    assert.equal(e.score, e.maxScore);
  });

  it('adds the attested throughput and the derived restore-time estimate', () => {
    assert.equal(byId('BAK-4.8').legacy_name, 'restore_throughput_mb_s');
    assert.deepEqual(byId('BAK-4.8').sources, ['manual']);
    const m = byId('BAK-4.9');
    assert.equal(m.legacy_name, 'restore_time_estimate_minutes');
    assert.equal(m.derived, true);
    assert.equal(m.evaluation_config.by_declaration.metric, 'rto_target');
    // 1.16.0: counted everywhere, not required with a declared standby.
    assert.equal(m.applies_when, undefined);
    assert.deepEqual(m.optional_when, { metric: 'ha_topology', in: ['async_standby', 'sync_standby', 'cluster_managed'] });
  });

  it('PG-CR-RTO-3 fires on a terabyte standalone estate declaring rto_15 and zeroes the declaration', () => {
    const r = scoreSample('postgresql-healthy.json', v => { v.database_size = 1024; v.rto_target = 'rto_15'; v.ha_topology = 'none'; delete v.restore_throughput_mb_s; });
    assert.ok(firedRules(r).includes('PG-CR-RTO-3'), firedRules(r).join(','));
    assert.equal(r.allMetrics.find(x => x.name === 'rto_target').score, 0);
    assert.ok(r.totalScore < 100);
  });

  it('PG-CR-RTO-3 stays silent with a standby, with a small database, or with a fast attested restore', () => {
    const standby = scoreSample('postgresql-healthy.json', v => { v.database_size = 1024; v.rto_target = 'rto_15'; v.ha_topology = 'async_standby'; });
    assert.ok(!firedRules(standby).includes('PG-CR-RTO-3'));
    assert.equal(standby.allMetrics.find(x => x.name === 'restore_time_estimate_minutes').required, false);
    const small = scoreSample('postgresql-healthy.json', v => { v.database_size = 43; v.rto_target = 'rto_15'; v.ha_topology = 'none'; });
    assert.ok(!firedRules(small).includes('PG-CR-RTO-3'));
    const fast = scoreSample('postgresql-healthy.json', v => { v.database_size = 1024; v.rto_target = 'rto_60'; v.ha_topology = 'none'; v.restore_throughput_mb_s = 2000; });
    assert.ok(!firedRules(fast).includes('PG-CR-RTO-4'));
  });

  it('PG-CR-RTO-4 covers the one-hour rung', () => {
    const r = scoreSample('postgresql-healthy.json', v => { v.database_size = 2048; v.rto_target = 'rto_60'; v.ha_topology = 'none'; delete v.restore_throughput_mb_s; });
    assert.ok(firedRules(r).includes('PG-CR-RTO-4'));
  });

  it('SEC-3.4 pgaudit is required only under a regulated or undeclared posture (1.16.0)', () => {
    assert.deepEqual(byId('SEC-3.4').optional_when, { metric: 'security_posture', in: ['baseline', 'hardened'] });
    const baseline = scoreSample('postgresql-average.json', v => { v.security_posture = 'baseline'; v.pgaudit_installed = false; });
    const base = baseline.allMetrics.find(x => x.name === 'pgaudit_installed');
    assert.equal(base.required, false);
    assert.equal(base.score, 0, 'counted: an absent pgAudit loses its points');
    const regulated = scoreSample('postgresql-average.json', v => { v.security_posture = 'regulated'; v.pgaudit_installed = false; });
    const reg = regulated.allMetrics.find(x => x.name === 'pgaudit_installed');
    assert.equal(reg.applicable, undefined);
    assert.equal(reg.required, true);
    assert.equal(reg.scored, true);
    assert.equal(reg.score, 0);
  });

  it('provenance and measurement are recorded on the metrics the reviewer questioned', () => {
    for (const id of ['PER-2.7', 'PER-2.10', 'CAP-3.11', 'CAP-3.2', 'PER-2.9', 'SEC-3.4']) {
      assert.ok(byId(id).rationale, `${id} rationale`);
      assert.ok(byId(id).technical_anchor && byId(id).technical_anchor.query, `${id} anchor`);
    }
    assert.ok(!/Azure/.test(byId('PER-2.15').remediation));
  });

  // 1.15.0 exact partial credit (adoption review) moved almost-there 96.31 -> 95.6,
  // average 81.82 -> 80.96 and uneven 64.79 -> 64.52; no status band changed.
  // archive_timeout (BAK-1.7, 2026-09-25): average 80.96 -> 80.61 (0, the default,
  // under a declared 4-hour RPO without a standby), almost-there 95.6 -> 95.64.
  it('keeps the seven samples where the release left them', () => {
    // 1.13.0 (one ruler, a target per estate): every check counts again, and
    // pgAudit and the restore estimate now count where posture or topology was
    // not declared. average 80.61 -> 79.57, uneven 64.52 -> 63.4, oltp 100 ->
    // 99.7 and olap 100 -> 99.39 (restore estimate longer than the RTO, now
    // judged with an undeclared topology),
    // almost-there 95.64 -> 95.75; healthy and critical unchanged.
    // 1.17.0 (absolute target, standalone runs): an uncollected check counts
    // 0, so the four agent-only checks cost every sample 4.27 points not
    // assessed; oltp and olap now carry the 14 values added to the catalog
    // after they were written (oltp 95.43, olap 95.12); healthy 95.73 (100 in
    // an agent run); almost-there 91.48, average 74.3, uneven 59.56 and
    // critical 47.33 keep their own gaps.
    const expected = { 'postgresql-healthy.json': 95.73, 'postgresql-oltp.json': 95.43, 'postgresql-olap.json': 95.12, 'postgresql-almost-there.json': 91.48, 'postgresql-average.json': 74.3, 'postgresql-uneven.json': 59.56, 'postgresql-critical.json': 47.33 };
    for (const [f, total] of Object.entries(expected)) {
      const r = scoreSample(f);
      assert.ok(Math.abs(r.totalScore - total) < 0.005, `${f}: ${r.totalScore} vs ${total}`);
    }
  });
});
