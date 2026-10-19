'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { MetricCatalog } = require('../src/catalog');
const ScoringEngine = require('../src/scoring/engine');
const { evaluatePredicate } = require('../src/scoring/consistency');

function makeMetric(overrides) {
  return {
    metric_id: 'T-1',
    subcategory: 'test_sub',
    legacy_name: 'test_metric',
    display_name: 'Test Metric',
    description: 'Test',
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
    remediation: 'Fix it',
    ...overrides,
  };
}

describe('wal_buffers_ratio_capped derived formula (v1.8.0)', () => {
  function engineWith() {
    const engine = new ScoringEngine();
    engine.catalog = MetricCatalog.fromData('test', {
      version: '1.0.0',
      pillars: { test: { name: 'Test', maxPoints: 20, order: 1 } },
      subcategories: { test_sub: { pillar: 'test', name: 'Sub', maxPoints: 20, order: 1 } },
      metrics: [
        makeMetric({ metric_id: 'I-1', legacy_name: 'wal_buffers_bytes', evaluation_type: 'threshold', evaluation_config: { min: 0 } }),
        makeMetric({ metric_id: 'I-2', legacy_name: 'shared_buffers_bytes', evaluation_type: 'threshold', evaluation_config: { min: 0 } }),
        makeMetric({
          metric_id: 'D-1', legacy_name: 'wal_ratio', evaluation_type: 'threshold',
          evaluation_config: { min: 1 },
          derived: true,
          derived_from: { formula: 'wal_buffers_ratio_capped', inputs: ['wal_buffers_bytes', 'shared_buffers_bytes'] },
        }),
      ],
    });
    return engine;
  }

  it('uses sb/32 below the 16MB knee (small shared_buffers)', () => {
    // sb = 64MB → expected = 2MB; wb = 2MB → ratio 1.0 (auto-tuned passes)
    const result = engineWith().calculate({
      wal_buffers_bytes: 2 * 1024 * 1024,
      shared_buffers_bytes: 64 * 1024 * 1024,
    });
    const entry = result.allMetrics.find(m => m.name === 'wal_ratio');
    assert.equal(entry.value, 1);
    assert.equal(entry.score, entry.maxScore, 'auto-tuned value passes {min:1}');
  });

  it('caps the expectation at 16MB for large shared_buffers (the v1.7.0 false-failure case)', () => {
    // sb = 10GB → sb/32 = 320MB but expected caps at 16MB; wb = 16MB → 1.0
    const result = engineWith().calculate({
      wal_buffers_bytes: 16 * 1024 * 1024,
      shared_buffers_bytes: 10 * 1024 * 1024 * 1024,
    });
    const entry = result.allMetrics.find(m => m.name === 'wal_ratio');
    assert.equal(entry.value, 1, 'PostgreSQL auto-tune default scores 1.0 at any size');
    assert.equal(entry.score, entry.maxScore);
  });

  it('reports not-provided when inputs are missing', () => {
    const result = engineWith().calculate({ shared_buffers_bytes: 64 * 1024 * 1024 });
    const entry = result.allMetrics.find(m => m.name === 'wal_ratio');
    assert.equal(entry.value, 'not provided');
  });
});

describe('string system facts in predicates (v1.8.0)', () => {
  it('matches equals/in/not_in case-insensitively', () => {
    const ctx = { systemFacts: { storage_type: 'SSD', edition: 'Enterprise' } };
    assert.equal(evaluatePredicate({ system_fact: 'storage_type', in: ['ssd', 'nvme'] }, {}, ctx), true);
    assert.equal(evaluatePredicate({ system_fact: 'storage_type', not_in: ['hdd'] }, {}, ctx), true);
    assert.equal(evaluatePredicate({ system_fact: 'storage_type', in: ['hdd', 'san'] }, {}, ctx), false);
    assert.equal(evaluatePredicate({ system_fact: 'edition', equals: 'ENTERPRISE' }, {}, ctx), true);
    assert.equal(evaluatePredicate({ system_fact: 'edition', equals: 'se2' }, {}, ctx), false);
  });

  it('returns false when the fact is missing', () => {
    assert.equal(evaluatePredicate({ system_fact: 'storage_type', in: ['ssd'] }, {}, { systemFacts: {} }), false);
  });

  it('keeps numeric anchors on numeric comparison (equals included)', () => {
    const ctx = { systemFacts: { ram_kb: 16777216, cpu_count: 8 } };
    assert.equal(evaluatePredicate({ system_fact: 'ram_kb', gte: 16000000 }, {}, ctx), true);
    assert.equal(evaluatePredicate({ system_fact: 'cpu_count', equals: 8 }, {}, ctx), true);
    assert.equal(evaluatePredicate({ system_fact: 'cpu_count', equals: '8' }, {}, ctx), true);
    assert.equal(evaluatePredicate({ system_fact: 'cpu_count', lt: 8 }, {}, ctx), false);
  });

  it('drives an edition-gated rule end-to-end', () => {
    const engine = new ScoringEngine();
    engine.catalog = MetricCatalog.fromData('test', {
      version: '1.0.0',
      pillars: { test: { name: 'Test', maxPoints: 20, order: 1 } },
      subcategories: { test_sub: { pillar: 'test', name: 'Sub', maxPoints: 20, order: 1 } },
      metrics: [makeMetric({ metric_id: 'M-1', legacy_name: 'awr_enabled' })],
      consistency_rules: [{
        rule_id: 'TEST-ED-1',
        title: 'AWR off on Enterprise',
        applies_when: {
          all_of: [
            { system_fact: 'edition', equals: 'enterprise' },
            { metric: 'awr_enabled', is_truthy: false },
          ],
        },
        on_violation: {
          severity: 'warning',
          score_adjustment: { type: 'subcategory_deduction', target: 'test_sub', points: 2 },
          title: 'AWR disabled despite Enterprise licensing',
        },
        pillar_hint: 'test',
      }],
    });

    const enterprise = engine.calculate({ awr_enabled: false }, { systemFacts: { edition: 'enterprise' } });
    assert.ok(enterprise.allFindings.some(f => f.rule_id === 'TEST-ED-1'), 'fires on enterprise');

    const engine2 = new ScoringEngine();
    engine2.catalog = engine.catalog;
    const se2 = engine2.calculate({ awr_enabled: false }, { systemFacts: { edition: 'se2' } });
    assert.ok(!se2.allFindings.some(f => f.rule_id === 'TEST-ED-1'), 'silent on SE2');
  });
});
