'use strict';

/**
 * PG catalog v1.10.0 content lock — P0 production-relevance corrections.
 * From the catalog assessment of 2026-07-14.
 * Asserts the corrected thresholds, the new applicability gates, the
 * profile-keyed PER-2.14, the PG-CR-SECPOST-3 rule, and the metadata fixes.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const ScoringEngine = require('../src/scoring/engine');
const { getCatalog } = require('../src');

const cat = getCatalog('postgresql');
const metric = (id) => cat.metrics.find(m => m.metric_id === id);

describe('v1.10.0 PG catalog — threshold corrections', () => {
  it('PER-1.2 shared_buffers pass band capped at 40% RAM', () => {
    const m = metric('PER-1.2');
    assert.equal(m.evaluation_config.min, 20);
    assert.equal(m.evaluation_config.max, 40);
  });

  it('PER-3.2 tolerates up to 2 deadlocks per 24h', () => {
    assert.equal(metric('PER-3.2').evaluation_config.max, 2);
  });

  it('FUT-1.1 current-major floor is 16 (latest-minus-2, PG 18 latest)', () => {
    const m = metric('FUT-1.1');
    assert.equal(m.evaluation_config.min, 16);
    assert.equal(m.criticality, 'critical');
  });

  it('CAP-3.12 autovacuum cost limit floor raised to 1000', () => {
    assert.equal(metric('CAP-3.12').evaluation_config.min, 1000);
  });

  it('FUT-2.1 checkpoint_timeout min 900s, downgraded to advisory', () => {
    const m = metric('FUT-2.1');
    assert.equal(m.evaluation_config.min, 900);
    assert.equal(m.criticality, 'advisory');
  });
});

describe('v1.10.0 PG catalog — applicability gates', () => {
  it('PER-2.10 applies only up to PG 17 (PG 18 AIO covered by PER-1.6)', () => {
    const m = metric('PER-2.10');
    assert.deepEqual(m.applies_when, { metric: 'pg_version', lte: 17 });
  });

  it('CAP-2.3 applies only when no connection pooler is declared', () => {
    const m = metric('CAP-2.3');
    assert.deepEqual(m.applies_when, { metric: 'connection_pooler', is_truthy: false });
  });

  it('engine excludes CAP-2.3 on pooled instances and scores it on unpooled ones', () => {
    const engine = new ScoringEngine('postgresql');
    const base = { connection_pooler: true, idle_connections: 70 };
    const pooled = engine.calculate(base, { workloadProfile: 'mixed' });
    const pooledMetric = pooled.allMetrics.find(m => m.name === 'idle_connections');
    assert.equal(pooledMetric.applicable, false);
    assert.equal(pooledMetric.exclusion_reason, 'applies_when');

    const unpooled = engine.calculate({ connection_pooler: false, idle_connections: 70 },
      { workloadProfile: 'mixed' });
    const unpooledMetric = unpooled.allMetrics.find(m => m.name === 'idle_connections');
    assert.equal(unpooledMetric.scored, true);
    assert.notEqual(unpooledMetric.applicable, false);
    assert.equal(unpooledMetric.exclusion_reason, undefined);
  });

  it('engine excludes PER-2.10 on PG 18 and scores it on PG 17', () => {
    const engine = new ScoringEngine('postgresql');
    const pg18 = engine.calculate({ pg_version: 18, effective_io_concurrency: 16 },
      { workloadProfile: 'mixed' });
    const m18 = pg18.allMetrics.find(m => m.name === 'effective_io_concurrency');
    assert.equal(m18.applicable, false);

    const pg17 = engine.calculate({ pg_version: 17, effective_io_concurrency: 150 },
      { workloadProfile: 'mixed' });
    const m17 = pg17.allMetrics.find(m => m.name === 'effective_io_concurrency');
    assert.equal(m17.scored, true);
    assert.equal(m17.score, m17.maxScore);
  });
});

describe('v1.10.0 PG catalog — profile-keyed PER-2.14', () => {
  it('oltp profile is capture-only (min 0), others require 2', () => {
    const p = metric('PER-2.14').evaluation_config.profiles;
    assert.equal(p.oltp.min, 0);
    assert.equal(p.default.min, 2);
    assert.equal(p.olap.min, 2);
    assert.equal(p.mixed.min, 2);
  });
});

describe('v1.10.0 PG catalog — PG-CR-SECPOST-3 (regulated log retention)', () => {
  const engine = new ScoringEngine('postgresql');
  const zeroedBy = (result, name) => {
    const m = result.allMetrics.find(x => x.name === name);
    return m && m.score === 0 && m.scored;
  };

  it('fires on regulated posture with 200d retention and zeroes the retention metric', () => {
    const r = engine.calculate({ security_posture: 'regulated', log_retention_days: 200 },
      { workloadProfile: 'mixed' });
    const fired = r.allFindings.some(f => f.kind === 'consistency' && /log retention/i.test(f.title));
    assert.ok(fired, 'SECPOST-3 finding expected');
    assert.ok(zeroedBy(r, 'log_retention_days'), 'log_retention_days must earn 0');
  });

  it('stays silent for hardened posture, compliant retention, or unattested retention', () => {
    const cases = [
      { security_posture: 'hardened', log_retention_days: 200 },
      { security_posture: 'regulated', log_retention_days: 365 },
      { security_posture: 'regulated' },
    ];
    for (const values of cases) {
      const r = engine.calculate(values, { workloadProfile: 'mixed' });
      const fired = r.allFindings.some(f => f.kind === 'consistency' && /log retention/i.test(f.title));
      assert.equal(fired, false, `must not fire for ${JSON.stringify(values)}`);
    }
  });
});

describe('v1.10.0 PG catalog — metadata fixes', () => {
  it('PER-2.19 min_pg_version uses server_version_num format', () => {
    assert.equal(metric('PER-2.19').min_pg_version, 120000);
  });

  it('CHK-PER-2 carries the 0.5 capture weight', () => {
    assert.equal(metric('CHK-PER-2').weight, 0.5);
  });

  it('catalog is on the v1.11.x line or later, targeting PG 18', () => {
    const raw = require('../data/metrics/postgresql.json');
    const [major, minor] = raw.version.split('.').map(Number);
    assert.ok(major === 1 && minor >= 11, `expected 1.11.x or later, got ${raw.version}`);
    assert.equal(raw.technology_version, '18');
  });

  it('SEC CIS references follow CIS PostgreSQL 16 v1.0.0 numbering', () => {
    const expected = {
      'SEC-1.1': 'CIS 5.2',
      'SEC-1.2': 'CIS 5.2',
      'SEC-1.3': 'CIS 5.2',
      'SEC-1.5': 'CIS 5.3',
      'SEC-1.6': 'CIS 5.2',
      'SEC-2.1': 'CIS 6.8',
      'SEC-2.2': 'CIS 6.8',
      'SEC-2.3': 'CIS 6.8',
      'SEC-3.1': 'CIS 3.1.20',
      'SEC-3.2': 'CIS 3.1.21',
      'SEC-3.3': 'CIS 3.1.25',
      'SEC-3.4': 'CIS 3.2',
      'SEC-4.1': 'CIS 4.4',
      'SEC-4.2': 'CIS 4.2',
      'SEC-4.3': 'CIS 4.7',
      'SEC-4.4': 'CIS 4.5',
    };
    for (const [id, ref] of Object.entries(expected)) {
      assert.equal(metric(id).cis_reference, ref, `${id} cis_reference`);
    }
  });
});
