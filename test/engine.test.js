'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const ScoringEngine = require('../src/scoring/engine');
const { MetricCatalog } = require('../src/catalog');

describe('ScoringEngine', () => {
  describe('basic scoring', () => {
    // 1.17.0: an all-passing estate reaches 100 only when every check was
    // assessed, so the agent run (a standalone run cannot collect the
    // agent-only checks and reports their points as not assessed).
    it('returns 100% for all-passing PostgreSQL healthy sample', () => {
      const engine = new ScoringEngine('postgresql');
      const healthy = require('../data/samples/postgresql-healthy.json');
      const result = engine.calculate(healthy.values, { systemFacts: healthy.systemFacts, workloadProfile: healthy.workloadProfile, mode: 'agent', availableSources: ['sql', 'manual', 'zabbix', 'worker'] });

      assert.equal(result.totalScore, 100);
      assert.equal(result.totalPercentage, 100);
      assert.equal(result.status, 'excellent');

      for (const p of Object.values(result.pillars)) {
        assert.equal(p.score, 20);
        assert.equal(p.percentage, 100);
      }
    });

    it('returns reduced score for critical failures', () => {
      const engine = new ScoringEngine('postgresql');
      const critical = require('../data/samples/postgresql-critical.json');
      const result = engine.calculate(critical.values);

      assert.ok(result.totalScore < 100);
      assert.ok(result.totalPercentage < 100);
      assert.ok(result.allFindings.length > 0);
      assert.ok(result.recommendations.length > 0);
    });

    it('accepts Map as input', () => {
      const engine = new ScoringEngine('postgresql');
      const healthy = require('../data/samples/postgresql-healthy.json');
      const map = new Map(Object.entries(healthy.values));
      const result = engine.calculate(map, { systemFacts: healthy.systemFacts, workloadProfile: healthy.workloadProfile, mode: 'agent', availableSources: ['sql', 'manual', 'zabbix', 'worker'] });
      assert.equal(result.totalScore, 100);
    });
  });

  describe('subcategory rollup', () => {
    it('exposes a subcategories map with the documented shape', () => {
      const engine = new ScoringEngine('postgresql');
      const healthy = require('../data/samples/postgresql-healthy.json');
      const result = engine.calculate(healthy.values);
      assert.ok(result.subcategories && typeof result.subcategories === 'object');
      assert.deepEqual(
        Object.keys(result.subcategories.backup_wal).sort(),
        ['hasCriticalFailure', 'maxScore', 'name', 'onTarget', 'percentage', 'pillar', 'pointsNotAssessed', 'score', 'status', 'target', 'targetAttainment']
      );
      assert.equal(result.subcategories.backup_wal.pillar, 'backup');
    });

    it('subcategory scores sum to the pillar score when no pillar gate fires', () => {
      const engine = new ScoringEngine('postgresql');
      const healthy = require('../data/samples/postgresql-healthy.json');
      const result = engine.calculate(healthy.values);
      const sums = {};
      for (const s of Object.values(result.subcategories)) {
        sums[s.pillar] = (sums[s.pillar] || 0) + s.score;
      }
      for (const [pid, p] of Object.entries(result.pillars)) {
        assert.equal(Math.round(sums[pid] * 100) / 100, p.score,
          `subcategory rollup for ${pid} must sum to its pillar score`);
      }
    });

    it('reflects the 60% criticality gate (the number per-metric scores cannot reproduce)', () => {
      const engine = new ScoringEngine('postgresql');
      const healthy = require('../data/samples/postgresql-healthy.json');
      // A placeholder archive command hard-fails a critical check in an
      // otherwise full Log Archiving section (backup_wal, max 5), which the
      // gate caps at 60%. (The critical sample no longer reaches the cap on
      // its own since 1.16.0: with archiving off, the archiving failures count
      // does not apply and the section sits below 60% unaided.)
      const result = engine.calculate({ ...healthy.values, archive_command: '/bin/true' }, {
        systemFacts: healthy.systemFacts || {},
        workloadProfile: healthy.workloadProfile || 'mixed',
      });
      const wal = result.subcategories.backup_wal;
      assert.equal(wal.score, 3);
      assert.equal(wal.maxScore, 5);
      assert.equal(wal.percentage, 60);
      assert.equal(wal.hasCriticalFailure, true);
    });

    it('propagates the pillar zero gate to the subcategory map', () => {
      const engine = new ScoringEngine('postgresql');
      const critical = require('../data/samples/postgresql-critical.json');
      const result = engine.calculate(critical.values, {
        systemFacts: critical.systemFacts || {},
        workloadProfile: critical.workloadProfile || 'mixed',
      });
      // version_supported (gate_scope=pillar) fails in this sample -> futureproof pillar = 0.
      assert.equal(result.pillars.futureproof.score, 0);
      const futureSubs = Object.values(result.subcategories).filter(s => s.pillar === 'futureproof');
      assert.ok(futureSubs.length > 0);
      for (const s of futureSubs) {
        assert.equal(s.score, 0, `${s.name} must be zeroed with its gated pillar`);
        assert.equal(s.percentage, 0);
        assert.equal(s.zeroedByPillarGate, true);
      }
      // A non-gated pillar keeps its subcategory scores and carries no flag.
      const backupSubs = Object.values(result.subcategories).filter(s => s.pillar === 'backup');
      assert.ok(backupSubs.some(s => s.score > 0));
      for (const s of backupSubs) assert.equal('zeroedByPillarGate' in s, false);
    });

    it('subcategory sums match the pillar score when the gate fires (oracle backup)', () => {
      const engine = new ScoringEngine('oracle');
      const critical = require('../data/samples/oracle-critical.json');
      const result = engine.calculate(critical.values, {
        systemFacts: critical.systemFacts || {},
        workloadProfile: critical.workloadProfile || 'mixed',
        licensedOptions: critical.licensedOptions || [],
      });
      // archive_log_mode (gate_scope=pillar) fails in this sample -> backup pillar = 0.
      assert.equal(result.pillars.backup.score, 0);
      const sum = Object.values(result.subcategories)
        .filter(s => s.pillar === 'backup')
        .reduce((acc, s) => acc + s.score, 0);
      assert.equal(sum, 0, 'gated pillar subcategories must sum to the zeroed pillar score');
    });
  });

  describe('status thresholds', () => {
    // Test using a minimal custom catalog to control exact scores
    function createMinimalCatalog() {
      return {
        version: '1.0.0',
        pillars: {
          test: { name: 'Test', maxPoints: 20, order: 1 },
        },
        subcategories: {
          test_sub: { pillar: 'test', name: 'Test Sub', maxPoints: 20, order: 1 },
        },
        metrics: [{
          metric_id: 'T-1',
          subcategory: 'test_sub',
          legacy_name: 'test_val',
          display_name: 'Test Value',
          description: 'Test',
          criticality: 'important',
          weight: null,
          evaluation_type: 'threshold',
          evaluation_config: { max: 100 },
          sources: ['sql'],
          agent_only: false,
          deployment_profiles: null,
          min_pg_version: null,
          extension_requirement: null,
          metric_tier: 'baseline',
          remediation: 'Fix it',
        }],
      };
    }

    it('returns excellent for >= 85%', () => {
      const cat = MetricCatalog.fromData('test', createMinimalCatalog());
      const engine = new ScoringEngine();
      engine.catalog = cat;
      const result = engine.calculate({ test_val: 50 }); // passes → 100%
      assert.equal(result.status, 'excellent');
    });
  });

  describe('criticality gates', () => {
    function createGateCatalog() {
      return {
        version: '1.0.0',
        pillars: {
          test: { name: 'Test', maxPoints: 20, order: 1 },
        },
        subcategories: {
          test_sub: { pillar: 'test', name: 'Test Sub', maxPoints: 20, order: 1 },
        },
        metrics: [
          {
            metric_id: 'T-1',
            subcategory: 'test_sub',
            legacy_name: 'critical_metric',
            display_name: 'Critical Metric',
            description: 'Must pass',
            criticality: 'critical',
            weight: null,
            evaluation_type: 'boolean',
            evaluation_config: { pass_value: true },
            sources: ['sql'],
            agent_only: false,
            deployment_profiles: null,
            min_pg_version: null,
            extension_requirement: null,
            metric_tier: 'baseline',
            remediation: 'Fix it',
          },
          {
            metric_id: 'T-2',
            subcategory: 'test_sub',
            legacy_name: 'advisory_metric',
            display_name: 'Advisory Metric',
            description: 'Nice to have',
            criticality: 'advisory',
            weight: null,
            evaluation_type: 'boolean',
            evaluation_config: { pass_value: true },
            sources: ['sql'],
            agent_only: false,
            deployment_profiles: null,
            min_pg_version: null,
            extension_requirement: null,
            metric_tier: 'baseline',
            remediation: 'Optional fix',
          },
        ],
      };
    }

    it('caps subcategory at 60% when critical metric fails', () => {
      const cat = MetricCatalog.fromData('test', createGateCatalog());
      const engine = new ScoringEngine();
      engine.catalog = cat;

      // Critical fails, advisory passes
      const result = engine.calculate({ critical_metric: false, advisory_metric: true });
      const pillar = result.pillars.test;

      // Without gate: advisory passes (1pt) + critical fails (0pt) → 1/4 weight → 5/20
      // With gate: score is capped at 60% of 20 = 12
      // Actual: weighted = 1/4 * 20 = 5.0, cap = 12.0 → 5.0 (below cap, no actual capping)
      // But the gate IS triggered because a critical failed
      assert.ok(pillar.score <= 20 * 0.6, 'Score should be at or below 60% cap');
    });

    it('does not cap when all critical metrics pass', () => {
      const cat = MetricCatalog.fromData('test', createGateCatalog());
      const engine = new ScoringEngine();
      engine.catalog = cat;

      const result = engine.calculate({ critical_metric: true, advisory_metric: true });
      const pillar = result.pillars.test;

      assert.equal(pillar.score, 20);
      assert.equal(pillar.percentage, 100);
    });

    it('treats missing critical metric as failure', () => {
      const cat = MetricCatalog.fromData('test', createGateCatalog());
      const engine = new ScoringEngine();
      engine.catalog = cat;

      // critical_metric not provided, advisory passes
      const result = engine.calculate({ advisory_metric: true });
      const pillar = result.pillars.test;

      assert.ok(pillar.score < 20, 'Missing critical should reduce score');
    });

    it('emits a gate finding even when raw score is already below the 60% cap', () => {
      const cat = MetricCatalog.fromData('test', createGateCatalog());
      const engine = new ScoringEngine();
      engine.catalog = cat;

      // Both fail: critical (weight 3) + advisory (weight 1) → weighted 0/4 → 0/20
      // Cap = 12, raw = 0 → no actual capping, but gate IS active.
      const result = engine.calculate({ critical_metric: false, advisory_metric: false });
      const pillar = result.pillars.test;

      assert.equal(pillar.score, 0, 'Score should be 0 (no capping needed)');

      const gateFinding = result.allFindings.find(f =>
        f.title && f.title.includes('critical gate active'));
      assert.ok(gateFinding, 'Gate finding should be emitted even when no capping applied');
      assert.ok(gateFinding.description.includes('Critical Metric'),
        'Finding description should name the failing critical metric');
    });

    function createPartialCreditGateCatalog() {
      return {
        version: '1.0.0',
        pillars: {
          test: { name: 'Test', maxPoints: 20, order: 1 },
        },
        subcategories: {
          test_sub: { pillar: 'test', name: 'Test Sub', maxPoints: 20, order: 1 },
        },
        metrics: [{
          metric_id: 'T-1',
          subcategory: 'test_sub',
          legacy_name: 'lag_minutes',
          display_name: 'Replication Lag',
          description: 'Replication lag in minutes',
          criticality: 'critical',
          weight: null,
          evaluation_type: 'threshold',
          evaluation_config: { max: 5 },
          sources: ['sql'],
          agent_only: false,
          deployment_profiles: null,
          min_pg_version: null,
          extension_requirement: null,
          metric_tier: 'baseline',
          remediation: 'Reduce lag',
        }],
      };
    }

    it('triggers gate (with partial-credit context) when a critical threshold metric scores partial', () => {
      const cat = MetricCatalog.fromData('test', createPartialCreditGateCatalog());
      const engine = new ScoringEngine();
      engine.catalog = cat;

      // value=8 with max=5: within 2x, partial credit = 3 * 0.5 = 1.5 (exact,
      // never rounded since 1.15.0) → weighted 1.5/3 → normalized 10 of 20,
      // already below the 60% cap, so the gate is reported as active, not capping.
      const result = engine.calculate({ lag_minutes: 8 });
      const pillar = result.pillars.test;

      assert.equal(pillar.score, 10, 'Partial-credit critical earns exactly half');

      const gateFinding = result.allFindings.find(f =>
        f.title && f.title.includes('critical gate active'));
      assert.ok(gateFinding, 'Gate finding should be emitted for a partial-credit critical');
      assert.ok(gateFinding.description.includes('partial credit 1.5/3'),
        'Finding description should reference partial-credit context');
      assert.ok(gateFinding.description.includes('lag_minutes=8') ||
        gateFinding.description.includes('Replication Lag=8'),
        'Finding description should include the failing value');
    });
  });

  describe('pillar zero gate', () => {
    function createPillarGateCatalog() {
      return {
        version: '1.0.0',
        pillars: {
          test: { name: 'Test', maxPoints: 20, order: 1 },
        },
        subcategories: {
          test_sub: { pillar: 'test', name: 'Test Sub', maxPoints: 20, order: 1 },
        },
        metrics: [
          {
            metric_id: 'T-1',
            subcategory: 'test_sub',
            legacy_name: 'gate_metric',
            display_name: 'Gate Metric',
            description: 'Pillar gate',
            criticality: 'critical',
            weight: null,
            evaluation_type: 'boolean',
            evaluation_config: { pass_value: true },
            sources: ['sql'],
            agent_only: false,
            deployment_profiles: null,
            min_pg_version: null,
            extension_requirement: null,
            metric_tier: 'baseline',
            remediation: 'Fix gate',
            gate_scope: 'pillar',
          },
          {
            metric_id: 'T-2',
            subcategory: 'test_sub',
            legacy_name: 'other_metric',
            display_name: 'Other Metric',
            description: 'Regular metric',
            criticality: 'important',
            weight: null,
            evaluation_type: 'boolean',
            evaluation_config: { pass_value: true },
            sources: ['sql'],
            agent_only: false,
            deployment_profiles: null,
            min_pg_version: null,
            extension_requirement: null,
            metric_tier: 'baseline',
            remediation: 'Fix it',
          },
        ],
      };
    }

    it('zeros entire pillar when pillar-gate critical metric fails', () => {
      const cat = MetricCatalog.fromData('test', createPillarGateCatalog());
      const engine = new ScoringEngine();
      engine.catalog = cat;

      const result = engine.calculate({ gate_metric: false, other_metric: true });
      assert.equal(result.pillars.test.score, 0, 'Pillar should be zeroed');

      const gateFindings = result.allFindings.filter(f => f.title.includes('zeroed'));
      assert.ok(gateFindings.length > 0, 'Should have pillar zero finding');
    });

    it('does not zero pillar when gate metric passes', () => {
      const cat = MetricCatalog.fromData('test', createPillarGateCatalog());
      const engine = new ScoringEngine();
      engine.catalog = cat;

      const result = engine.calculate({ gate_metric: true, other_metric: true });
      assert.equal(result.pillars.test.score, 20);
    });
  });

  describe('multi-technology support', () => {
    for (const tech of ['postgresql', 'mysql', 'oracle', 'mariadb', 'mongodb', 'sqlserver']) {
      it(`creates engine for ${tech}`, () => {
        const engine = new ScoringEngine(tech);
        assert.ok(engine.catalog);
        assert.ok(engine.catalog.metrics.length > 0);
      });
    }
  });

  describe('recommendations', () => {
    it('generates recommendations for failed metrics', () => {
      const engine = new ScoringEngine('postgresql');
      const critical = require('../data/samples/postgresql-critical.json');
      const result = engine.calculate(critical.values);

      assert.ok(result.recommendations.length > 0);
      for (const rec of result.recommendations) {
        assert.ok(rec.priority);
        assert.ok(rec.title);
        assert.ok(rec.action);
      }
    });

    it('limits recommendations to 15 metric findings', () => {
      const engine = new ScoringEngine('postgresql');
      const critical = require('../data/samples/postgresql-critical.json');
      const result = engine.calculate(critical.values);

      const metricRecs = result.recommendations.filter(r => r.potentialGain !== undefined);
      assert.ok(metricRecs.length <= 15);
    });
  });

  describe('edge cases', () => {
    it('cleanly excludes a subcategory whose metrics all filter out (no NaN)', () => {
      const cat = MetricCatalog.fromData('test', {
        version: '1.0.0',
        pillars: { test: { name: 'Test', maxPoints: 20, order: 1 } },
        subcategories: {
          filtered_sub: { pillar: 'test', name: 'Filtered Sub', maxPoints: 20, order: 1 },
        },
        metrics: [{
          metric_id: 'T-1',
          subcategory: 'filtered_sub',
          legacy_name: 'future_metric',
          display_name: 'Future Metric',
          description: 'Requires PG 20+',
          criticality: 'critical',
          weight: null,
          evaluation_type: 'boolean',
          evaluation_config: { pass_value: true },
          sources: ['sql'],
          agent_only: false,
          deployment_profiles: null,
          min_pg_version: 200000,
          extension_requirement: null,
          metric_tier: 'baseline',
          remediation: 'Upgrade',
        }],
      });
      const engine = new ScoringEngine();
      engine.catalog = cat;

      // pgVersion 17 → the metric filters out → subcategory has zero active metrics
      const result = engine.calculate({}, { pgVersion: 170000 });

      assert.ok(result.pillars.test, 'Pillar should still exist in the result');
      assert.equal(result.pillars.test.metrics.length, 0, 'No metrics should be scored');
      assert.ok(!Number.isNaN(result.pillars.test.score), 'Pillar score must not be NaN');
      assert.ok(!Number.isNaN(result.totalScore), 'Total score must not be NaN');
      assert.ok(!Number.isNaN(result.totalPercentage), 'Total percentage must not be NaN');
    });
  });

  describe('workload profile + size-relative thresholds (v1.5.0)', () => {
    function createProfileCatalog() {
      return {
        version: '1.0.0',
        pillars: {
          test: { name: 'Test', maxPoints: 20, order: 1 },
        },
        subcategories: {
          test_sub: { pillar: 'test', name: 'Test Sub', maxPoints: 20, order: 1 },
        },
        metrics: [{
          metric_id: 'T-1',
          subcategory: 'test_sub',
          legacy_name: 'cache_hit_ratio',
          display_name: 'Cache Hit Ratio',
          description: 'Buffer cache hit ratio',
          criticality: 'important',
          weight: null,
          evaluation_type: 'threshold',
          evaluation_config: {
            profiles: {
              default: { min: 95 },
              oltp:    { min: 98 },
              olap:    { min: 85 },
              mixed:   { min: 95 },
            },
          },
          sources: ['sql'],
          agent_only: false,
          deployment_profiles: null,
          min_pg_version: null,
          extension_requirement: null,
          metric_tier: 'baseline',
          remediation: 'Tune shared_buffers',
        }],
      };
    }

    it('cache_hit_ratio=88 passes under olap profile, fails under oltp', () => {
      const cat = MetricCatalog.fromData('test', createProfileCatalog());
      const engine = new ScoringEngine();
      engine.catalog = cat;

      const olap = engine.calculate({ cache_hit_ratio: 88 }, { workloadProfile: 'olap' });
      const oltp = engine.calculate({ cache_hit_ratio: 88 }, { workloadProfile: 'oltp' });

      assert.equal(olap.pillars.test.score, 20, 'OLAP profile should treat 88 as healthy');
      assert.ok(oltp.pillars.test.score < 20, 'OLTP profile should not treat 88 as healthy');
    });

    function createRelativeCatalog() {
      return {
        version: '1.0.0',
        pillars: {
          test: { name: 'Test', maxPoints: 20, order: 1 },
        },
        subcategories: {
          test_sub: { pillar: 'test', name: 'Test Sub', maxPoints: 20, order: 1 },
        },
        metrics: [{
          metric_id: 'T-1',
          subcategory: 'test_sub',
          legacy_name: 'maintenance_work_mem',
          display_name: 'Maintenance Work Mem',
          description: 'maintenance_work_mem sizing relative to RAM',
          criticality: 'important',
          weight: null,
          evaluation_type: 'threshold',
          evaluation_config: {
            min_pct: 5,
            min_pct_of: 'ram_kb',
            absolute_floor: { min: 65536 },
            unit: 'kB',
          },
          sources: ['sql'],
          agent_only: false,
          deployment_profiles: null,
          min_pg_version: null,
          extension_requirement: null,
          metric_tier: 'baseline',
          remediation: 'Increase maintenance_work_mem',
        }],
      };
    }

    it('maintenance_work_mem = 5% of 16 GB RAM passes; 5% of 1 TB RAM requires more', () => {
      const cat = MetricCatalog.fromData('test', createRelativeCatalog());
      const engine = new ScoringEngine();
      engine.catalog = cat;

      // 16 GB instance, mwm = 1 GB (1048576 kB). 5% of 16 GB = 819200 kB. 1 GB > 819200 -> pass.
      const small = engine.calculate(
        { maintenance_work_mem: 1048576 },
        { systemFacts: { ram_kb: 16 * 1024 * 1024 } }
      );
      assert.equal(small.pillars.test.score, 20);

      // 1 TB instance, mwm = 1 GB. 5% of 1 TB = ~52 GB. 1 GB << 52 GB -> partial credit at best.
      const large = engine.calculate(
        { maintenance_work_mem: 1048576 },
        { systemFacts: { ram_kb: 1024 * 1024 * 1024 } }
      );
      assert.ok(large.pillars.test.score < 20, 'A 1 GB mwm setting should not earn full score on a 1 TB instance');
    });

    it('falls back to absolute_floor + emits info finding when systemFacts missing', () => {
      const cat = MetricCatalog.fromData('test', createRelativeCatalog());
      const engine = new ScoringEngine();
      engine.catalog = cat;

      const result = engine.calculate({ maintenance_work_mem: 1048576 });
      // 1 GB >> 64 MB absolute_floor -> still passes
      assert.equal(result.pillars.test.score, 20);

      const fallbackFinding = result.allFindings.find(f =>
        f.title && f.title.includes('using absolute fallback'));
      assert.ok(fallbackFinding, 'Expected an info finding when systemFact is missing');
      assert.equal(fallbackFinding.severity, 'info');
    });
  });

  describe('consistency rules', () => {
    it('v1.8.0: BAK-CR-1 zeroes rpo_target (metric_zero) and moves the score', () => {
      const engine = new ScoringEngine('postgresql');
      const healthy = require('../data/samples/postgresql-healthy.json');
      // rpo_5 + daily dumps: the declared RPO cannot be met by the schedule, so
      // BAK-CR-1 (upgraded from findings-only to metric_zero in v1.8.0) invalidates
      // the rpo_target claim — a finding appears AND the metric earns 0 while its
      // weight stays in the denominator, dropping the score below 100.
      const result = engine.calculate({ ...healthy.values, rpo_target: 'rpo_5', dump_schedule: 'daily' });

      const fired = result.allFindings.filter(f => f.rule_id === 'BAK-CR-1');
      assert.equal(fired.length, 1, 'BAK-CR-1 should fire on the forced combination');
      assert.equal(fired[0].kind, 'consistency');
      assert.equal(fired[0].severity, 'critical');
      assert.equal(fired[0].pillar, 'backup');
      assert.match(fired[0].description, /rpo_target=rpo_5/);
      assert.match(fired[0].description, /dump_schedule=daily/);

      const rpo = result.allMetrics.find(m => m.name === 'rpo_target');
      assert.ok(rpo.zeroed_by_rules && rpo.zeroed_by_rules.includes('BAK-CR-1'),
        'rpo_target is zeroed by BAK-CR-1');
      assert.ok(result.totalScore < 100, 'metric_zero moves the score below 100');
    });

    it('BAK-CR-1 stops firing when dump_schedule is switched to continuous', () => {
      const engine = new ScoringEngine('postgresql');
      const healthy = require('../data/samples/postgresql-healthy.json');
      const v = { ...healthy.values, dump_schedule: 'continuous' };
      const result = engine.calculate(v);

      const fired = result.allFindings.filter(f => f.rule_id === 'BAK-CR-1');
      assert.equal(fired.length, 0);
    });

    it('SEC-CR-1 fires when ssl_enabled=on and ssl_connection_pct < 100', () => {
      const engine = new ScoringEngine('postgresql');
      const healthy = require('../data/samples/postgresql-healthy.json');
      const v = { ...healthy.values, ssl_enabled: 'on', ssl_connection_pct: 50 };
      const result = engine.calculate(v);

      const fired = result.allFindings.filter(f => f.rule_id === 'SEC-CR-1');
      assert.equal(fired.length, 1);
      assert.equal(fired[0].pillar, 'security');
    });

    it('catalog without consistency_rules behaves identically (smoke)', () => {
      // mariadb has consistency_rules: [] — calculate must work without rule findings.
      const engine = new ScoringEngine('mariadb');
      const result = engine.calculate({});
      const ruleFindings = result.allFindings.filter(f => f.kind === 'consistency');
      assert.equal(ruleFindings.length, 0);
      assert.ok(typeof result.totalScore === 'number');
    });
  });
});
