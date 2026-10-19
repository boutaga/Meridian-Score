'use strict';

/**
 * PostgreSQL BAK-2.2 last_backup_age_hours with WAL archiving (1.15.0,
 * adoption review 2026-09-04). A base backup plus archived WAL recovers far
 * past the backup time, so with archive_mode on the metric ignores the declared
 * RPO (by_declaration.unless) and keeps its 24-hour base-backup freshness bound.
 * The review's two cases: a daily backup with continuous WAL meets a short RPO;
 * a fresh backup with a failing WAL chain does not.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const ScoringEngine = require('../src/scoring/engine');
const { buildLookups, validateByDeclaration } = require('../src/catalog/validation');
const { getCatalog } = require('../src');

const healthy = require('../data/samples/postgresql-healthy.json');
// BAK-2.2 is agent-only (Zabbix or worker collection), so score in agent mode.
const ctx = {
  systemFacts: healthy.systemFacts, workloadProfile: healthy.workloadProfile,
  mode: 'agent', availableSources: ['sql', 'manual', 'zabbix', 'worker'],
};

function metric(result, id) {
  return result.allMetrics.find(m => m.metric_id === id);
}

function score(overrides) {
  return new ScoringEngine('postgresql').calculate({ ...healthy.values, ...overrides }, ctx);
}

describe('BAK-2.2 backup age with WAL archiving', () => {
  it('a daily base backup with continuous archiving meets a five-minute RPO', () => {
    const r = score({ rpo_target: 'rpo_5', archive_mode: 'on', last_backup_age_hours: 20, archive_failures: 0 });
    const m = metric(r, 'BAK-2.2');
    assert.equal(m.score, m.maxScore);
    assert.match(m.derivation, /unless condition holds/);
    assert.equal(metric(r, 'BAK-1.3').score, metric(r, 'BAK-1.3').maxScore);
  });

  it('a fresh base backup with a failing WAL chain fails the archive-failures check instead', () => {
    const r = score({ rpo_target: 'rpo_5', archive_mode: 'on', last_backup_age_hours: 0.05, archive_failures: 12 });
    assert.equal(metric(r, 'BAK-2.2').score, metric(r, 'BAK-2.2').maxScore, 'the base backup itself is fresh');
    assert.equal(metric(r, 'BAK-1.3').score, 0, 'the broken WAL chain fails archive failures');
    // BAK-1.3 is important, not critical: the declared RPO itself is not
    // invalidated by archive failures today (a question for the PostgreSQL TL).
  });

  it('applies the declared RPO when archive_mode was not collected', () => {
    const values = { ...healthy.values, rpo_target: 'rpo_5', last_backup_age_hours: 20 };
    delete values.archive_mode;
    const r = new ScoringEngine('postgresql').calculate(values, ctx);
    assert.equal(metric(r, 'BAK-2.2').score, 0, 'an unknown archive_mode never relaxes the bound');
    assert.match(metric(r, 'BAK-2.2').derivation, /declared rpo_target=rpo_5/);
  });

  it('without archiving the backup is the recovery point and must meet the declared RPO', () => {
    const r = score({ rpo_target: 'rpo_5', archive_mode: 'off', last_backup_age_hours: 20 });
    assert.equal(metric(r, 'BAK-2.2').score, 0);
    assert.match(metric(r, 'BAK-2.2').derivation, /declared rpo_target=rpo_5/);
  });

  it('keeps the 24-hour freshness bound when archiving is on', () => {
    const r = score({ rpo_target: 'rpo_5', archive_mode: 'on', last_backup_age_hours: 30 });
    const m = metric(r, 'BAK-2.2');
    assert.ok(m.score > 0 && m.score < m.maxScore, 'partial credit beyond 24 hours');
  });

  it('the validator walks the unless predicate', () => {
    const lookups = buildLookups(getCatalog('postgresql'));
    const errors = [];
    validateByDeclaration({
      metric_id: 'X-1',
      evaluation_config: { max: 24, by_declaration: { metric: 'rpo_target', bands: { default: { max: 24 } }, unless: { metric: 'no_such_metric', in: ['on'] } } },
    }, lookups, errors);
    assert.equal(errors.length, 1);
    assert.match(errors[0], /no_such_metric/);
  });
});
