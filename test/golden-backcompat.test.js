'use strict';

/**
 * Golden lock — deep-asserts the engine output on the curated PostgreSQL
 * samples. The fired set, finding order, and all scores must be byte-identical
 * to the baseline captured here.
 *
 * Re-baselined for the v1.8.0 catalog release (PG v1.8.0): R1 reweighting
 * (budgets, PER-4.1 critical+applies_when, SEC-2.2/BAK-1.2 gates, 9 weight
 * overrides). On the brute-force critical sample, archive_command and ssl_version
 * now report NOT APPLICABLE (their applies_when gates are off), which both
 * removes two failing findings (34 -> 32) and lifts security (14.54 -> 15.27).
 * The v1.8 rule mechanisms (metric_zero, multi-deduction, edition gates) are
 * exercised by dedicated focused tests, not this broad-failure anchor.
 *
 * Re-baselined for the v1.10.0 catalog release (P0 threshold corrections):
 * CAP-2.3 idle_connections is now NOT APPLICABLE when a connection pooler is
 * declared (the sample declares one), removing its passing advisory weight
 * from capacity_connections: capacity 13.86 -> 13.5, total 59.11 -> 58.75.
 * Findings stay at 32 (checkpoint_timeout 450 vs the new min 900 lands in the
 * partial-credit band, which until 1.15.0 rounded a weight-1 advisory back to
 * full score).
 *
 * Re-baselined for the v1.14.0 release (pillar criticality cap, O2h): a
 * hard-failed or missing critical now caps its WHOLE pillar at 60% (12/20),
 * escalating the subcategory 60% gate one level. The brute-force critical
 * sample hard-fails a critical in every pillar, so backup/security/capacity/
 * performance all cap to 12 (futureproof stays 0 via the pillar zero gate):
 * total 58.75 -> 48, status needs_improvement -> critical, findings 32 -> 36
 * (four new pillar-cap findings). The healthy sample has no critical failure,
 * so it is untouched at 100/100.
 *
 * Re-baselined for the 1.15.0 exact partial credit (adoption review): half
 * credit is no longer rounded, so checkpoint_timeout 450 against min 900 now
 * earns 0.5 of 1 and is reported as an info finding instead of passing
 * silently: findings 36 -> 37. The total stays 48, because the pillars it
 * sits in are capped or zeroed by their critical gates.
 *
 * Re-baselined for 1.16.0 (one ruler, a target per estate): the critical
 * sample declares a baseline posture and no standby, so five checks it passes
 * (encryption, standby, pgAudit) are counted but not required and its target
 * is 96.42. Status follows the share of the target reached, counted on
 * required points only (excellent-means-on-target decision): 49 percent, so it
 * stays critical. The total stays 48. The archiving
 * failures count no longer applies with archiving off, so Log Archiving sits
 * below its 60% cap on its own: the gate finding reads "already below 60%".
 *
 * Re-baselined for 1.17.0 (absolute target): an uncollected check stays on
 * the ruler at 0 points. The healthy sample now carries the four agent-only
 * values, so an agent run assesses every check and scores 100 with no finding;
 * a standalone run cannot collect them and reads 95.73 with 4.27 points not
 * assessed. The critical sample misses 11 tuning values, the 4 agent-only
 * checks and its synchronous standby list (so the derived count is unknown,
 * not 0, and is not assessed either): Capacity falls to 11.33 on its own (below its 12/20 cap, so the
 * pillar-cap finding no longer fires) and Encryption reads "already below
 * 60%": total 48 -> 47.33, target 96.42 -> 96.21 (the absolute target counts
 * every applicable check), 48 percent reached; findings stay 37 (the
 * pillar-cap finding goes, one "server version unknown" finding comes).
 *
 * If a DELIBERATE engine/catalog change moves these numbers, update the
 * constants in the same commit and say why in the commit message.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const ScoringEngine = require('../src/scoring/engine');

const healthy = require('../data/samples/postgresql-healthy.json');
const critical = require('../data/samples/postgresql-critical.json');
const AGENT = { mode: 'agent', availableSources: ['sql', 'manual', 'zabbix', 'worker'] };

function opts(sample) {
  return {
    systemFacts: sample.systemFacts || {},
    workloadProfile: sample.workloadProfile || 'mixed',
  };
}

describe('golden back-compat — PostgreSQL samples (v1.10.0 baseline)', () => {
  it('healthy sample scores exactly 100/100 with zero findings in an agent run', () => {
    const result = new ScoringEngine('postgresql').calculate(healthy.values, { ...opts(healthy), ...AGENT });
    assert.equal(result.totalScore, 100);
    assert.equal(result.totalMaxScore, 100);
    assert.equal(result.pointsNotAssessed, 0);
    assert.equal(result.status, 'excellent');
    assert.equal(result.allFindings.length, 0);
  });

  it('healthy sample, standalone: the agent-only checks are not assessed (1.17.0)', () => {
    const result = new ScoringEngine('postgresql').calculate(healthy.values, opts(healthy));
    assert.equal(result.totalScore, 95.73);
    assert.equal(result.totalMaxScore, 100);
    assert.equal(result.pointsNotAssessed, 4.27);
    assert.equal(result.status, 'good');
    assert.equal(result.allFindings.length, 0);
    assert.deepEqual(result.requiredMissed.map(m => [m.id, m.reason, m.outOfScope]),
      [['BAK-2.2', 'missing', true], ['SEC-1.4', 'missing', true], ['CAP-1.2', 'missing', true], ['CAP-1.7', 'missing', true]]);
  });

  it('critical sample reproduces the locked baseline exactly', () => {
    const result = new ScoringEngine('postgresql').calculate(critical.values, opts(critical));
    assert.equal(result.totalScore, 47.33);
    assert.equal(result.totalMaxScore, 100);
    assert.equal(result.targetScore, 96.21);
    assert.equal(result.targetAttainment, 48);
    assert.equal(result.status, 'critical');
    assert.equal(result.allFindings.length, 37);

    // Every scored pillar hard-fails a critical, so O2h caps each at 12/20;
    // Capacity falls below its cap on its own (1.17.0).
    assert.equal(result.pillars.backup.score, 12);
    assert.equal(result.pillars.security.score, 12);
    assert.equal(result.pillars.capacity.score, 11.33);
    assert.equal(result.pillars.performance.score, 12);
    assert.equal(result.pillars.futureproof.score, 0);

    // Finding ORDER is part of the contract (the rules hoist must not move it).
    assert.deepEqual(
      result.allFindings.slice(0, 3).map(f => f.title),
      [
        'Archive Mode Enabled',
        'Log Archiving — critical gate active (score already below 60%)',
        'Backup Schedule Defined',
      ]
    );

    // Rule findings still land after metric/gate findings.
    const ruleIdx = result.allFindings.findIndex(f => f.kind === 'consistency');
    const lastMetricIdx = result.allFindings.map(f => f.kind).lastIndexOf(undefined);
    assert.ok(ruleIdx === -1 || ruleIdx > lastMetricIdx,
      'consistency findings must come after metric findings');
  });
});
