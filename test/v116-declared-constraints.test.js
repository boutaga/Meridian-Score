'use strict';

// 1.16.0: one ruler, a target per estate (score-and-target decision DEC-026). Every check counts for every estate. A
// declared target never switches a check off: it decides whether the check is
// required (optional_when). A check that is not required still earns or loses
// its points, leaves the target score and never gates. Status follows the share
// of the target reached. An estate that declares nothing is required to meet
// every check.

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const ScoringEngine = require('../src/scoring/engine');
const { checkPayload } = require('../src/catalog/payload-check');
const v = require('../src/catalog/validation');
const { getCatalog, MetricCatalog } = require('../src/catalog');
const { rulesFingerprint, declarationsFingerprint, catalogFingerprint } = require('../src/fingerprint');
const { exportRulesBundle, loadRulesBundle } = require('../src/bundle');
const { SCORING_POLICY } = require('../src/scoring/policy');
const ladder = require('../simulator/lib/ladder');

const SAMPLES_DIR = path.resolve(__dirname, '../data/samples');
const loadSample = (file) => JSON.parse(fs.readFileSync(path.join(SAMPLES_DIR, `${file}.json`), 'utf8'));
const load = (name) => loadSample(`postgresql-${name}`);
const pg = new ScoringEngine('postgresql');
const healthy = load('healthy');
const dev = load('dev-loose');
const AGENT = { mode: 'agent', availableSources: ['sql', 'manual', 'zabbix', 'worker'] };
const DECLARATIONS = ['growth_headroom_target', 'ha_topology', 'rpo_target', 'rto_target', 'security_posture', 'upgrade_plan'];

function run(over = {}, opts = {}, sample = healthy, engine = pg) {
  const values = { ...sample.values, ...over };
  for (const k of Object.keys(values)) if (values[k] === undefined) delete values[k];
  return engine.calculate(values, { systemFacts: sample.systemFacts, workloadProfile: sample.workloadProfile, ...opts });
}
const metric = (r, name) => r.allMetrics.find((m) => m.name === name);
const required = (r, name) => metric(r, name).required;
const undeclared = Object.fromEntries(DECLARATIONS.map((k) => [k, undefined]));

describe('1.16.0 declared targets decide what is required, never what is judged', () => {
  // [check, declarations under which it is not required, declarations under which it is]
  const TABLE = [
    ['archive_mode', { rpo_target: 'rpo_1440' }, [{ rpo_target: 'rpo_240' }, { rpo_target: 'rpo_5' }, {}]],
    ['summarize_wal', { rpo_target: 'rpo_1440' }, [{ rpo_target: 'rpo_60' }, {}]],
    ['backup_tool_detection', { rpo_target: 'rpo_1440' }, [{ rpo_target: 'rpo_240' }, {}]],
    ['external_backup_tool', { rpo_target: 'rpo_1440', rto_target: 'rto_480' },
      [{ rpo_target: 'rpo_1440', rto_target: 'rto_240' }, { rpo_target: 'rpo_240', rto_target: 'rto_1440' }, { rpo_target: 'rpo_1440' }]],
    ['pitr_enabled', { rpo_target: 'rpo_1440', rto_target: 'rto_1440' }, [{ rto_target: 'rto_1440' }, {}]],
    ['backup_encryption', { security_posture: 'baseline' }, [{ security_posture: 'hardened' }, {}]],
    ['encryption_at_rest', { security_posture: 'baseline' }, [{ security_posture: 'regulated' }, {}]],
    ['pgaudit_installed', { security_posture: 'hardened' }, [{ security_posture: 'regulated' }, {}]],
    ['streaming_status', { ha_topology: 'none' }, [{ ha_topology: 'async_standby' }, {}]],
    ['ha_standby_count', { ha_topology: 'none' }, [{ ha_topology: 'cluster_managed' }, {}]],
    ['synchronous_standby_names', { ha_topology: 'async_standby' }, [{ ha_topology: 'sync_standby' }, {}]],
    ['restore_time_estimate_minutes', { ha_topology: 'sync_standby' }, [{ ha_topology: 'none' }, {}]],
  ];
  for (const [name, optionalOver, requiredOvers] of TABLE) {
    it(`${name} counts everywhere and is required only when the targets ask for it`, () => {
      const opt = run({ ...undeclared, synchronous_standby_names: 'pg2', ...optionalOver });
      assert.notEqual(metric(opt, name).applicable, false, 'still judged');
      assert.equal(required(opt, name), false);
      assert.ok(Object.keys(metric(opt, name).optional_because).length > 0);
      for (const over of requiredOvers) {
        const r = run({ ...undeclared, synchronous_standby_names: 'pg2', ...over });
        assert.equal(required(r, name), true, JSON.stringify(over));
      }
    });
  }

  it('Oracle Data Guard counts on Enterprise Edition and is required unless no standby is declared', () => {
    const ora = new ScoringEngine('oracle');
    const ee = { systemFacts: { edition: 'enterprise' } };
    const none = ora.calculate({ dr_topology: 'none', dataguard_configured: false }, ee);
    assert.equal(metric(none, 'dataguard_configured').required, false);
    assert.notEqual(metric(none, 'dataguard_configured').applicable, false);
    for (const dr of ['dg_async', undefined]) {
      const r = ora.calculate({ ...(dr ? { dr_topology: dr } : {}), dataguard_configured: false }, ee);
      assert.equal(metric(r, 'dataguard_configured').required, true, String(dr));
    }
  });

  it('the dump schedule no longer decides anything: archiving is required below a 24-hour RPO', () => {
    const r = run({ archive_mode: 'off', archive_command: '(disabled)', rpo_target: 'rpo_240', dump_schedule: 'hourly' });
    assert.equal(required(r, 'archive_mode'), true);
    assert.ok(r.disposition.items.some((i) => i.id === 'BAK-1.1'));
  });

  it('archiving that is on is judged, command included', () => {
    const r = run({ rpo_target: 'rpo_1440', archive_command: '(disabled)' });
    assert.notEqual(metric(r, 'archive_mode').applicable, false);
    assert.notEqual(metric(r, 'archive_command').applicable, false);
  });

  it('the archiving failures count applies only with archiving on', () => {
    assert.equal(metric(run({ archive_mode: 'off' }), 'archive_failures').applicable, false);
    assert.notEqual(metric(run({ archive_mode: 'on' }), 'archive_failures').applicable, false);
  });

  it('a short RPO on dumps alone is still a critical problem', () => {
    const r = run({ archive_mode: 'off', archive_command: '(disabled)', rpo_target: 'rpo_15', dump_schedule: 'daily' });
    assert.equal(r.disposition.state, 'critical_unresolved');
    assert.ok(r.disposition.items.some((i) => i.id === 'BAK-1.1'));
  });

  it('a failing backup job on a dump-only estate moves the score', () => {
    const bo = { archive_mode: 'off', archive_command: '(disabled)', dump_schedule: 'daily', rpo_target: 'rpo_1440',
      ha_topology: 'none', streaming_status: false, ha_standby_count: 0, replication_lag_seconds: undefined };
    const fresh = run({ ...bo, last_backup_age_hours: 5 }, AGENT);
    const stale = run({ ...bo, last_backup_age_hours: 72 }, AGENT);
    assert.ok(stale.totalScore < fresh.totalScore, `${stale.totalScore} < ${fresh.totalScore}`);
    assert.ok(!fresh.pillars.backup.criticalGated, 'backup pillar is not held at the cap');
  });
});

describe('1.16.0 a critical check the targets do not require never gates', () => {
  const dumpOnly = { archive_mode: 'off', archive_command: '(disabled)', rpo_target: 'rpo_1440', rto_target: 'rto_1440' };
  const r = run(dumpOnly);
  const strict = run({ ...dumpOnly, rpo_target: 'rpo_240' });

  it('it loses its own points', () => {
    assert.equal(metric(r, 'archive_mode').score, 0);
    assert.ok(metric(r, 'archive_mode').maxScore > 0);
  });
  it('no pillar cap, no subcategory gate, no disposition item', () => {
    assert.ok(!r.pillars.backup.criticalGated);
    assert.equal(r.subcategories.backup_wal.hasCriticalFailure, false);
    assert.ok(!r.allFindings.some((f) => f.source === 'engine' && /critical gate/.test(f.title) && f.category === 'Log Archiving'));
    assert.ok(!r.disposition.items.some((i) => i.id === 'BAK-1.1'));
  });
  it('the same failure gates when the targets require it', () => {
    assert.ok(strict.pillars.backup.criticalGated);
    assert.equal(strict.subcategories.backup_wal.hasCriticalFailure, true);
    assert.ok(strict.allFindings.some((f) => f.source === 'engine' && /critical gate/.test(f.title) && f.category === 'Log Archiving'));
    assert.ok(strict.disposition.items.some((i) => i.id === 'BAK-1.1'));
  });
  it('a missing one still counts as 0 points in score and maximum, but never gates', () => {
    const missing = run({ ...dumpOnly, archive_mode: undefined });
    const m = metric(missing, 'archive_mode');
    assert.equal(m.scored, false);
    assert.equal(m.required, false);
    assert.equal(missing.subcategories.backup_wal.hasCriticalFailure, false);
    assert.ok(!missing.disposition.items.some((i) => i.id === 'BAK-1.1'));
    // same section score as an archive-off estate: the declaration hides nothing
    const undeclaredMissing = run({ ...dumpOnly, archive_mode: undefined, rpo_target: undefined });
    assert.ok(missing.totalScore <= r.totalScore);
    assert.ok(Math.abs(missing.subcategories.backup_wal.score - r.subcategories.backup_wal.score) < 0.011,
      `${missing.subcategories.backup_wal.score} vs ${r.subcategories.backup_wal.score}`);
    assert.ok(undeclaredMissing.subcategories.backup_wal.hasCriticalFailure);
  });
  it('its finding is an improvement above the target, listed after the required work', () => {
    const f = r.allFindings.find((x) => x.metric === 'archive_mode');
    assert.equal(f.severity, 'info');
    assert.equal(f.aboveTarget, true);
    const recs = r.recommendations;
    const first = recs.findIndex((x) => x.aboveTarget);
    assert.ok(first >= 0);
    assert.ok(recs.slice(first).every((x) => x.aboveTarget), 'above-target items come last');
  });
});

describe('1.16.0 target and status', () => {
  // [sample, score, maximum, target, percent of target reached (required
  // points only), status, disposition, required checks missed, points not
  // assessed]. Standalone runs. 1.17.0 (absolute target): an uncollected
  // check counts 0 and stays in the target; the four agent-only PostgreSQL
  // checks are not assessed in a standalone run (4.27 points); the samples
  // written before the catalog grew were completed by hand; a blank
  // non-critical declaration keeps its full points; the synchronous standby
  // count of an uncollected list is not assessed (critical: 30 missed).
  const LOCKS = [
    ['oracle-almost-there', 95.53, 100, 100, 96, 'good', 'clear', 8, 0],
    ['oracle-average', 81.72, 100, 100, 82, 'good', 'clear', 25, 1.2],
    ['oracle-critical', 51.51, 100, 100, 52, 'needs_improvement', 'critical_unresolved', 48, 16.43],
    ['oracle-healthy', 100, 100, 99.44, 100, 'excellent', 'clear', 0, 0],
    ['oracle-olap', 100, 100, 100, 100, 'excellent', 'clear', 0, 0],
    ['oracle-oltp', 99.07, 100, 100, 99, 'good', 'clear', 1, 0],
    ['oracle-se2', 100, 100, 100, 100, 'excellent', 'clear', 0, 0],
    ['oracle-uneven', 62.2, 100, 100, 62, 'needs_improvement', 'critical_unresolved', 41, 0],
    ['postgresql-almost-there', 91.48, 100, 98.14, 91, 'good', 'clear', 14, 4.27],
    ['postgresql-average', 74.3, 100, 96.59, 77, 'good', 'critical_unresolved', 38, 6.57],
    ['postgresql-critical', 47.33, 100, 96.21, 48, 'critical', 'critical_unresolved', 30, 8.09],
    ['postgresql-dev-loose', 84.28, 100, 91.23, 91, 'good', 'clear', 10, 5.57],
    ['postgresql-healthy', 95.73, 100, 97.54, 96, 'good', 'clear', 4, 4.27],
    ['postgresql-olap', 95.12, 100, 100, 95, 'good', 'clear', 5, 4.27],
    ['postgresql-oltp', 95.43, 100, 100, 95, 'good', 'clear', 5, 4.27],
    ['postgresql-uneven', 59.56, 100, 96.59, 62, 'needs_improvement', 'critical_unresolved', 29, 5.57],
  ];
  for (const [file, score, max, target, attained, status, disposition, missed, notAssessed] of LOCKS) {
    it(`${file}: ${score} of ${max}, target ${target}, ${attained} percent reached, ${status}, ${missed} required missed, ${notAssessed} not assessed`, () => {
      const s = loadSample(file);
      const r = new ScoringEngine(file.split('-')[0]).calculate(s.values, { systemFacts: s.systemFacts || {}, workloadProfile: s.workloadProfile || 'mixed' });
      assert.equal(r.totalScore, score);
      assert.equal(r.totalMaxScore, max);
      assert.equal(r.targetScore, target);
      assert.equal(r.targetAttainment, attained);
      assert.equal(r.status, status);
      assert.equal(r.disposition.state, disposition);
      assert.equal(r.requiredMissed.length, missed);
      assert.equal(r.onTarget, missed === 0);
      assert.equal(r.pointsNotAssessed, notAssessed);
    });
  }

  it('"excellent" only on target: every required check fully met (excellent-means-on-target decision)', () => {
    for (const [file] of LOCKS) {
      const s = loadSample(file);
      const r = new ScoringEngine(file.split('-')[0]).calculate(s.values, { systemFacts: s.systemFacts || {}, workloadProfile: s.workloadProfile || 'mixed' });
      assert.equal(r.status === 'excellent', r.onTarget, file);
      for (const p of Object.values(r.pillars)) assert.ok(p.status !== 'excellent' || p.onTarget, `${file} ${p.name}`);
      for (const x of Object.values(r.subcategories)) assert.ok(x.status !== 'excellent' || x.onTarget, `${file} ${x.name}`);
      if (!r.onTarget) assert.ok(r.targetAttainment < 100, file);
    }
  });

  it('an estate that declares nothing has a target equal to its maximum; below "excellent" its status follows its percentage', () => {
    const b = SCORING_POLICY.statusBands;
    const statusOf = (pct, on) => (pct >= b.excellent ? (on ? 'excellent' : 'good') : pct >= b.good ? 'good' : pct >= b.needs_improvement ? 'needs_improvement' : 'critical');
    for (const name of ['average', 'uneven', 'critical', 'dev-loose', 'almost-there', 'oltp']) {
      const r = run(undeclared, {}, load(name));
      assert.equal(r.targetScore, r.totalMaxScore, name);
      assert.equal(r.requiredScore, r.totalScore, `${name}: every check is required`);
      assert.equal(r.status, statusOf(r.totalPercentage, r.onTarget), name);
    }
  });

  it('targets add up: sections into pillars, pillars into the total', () => {
    const r = run({}, {}, dev);
    let total = 0;
    for (const [pid, p] of Object.entries(r.pillars)) {
      const subs = Object.values(r.subcategories).filter((s) => s.pillar === pid);
      const sum = Math.round(subs.reduce((a, s) => a + s.target, 0) * 100) / 100;
      assert.ok(Math.abs(Math.min(sum, 20) - p.target) < 0.011, `${pid} ${sum} vs ${p.target}`);
      assert.ok(p.target <= p.maxScore);
      total += p.target;
    }
    assert.ok(Math.abs(total - r.targetScore) < 0.011);
    assert.equal(r.subcategories.backup_tools.target, 0, 'nothing in backup tools is required of this DEV');
    assert.equal(r.subcategories.backup_tools.maxScore, 3, 'but the section still counts');
  });

  it('below the target never reads 100 percent reached', () => {
    // 1.17.0: a standalone run cannot collect the four agent-only checks;
    // they stay required, so the target is not reached.
    const oltp = run({}, {}, load('oltp'));
    assert.ok(oltp.totalScore < oltp.targetScore);
    assert.equal(oltp.targetAttainment, 95);
    assert.equal(oltp.onTarget, false);
    assert.equal(oltp.status, 'good');
    assert.deepEqual(oltp.requiredMissed.map((m) => [m.id, m.reason, m.outOfScope]),
      [['BAK-2.2', 'missing', true], ['BAK-4.9', 'partial', undefined], ['SEC-1.4', 'missing', true], ['CAP-1.2', 'missing', true], ['CAP-1.7', 'missing', true]]);
  });

  it('a subcategory zeroed by its pillar gate reads 0, even with a target of 0', () => {
    // A catalog copy where nothing in Configuration is required at a baseline
    // posture (the critical sample declares baseline), so its target is 0,
    // and the version gate zeroes the Future-Proofing pillar.
    const data = JSON.parse(JSON.stringify(require('../data/metrics/postgresql.json')));
    for (const m of data.metrics.filter((x) => x.subcategory === 'future_config')) {
      m.optional_when = { metric: 'security_posture', in: ['baseline'] };
    }
    const eng = new ScoringEngine('postgresql', { catalog: MetricCatalog.fromData('postgresql', data) });
    const r = run({}, {}, load('critical'), eng);
    const s = r.subcategories.future_config;
    assert.equal(s.zeroedByPillarGate, true);
    assert.equal(s.target, 0);
    assert.equal(s.targetAttainment, 0);
    assert.equal(s.onTarget, false);
    assert.equal(s.status, 'critical');
  });

  it('status follows the share of the target reached, capped at 100', () => {
    const r = run({}, AGENT, healthy);
    assert.ok(r.totalScore > r.targetScore);
    assert.equal(r.targetAttainment, 100);
    assert.equal(r.onTarget, true);
  });
});

describe('1.16.0 a declaration moves the target; the score moves only through the checks judged against it, the coherence rules and the caps', () => {
  // Strip the two mechanisms that read declarations into the score (checks
  // judged against the declared target, coherence rules): on estates where no
  // cap bites, the requirement mechanism must not move the score. Where a cap
  // bites, lowering a target lifts it (locked below).
  const data = JSON.parse(JSON.stringify(require('../data/metrics/postgresql.json')));
  data.consistency_rules = [];
  for (const m of data.metrics) {
    if (m.evaluation_config && m.evaluation_config.by_declaration) delete m.evaluation_config.by_declaration;
  }
  const bare = new ScoringEngine('postgresql', { catalog: MetricCatalog.fromData('postgresql', data) });
  // Declared values only: an undeclared target is itself a missing critical
  // declaration and costs points; which declared value never does.
  const GRID = [
    { rpo_target: 'rpo_1440', rto_target: 'rto_1440', ha_topology: 'none', security_posture: 'baseline' },
    { rpo_target: 'rpo_240', rto_target: 'rto_480', ha_topology: 'async_standby', security_posture: 'hardened' },
    { rpo_target: 'rpo_5', rto_target: 'rto_5', ha_topology: 'sync_standby', security_posture: 'regulated' },
  ];
  for (const sample of ['dev-loose', 'average', 'healthy']) {
    it(`${sample}: the same score under every declaration, a different target`, () => {
      const results = GRID.map((g) => run(g, {}, load(sample), bare));
      const scores = new Set(results.map((r) => r.totalScore));
      assert.equal(scores.size, 1, [...scores].join(', '));
    });
  }

  it('lowering a target lifts the caps on the checks it stops requiring (score-and-target decision, reworded 2026-09-28)', () => {
    const f = (rpo) => run({ archive_mode: 'off', archive_command: '(disabled)', rto_target: 'rto_1440', rpo_target: rpo }, {}, healthy, bare);
    const loose = f('rpo_1440');
    const strict = f('rpo_240');
    assert.ok(strict.pillars.backup.criticalGated);
    assert.ok(!loose.pillars.backup.criticalGated);
    assert.ok(loose.totalScore > strict.totalScore, `${loose.totalScore} > ${strict.totalScore}`);
    assert.ok(loose.targetScore < strict.targetScore);
  });

  it('the contract example: healthy sample, archiving off, 92 at a 4-hour RPO and 97.86 at a 24-hour one', () => {
    // 1.17.0: an agent run, so every check is assessed (targets unchanged).
    const f = (rpo) => run({ archive_mode: 'off', archive_command: '(disabled)', rto_target: 'rto_1440', rpo_target: rpo }, AGENT);
    const strict = f('rpo_240');
    const loose = f('rpo_1440');
    assert.equal(strict.totalScore, 92);
    assert.equal(strict.targetScore, 97.54);
    assert.equal(loose.totalScore, 97.86);
    assert.equal(loose.targetScore, 92.18);
  });

  it('a looser declaration never raises the target', () => {
    for (const sample of ['dev-loose', 'average']) {
      for (const [name, rungs] of [
        ['rpo_target', ['rpo_1440', 'rpo_240', 'rpo_60', 'rpo_15', 'rpo_5']],
        ['rto_target', ['rto_1440', 'rto_480', 'rto_240', 'rto_60', 'rto_15', 'rto_5']],
        ['security_posture', ['baseline', 'hardened', 'regulated']],
      ]) {
        const targets = rungs.map((x) => run({ [name]: x }, {}, load(sample)).targetScore);
        for (let i = 1; i < targets.length; i++) assert.ok(targets[i - 1] <= targets[i], `${sample} ${name} ${targets.join(' < ')}`);
      }
    }
  });
});

describe('1.16.0 the SSL checks stay a floor on every environment', () => {
  it('the SSL checks are flagged floor, carry no optional_when, and baseline does not relax them', () => {
    const ssl = getCatalog('postgresql').metrics.filter((x) => /^ssl_/.test(x.legacy_name));
    assert.equal(ssl.length, 4);
    for (const m of ssl) {
      assert.equal(m.floor, true, m.metric_id);
      assert.equal(m.optional_when, undefined, m.metric_id);
    }
    const r = run({ security_posture: 'baseline', ssl_enabled: 'off', ssl_connection_pct: 0 });
    assert.equal(required(r, 'ssl_enabled'), true);
    assert.equal(required(r, 'ssl_connection_pct'), true);
  });
});

describe('1.16.0 validator for optional_when', () => {
  const data = require('../data/metrics/postgresql.json');
  const lookups = v.buildLookups(data);
  const errs = (m) => { const e = []; v.validateOptionalWhen(m, lookups, e); v.validateMetricAppliesWhen(m, lookups, e); return e; };
  const base = { metric_id: 'X-1', legacy_name: 'x_check' };
  it('accepts a condition on declared targets', () => {
    assert.deepEqual(errs({ ...base, optional_when: { metric: 'rpo_target', in: ['rpo_1440'] } }), []);
  });
  it('refuses a condition on a collected value, a system fact or nothing', () => {
    assert.equal(errs({ ...base, optional_when: { metric: 'archive_mode', in: ['off'] } }).length, 1);
    assert.ok(errs({ ...base, optional_when: { system_fact: 'edition', equals: 'enterprise' } }).length >= 1);
  });
  it('refuses a condition that holds when nothing is declared', () => {
    assert.equal(errs({ ...base, optional_when: { none_of: [{ metric: 'rpo_target', in: ['rpo_5'] }] } }).length, 1);
    assert.equal(errs({ ...base, optional_when: { metric: 'rpo_target', not_in: ['rpo_5'] } }).length, 1);
    assert.equal(errs({ ...base, optional_when: { metric: 'rpo_target', provided: false } }).length, 1);
  });
  it('refuses it on a floor check, a pillar-gate check and a declaration', () => {
    const ow = { metric: 'security_posture', in: ['baseline'] };
    assert.equal(errs({ ...base, floor: true, optional_when: ow }).length, 1);
    assert.equal(errs({ ...base, gate_scope: 'pillar', optional_when: ow }).length, 1);
    assert.equal(errs({ ...base, declared_target: true, optional_when: ow }).length, 1);
  });
  it('refuses an applies_when that reads a declared target', () => {
    assert.equal(errs({ ...base, applies_when: { metric: 'ha_topology', in: ['none'] } }).length, 1);
  });
});

describe('1.16.0 "yes" is no longer a declaration', () => {
  for (const name of ['rpo_target', 'rto_target']) {
    it(`${name}="yes" earns nothing and is reported as a failed critical`, () => {
      const r = run({ [name]: 'yes' });
      assert.equal(metric(r, name).score, 0);
      assert.ok(r.disposition.items.some((i) => i.id === metric(r, name).metric_id && i.reason === 'failed'));
    });
  }
  it('the payload checker says which rungs exist', () => {
    const report = checkPayload('postgresql', { ...healthy.values, rpo_target: 'yes' }, { systemFacts: healthy.systemFacts });
    const row = report.metrics.find((m) => m.legacy_name === 'rpo_target');
    assert.equal(row.status, 'enum_mismatch');
    assert.match(row.detail, /not a declared rung; the engine scores it as a failed declaration.*rpo_1440/);
  });
  it('the payload checker compares declarations case-insensitively, as the engine does', () => {
    const report = checkPayload('postgresql', { ...healthy.values, security_posture: 'Baseline', rpo_target: 'RPO_60' }, { systemFacts: healthy.systemFacts });
    for (const n of ['security_posture', 'rpo_target']) assert.equal(report.metrics.find((m) => m.legacy_name === n).status, 'ok', n);
  });
  it('a malformed collected value keeps its check judged and reported', () => {
    const payload = { ...healthy.values, ha_topology: 'none', streaming_status: 'unknown' };
    const report = checkPayload('postgresql', payload, { systemFacts: healthy.systemFacts });
    assert.equal(report.metrics.find((m) => m.legacy_name === 'streaming_status').status, 'unparseable');
    assert.notEqual(metric(run({ ha_topology: 'none', streaming_status: 'unknown' }), 'streaming_status').applicable, false);
  });
});

describe('1.16.0 catalog versions', () => {
  it('PostgreSQL is 1.14.0 and Oracle 1.11.0 (1.17.0 applicability guards)', () => {
    assert.equal(getCatalog('postgresql').version, '1.14.0');
    assert.equal(getCatalog('oracle').version, '1.11.0');
  });
});

describe('1.16.0 maturity ladder rules (simulator)', () => {
  it('flagged catalogs use the flag; unflagged ones keep the name-and-shape detection', () => {
    const pgTargets = getCatalog('postgresql').metrics.filter((m) => ladder.isTarget(m, true)).map((m) => m.legacy_name).sort();
    assert.deepEqual(pgTargets, DECLARATIONS);
    const my = getCatalog('mysql');
    assert.ok(!my.metrics.some((m) => m.declared_target === true));
    const myTargets = my.metrics.filter((m) => ladder.isTarget(m, false)).map((m) => m.legacy_name);
    assert.ok(myTargets.includes('rpo_target') && myTargets.includes('rto_target'), myTargets.join(','));
  });
  it('under an honored declaration a rung that lowers the target is never a gain', () => {
    const rung = { coherent: true, delta: 1.5, targetDelta: -2 };
    assert.equal(ladder.isGainRung(rung, 'honored'), false);
    for (const st of ['invalidated', 'undeclared', 'unmet']) assert.equal(ladder.isGainRung(rung, st), true, st);
    assert.equal(ladder.isGainRung({ ...rung, targetDelta: 0 }, 'honored'), true);
  });

  const advise = (values, sample = dev) => {
    const opts = { systemFacts: sample.systemFacts, workloadProfile: sample.workloadProfile };
    const base = pg.calculate(values, opts);
    return Object.fromEntries(ladder.computeNextRungs('postgresql', values, opts, base).map((t) => [t.legacy_name, t]));
  };
  it('every rung reports the score change and the target change, never switched-off checks', () => {
    const t = advise(dev.values).ha_topology;
    for (const r of t.rungs) {
      assert.equal(r.waives, undefined, r.value);
      assert.equal(typeof r.targetDelta, 'number', r.value);
    }
    assert.ok(t.rungs.find((r) => r.value === 'async_standby').targetDelta > 0, 'declaring a standby raises the target');
  });
  it('honored: the advisor never recommends loosening', () => {
    const almost = load('almost-there');
    const t = advise(almost.values, almost).security_posture;
    assert.equal(t.state, 'honored');
    assert.ok(!t.recommendation || t.recommendation.targetDelta >= 0);
  });
  it('invalidated: stepping down to the honest rung is the fix, and says it lowers the target', () => {
    const t = advise({ ...dev.values, rpo_target: 'rpo_15' }).rpo_target;
    assert.equal(t.state, 'invalidated');
    assert.equal(t.recommendation.kind, 'fix');
    assert.equal(t.recommendation.value, 'rpo_1440');
    assert.ok(t.recommendation.targetDelta < 0);
  });
  it('with nothing declared, the advisor proposes the strictest rung the evidence supports, not the loosest', () => {
    const noRpo = { ...healthy.values }; delete noRpo.rpo_target;
    assert.equal(advise(noRpo, healthy).rpo_target.recommendation.value, 'rpo_5');
    const avg = load('average');
    const noPosture = { ...avg.values }; delete noPosture.security_posture;
    assert.equal(advise(noPosture, avg).security_posture.recommendation.value, 'hardened');
  });
  it('undeclared: declaring the honest constraint is a fix', () => {
    const values = { ...dev.values }; delete values.rpo_target;
    const t = advise(values).rpo_target;
    assert.equal(t.state, 'undeclared');
    assert.equal(t.recommendation.kind, 'fix');
  });
});

describe('1.16.0 the result names its declarations and its fingerprints', () => {
  it('a declaration in other letter case is scored as the catalog spelling; other characters are not', () => {
    const upper = run({ archive_mode: 'off', rpo_target: 'RPO_1440' });
    assert.equal(required(upper, 'archive_mode'), false);
    assert.equal(metric(upper, 'rpo_target').score, metric(upper, 'rpo_target').maxScore);
    const spaced = run({ archive_mode: 'off', rpo_target: ' rpo_1440' });
    assert.equal(required(spaced, 'archive_mode'), true);
    assert.equal(spaced.context.declarations.rpo_target, ' rpo_1440');
    assert.notEqual(spaced.context.fingerprint.declarations, upper.context.fingerprint.declarations);
  });
  it('PostgreSQL echoes the six declarations in the catalog spelling, null when not declared', () => {
    const r = run({ ha_topology: undefined, security_posture: 'Baseline' });
    assert.deepEqual(Object.keys(r.context.declarations).sort(), DECLARATIONS);
    assert.equal(r.context.declarations.rpo_target, 'rpo_5');
    assert.equal(r.context.declarations.security_posture, 'baseline');
    assert.equal(r.context.declarations.ha_topology, null);
  });
  it('Oracle echoes its five declarations', () => {
    const r = new ScoringEngine('oracle').calculate({ dr_topology: 'dg_async' });
    assert.deepEqual(Object.keys(r.context.declarations).sort(),
      ['dr_topology', 'growth_headroom_target', 'rpo_target', 'rto_target', 'security_posture']);
    assert.equal(r.context.declarations.dr_topology, 'dg_async');
    assert.equal(r.context.declarations.rpo_target, null);
  });
  it('the declared_target flag is accepted only as true on a manual enum', () => {
    const base = { metric_id: 'X-1', evaluation_type: 'enum', sources: ['manual'] };
    const e1 = []; v.validateDeclaredTarget({ ...base, declared_target: true }, e1); assert.deepEqual(e1, []);
    const e2 = []; v.validateDeclaredTarget({ ...base, declared_target: 'yes' }, e2); assert.equal(e2.length, 1);
    const e3 = []; v.validateDeclaredTarget({ ...base, evaluation_type: 'threshold', declared_target: true }, e3); assert.equal(e3.length, 1);
    const e4 = []; v.validateDeclaredTarget({ ...base, sources: ['sql'], declared_target: true }, e4); assert.equal(e4.length, 1);
  });
  it('same rules and declarations give the same codes; collected values never enter them', () => {
    const a = run({}, {}, dev);
    const b = run({ shared_buffers_pct: 12, last_backup_age_hours: 3 }, {}, dev);
    assert.equal(a.context.fingerprint.rules, b.context.fingerprint.rules);
    assert.equal(a.context.fingerprint.declarations, b.context.fingerprint.declarations);
    assert.equal(a.context.fingerprint.rulesShort, a.context.fingerprint.rules.slice(0, 12));
    const c = run({ rpo_target: 'rpo_240' }, {}, dev);
    assert.notEqual(a.context.fingerprint.declarations, c.context.fingerprint.declarations);
  });
});

describe('1.16.0 fingerprints', () => {
  const data = require('../data/metrics/postgresql.json');
  const clone = () => JSON.parse(JSON.stringify(data));
  const code = (d) => rulesFingerprint(MetricCatalog.fromData('postgresql', d));
  it('reordering metrics, rules and keys leaves the rules code unchanged', () => {
    const d = clone();
    d.metrics.reverse();
    d.consistency_rules.reverse();
    d.metrics = d.metrics.map((m) => Object.fromEntries(Object.entries(m).reverse()));
    assert.equal(code(d), code(clone()));
  });
  it('one threshold edit changes the rules code', () => {
    const d = clone();
    d.metrics.find((m) => m.metric_id === 'FUT-2.1').evaluation_config = { min: 300 };
    assert.notEqual(code(d), code(clone()));
  });
  it('the embedded catalog and a copy loaded from data give the same code', () => {
    assert.equal(rulesFingerprint(getCatalog('postgresql')), code(clone()));
  });
  it('letter case and key order of declarations do not change the declarations code', () => {
    const cat = getCatalog('postgresql');
    assert.equal(declarationsFingerprint(cat, { rpo_target: 'RPO_1440', security_posture: 'Baseline' }),
      declarationsFingerprint(cat, { security_posture: 'baseline', rpo_target: 'rpo_1440' }));
  });
});

describe('1.16.0 rules bundle', () => {
  const declarations = { rpo_target: 'rpo_1440', rto_target: 'rto_1440', ha_topology: 'none', security_posture: 'baseline' };
  const text = JSON.stringify(exportRulesBundle('postgresql', { declarations }));
  it('round-trips: same rules code, same declarations, same score', () => {
    const b = loadRulesBundle(text);
    assert.equal(b.sameEngine, true);
    assert.deepEqual(b.notes, []);
    const r = run({}, {}, dev, new ScoringEngine('postgresql', { catalog: b.catalog }));
    assert.equal(r.context.fingerprint.rules, b.fingerprint.rules);
    assert.equal(r.totalScore, run({}, {}, dev).totalScore);
    assert.equal(b.declarations.rpo_target, 'rpo_1440');
  });
  it('refuses a threshold edited inside the file', () => {
    const t = JSON.parse(text);
    t.catalog.metrics.find((m) => m.metric_id === 'FUT-2.1').evaluation_config = { min: 1 };
    assert.throws(() => loadRulesBundle(t), /does not match its content/);
  });
  it('refuses edited declarations and a file that is not a bundle', () => {
    const t = JSON.parse(text);
    t.declarations.rpo_target = 'rpo_5';
    assert.throws(() => loadRulesBundle(t), /declarations fingerprint/);
    assert.throws(() => loadRulesBundle({ format: 'other' }), /not a rules bundle/);
  });
  it('refuses a collected value smuggled in as a declaration, and declarations without their code', () => {
    const t = JSON.parse(text);
    t.declarations.archive_mode = 'on';
    assert.throws(() => loadRulesBundle(t), /not declared targets: archive_mode/);
    const u = JSON.parse(text);
    delete u.fingerprint.declarations;
    u.declarations.rpo_target = 'rpo_5';
    assert.throws(() => loadRulesBundle(u), /must come together/);
  });
  it('refuses to export declarations in which no declared target is recognised', () => {
    assert.throws(() => exportRulesBundle('postgresql', { declarations: { rpo: 'rpo_60' } }), /no declared target recognised/);
  });
  it('imports a bundle from another engine version and says why the rules code differs', () => {
    const t = JSON.parse(text);
    t.engineVersion = '1.15.0';
    const b = loadRulesBundle(t);
    assert.equal(b.sameEngine, false);
    assert.match(b.notes[0], /exported by engine 1\.15\.0/);
  });
  it('the command line scores with the payload run options and says whose targets it used', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bundle-'));
    after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const bfile = path.join(dir, 'b.json');
    fs.writeFileSync(bfile, JSON.stringify(exportRulesBundle('oracle')));
    // The licensed options move this sample (94.95 with them, 95.53 without).
    const s = loadSample('oracle-almost-there');
    const pfile = path.join(dir, 'p.json');
    fs.writeFileSync(pfile, JSON.stringify(s));
    const script = path.resolve(__dirname, '../scripts/rules-bundle.js');
    const out = spawnSync(process.execPath, [script, 'score', bfile, pfile], { encoding: 'utf8' });
    assert.equal(out.status, 0, out.stderr);
    assert.match(out.stdout, /^Score 94\.95 of 100/);
    assert.match(out.stdout, /the payload's own targets/);
  });
  it('the command line refuses unknown options, a missing value, an unreadable or non-object payload', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bundle-'));
    after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const script = path.resolve(__dirname, '../scripts/rules-bundle.js');
    const cli = (...a) => spawnSync(process.execPath, [script, ...a], { encoding: 'utf8' });
    const bfile = path.join(dir, 'b.json');
    fs.writeFileSync(bfile, text);
    let r = cli('export', 'postgresql', '--declaration', 'x.json');
    assert.equal(r.status, 2); assert.match(r.stderr, /unknown option --declaration/);
    r = cli('export', 'postgresql', '--declarations');
    assert.equal(r.status, 2); assert.match(r.stderr, /needs a file/);
    r = cli('score', bfile, path.join(dir, 'missing.json'));
    assert.equal(r.status, 1); assert.match(r.stderr, /cannot read/);
    fs.writeFileSync(path.join(dir, 'null.json'), 'null');
    r = cli('score', bfile, path.join(dir, 'null.json'));
    assert.equal(r.status, 1); assert.match(r.stderr, /expected a JSON object/);
    r = cli('nonsense');
    assert.equal(r.status, 2); assert.match(r.stderr, /Usage/);
  });
  it('the command line says whose targets it used, and flags a target not reached', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bundle-'));
    after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const script = path.resolve(__dirname, '../scripts/rules-bundle.js');
    const partial = path.join(dir, 'partial.json');
    fs.writeFileSync(partial, JSON.stringify(exportRulesBundle('postgresql', { declarations: { rpo_target: 'rpo_1440' } })));
    const pfile = path.join(dir, 'dev.json');
    fs.writeFileSync(pfile, JSON.stringify(dev));
    let r = spawnSync(process.execPath, [script, 'score', partial, pfile], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /the bundle's targets, plus your own where the bundle declares none/);
    assert.match(r.stdout, /Target not reached: /);
    r = spawnSync(process.execPath, [script, 'score', partial, pfile, '--own-declarations'], { encoding: 'utf8' });
    assert.match(r.stdout, /the payload's own targets/);
    const bare = path.join(dir, 'bare.json');
    fs.writeFileSync(bare, JSON.stringify({ values: { archive_mode: 'on' } }));
    r = spawnSync(process.execPath, [script, 'score', partial, bare], { encoding: 'utf8' });
    assert.match(r.stdout, /the bundle's targets/);
    assert.doesNotMatch(r.stdout, /plus your own/);
  });
  it('an edited catalog cannot promote a collected value to a travelling declaration, even with recomputed codes', () => {
    const t = JSON.parse(text);
    t.catalog.metrics.find((m) => m.legacy_name === 'dump_schedule').declared_target = true;
    const cat = MetricCatalog.fromData('postgresql', t.catalog);
    t.declarations.dump_schedule = 'daily';
    t.fingerprint.catalog = catalogFingerprint(cat);
    t.fingerprint.rules = rulesFingerprint(cat);
    t.fingerprint.declarations = declarationsFingerprint(cat, t.declarations);
    assert.throws(() => loadRulesBundle(t), /not declared targets: dump_schedule/);
  });
  it('spelling the technology "PostgreSQL" does not step around the shipped catalog', () => {
    const t = JSON.parse(text);
    t.technology = 'PostgreSQL';
    t.catalog.metrics.find((m) => m.legacy_name === 'dump_schedule').declared_target = true;
    const cat = MetricCatalog.fromData('PostgreSQL', t.catalog);
    t.declarations.dump_schedule = 'daily';
    t.fingerprint.catalog = catalogFingerprint(cat);
    t.fingerprint.rules = rulesFingerprint(cat);
    t.fingerprint.declarations = declarationsFingerprint(cat, t.declarations);
    assert.throws(() => loadRulesBundle(t), /does not match its content|not declared targets: dump_schedule/);
  });
  it('the command line refuses a tampered bundle with exit 1', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bundle-'));
    after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const ok = path.join(dir, 'ok.json');
    const bad = path.join(dir, 'bad.json');
    fs.writeFileSync(ok, text);
    const t = JSON.parse(text);
    t.catalog.metrics.find((m) => m.metric_id === 'FUT-2.1').evaluation_config = { min: 1 };
    fs.writeFileSync(bad, JSON.stringify(t));
    const script = path.resolve(__dirname, '../scripts/rules-bundle.js');
    assert.equal(spawnSync(process.execPath, [script, 'verify', ok], { encoding: 'utf8' }).status, 0);
    const r = spawnSync(process.execPath, [script, 'verify', bad], { encoding: 'utf8' });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /INVALID/);
  });
});

describe('1.16.0 honest DEV sample (postgresql-dev-loose)', () => {
  const opts = { systemFacts: dev.systemFacts, workloadProfile: dev.workloadProfile };
  const r = pg.calculate(dev.values, opts);

  it('scores 84.28 of 100 against a target of 91.23: "good", target not reached, no critical problem', () => {
    // 1.17.0: the five checks it fails, plus five it was not assessed on (the
    // four agent-only checks of a standalone run and the restore throughput
    // attestation), which now count 0 and stay required.
    assert.equal(r.totalScore, 84.28);
    assert.equal(r.totalMaxScore, 100);
    assert.equal(r.targetScore, 91.23);
    assert.equal(r.pointsNotAssessed, 5.57);
    assert.equal(r.status, 'good');
    assert.equal(r.onTarget, false);
    assert.deepEqual(r.requiredMissed.filter((m) => m.reason !== 'missing').map((m) => m.id).sort(), ['BAK-2.3', 'BAK-4.3', 'BAK-4.4', 'CAP-2.2', 'SEC-3.5']);
    assert.deepEqual(r.requiredMissed.filter((m) => m.reason === 'missing').map((m) => m.id).sort(), ['BAK-2.2', 'BAK-4.8', 'CAP-1.2', 'CAP-1.7', 'SEC-1.4']);
    assert.equal(r.disposition.state, 'clear');
  });
  it('misses its target only on required debt that no declaration touches', () => {
    const lost = r.allMetrics.filter((m) => m.scored && m.required && m.score < m.maxScore).map((m) => m.name).sort();
    assert.deepEqual(lost, ['connection_pooler', 'dr_plan_documented', 'log_retention_days', 'recovery_tested', 'restore_tested']);
  });
  it('the same DEV with that debt paid reaches its target once every required check is assessed', () => {
    const paid = { ...dev.values, connection_pooler: true, dr_plan_documented: true, log_retention_days: 90,
      recovery_tested: true, restore_tested: true };
    // Standalone: only what was not assessed stands between it and its target.
    const fixed = pg.calculate(paid, opts);
    assert.equal(fixed.onTarget, false);
    assert.ok(fixed.requiredMissed.every((m) => m.reason === 'missing'));
    // Collected by the agent, with the restore throughput attested: on target.
    const full = pg.calculate({ ...paid, last_backup_age_hours: 12, failed_auth_24h: 0, growth_rate: 200, disk_usage_pct: 60,
      restore_throughput_mb_s: 200 }, { ...opts, ...AGENT });
    assert.equal(full.onTarget, true);
    assert.equal(full.targetAttainment, 100);
    assert.equal(full.status, 'excellent');
    assert.ok(full.allMetrics.filter((m) => m.applicable !== false && !m.scored).every((m) => m.required === false),
      'what is left unassessed is not required (no backup tool to detect with archiving off)');
    assert.deepEqual(full.requiredMissed, []);
  });
  it('extra effort raises the score but never makes up for a missed required check', () => {
    // Fully collected (1.17.0), so the score is not held down by checks a
    // standalone run cannot assess.
    const collected = { ...dev.values, last_backup_age_hours: 12, failed_auth_24h: 0, growth_rate: 200, disk_usage_pct: 60,
      restore_throughput_mb_s: 200 };
    const base = pg.calculate(collected, { ...opts, ...AGENT });
    const more = pg.calculate({ ...collected, archive_mode: 'on', archive_command: 'pgbackrest --stanza=main archive-push %p',
      pitr_enabled: true }, { ...opts, ...AGENT });
    assert.ok(more.totalScore > base.totalScore, `${more.totalScore} > ${base.totalScore}`);
    assert.ok(more.totalScore > more.targetScore, 'the score is above the target');
    // Archiving brings its own checks (command, failures, timeout), not
    // required either: they join the section's weight, so the target moves a
    // little (91.23 to 90.24). A practice switched on is an applicability
    // fact, so the target may move with it (1.17.0: never with collection).
    assert.equal(more.targetScore, 90.24);
    assert.equal(more.status, 'good');
    assert.equal(more.onTarget, false);
    assert.deepEqual(more.requiredMissed.map((m) => m.id).sort(), ['BAK-2.3', 'BAK-4.3', 'BAK-4.4', 'CAP-2.2', 'SEC-3.5']);
  });
  it('declaring nothing on the same estate raises the target to the maximum', () => {
    const silent = { ...dev.values };
    for (const k of DECLARATIONS) delete silent[k];
    const s = pg.calculate(silent, opts);
    assert.equal(s.targetScore, 100);
    assert.ok(s.targetAttainment < r.targetAttainment, `${s.targetAttainment} < ${r.targetAttainment}`);
  });
});

describe('1.16.0 a rule that takes required points leaves the target unreached (gate re-check 2026-09-29)', () => {
  // PG-CR-SYNC-1 takes 4 Backup points while synchronous_commit=local passes
  // on its own: no check is missed, but the required points fall below the target.
  const run = () => pg.calculate(
    { ...healthy.values, synchronous_commit: 'local', synchronous_standby_names_count: 1 },
    { workloadProfile: healthy.workloadProfile, systemFacts: healthy.systemFacts, ...AGENT },
  );

  it('reads "good", below 100 percent of the target, never "excellent"', () => {
    const r = run();
    assert.ok(r.requiredScore < r.targetScore, `${r.requiredScore} < ${r.targetScore}`);
    assert.equal(r.onTarget, false);
    assert.equal(r.status, 'good');
    assert.ok(r.targetAttainment < 100);
    assert.equal(r.pillars.backup.onTarget, false);
    assert.ok(r.pillars.backup.targetAttainment < 100);
  });

  it('names the rule in requiredMissed, so the "target not reached" flag has a cause', () => {
    const r = run();
    assert.deepEqual(r.requiredMissed.map((m) => [m.id, m.reason, m.pillar]), [['PG-CR-SYNC-1', 'rule', 'backup']]);
  });
});

describe('1.16.0 "target not reached" always names a cause (gate re-check 2026-09-29)', () => {
  const withRule = (rule) => {
    const data = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../data/metrics/postgresql.json'), 'utf8'));
    data.consistency_rules.push(rule);
    return new ScoringEngine('postgresql', { catalog: MetricCatalog.fromData('postgresql', data) })
      .calculate(healthy.values, { workloadProfile: healthy.workloadProfile, systemFacts: healthy.systemFacts, ...AGENT });
  };
  const rule = (id, adjustments) => ({
    rule_id: id, title: id, description: 'test rule', applies_when: { metric: 'ssl_enabled', in: ['on'] },
    on_violation: { severity: 'warning', score_adjustments: adjustments, title: id, description: 'test', remediation: 'test' },
  });
  const pillarsOf = (r) => new Set(r.requiredMissed.map((m) => m.pillar));

  it('a rule that only caps a section is listed with that section', () => {
    const r = withRule(rule('TEST-CAP-ONLY', [{ type: 'subcategory_cap', target: 'backup_recovery', cap_pct: 50 }]));
    assert.equal(r.onTarget, false);
    assert.deepEqual(r.requiredMissed.map((m) => [m.id, m.reason, m.pillar, m.subcategory]), [['TEST-CAP-ONLY', 'rule', 'backup', 'backup_recovery']]);
  });

  it('a rule acting on two pillars is listed under both', () => {
    const r = withRule(rule('TEST-TWO-PILLARS', [
      { type: 'subcategory_deduction', target: 'capacity_connections', points: 2 },
      { type: 'subcategory_deduction', target: 'perf_locks', points: 2 },
    ]));
    assert.equal(r.onTarget, false);
    assert.deepEqual([...pillarsOf(r)].sort(), ['capacity', 'performance']);
    assert.ok(r.requiredMissed.every((m) => m.id === 'TEST-TWO-PILLARS' && m.reason === 'rule'));
  });

  it('on every shipped sample, each pillar off target has at least one entry in requiredMissed', () => {
    for (const file of fs.readdirSync(SAMPLES_DIR).filter((f) => f.endsWith('.json'))) {
      const s = JSON.parse(fs.readFileSync(path.join(SAMPLES_DIR, file), 'utf8'));
      const r = new ScoringEngine(file.split('-')[0]).calculate(s.values, { systemFacts: s.systemFacts || {}, workloadProfile: s.workloadProfile || 'mixed' });
      assert.equal(r.onTarget, r.requiredMissed.length === 0, `${file}: onTarget ${r.onTarget} with ${r.requiredMissed.length} missed`);
      for (const [id, p] of Object.entries(r.pillars)) {
        if (!p.onTarget) assert.ok(pillarsOf(r).has(id), `${file}: pillar ${id} off target with no cause listed`);
      }
    }
  });

  it('a bundle for a technology this package does not ship may carry rules but no declarations', () => {
    const rename = (b, name) => {
      b.technology = name;
      const cat = MetricCatalog.fromData(name, b.catalog);
      b.fingerprint.catalog = catalogFingerprint(cat);
      b.fingerprint.rules = rulesFingerprint(cat);
      if (b.declarations) b.fingerprint.declarations = declarationsFingerprint(cat, b.declarations);
      return b;
    };
    const withDecl = () => JSON.parse(JSON.stringify(exportRulesBundle('postgresql', { declarations: { rpo_target: 'rpo_60' } })));
    assert.throws(() => loadRulesBundle(rename(withDecl(), 'postgres')), /need a technology this package ships/);
    const rulesOnly = rename(JSON.parse(JSON.stringify(exportRulesBundle('postgresql'))), 'postgres');
    assert.equal(loadRulesBundle(rulesOnly).technology, 'postgres');
  });

  it('a shipped technology loads in its catalog spelling, and a hand-edited spelling no longer matches its codes', () => {
    const b = JSON.parse(JSON.stringify(exportRulesBundle('oracle')));
    assert.equal(loadRulesBundle(b).catalog.technology, 'oracle');
    for (const name of ['Oracle', ' oracle ']) {
      const e = JSON.parse(JSON.stringify(b));
      e.technology = name;
      const cat = MetricCatalog.fromData(name, e.catalog);
      e.fingerprint.catalog = catalogFingerprint(cat);
      e.fingerprint.rules = rulesFingerprint(cat);
      assert.throws(() => loadRulesBundle(e), /does not match its content/, name);
    }
  });
});
