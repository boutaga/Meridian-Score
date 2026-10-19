'use strict';

/**
 * Coherence expansion (PG catalog v1.9.0 / Oracle v1.7.0, package 1.12.0).
 *
 * Verifies the declared-target model beyond the Backup pillar:
 *   - the RTO hole is closed (rto_target linked to recovery evidence);
 *   - each new declared target (security_posture, growth_headroom_target,
 *     ha_topology / dr_topology) is zeroed by its coherence rule when the
 *     evidence contradicts the declaration, and left alone otherwise;
 *   - the invariant that declaring a target is NEVER graded — every declarable
 *     value earns full points on its own; only incoherence with evidence costs.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const ScoringEngine = require('../src/scoring/engine');
const { evaluateMetric } = require('../src/scoring/evaluator');
const { getCatalog } = require('../src/catalog');

function metric(res, name) { return res.allMetrics.find(m => m.name === name); }
function fired(res) { return res.allFindings.filter(f => f.rule_id).map(f => f.rule_id); }
function zeroedBy(res, name) { const m = metric(res, name); return (m && m.zeroed_by_rules) || []; }

// ---------------------------------------------------------------------------
// Invariant: declaration is never graded.
// ---------------------------------------------------------------------------
describe('declared targets are never graded on the declaration alone', () => {
  const TARGETS = {
    postgresql: ['rpo_target', 'rto_target', 'security_posture', 'growth_headroom_target', 'ha_topology'],
    oracle: ['rpo_target', 'rto_target', 'security_posture', 'growth_headroom_target', 'dr_topology'],
  };
  for (const [tech, names] of Object.entries(TARGETS)) {
    for (const name of names) {
      it(`${tech}: every declarable value of ${name} earns full points`, () => {
        const cat = getCatalog(tech);
        const def = cat.getByLegacyName(name);
        assert.ok(def, `${name} exists`);
        assert.equal(def.evaluation_type, 'enum', `${name} is an enum target`);
        const weight = cat.getEffectiveWeight(def);
        for (const value of def.evaluation_config.pass_values) {
          const { score, passed } = evaluateMetric(def, value, weight);
          assert.equal(score, weight, `${name}=${value} should earn full ${weight}`);
          assert.equal(passed, true);
        }
      });
    }
  }
});

// ---------------------------------------------------------------------------
// Phase 1 — the RTO hole.
// ---------------------------------------------------------------------------
describe('RTO hole is closed', () => {
  it('PG: aggressive RTO with no recovery evidence zeroes rto_target', () => {
    const res = new ScoringEngine('postgresql').calculate({ rto_target: 'rto_5' }, {});
    assert.deepEqual(zeroedBy(res, 'rto_target').sort(), ['PG-CR-RTO-1', 'PG-CR-RTO-2']);
    assert.equal(metric(res, 'rto_target').score, 0);
  });

  it('PG: relaxed RTO is free (no rule fires, full points)', () => {
    const res = new ScoringEngine('postgresql').calculate({ rto_target: 'rto_1440' }, {});
    assert.equal(zeroedBy(res, 'rto_target').length, 0);
    assert.equal(fired(res).filter(r => r.startsWith('PG-CR-RTO')).length, 0);
    assert.ok(metric(res, 'rto_target').score > 0);
  });

  it('PG: aggressive RTO with tested recovery + PITR is honoured', () => {
    const res = new ScoringEngine('postgresql').calculate(
      { rto_target: 'rto_15', recovery_tested: true, pitr_enabled: true }, {});
    assert.equal(zeroedBy(res, 'rto_target').length, 0);
  });

  it('Oracle: minutes-level RTO without Data Guard zeroes rto_target and caps recovery', () => {
    const res = new ScoringEngine('oracle').calculate({ rto_target: 'rto_5' }, {});
    assert.ok(zeroedBy(res, 'rto_target').includes('OR-CR-RTO-1'));
    assert.ok(fired(res).includes('OR-CR-RTO-1'));
  });

  it('Oracle: minutes-level RTO with Data Guard + tested recovery is honoured', () => {
    const res = new ScoringEngine('oracle').calculate(
      { rto_target: 'rto_5', dataguard_configured: true, recovery_tested: true }, {});
    assert.equal(zeroedBy(res, 'rto_target').length, 0);
  });
});

// ---------------------------------------------------------------------------
// Phase 2 — attestation corroboration (Oracle).
// ---------------------------------------------------------------------------
describe('attestation corroboration', () => {
  it('Oracle: recovery_tested attested but stale backups zeroes recovery_tested', () => {
    const res = new ScoringEngine('oracle').calculate(
      { recovery_tested: true, last_rman_backup_age: 200 }, {});
    assert.ok(zeroedBy(res, 'recovery_tested').includes('OR-CR-ATT-1'));
  });

  it('Oracle: tablespace_encryption attested but none observed zeroes the attestation', () => {
    // SEC-2.1/2.4 are advanced_security-gated (v1.8.0 Oracle catalog): the TDE
    // attestation is only in scope, hence only zeroable, when ASO is owned.
    const res = new ScoringEngine('oracle').calculate(
      { tablespace_encryption: true, tde_encrypted_tablespaces: 0 },
      { licensedOptions: ['advanced_security'] });
    assert.ok(zeroedBy(res, 'tablespace_encryption').includes('OR-CR-ATT-2'));
  });

  it('Oracle: fresh backups leave a tested-recovery attestation intact', () => {
    const res = new ScoringEngine('oracle').calculate(
      { recovery_tested: true, last_rman_backup_age: 6 }, {});
    assert.equal(zeroedBy(res, 'recovery_tested').length, 0);
  });
});

// ---------------------------------------------------------------------------
// Phase 3 — declared targets beyond Backup.
// ---------------------------------------------------------------------------
describe('security posture', () => {
  it('PG: regulated posture with SSL off is zeroed and caps encryption', () => {
    const res = new ScoringEngine('postgresql').calculate(
      { security_posture: 'regulated', ssl_enabled: 'off' }, {});
    assert.ok(zeroedBy(res, 'security_posture').includes('PG-CR-SECPOST-1'));
    assert.ok(fired(res).includes('PG-CR-SECPOST-1'));
  });

  it('PG: regulated posture with SSL on and pgAudit installed is honoured', () => {
    const res = new ScoringEngine('postgresql').calculate(
      { security_posture: 'regulated', ssl_enabled: 'on', pgaudit_installed: true }, {});
    assert.equal(zeroedBy(res, 'security_posture').length, 0);
  });

  it('Oracle: regulated posture without TDE fires only on Enterprise Edition', () => {
    const se = new ScoringEngine('oracle').calculate(
      { security_posture: 'regulated', tde_encrypted_tablespaces: 0 }, { systemFacts: { edition: 'standard' } });
    assert.ok(!fired(se).includes('OR-CR-SECPOST-1'), 'SE must not be penalised for TDE it cannot license');

    const ee = new ScoringEngine('oracle').calculate(
      { security_posture: 'regulated', tde_encrypted_tablespaces: 0 }, { systemFacts: { edition: 'enterprise' } });
    assert.ok(fired(ee).includes('OR-CR-SECPOST-1'));
  });
});

describe('capacity headroom', () => {
  it('PG: growth headroom declared while disk is critical is zeroed', () => {
    const res = new ScoringEngine('postgresql').calculate(
      { growth_headroom_target: 'months_12', disk_usage_pct: 92 }, {});
    assert.ok(zeroedBy(res, 'growth_headroom_target').includes('PG-CR-CAP-1'));
  });

  it('Oracle: growth headroom declared while a tablespace is critical is zeroed', () => {
    const res = new ScoringEngine('oracle').calculate(
      { growth_headroom_target: 'months_6', tablespace_usage: 3 }, {});
    assert.ok(zeroedBy(res, 'growth_headroom_target').includes('OR-CR-CAP-1'));
  });

  it('PG: growth headroom with healthy storage is honoured', () => {
    const res = new ScoringEngine('postgresql').calculate(
      { growth_headroom_target: 'months_12', disk_usage_pct: 40 }, {});
    assert.equal(zeroedBy(res, 'growth_headroom_target').length, 0);
  });
});

describe('HA / DR topology', () => {
  it('PG: sync_standby declared but async commit is zeroed and caps replication', () => {
    const res = new ScoringEngine('postgresql').calculate(
      { ha_topology: 'sync_standby', synchronous_commit: 'off', streaming_status: true }, {});
    assert.ok(zeroedBy(res, 'ha_topology').includes('PG-CR-HA-1'));
  });

  it('PG: standby topology declared without streaming is zeroed', () => {
    const res = new ScoringEngine('postgresql').calculate({ ha_topology: 'async_standby', streaming_status: false }, {});
    assert.ok(zeroedBy(res, 'ha_topology').includes('PG-CR-HA-2'));
  });

  it('PG: the standby rule fires only on a collected streaming state (1.16.0)', () => {
    const res = new ScoringEngine('postgresql').calculate({ ha_topology: 'async_standby' }, {});
    assert.ok(!zeroedBy(res, 'ha_topology').includes('PG-CR-HA-2'));
  });

  it('Oracle: dg_sync declared but async protection mode is zeroed and caps replication', () => {
    const res = new ScoringEngine('oracle').calculate(
      { dr_topology: 'dg_sync', dataguard_configured: true, dataguard_protection_mode: 'MAXIMUM PERFORMANCE' }, {});
    assert.ok(zeroedBy(res, 'dr_topology').includes('OR-CR-DR-2'));
  });

  it('Oracle: DR topology declared without Data Guard is zeroed', () => {
    const res = new ScoringEngine('oracle').calculate({ dr_topology: 'dg_async' }, {});
    assert.ok(zeroedBy(res, 'dr_topology').includes('OR-CR-DR-1'));
  });

  it('declaring topology=none never fires an HA/DR rule', () => {
    const pg = new ScoringEngine('postgresql').calculate({ ha_topology: 'none' }, {});
    assert.equal(fired(pg).filter(r => r.startsWith('PG-CR-HA')).length, 0);
    const or = new ScoringEngine('oracle').calculate({ dr_topology: 'none' }, {});
    assert.equal(fired(or).filter(r => r.startsWith('OR-CR-DR')).length, 0);
  });
});

describe('future-proofing', () => {
  it('PG: upgrade plan declared while 3+ majors behind is zeroed', () => {
    const res = new ScoringEngine('postgresql').calculate(
      { upgrade_plan: 'yes', versions_behind: 4 }, {});
    assert.ok(zeroedBy(res, 'upgrade_plan').includes('PG-CR-FUT-1'));
  });

  it('Oracle: upgrade plan declared while patching is a year stale is zeroed', () => {
    const res = new ScoringEngine('oracle').calculate(
      { upgrade_plan: true, latest_patch: 18 }, {});
    assert.ok(zeroedBy(res, 'upgrade_plan').includes('OR-CR-FUT-1'));
  });
});
