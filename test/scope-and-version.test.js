'use strict';

/**
 * 1.15.0 (adoption review 2026-09-04):
 * - coverage reports the collection scope, so a SQL-only run that scores
 *   89 of 89 no longer reads as a complete assessment;
 * - version filtering works for every technology with a version field, not
 *   only PostgreSQL (serverVersion, pgVersion kept as its alias).
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { ScoringEngine, getCatalog } = require('../src');

const healthy = require('../data/samples/postgresql-healthy.json');
const ctx = { systemFacts: healthy.systemFacts, workloadProfile: healthy.workloadProfile };

describe('coverage collection scope', () => {
  it('labels a SQL-only run partial and names the critical metrics it never assessed', () => {
    const sqlValues = {};
    for (const m of getCatalog('postgresql').getActiveMetrics({ availableSources: ['sql'] })) {
      if (healthy.values[m.legacy_name] !== undefined) sqlValues[m.legacy_name] = healthy.values[m.legacy_name];
    }
    const r = new ScoringEngine('postgresql').calculate(sqlValues, { ...ctx, availableSources: ['sql'] });
    assert.equal(r.coverage.percentage, 100, 'the percentage keeps its meaning');
    assert.equal(r.coverage.collectionScope, 'partial');
    assert.ok(r.coverage.outOfScope.critical.includes('BAK-4.2'), 'a manual critical declaration is out of scope');
    assert.equal(r.coverage.outOfScope.count, r.coverage.outOfScope.metricIds.length);
  });

  it('labels an agent run with every source full', () => {
    const r = new ScoringEngine('postgresql').calculate(healthy.values, {
      ...ctx, mode: 'agent', availableSources: ['sql', 'manual', 'zabbix', 'worker'],
    });
    assert.equal(r.coverage.collectionScope, 'full');
    assert.equal(r.coverage.outOfScope.count, 0);
  });

  it('does not count metrics excluded for version as out of scope', () => {
    const cat = getCatalog('postgresql');
    const opts = { serverVersion: 150000, availableSources: ['sql', 'manual'] };
    const versionExcluded = cat.metrics.filter(m => m.min_pg_version && m.min_pg_version > 150000).map(m => m.metric_id);
    assert.ok(versionExcluded.length > 0);
    const scope = cat.getScopeExcludedMetrics(opts).map(m => m.metric_id);
    for (const id of versionExcluded) assert.ok(!scope.includes(id), `${id} is not applicable, not out of scope`);
  });
});

describe('version filtering for every technology', () => {
  it('drops MySQL 8.0 metrics on a 5.7 server and keeps them on 8.0', () => {
    const cat = getCatalog('mysql');
    const needs80 = cat.metrics.filter(m => m.min_mysql_version === '8.0').map(m => m.metric_id);
    assert.ok(needs80.length > 0);
    const on57 = cat.getActiveMetrics({ serverVersion: '5.7.44' }).map(m => m.metric_id);
    const on80 = cat.getActiveMetrics({ serverVersion: '8.0.35' }).map(m => m.metric_id);
    for (const id of needs80) {
      assert.ok(!on57.includes(id), `${id} dropped on 5.7`);
      assert.ok(on80.includes(id), `${id} kept on 8.0`);
    }
  });

  it('reads MariaDB versions from the MariaDB field and ignores a stray MySQL field', () => {
    const cat = getCatalog('mariadb');
    const stray = cat.metrics.find(m => m.min_mysql_version && !m.min_mariadb_version);
    assert.ok(stray, 'the catalog carries one metric with only a MySQL version field');
    const on103 = cat.getActiveMetrics({ serverVersion: '10.3.39' }).map(m => m.metric_id);
    assert.ok(on103.includes(stray.metric_id), 'a MySQL 8.0 field does not filter a MariaDB server');
    assert.ok(!on103.includes('SEC-1.2'), 'SEC-1.2 needs MariaDB 10.4');
    const on106 = cat.getActiveMetrics({ serverVersion: '10.6.12-MariaDB' }).map(m => m.metric_id);
    assert.ok(on106.includes('SEC-1.2'));
  });

  it('keeps pgVersion as the PostgreSQL alias and echoes the version used', () => {
    const cat = getCatalog('postgresql');
    assert.deepEqual(
      cat.getActiveMetrics({ pgVersion: 150000 }).map(m => m.metric_id),
      cat.getActiveMetrics({ serverVersion: 150000 }).map(m => m.metric_id),
    );
    const r = new ScoringEngine('postgresql').calculate(healthy.values, { ...ctx, pgVersion: 170000 });
    assert.equal(r.context.serverVersion, 170000);
  });
});

describe('scope and version edge cases (1.15.0 gate)', () => {
  it('keeps an out-of-scope metric whose applies_when reads a value that was never collected', () => {
    const oracle = require('../data/samples/oracle-healthy.json');
    const values = { ...oracle.values };
    delete values.asm_diskgroup_usage;
    const r = new ScoringEngine('oracle').calculate(values, {
      systemFacts: oracle.systemFacts, workloadProfile: oracle.workloadProfile, licensedOptions: oracle.licensedOptions,
      availableSources: ['manual'],
    });
    assert.ok(r.coverage.outOfScope.critical.includes('CAP-1.2'), 'guarded on its own presence, unknown when not collected');
    assert.equal(r.coverage.outOfScope.byReason.source, r.coverage.outOfScope.count - r.coverage.outOfScope.byReason.mode);
  });

  it('splits out-of-scope metrics by reason', () => {
    const r = new ScoringEngine('postgresql').calculate(healthy.values, ctx);
    assert.deepEqual(r.coverage.outOfScope.byReason, { mode: r.coverage.outOfScope.count, source: 0 },
      'a standalone run with sql and manual only misses agent-only metrics');
  });

  it('never drops metrics on a version it cannot read or compare', () => {
    const pg = getCatalog('postgresql');
    const all = pg.getActiveMetrics({}).length;
    assert.equal(pg.getActiveMetrics({ pgVersion: 'PostgreSQL 17.2' }).length, all, 'text prefix');
    assert.equal(pg.getActiveMetrics({ serverVersion: '17.2' }).length, all, 'dotted against server_version_num');
    const my = getCatalog('mysql');
    assert.equal(my.getActiveMetrics({ serverVersion: 'v5.7' }).length, my.getActiveMetrics({}).length);
  });

  it('an empty serverVersion does not mask a valid pgVersion', () => {
    const pg = getCatalog('postgresql');
    assert.deepEqual(
      pg.getActiveMetrics({ serverVersion: '', pgVersion: 150000 }).map(m => m.metric_id),
      pg.getActiveMetrics({ pgVersion: 150000 }).map(m => m.metric_id),
    );
    const r = new ScoringEngine('postgresql').calculate(healthy.values, { ...ctx, serverVersion: '', pgVersion: 150000 });
    assert.equal(r.context.serverVersion, 150000);
  });
});
