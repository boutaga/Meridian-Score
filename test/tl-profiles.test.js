'use strict';

// Narrative locks for the TL validation profile set (uneven / average /
// almost-there, PostgreSQL + Oracle). These fixtures are demo material for the
// technology-leader review of the catalogs: each test pins the story a profile
// must keep telling (score band, pillar contrast, target coherence states) so
// a future catalog change cannot silently break the demo.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const ScoringEngine = require('../src/scoring/engine');

const SAMPLES_DIR = path.resolve(__dirname, '../data/samples');

function score(file) {
  const data = JSON.parse(fs.readFileSync(path.join(SAMPLES_DIR, file), 'utf8'));
  const engine = new ScoringEngine(data._meta.technology);
  const result = engine.calculate(data.values, {
    systemFacts: data.systemFacts,
    workloadProfile: data.workloadProfile,
    licensedOptions: data.licensedOptions || [],
  });
  return { data, engine, result };
}

const metric = (result, name) => result.allMetrics.find(m => m.name === name);
const zeroedBy = (m) => (m && m.zeroed_by_rules) || [];
const failsOf = (result, criticality) => result.allMetrics.filter(
  m => m.scored && m.score < m.maxScore && m.criticality === criticality
);

function assertTargetHonored(result, name) {
  const m = metric(result, name);
  assert.ok(m, `target ${name} present`);
  assert.equal(zeroedBy(m).length, 0, `${name} must not be zeroed (got ${zeroedBy(m)})`);
  assert.equal(m.score, m.maxScore, `${name} must earn full points`);
}

function assertTargetInvalidated(result, name, expectedRule) {
  const m = metric(result, name);
  assert.ok(m, `target ${name} present`);
  assert.equal(m.score, 0, `${name} must be zeroed`);
  assert.ok(zeroedBy(m).includes(expectedRule),
    `${name} must be zeroed by ${expectedRule} (got ${zeroedBy(m)})`);
}

describe('TL validation profiles: PostgreSQL', () => {
  describe('postgresql-uneven (perf-first, legacy operations)', () => {
    const { result } = score('postgresql-uneven.json');

    it('scores in the needs-improvement band', () => {
      assert.ok(result.totalScore >= 40 && result.totalScore <= 72,
        `expected 40-72, got ${result.totalScore}`);
    });

    it('shows the pillar contrast: strong performance, gutted foundations', () => {
      assert.ok(result.pillars.performance.score >= 15,
        `performance should stay strong, got ${result.pillars.performance.score}`);
      assert.ok(result.pillars.futureproof.score <= 10,
        `futureproof should be gutted (PG 11 EOL), got ${result.pillars.futureproof.score}`);
      assert.ok(result.pillars.backup.percentage < 60,
        `backup should be weak (dumps only), got ${result.pillars.backup.percentage}%`);
    });

    it('invalidates the ambitious RPO/RTO declarations via coherence rules', () => {
      assertTargetInvalidated(result, 'rpo_target', 'BAK-CR-1');
      assertTargetInvalidated(result, 'rto_target', 'PG-CR-RTO-2');
    });

    it('honors the honest declarations', () => {
      assertTargetHonored(result, 'ha_topology');
      assertTargetHonored(result, 'security_posture');
      assertTargetHonored(result, 'growth_headroom_target');
    });
  });

  describe('postgresql-average (decent hygiene, nothing verified)', () => {
    const { result } = score('postgresql-average.json');

    it('scores in the average band', () => {
      assert.ok(result.totalScore >= 68 && result.totalScore <= 88,
        `expected 68-88, got ${result.totalScore}`);
    });

    it('honors all modest declared targets', () => {
      for (const t of ['rpo_target', 'rto_target', 'security_posture', 'growth_headroom_target', 'ha_topology']) {
        assertTargetHonored(result, t);
      }
    });

    it('has honest coverage gaps (manual inputs not provided)', () => {
      assert.ok(result.coverage.counts.missingNonCritical >= 1,
        'at least one manual input should be missing');
    });
  });

  describe('postgresql-almost-there (good score, low-ROI leftovers)', () => {
    const { result, data, engine } = score('postgresql-almost-there.json');

    it('scores in the excellent band with only low-ROI gaps, and reads good while a required check is missed', () => {
      assert.ok(result.totalScore >= 90, `expected >= 90, got ${result.totalScore}`);
      // 1.16.0 excellent-means-on-target decision: a missed required check
      // caps the status at good.
      assert.equal(result.onTarget, false);
      assert.equal(result.status, 'good');
      assert.equal(failsOf(result, 'critical').length, 0, 'no critical gaps');
      assert.ok(failsOf(result, 'important').length <= 2,
        'at most the two effort-heavy important gaps (data_checksums, huge_pages)');
    });

    it('honors every declared target', () => {
      for (const t of ['rpo_target', 'rto_target', 'security_posture', 'growth_headroom_target', 'ha_topology']) {
        assertTargetHonored(result, t);
      }
    });

    it('shows the sync_standby rung as an aspiration (incoherent today)', () => {
      const probe = engine.calculate(
        { ...data.values, ha_topology: 'sync_standby' },
        { systemFacts: data.systemFacts, workloadProfile: data.workloadProfile, licensedOptions: [] }
      );
      assert.ok(zeroedBy(metric(probe, 'ha_topology')).includes('PG-CR-HA-1'),
        'declaring sync_standby without sync replication must be invalidated');
    });
  });
});

describe('TL validation profiles: Oracle', () => {
  describe('oracle-uneven (tuned EE, weak operational discipline)', () => {
    const { result } = score('oracle-uneven.json');

    it('scores in the needs-improvement band', () => {
      assert.ok(result.totalScore >= 40 && result.totalScore <= 72,
        `expected 40-72, got ${result.totalScore}`);
    });

    it('shows the pillar contrast: strong performance, gutted foundations', () => {
      assert.ok(result.pillars.performance.score >= 15,
        `performance should stay strong, got ${result.pillars.performance.score}`);
      assert.ok(result.pillars.futureproof.percentage < 60,
        `futureproof should be weak (12.2, 30 months unpatched), got ${result.pillars.futureproof.percentage}%`);
      assert.ok(result.pillars.backup.percentage < 60,
        `backup should be weak (no RMAN discipline), got ${result.pillars.backup.percentage}%`);
    });

    it('invalidates the aggressive RTO and phantom DR declarations', () => {
      assertTargetInvalidated(result, 'rto_target', 'OR-CR-RTO-1');
      assertTargetInvalidated(result, 'dr_topology', 'OR-CR-DR-1');
    });

    it('honors the honest daily-backup RPO declaration', () => {
      assertTargetHonored(result, 'rpo_target');
    });

    it('excludes only the unlicensed options from scoring', () => {
      assert.ok(result.coverage.counts.licenseExcluded >= 4,
        'options not owned (advanced_security, rac, partitioning, ADG) must be excluded');
    });
  });

  describe('oracle-average (typical SE2 estate)', () => {
    const { result } = score('oracle-average.json');

    it('scores in the average band', () => {
      assert.ok(result.totalScore >= 68 && result.totalScore <= 88,
        `expected 68-88, got ${result.totalScore}`);
    });

    it('honors all modest declared targets', () => {
      for (const t of ['rpo_target', 'rto_target', 'security_posture', 'growth_headroom_target', 'dr_topology']) {
        assertTargetHonored(result, t);
      }
    });

    it('excludes all license-gated metrics on SE2 without penalty', () => {
      assert.ok(result.coverage.counts.licenseExcluded >= 10,
        `SE2 with no options should exclude the license-gated set, got ${result.coverage.counts.licenseExcluded}`);
    });

    it('has honest coverage gaps (manual inputs not provided)', () => {
      assert.ok(result.coverage.counts.missingNonCritical >= 1,
        'at least one manual input should be missing');
    });
  });

  describe('oracle-almost-there (mature EE estate, diminishing returns)', () => {
    const { result, data, engine } = score('oracle-almost-there.json');

    it('scores in the excellent band with only low-ROI gaps, and reads good while a required check is missed', () => {
      assert.ok(result.totalScore >= 90, `expected >= 90, got ${result.totalScore}`);
      // 1.16.0 excellent-means-on-target decision: a missed required check
      // caps the status at good.
      assert.equal(result.onTarget, false);
      assert.equal(result.status, 'good');
      assert.equal(failsOf(result, 'critical').length, 0, 'no critical gaps');
      assert.ok(failsOf(result, 'important').length <= 2,
        'at most the effort-heavy important gaps (rman_catalog)');
    });

    it('honors every declared target', () => {
      for (const t of ['rpo_target', 'rto_target', 'security_posture', 'growth_headroom_target', 'dr_topology']) {
        assertTargetHonored(result, t);
      }
    });

    it('shows the dg_sync rung as an aspiration (incoherent today)', () => {
      const probe = engine.calculate(
        { ...data.values, dr_topology: 'dg_sync' },
        { systemFacts: data.systemFacts, workloadProfile: data.workloadProfile, licensedOptions: data.licensedOptions }
      );
      assert.ok(zeroedBy(metric(probe, 'dr_topology')).includes('OR-CR-DR-2'),
        'declaring dg_sync on MAXIMUM PERFORMANCE protection mode must be invalidated');
    });
  });
});
