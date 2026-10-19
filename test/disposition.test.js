'use strict';

/**
 * Disposition (1.15.0): an unresolved critical problem is reported beside the
 * score, never only through the numeric band. Cases are the adoption review's
 * reproductions (2026-09-04) on the healthy PostgreSQL sample: each keeps an
 * "excellent" total while a critical requirement is open.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const ScoringEngine = require('../src/scoring/engine');

const healthy = require('../data/samples/postgresql-healthy.json');
const ctx = { systemFacts: healthy.systemFacts, workloadProfile: healthy.workloadProfile };

function score(overrides) {
  return new ScoringEngine('postgresql').calculate({ ...healthy.values, ...overrides }, ctx);
}

describe('disposition', () => {
  it('is clear on the healthy sample', () => {
    const r = score({});
    assert.equal(r.disposition.state, 'clear');
    assert.deepEqual(r.disposition.items, []);
  });

  it('reports a failed critical metric whose score would still reach the excellent band', () => {
    const r = score({ autovacuum_health: 'off' });
    // Since 1.16.0 a missed required check caps the status at good
    // (excellent-means-on-target decision); the disposition still names it.
    assert.ok(r.totalPercentage >= 90);
    assert.equal(r.status, 'good');
    assert.equal(r.disposition.state, 'critical_unresolved');
    assert.deepEqual(r.disposition.items.map(i => [i.id, i.reason]), [['CAP-3.1', 'failed']]);
  });

  it('reports a critical metric that did not reach full points', () => {
    const r = score({ connection_usage_pct: 100 });
    assert.equal(r.disposition.state, 'critical_unresolved');
    assert.deepEqual(r.disposition.items.map(i => [i.id, i.reason]), [['CAP-2.1', 'failed']]);
  });

  it('reports a missing critical metric', () => {
    const values = { ...healthy.values };
    delete values.autovacuum_health;
    const r = new ScoringEngine('postgresql').calculate(values, ctx);
    assert.ok(r.disposition.items.some(i => i.id === 'CAP-3.1' && i.reason === 'missing'));
  });

  it('reports a critical rule once, with the declaration it invalidates, and clears when the target is relaxed', () => {
    const r = score({ database_size: 1024, ha_topology: 'none', rto_target: 'rto_5' });
    assert.equal(r.disposition.state, 'critical_unresolved');
    assert.equal(r.disposition.items.length, 1, 'one problem, one item');
    const [item] = r.disposition.items;
    assert.equal(item.kind, 'rule');
    assert.equal(item.id, 'PG-CR-RTO-3');
    assert.deepEqual(item.invalidates, ['BAK-4.2']);

    const relaxed = score({ database_size: 1024, ha_topology: 'none', rto_target: 'rto_1440' });
    assert.equal(relaxed.disposition.state, 'clear');
  });

  it('lists critical metrics that were never assessed, without calling them failed', () => {
    const r = score({});
    assert.equal(r.disposition.state, 'clear', 'clear covers assessed metrics only');
    assert.deepEqual(r.disposition.unassessed.map(u => [u.id, u.reason]), [['CAP-1.7', 'mode']],
      'the standalone run never assesses the agent-only disk usage');
    const agent = new ScoringEngine('postgresql').calculate(healthy.values, {
      ...ctx, mode: 'agent', availableSources: ['sql', 'manual', 'zabbix', 'worker'],
    });
    assert.deepEqual(agent.disposition.unassessed, []);
  });

  it('reports a failed critical and the critical rule it triggers as two problems', () => {
    // archive_mode off fails the critical BAK-1.1 naturally; with an aggressive
    // RPO and no WAL transport, PG-CR-RPO-2 fires and invalidates rpo_target.
    const r = score({ archive_mode: 'off', rpo_target: 'rpo_5', streaming_status: false });
    assert.deepEqual(r.disposition.items.map(i => [i.id, i.reason]), [['BAK-1.1', 'failed'], ['PG-CR-RPO-2', 'rule']]);
    assert.deepEqual(r.disposition.items[1].invalidates, ['BAK-4.1']);
  });
});

describe('disposition on a synthetic catalog', () => {
  const { MetricCatalog } = require('../src');
  const metric = (over) => ({
    subcategory: 's', description: '', weight: null, sources: ['sql'], agent_only: false,
    deployment_profiles: null, min_pg_version: null, extension_requirement: null, metric_tier: 'baseline', remediation: '',
    ...over,
  });
  function engineFor(metrics, rules = []) {
    const engine = new ScoringEngine();
    engine.catalog = MetricCatalog.fromData('test', {
      version: '1.0.0',
      pillars: { p: { name: 'P', maxPoints: 20, order: 1 } },
      subcategories: { s: { pillar: 'p', name: 'S', maxPoints: 20, order: 1 } },
      metrics,
      consistency_rules: rules,
    });
    return engine;
  }

  it('keeps the rule ids on a critical metric that failed and was also zeroed by a rule', () => {
    const engine = engineFor(
      [metric({ metric_id: 'T-1', legacy_name: 'lag', display_name: 'Lag', criticality: 'critical', evaluation_type: 'threshold', evaluation_config: { max: 10 } })],
      [{ rule_id: 'T-CR-1', title: 'Lag rule', applies_when: { metric: 'lag', gt: 50 },
        on_violation: { severity: 'warning', score_adjustments: [{ type: 'metric_zero', target: 'lag' }] } }],
    );
    const r = engine.calculate({ lag: 100 });
    assert.deepEqual(r.disposition.items, [{ kind: 'metric', id: 'T-1', name: 'Lag', pillar: 'p', reason: 'failed', rules: ['T-CR-1'] }]);
  });

  it('reports unresolved, not failed, when the system fact a critical bound needs is missing', () => {
    const engine = engineFor([metric({
      metric_id: 'T-1', legacy_name: 'mem', display_name: 'Mem', criticality: 'critical',
      evaluation_type: 'threshold', evaluation_config: { max_pct: 40, max_pct_of: 'ram_bytes' },
    })]);
    const r = engine.calculate({ mem: 1000 });
    assert.deepEqual(r.disposition.items.map(i => [i.id, i.reason]), [['T-1', 'unresolved']]);
  });
});
