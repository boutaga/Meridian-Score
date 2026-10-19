'use strict';

/**
 * PostgreSQL BAK-1.7 archive_timeout and rule PG-CR-RPO-3 (2026-09-25, DEC-021).
 * With WAL archiving and no standby streaming, the unarchived WAL segment is
 * the data at risk; archive_timeout is what bounds its age on a quiet
 * database. The metric is banded by the declared RPO; the rule invalidates a
 * 5- or 15-minute RPO declaration the setting does not bound. A standby is
 * detected as PER-4.1 does (streaming_status or ha_standby_count), and an
 * unknown standby state never invalidates the declaration.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const ScoringEngine = require('../src/scoring/engine');
const { SCORING_POLICY } = require('../src/scoring/policy');

const healthy = require('../data/samples/postgresql-healthy.json');
const ctx = { systemFacts: healthy.systemFacts, workloadProfile: healthy.workloadProfile };
const HALF = SCORING_POLICY.partialCredit.factor;

function metric(result, id) {
  return result.allMetrics.find(m => m.metric_id === id);
}

function finding(result) {
  return result.allFindings.find(f => f.rule_id === 'PG-CR-RPO-3');
}

// Archiving on, standby state collected and negative: the case the metric and
// the rule judge. The healthy sample declares standbys, so reset both signals.
function score(overrides) {
  return new ScoringEngine('postgresql').calculate(
    { ...healthy.values, archive_mode: 'on', streaming_status: false, ha_standby_count: 0, ...overrides }, ctx);
}

describe('BAK-1.7 archive_timeout against the declared RPO', () => {
  it('fails 0 under a five-minute RPO with archiving and no standby', () => {
    const m = metric(score({ rpo_target: 'rpo_5', archive_timeout: 0 }), 'BAK-1.7');
    assert.equal(m.score, 0, '0 is never inside the partial band');
    assert.match(m.derivation, /declared rpo_target=rpo_5/);
  });

  it('passes 1, 120 and 300 seconds under a five-minute RPO', () => {
    for (const v of [1, 120, 300]) {
      const m = metric(score({ rpo_target: 'rpo_5', archive_timeout: v }), 'BAK-1.7');
      assert.equal(m.score, m.maxScore, `${v} seconds`);
    }
  });

  it('gives exactly half credit from 301 to 600 seconds under a five-minute RPO, nothing beyond', () => {
    for (const v of [301, 600]) {
      const m = metric(score({ rpo_target: 'rpo_5', archive_timeout: v }), 'BAK-1.7');
      assert.equal(m.score, m.maxScore * HALF, `${v} seconds`);
    }
    assert.equal(metric(score({ rpo_target: 'rpo_5', archive_timeout: 601 }), 'BAK-1.7').score, 0);
  });

  it('passes 900 and gives half credit to 901 seconds under a fifteen-minute RPO', () => {
    const edge = metric(score({ rpo_target: 'rpo_15', archive_timeout: 900 }), 'BAK-1.7');
    assert.equal(edge.score, edge.maxScore);
    const over = metric(score({ rpo_target: 'rpo_15', archive_timeout: 901 }), 'BAK-1.7');
    assert.equal(over.score, over.maxScore * HALF);
  });

  it('fails 0 under a four-hour RPO, passes 14400, and passes any value under a daily RPO', () => {
    assert.equal(metric(score({ rpo_target: 'rpo_240', archive_timeout: 0 }), 'BAK-1.7').score, 0);
    const edge = metric(score({ rpo_target: 'rpo_240', archive_timeout: 14400 }), 'BAK-1.7');
    assert.equal(edge.score, edge.maxScore);
    for (const v of [0, 86400]) {
      const daily = metric(score({ rpo_target: 'rpo_1440', archive_timeout: v }), 'BAK-1.7');
      assert.equal(daily.score, daily.maxScore, `daily RPO, ${v} seconds`);
    }
  });

  it('passes any value when a standby streams or is counted', () => {
    for (const standby of [{ streaming_status: true }, { ha_standby_count: 2 }]) {
      for (const v of [0, 86400]) {
        const m = metric(score({ rpo_target: 'rpo_5', archive_timeout: v, ...standby }), 'BAK-1.7');
        assert.equal(m.score, m.maxScore, `${JSON.stringify(standby)}, ${v} seconds`);
        assert.match(m.derivation, /unless condition holds/);
      }
    }
  });

  it('still applies the bands when the standby state was not collected (advisory, unlike the rule)', () => {
    const values = { ...healthy.values, rpo_target: 'rpo_5', archive_mode: 'on', archive_timeout: 0 };
    delete values.streaming_status;
    delete values.ha_standby_count;
    const r = new ScoringEngine('postgresql').calculate(values, ctx);
    assert.equal(metric(r, 'BAK-1.7').score, 0);
    assert.equal(finding(r), undefined, 'the rule never fires on an unknown standby state');
  });

  it('passes any value when no RPO is declared', () => {
    for (const v of [0, 86400]) {
      const values = { ...healthy.values, archive_mode: 'on', streaming_status: false, ha_standby_count: 0, archive_timeout: v };
      delete values.rpo_target;
      const m = metric(new ScoringEngine('postgresql').calculate(values, ctx), 'BAK-1.7');
      assert.equal(m.score, m.maxScore, `${v} seconds`);
    }
  });

  it('is not scored when archiving is off', () => {
    const m = metric(score({ rpo_target: 'rpo_5', archive_mode: 'off', archive_timeout: 0 }), 'BAK-1.7');
    assert.equal(m.applicable, false);
  });

  it('reports an uncollected archive_timeout as not assessed, and the rule never fires on it (1.17.0)', () => {
    const values = { ...healthy.values, rpo_target: 'rpo_5', archive_mode: 'on', streaming_status: false, ha_standby_count: 0 };
    delete values.archive_timeout;
    const r = new ScoringEngine('postgresql').calculate(values, ctx);
    assert.equal(metric(r, 'BAK-1.7').scored, false, 'an uncollected archive_timeout is not scored');
    assert.equal(finding(r), undefined, 'the rule never fires on a missing value');
    // Absolute target (1.17.0): it stays on the ruler at 0 points, is listed
    // as missing, and its points are reported as not assessed.
    assert.deepEqual(r.requiredMissed.filter((m) => m.id === 'BAK-1.7').map((m) => m.reason), ['missing']);
    assert.ok(r.subcategories[metric(r, 'BAK-1.7').subcategory].pointsNotAssessed > 0);
  });
});

describe('PG-CR-RPO-3 links archive_timeout to an aggressive RPO', () => {
  it('fires on 0 under a five-minute RPO and zeroes the declaration', () => {
    const r = score({ rpo_target: 'rpo_5', archive_timeout: 0 });
    const f = finding(r);
    assert.ok(f, 'rule fires');
    assert.equal(f.severity, 'warning');
    assert.equal(metric(r, 'BAK-4.1').score, 0, 'rpo_target earns no points');
  });

  it('fires just above the bound and stays silent on it', () => {
    assert.ok(finding(score({ rpo_target: 'rpo_5', archive_timeout: 301 })));
    assert.equal(finding(score({ rpo_target: 'rpo_5', archive_timeout: 300 })), undefined);
    assert.ok(finding(score({ rpo_target: 'rpo_15', archive_timeout: 901 })));
    assert.equal(finding(score({ rpo_target: 'rpo_15', archive_timeout: 900 })), undefined);
  });

  it('stays silent with a standby streaming or counted, and on looser RPOs', () => {
    assert.equal(finding(score({ rpo_target: 'rpo_5', archive_timeout: 0, streaming_status: true })), undefined);
    assert.equal(finding(score({ rpo_target: 'rpo_5', archive_timeout: 0, ha_standby_count: 1 })), undefined);
    assert.equal(finding(score({ rpo_target: 'rpo_60', archive_timeout: 0 })), undefined);
  });

  it('stays silent when the standby state was not collected', () => {
    const values = { ...healthy.values, rpo_target: 'rpo_5', archive_mode: 'on', archive_timeout: 0 };
    delete values.streaming_status;
    delete values.ha_standby_count;
    assert.equal(finding(new ScoringEngine('postgresql').calculate(values, ctx)), undefined);
  });

  it('fires when only one standby signal was collected and it is negative', () => {
    for (const drop of ['streaming_status', 'ha_standby_count']) {
      const values = { ...healthy.values, rpo_target: 'rpo_5', archive_mode: 'on', archive_timeout: 0, streaming_status: false, ha_standby_count: 0 };
      delete values[drop];
      assert.ok(finding(new ScoringEngine('postgresql').calculate(values, ctx)), `without ${drop}`);
    }
  });

  it('lists the invalidated RPO declaration as an open critical (Adrien, 2026-09-25)', () => {
    const r = score({ rpo_target: 'rpo_5', archive_timeout: 0 });
    assert.equal(r.disposition.state, 'critical_unresolved');
    const item = r.disposition.items.find(i => i.id === 'BAK-4.1');
    assert.equal(item.reason, 'invalidated');
    assert.deepEqual(item.rules, ['PG-CR-RPO-3']);
  });
});
