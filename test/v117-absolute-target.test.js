'use strict';

/**
 * 1.17.0 absolute target.
 * The target depends on the catalog, the declarations and the applicability
 * facts only, never on what a run collected; an uncollected check counts 0
 * points and is reported in pointsNotAssessed; a check outside the run's
 * collection scope never triggers a gate or cap.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const ScoringEngine = require('../src/scoring/engine');
const { MetricCatalog } = require('../src/catalog');

const SAMPLES_DIR = path.resolve(__dirname, '../data/samples');
const loadSample = (file) => JSON.parse(fs.readFileSync(path.join(SAMPLES_DIR, file), 'utf8'));
const healthy = loadSample('postgresql-healthy.json');
const oraHealthy = loadSample('oracle-healthy.json');
const AGENT = { mode: 'agent', availableSources: ['sql', 'manual', 'zabbix', 'worker'] };
const pg = new ScoringEngine('postgresql');
const ora = new ScoringEngine('oracle');
const optsOf = (s) => ({ systemFacts: s.systemFacts || {}, workloadProfile: s.workloadProfile || 'mixed' });
const run = (over = {}, opts = {}, sample = healthy, engine = pg) => {
  const values = { ...sample.values, ...over };
  for (const k of Object.keys(values)) if (values[k] === undefined) delete values[k];
  return engine.calculate(values, { ...optsOf(sample), ...opts });
};
const metric = (r, name) => r.allMetrics.find((m) => m.name === name);
const near = (a, b) => Math.abs(a - b) < 0.011;

describe('1.17.0 the target does not depend on what was collected', () => {
  const full = run({}, AGENT);

  it('a required non-critical check left uncollected keeps the target', () => {
    const r = run({ log_retention_days: undefined }, AGENT);
    assert.equal(metric(r, 'log_retention_days').scored, false);
    assert.equal(r.targetScore, full.targetScore);
    assert.equal(r.pillars[metric(r, 'log_retention_days').pillar].target, full.pillars[metric(full, 'log_retention_days').pillar].target);
  });

  it('a section with nothing collected keeps its points in the maximum and the target', () => {
    const sid = metric(full, 'log_retention_days').subcategory;
    const names = full.allMetrics.filter((m) => m.subcategory === sid && m.criticality !== 'critical').map((m) => m.name);
    const r = run(Object.fromEntries(names.map((n) => [n, undefined])), AGENT);
    assert.equal(r.subcategories[sid].maxScore, full.subcategories[sid].maxScore);
    assert.equal(r.subcategories[sid].target, full.subcategories[sid].target);
    assert.equal(r.targetScore, full.targetScore);
    assert.equal(r.totalMaxScore, 100);
  });

  it('a standalone run and an agent run have the same target', () => {
    // A catalog copy where a sibling of the agent-only backup-age check is
    // not required at the DEV's 24-hour RPO: a target that followed
    // collection would move when the agent-only check joins the section.
    const data = JSON.parse(JSON.stringify(require('../data/metrics/postgresql.json')));
    const sibling = data.metrics.find((m) => m.subcategory === 'backup_dumps' && m.legacy_name !== 'last_backup_age_hours' && !m.optional_when);
    sibling.optional_when = { metric: 'rpo_target', in: ['rpo_1440'] };
    const eng = new ScoringEngine('postgresql', { catalog: MetricCatalog.fromData('postgresql', data) });
    const dev = loadSample('postgresql-dev-loose.json');
    const standalone = run({}, {}, dev, eng);
    const agent = run({ last_backup_age_hours: 12, failed_auth_24h: 0, growth_rate: 200, disk_usage_pct: 60 }, AGENT, dev, eng);
    assert.ok(standalone.subcategories.backup_dumps.target < standalone.subcategories.backup_dumps.maxScore, 'the section mixes required and optional checks');
    assert.equal(standalone.targetScore, agent.targetScore);
    for (const pid of Object.keys(agent.pillars)) assert.equal(standalone.pillars[pid].target, agent.pillars[pid].target, pid);
    for (const sid of Object.keys(agent.subcategories)) assert.equal(standalone.subcategories[sid].target, agent.subcategories[sid].target, sid);
  });
});

describe('1.17.0 an uncollected check counts 0 and is reported', () => {
  it('a missing non-critical check costs its share of the section', () => {
    const full = run({}, AGENT);
    const r = run({ log_retention_days: undefined }, AGENT);
    assert.ok(r.totalScore < full.totalScore, `${r.totalScore} < ${full.totalScore}`);
    assert.ok(near(full.totalScore - r.totalScore, r.pointsNotAssessed), 'the score drops by exactly the points not assessed');
  });

  it('a required non-critical check with no value is listed as missing and keeps the status below "excellent"', () => {
    const r = run({ log_retention_days: undefined }, AGENT);
    const m = metric(r, 'log_retention_days');
    assert.notEqual(m.criticality, 'critical');
    assert.deepEqual(r.requiredMissed.filter((x) => x.id === m.metric_id).map((x) => x.reason), ['missing']);
    assert.equal(r.onTarget, false);
    assert.notEqual(r.status, 'excellent');
  });

  it('a check outside the collection scope is listed with outOfScope, never caps its pillar, and stays out of the disposition items', () => {
    const r = run();
    const disk = metric(r, 'disk_usage_pct');
    assert.equal(disk.criticality, 'critical');
    assert.equal(disk.outOfScope, true);
    assert.equal(disk.scored, false);
    assert.equal(disk.value, 'not in scope');
    assert.ok(!r.pillars.capacity.criticalGated, 'an agent-only critical never caps a standalone run');
    assert.deepEqual(r.requiredMissed.filter((x) => x.id === disk.metric_id).map((x) => [x.reason, x.outOfScope]), [['missing', true]]);
    assert.ok(!r.disposition.items.some((i) => i.id === disk.metric_id));
    assert.ok(r.disposition.unassessed.some((i) => i.id === disk.metric_id));
  });

  it('an out-of-scope check whose applicability reads an uncollected value stays on the ruler', () => {
    const data = JSON.parse(JSON.stringify(require('../data/metrics/postgresql.json')));
    data.metrics.find((m) => m.legacy_name === 'disk_usage_pct').applies_when = { metric: 'never_collected_value', is_truthy: true };
    const r = run({}, {}, healthy, new ScoringEngine('postgresql', { catalog: MetricCatalog.fromData('postgresql', data) }));
    assert.equal(metric(r, 'disk_usage_pct').outOfScope, true);
    assert.notEqual(metric(r, 'disk_usage_pct').applicable, false);
  });

  it('a payload value for an out-of-scope check is not scored', () => {
    const r = run({ disk_usage_pct: 99 });
    assert.equal(metric(r, 'disk_usage_pct').scored, false);
    assert.equal(metric(r, 'disk_usage_pct').outOfScope, true);
  });

  it('pointsNotAssessed adds up: checks into sections, sections into pillars, pillars into the total', () => {
    const r = run();
    let total = 0;
    for (const [pid, p] of Object.entries(r.pillars)) {
      const subs = Object.values(r.subcategories).filter((x) => x.pillar === pid);
      assert.ok(near(subs.reduce((a, x) => a + x.pointsNotAssessed, 0), p.pointsNotAssessed), pid);
      total += p.pointsNotAssessed;
    }
    assert.ok(near(total, r.pointsNotAssessed));
    // The four agent-only checks of a standalone run, at their share of their sections.
    for (const [sid, x] of Object.entries(r.subcategories)) {
      const missing = r.allMetrics.filter((m) => m.subcategory === sid && m.applicable !== false && !m.scored && !m.undeclared);
      const weights = r.allMetrics.filter((m) => m.subcategory === sid && m.applicable !== false);
      const expected = missing.length === 0 ? 0
        : (missing.reduce((a, m) => a + m.maxScore, 0) / weights.reduce((a, m) => a + m.maxScore, 0)) * x.maxScore;
      assert.ok(near(x.pointsNotAssessed, expected), `${sid}: ${x.pointsNotAssessed} vs ${expected}`);
    }
  });

  for (const [label, opts] of [['standalone', {}], ['agent', AGENT]]) {
    it(`on every shipped sample (${label}), score plus points not assessed never exceeds the maximum, and onTarget is false exactly when requiredMissed is non-empty`, () => {
      for (const file of fs.readdirSync(SAMPLES_DIR).filter((f) => f.endsWith('.json'))) {
        const s = loadSample(file);
        const r = new ScoringEngine(file.split('-')[0]).calculate(s.values, { ...optsOf(s), ...opts });
        assert.ok(r.totalScore + r.pointsNotAssessed <= r.totalMaxScore + 0.011, `${file}: ${r.totalScore} + ${r.pointsNotAssessed}`);
        for (const [pid, p] of Object.entries(r.pillars)) {
          assert.ok(p.score + p.pointsNotAssessed <= p.maxScore + 0.011, `${file} ${pid}`);
          if (!p.onTarget) assert.ok(r.requiredMissed.some((m) => m.pillar === pid), `${file}: pillar ${pid} off target with no cause listed`);
        }
        assert.equal(r.onTarget, r.requiredMissed.length === 0, file);
        assert.ok(r.status !== 'excellent' || r.onTarget, file);
      }
    });
  }
});

describe('1.17.0 applicability', () => {
  it('a healthy Oracle Data Guard primary, shaped as the collector sends it, scores 100 (catalog 1.11.0)', () => {
    // On a primary the collector reports dataguard_configured=true, omits the
    // standby open mode, the Data Guard statistics are empty, and it counts no
    // local apply process (dataguard_apply_rate false).
    const over = { dataguard_configured: true, dataguard_apply_rate: false, standby_health: undefined, dataguard_apply_lag: undefined,
      dataguard_transport_lag: undefined, dataguard_archive_gap: undefined, dataguard_protection_mode: undefined };
    const r = run(over, {}, oraHealthy, ora);
    assert.equal(r.totalScore, 100);
    assert.equal(r.disposition.state, 'clear');
    for (const n of ['standby_health', 'dataguard_apply_lag', 'dataguard_archive_gap', 'dataguard_apply_rate']) assert.equal(metric(r, n).applicable, false, n);
    // The standby itself still reports and is judged.
    const standby = run({ dataguard_configured: true, standby_health: 'READ WRITE' }, {}, oraHealthy, ora);
    assert.equal(metric(standby, 'standby_health').applicable, undefined);
    assert.equal(metric(standby, 'standby_health').scored, true);
  });

  it('checks the collector omits because they do not apply are not applicable when absent', () => {
    const cases = {
      postgresql: [healthy, pg, { ssl_cert_days_remaining: 365, ssl_enabled: false }, ['ssl_cert_days_remaining'],
        ['tablespace_headroom']],
      oracle: [oraHealthy, ora, {}, [], ['fra_usage_pct', 'archive_log_volume_daily', 'sequence_cache_size', 'sga_target',
        'pga_aggregate_target', 'adaptive_plans', 'cursor_sharing_exact', 'audit_sys_operations', 'control_mgmt_pack_access',
        'securefiles_adoption']],
    };
    for (const [tech, [sample, engine, over, offByPractice, offWhenAbsent]] of Object.entries(cases)) {
      const r = run({ ...over, ...Object.fromEntries(offWhenAbsent.map((n) => [n, undefined])) }, {}, sample, engine);
      for (const n of [...offByPractice, ...offWhenAbsent]) assert.equal(metric(r, n).applicable, false, `${tech} ${n}`);
    }
  });

  it('with an unknown server version, a version-gated check applies when its value was collected and not otherwise', () => {
    const r = run({ summarize_wal: undefined });
    assert.equal(metric(r, 'summarize_wal').applicable, false);
    assert.equal(metric(r, 'summarize_wal').exclusion_reason, 'version_unknown');
    assert.equal(metric(run(), 'summarize_wal').scored, true);
    // A known older server leaves it out even with a value; a known newer one judges its absence.
    assert.equal(metric(run({}, { serverVersion: 160000 }), 'summarize_wal'), undefined);
    assert.equal(metric(run({ summarize_wal: undefined }, { serverVersion: 170000 }), 'summarize_wal').scored, false);
  });

  it('an empty synchronous standby list does not apply, and a declared synchronous standby without names is still caught', () => {
    const r = run({ synchronous_standby_names: '' }, AGENT);
    assert.equal(metric(r, 'synchronous_standby_names').applicable, false);
    assert.equal(r.totalScore, 100);
    const sync = run({ synchronous_standby_names: '', ha_topology: 'sync_standby' }, AGENT);
    assert.ok(sync.allFindings.some((f) => f.rule_id === 'PG-CR-HA-1'));
  });

  it('an empty value is a missing value: an empty archive command with archiving on is a missing critical', () => {
    const r = run({ archive_mode: 'on', archive_command: '' }, AGENT);
    const cmd = metric(r, 'archive_command');
    assert.equal(cmd.scored, false);
    assert.deepEqual(r.requiredMissed.filter((m) => m.id === cmd.metric_id).map((m) => m.reason), ['missing']);
    assert.ok(r.disposition.items.some((i) => i.id === cmd.metric_id && i.reason === 'missing'));
  });

  it('names the version-gated checks an unknown server version left out', () => {
    const r = run({ summarize_wal: undefined });
    const f = r.allFindings.find((x) => x.title.startsWith('Server version unknown'));
    assert.ok(f, 'a finding says the server version is unknown');
    assert.equal(f.severity, 'info');
    assert.match(f.description, new RegExp(metric(r, 'summarize_wal').display_name.replace(/[()]/g, '.')));
    assert.equal(run({}, { serverVersion: 170000 }).allFindings.filter((x) => x.title.startsWith('Server version')).length, 0);
  });

  it('a critical left out by an unknown server version reads "version unknown" and is listed as unassessed', () => {
    const r = run({ stale_replication_slots: undefined });
    const m = metric(r, 'stale_replication_slots');
    assert.equal(m.criticality, 'critical');
    assert.equal(m.value, 'version unknown');
    assert.ok(r.disposition.unassessed.some((i) => i.id === m.metric_id && i.reason === 'version_unknown'));
  });

  it('an uncollected synchronous standby list is unknown, so the synchronous-standby rule stays silent', () => {
    const uncollected = run({ synchronous_standby_names: undefined, ha_topology: 'sync_standby' }, AGENT);
    assert.ok(!uncollected.allFindings.some((f) => f.rule_id === 'PG-CR-HA-1'));
    const empty = run({ synchronous_standby_names: '', ha_topology: 'sync_standby' }, AGENT);
    assert.ok(empty.allFindings.some((f) => f.rule_id === 'PG-CR-HA-1'));
  });

  it('the draft catalogs\' healthy samples lose exactly their agent-only checks in a standalone run', () => {
    const want = { mysql: [95.45, 4.55], mariadb: [95.47, 4.53], mongodb: [97.96, 2.04], sqlserver: [99, 1] };
    for (const [tech, [score, notAssessed]] of Object.entries(want)) {
      const s = loadSample(`${tech}-healthy.json`);
      const r = new ScoringEngine(tech).calculate(s.values, optsOf(s));
      assert.equal(r.totalScore, score, tech);
      assert.equal(r.pointsNotAssessed, notAssessed, tech);
      assert.ok(near(r.totalScore + r.pointsNotAssessed, 100), tech);
    }
  });

  it('a standby whose Data Guard statistics query failed still reads missing criticals', () => {
    const r = run({ dataguard_configured: true, standby_health: 'MOUNTED', dataguard_apply_lag: undefined, dataguard_archive_gap: undefined }, {}, oraHealthy, ora);
    const items = r.disposition.items.map((i) => [i.id, i.reason]);
    assert.ok(items.some(([id, why]) => id === metric(r, 'dataguard_apply_lag').metric_id && why === 'missing'));
    assert.ok(items.some(([id, why]) => id === metric(r, 'dataguard_archive_gap').metric_id && why === 'missing'));
  });

  it('a non-critical declared target left blank costs nothing and is not a missed required check (Adrien, 2026-10-08)', () => {
    const blank = { upgrade_plan: undefined, growth_headroom_target: undefined, security_posture: undefined, ha_topology: undefined };
    const r = run(blank, AGENT);
    assert.equal(r.totalScore, 100);
    assert.equal(r.pointsNotAssessed, 0);
    for (const n of Object.keys(blank)) {
      assert.equal(metric(r, n).undeclared, true, n);
      assert.ok(!r.requiredMissed.some((m) => m.id === metric(r, n).metric_id), n);
    }
    assert.equal(r.targetScore, 100, 'an undeclared estate pays through a target at its maximum');
    for (const n of Object.keys(blank)) assert.equal(metric(r, n).value, 'not declared', n);
    // With failing neighbours too: the same score declared or blank.
    const dev = loadSample('postgresql-dev-loose.json');
    assert.equal(run(blank, {}, dev).totalScore, run({}, {}, dev).totalScore);
    // A blank declaration never empties its section: Oracle Replication with
    // no Data Guard keeps its points whether dr_topology is declared or not.
    const avg = loadSample('oracle-average.json');
    const declared = run({ dr_topology: 'none' }, {}, avg, ora);
    const silent = run({ dr_topology: undefined }, {}, avg, ora);
    assert.equal(silent.totalMaxScore, declared.totalMaxScore);
    assert.equal(silent.totalScore, declared.totalScore);
    // A critical declaration left blank still counts.
    const noRpo = run({ rpo_target: undefined }, AGENT);
    assert.ok(noRpo.totalScore < 100);
    assert.ok(noRpo.requiredMissed.some((m) => m.id === metric(noRpo, 'rpo_target').metric_id && m.reason === 'missing'));
  });
});
