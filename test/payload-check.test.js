'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { checkPayload } = require('../src/catalog/payload-check');

function sample(name) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'samples', name), 'utf8'));
}
function row(report, id) {
  return report.metrics.find(m => m.metric_id === id);
}
function byName(report, name) {
  return report.metrics.find(m => m.legacy_name === name);
}

describe('checkPayload', () => {
  it('reports the healthy PostgreSQL sample as clean', () => {
    const s = sample('postgresql-healthy.json');
    const r = checkPayload('postgresql', s.values, { systemFacts: s.systemFacts, workloadProfile: s.workloadProfile });
    assert.equal(r.counts.unparseable, 0);
    assert.equal(r.counts.criticalNotProvided, 0, JSON.stringify(r.metrics.filter(m => m.status === 'not_provided' && m.criticality === 'critical').map(m => m.metric_id)));
    assert.equal(r.counts.unknownKeys, 0);
    assert.ok(r.counts.ok > 100);
  });

  it('flags the prose autovacuum_health the checker emits as an enum mismatch on CAP-3.1', () => {
    const r = checkPayload('postgresql', { autovacuum_health: 'healthy' });
    assert.equal(row(r, 'CAP-3.1').status, 'enum_mismatch');
  });

  it('flags the file-count string the checker emits for temp_file_usage as unparseable on PER-2.9', () => {
    const r = checkPayload('postgresql', { temp_file_usage: '12 files (1 GB)' });
    assert.equal(row(r, 'PER-2.9').status, 'unparseable');
    assert.equal(r.counts.unparseable, 1);
  });

  it('flags a megabyte value against a bytes bound as unit suspect', () => {
    const catalog = {
      version: 't', pillars: { backup: { name: 'B', maxPoints: 20, order: 1 } },
      subcategories: { backup_wal: { pillar: 'backup', name: 'W', maxPoints: 20, order: 1 } },
      metrics: [{ metric_id: 'BAK-1.5', subcategory: 'backup_wal', legacy_name: 'redo_log_size', display_name: 'Redo', criticality: 'advisory', weight: null, evaluation_type: 'threshold', evaluation_config: { min: 536870912, unit: 'bytes' }, sources: ['sql'] }],
      consistency_rules: [],
    };
    const r = checkPayload('oracle', { redo_log_size: 512 }, { catalog });
    assert.equal(row(r, 'BAK-1.5').status, 'unit_suspect');
  });

  it('R-001: a bytes-sized redo_log_size against the shipped Oracle 1.9.0 catalog is unit suspect', () => {
    const r = checkPayload('oracle', { redo_log_size: 536870912 });
    const row = r.metrics.find(m => m.metric_id === 'BAK-1.5');
    assert.equal(row.status, 'unit_suspect');
    assert.match(row.detail, /min bound 512 \(mb\)/);
    const ok = checkPayload('oracle', { redo_log_size: 1024 });
    assert.equal(ok.metrics.find(m => m.metric_id === 'BAK-1.5').status, 'ok');
  });

  it('a percent above 100 is a legitimate value, a negative percent is not', () => {
    const r = checkPayload('postgresql', { connection_usage_pct: 240, xid_wraparound_pct: 150, dead_tuple_ratio: -5 });
    assert.equal(byName(r, 'connection_usage_pct').status, 'ok');
    assert.equal(byName(r, 'xid_wraparound_pct').status, 'ok');
    assert.equal(byName(r, 'dead_tuple_ratio').status, 'unit_suspect');
  });

  it('lists payload keys the catalog does not know and counts missing criticals', () => {
    const r = checkPayload('postgresql', { not_a_metric: 1 });
    assert.deepEqual(r.unknownKeys, ['not_a_metric']);
    assert.ok(r.counts.criticalNotProvided > 10);
    assert.equal(row(r, 'BAK-1.1').status, 'not_provided');
  });

  it('accepts boolean strings and non-empty checks', () => {
    const r = checkPayload('postgresql', { ssl_enabled: 'on', archive_mode: 'on', archive_command: '/usr/bin/cp %p /wal/%f' });
    assert.equal(byName(r, 'ssl_enabled').status, 'ok');
    assert.equal(byName(r, 'archive_command').status, 'ok');
  });

  it('reports inactive metrics as not applicable instead of not provided', () => {
    const s = sample('postgresql-healthy.json');
    const r = checkPayload('postgresql', s.values, { systemFacts: s.systemFacts, workloadProfile: s.workloadProfile });
    assert.equal(row(r, 'HA-1.1').status, 'not_applicable');
    assert.ok(r.counts.notApplicable > 0);
  });
});

describe('check-payload CLI forwards serverVersion (1.15.0 gate)', () => {
  it('drops a MySQL 8.0 critical on a 5.7 server instead of reporting it missing', () => {
    const os = require('os');
    const { spawnSync } = require('child_process');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'payload-'));
    const file = path.join(dir, 'mysql.json');
    fs.writeFileSync(file, JSON.stringify({ serverVersion: '5.7.44', values: {} }));
    const r = spawnSync(process.execPath, [path.resolve(__dirname, '../scripts/check-payload.js'), 'mysql', file], { encoding: 'utf8' });
    assert.doesNotMatch(r.stdout, /not_provided +SEC-1\.2 /, 'SEC-1.2 needs MySQL 8.0 and must not be expected from 5.7');
  });
});
