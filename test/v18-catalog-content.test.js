'use strict';

/**
 * v1.8.0 catalog-content tests — exercise the new PG/Oracle catalog mechanisms
 * against the REAL shipped catalogs (not synthetic fixtures):
 *   - R1 W-1 fractional weight overrides (9 PG capture metrics -> 0.5)
 *   - R3 PG-CR-RPO-2 (metric_zero + subcategory_cap composition)
 *   - R3 PG-CR-CONN-LOCK-1 (multi subcategory_deduction)
 *   - R2 C-5 edition fail-closed gate (Oracle awr_enabled)
 *   - R2 C-4 + C-15 TDE: metric carries the critical, OR-CR-TDE-1 is findings-only
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { getCatalog } = require('../src');
const ScoringEngine = require('../src/scoring/engine');

describe('v1.8.0 PostgreSQL — W-1 fractional weight overrides', () => {
  it('the nine capture metrics carry an effective weight of 0.5', () => {
    const cat = getCatalog('postgresql');
    const W1 = [
      'database_size', 'sync_standby', 'shared_buffers_bytes', 'intelligent_tuning',
      'jit', 'work_mem_bytes', 'max_connections',
      'synchronous_standby_names_count', 'synchronous_standby_names',
    ];
    for (const ln of W1) {
      const m = cat.metrics.find(x => x.legacy_name === ln);
      assert.ok(m, `${ln} present in catalog`);
      assert.equal(m.criticality, 'advisory', `${ln} stays advisory`);
      assert.equal(cat.getEffectiveWeight(m), 0.5, `${ln} effective weight is 0.5`);
    }
  });
});

describe('v1.8.0 PostgreSQL — PG-CR-RPO-2 (metric_zero + cap)', () => {
  it('zeroes rpo_target and caps backup_recovery when the declared RPO is unachievable', () => {
    const engine = new ScoringEngine('postgresql');
    // rpo_5 declared, archive_mode off, no streaming standby -> RPO has no basis.
    const result = engine.calculate({ rpo_target: 'rpo_5', archive_mode: 'off', streaming_status: false });

    const finding = result.allFindings.find(f => f.rule_id === 'PG-CR-RPO-2');
    assert.ok(finding, 'PG-CR-RPO-2 fires');
    assert.equal(finding.severity, 'critical');

    // Both adjustments recorded in application order (metric_zero then cap).
    assert.equal(finding.score_movement, undefined, 'plural form, no singular field');
    assert.deepEqual(finding.score_movements.map(m => m.type), ['metric_zero', 'subcategory_cap']);

    const rpo = result.allMetrics.find(m => m.name === 'rpo_target');
    assert.ok(rpo.zeroed_by_rules.includes('PG-CR-RPO-2'), 'rpo_target zeroed by the rule');
  });

  it('does not fire when a streaming standby is present (none_of guard)', () => {
    const engine = new ScoringEngine('postgresql');
    const result = engine.calculate({ rpo_target: 'rpo_5', archive_mode: 'off', streaming_status: true });
    assert.ok(!result.allFindings.some(f => f.rule_id === 'PG-CR-RPO-2'),
      'replication presence exempts the RPO claim from zeroing');
  });
});

describe('v1.8.0 PostgreSQL — PG-CR-CONN-LOCK-1 (multi-deduction)', () => {
  it('deducts from both capacity_connections and perf_locks on saturation', () => {
    const engine = new ScoringEngine('postgresql');
    const result = engine.calculate({ connection_usage_pct: 98, blocked_queries: 25 });

    const finding = result.allFindings.find(f => f.rule_id === 'PG-CR-CONN-LOCK-1');
    assert.ok(finding, 'PG-CR-CONN-LOCK-1 fires');
    assert.deepEqual(finding.score_movements.map(m => m.target), ['capacity_connections', 'perf_locks']);
  });

  it('does not fire below either threshold', () => {
    const engine = new ScoringEngine('postgresql');
    const result = engine.calculate({ connection_usage_pct: 98, blocked_queries: 2 });
    assert.ok(!result.allFindings.some(f => f.rule_id === 'PG-CR-CONN-LOCK-1'));
  });
});

describe('v1.5.0 Oracle — license gate (awr_enabled -> diagnostic_pack)', () => {
  const base = {
    awr_enabled: false, wallet_status: 'OPEN', tde_encrypted_tablespaces: 0,
    dataguard_configured: false, multitenant_architecture: false,
  };
  const applicableOf = (result, ln) => {
    const e = result.allMetrics.find(m => m.name === ln);
    return e ? e.applicable : 'MISSING';
  };

  it('awr_enabled is applicable when the Diagnostics Pack is licensed', () => {
    const r = new ScoringEngine('oracle').calculate(base, { systemFacts: { edition: 'enterprise' }, licensedOptions: ['diagnostic_pack'] });
    assert.notEqual(applicableOf(r, 'awr_enabled'), false, 'diagnostic_pack -> applicable');
  });

  it('awr_enabled is NOT applicable on EE without the Diagnostics Pack (no penalty)', () => {
    const r = new ScoringEngine('oracle').calculate(base, { systemFacts: { edition: 'enterprise' } });
    assert.equal(applicableOf(r, 'awr_enabled'), false, 'EE but no pack -> not applicable');
  });

  it('awr_enabled is NOT applicable on Standard edition (no SE2 penalty)', () => {
    const r = new ScoringEngine('oracle').calculate(base, { systemFacts: { edition: 'standard' } });
    assert.equal(applicableOf(r, 'awr_enabled'), false, 'SE -> not applicable');
  });
});

describe('v1.8.0 Oracle — TDE carries the critical, OR-CR-TDE-1 is findings-only', () => {
  it('wallet_status is the conditional-critical carrier when TDE is in use', () => {
    const r = new ScoringEngine('oracle').calculate(
      { tde_encrypted_tablespaces: 3, wallet_status: 'CLOSED' },
      { systemFacts: { edition: 'enterprise' } });
    const wallet = r.allMetrics.find(m => m.name === 'wallet_status');
    assert.notEqual(wallet.applicable, false, 'TDE in use -> wallet_status applies');
    assert.equal(wallet.scored, true);
  });

  it('OR-CR-TDE-1 fires as findings-only (no score movement) — no double count', () => {
    const r = new ScoringEngine('oracle').calculate(
      { tde_encrypted_tablespaces: 3, wallet_status: 'CLOSED' },
      { systemFacts: { edition: 'enterprise' } });
    const finding = r.allFindings.find(f => f.rule_id === 'OR-CR-TDE-1');
    assert.ok(finding, 'OR-CR-TDE-1 still annotates the condition');
    assert.equal(finding.score_movement, undefined, 'findings-only: no singular movement');
    assert.ok(!finding.score_movements || finding.score_movements.length === 0,
      'findings-only: no plural movements');
  });

  it('wallet_status is not applicable on a non-TDE estate', () => {
    const r = new ScoringEngine('oracle').calculate(
      { tde_encrypted_tablespaces: 0, wallet_status: 'CLOSED' },
      { systemFacts: { edition: 'enterprise' } });
    const wallet = r.allMetrics.find(m => m.name === 'wallet_status');
    assert.equal(wallet.applicable, false, 'no TDE -> wallet_status not applicable');
  });
});
