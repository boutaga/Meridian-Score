'use strict';

/**
 * Derived metrics (v1.6.0) — end-to-end through ScoringEngine.calculate.
 *
 * Each derived metric registered in src/scoring/engine.js DERIVED_FORMULAS
 * gets a pre-evaluation step that computes the value from collected inputs +
 * systemFacts and writes it back into `values` under the metric's
 * legacy_name. Missing inputs → metric is reported as not-provided (follows
 * the same not-counted path as any missing non-critical metric).
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { ScoringEngine, MetricCatalog } = require('../src');

function makeCatalog(derivedMetric) {
  return {
    version: '1.6.0',
    pillars: { perf: { name: 'Performance', maxPoints: 20, order: 1 } },
    subcategories: { perf_cache: { pillar: 'perf', name: 'Cache', maxPoints: 20, order: 1 } },
    metrics: [derivedMetric],
    consistency_rules: [],
  };
}

function makeEngine(cat) {
  const engine = new ScoringEngine('postgresql');
  engine.catalog = MetricCatalog.fromData('synthetic', cat);
  return engine;
}

describe('Derived formula: memory_pressure_pct', () => {
  const metric = {
    metric_id: 'D-MEM',
    subcategory: 'perf_cache',
    legacy_name: 'memory_pressure_pct',
    display_name: 'Memory Pressure',
    description: 'derived',
    criticality: 'important',
    weight: null,
    evaluation_type: 'threshold',
    evaluation_config: { max: 80 },
    derived: true,
    derived_from: {
      formula: 'memory_pressure_pct',
      inputs: ['shared_buffers_bytes', 'max_connections', 'work_mem_bytes', 'ram_bytes'],
    },
    sources: ['sql'],
    agent_only: false,
    deployment_profiles: null,
    min_pg_version: null,
    extension_requirement: null,
    metric_tier: 'baseline',
    remediation: 'reduce',
    cis_reference: null,
  };

  it('computes (sb + mc × wm) / ram × 100 and writes back into values', () => {
    const engine = makeEngine(makeCatalog(metric));
    const values = {
      shared_buffers_bytes: 4294967296,   // 4 GB
      max_connections: 80,
      work_mem_bytes: 100663296,          // 96 MB
    };
    const result = engine.calculate(values, { systemFacts: { ram_kb: 16777216 } });
    const m = result.allMetrics.find(x => x.name === 'memory_pressure_pct');
    assert.ok(m.scored, 'derived metric should be scored');
    // (4294967296 + 80 × 100663296) / (16 × 1024^3) × 100 ≈ 71.88
    assert.ok(m.value > 71.5 && m.value < 72.5, `expected ~71.88, got ${m.value}`);
    assert.equal(m.score, m.maxScore, 'value within threshold → full score');
  });

  it('fails when memory pressure exceeds the max threshold', () => {
    const engine = makeEngine(makeCatalog(metric));
    const result = engine.calculate({
      shared_buffers_bytes: 12884901888, // 12 GB
      max_connections: 500,
      work_mem_bytes: 33554432,          // 32 MB
    }, { systemFacts: { ram_kb: 16777216 } });
    const m = result.allMetrics.find(x => x.name === 'memory_pressure_pct');
    // (12GB + 500 × 32MB) / 16GB ≈ 173 %  → fails the max:80 threshold
    assert.ok(m.value > 100, `expected memory pressure >100%, got ${m.value}`);
    assert.equal(m.score, 0, 'value far past 2× max → 0');
  });

  it('reports not-provided when any input is missing', () => {
    const engine = makeEngine(makeCatalog(metric));
    const result = engine.calculate({
      shared_buffers_bytes: 4294967296,
      max_connections: 80,
      // work_mem_bytes intentionally missing
    }, { systemFacts: { ram_kb: 16777216 } });
    const m = result.allMetrics.find(x => x.name === 'memory_pressure_pct');
    assert.equal(m.scored, false);
    assert.equal(m.value, 'not provided');
  });

  it('reports not-provided when ram_bytes / ram_kb is missing from systemFacts', () => {
    const engine = makeEngine(makeCatalog(metric));
    const result = engine.calculate({
      shared_buffers_bytes: 4294967296,
      max_connections: 80,
      work_mem_bytes: 100663296,
    }); // no systemFacts
    const m = result.allMetrics.find(x => x.name === 'memory_pressure_pct');
    assert.equal(m.scored, false);
  });

  it('does not overwrite an explicitly-collected value', () => {
    const engine = makeEngine(makeCatalog(metric));
    // Operator already provided the value — engine should not recompute.
    const result = engine.calculate({
      memory_pressure_pct: 50,
      shared_buffers_bytes: 12884901888,
      max_connections: 500,
      work_mem_bytes: 33554432,
    }, { systemFacts: { ram_kb: 16777216 } });
    const m = result.allMetrics.find(x => x.name === 'memory_pressure_pct');
    assert.equal(m.value, 50, 'explicit value preserved');
  });
});

describe('Derived formula: wal_buffers_ratio', () => {
  const metric = {
    metric_id: 'D-WAL',
    subcategory: 'perf_cache',
    legacy_name: 'wal_buffers_ratio',
    display_name: 'WAL buffers ratio',
    description: 'derived',
    criticality: 'advisory',
    weight: null,
    evaluation_type: 'threshold',
    evaluation_config: { min: 0.03 },
    derived: true,
    derived_from: {
      formula: 'wal_buffers_ratio',
      inputs: ['wal_buffers_bytes', 'shared_buffers_bytes'],
    },
    sources: ['sql'],
    agent_only: false,
    deployment_profiles: null,
    min_pg_version: null,
    extension_requirement: null,
    metric_tier: 'baseline',
    remediation: 'increase',
    cis_reference: null,
  };

  it('computes wal_buffers / shared_buffers', () => {
    const engine = makeEngine(makeCatalog(metric));
    const result = engine.calculate({
      wal_buffers_bytes: 134217728,       // 128 MB
      shared_buffers_bytes: 4294967296,   // 4 GB
    });
    const m = result.allMetrics.find(x => x.name === 'wal_buffers_ratio');
    assert.equal(m.value, 0.0313);
    assert.equal(m.score, m.maxScore);
  });
});

describe('Derived formula: count_csv', () => {
  const metric = {
    metric_id: 'D-CSV',
    subcategory: 'perf_cache',
    legacy_name: 'sync_count',
    display_name: 'Sync standby count',
    description: 'derived',
    criticality: 'advisory',
    weight: null,
    evaluation_type: 'threshold',
    evaluation_config: { min: 0 },
    derived: true,
    derived_from: {
      formula: 'count_csv',
      inputs: ['synchronous_standby_names'],
    },
    sources: ['sql'],
    agent_only: false,
    deployment_profiles: null,
    min_pg_version: null,
    extension_requirement: null,
    metric_tier: 'baseline',
    remediation: '',
    cis_reference: null,
  };

  it('counts comma-separated entries, trimming and skipping empty ones', () => {
    const engine = makeEngine(makeCatalog(metric));
    const cases = [
      { val: '',                  count: 0 },
      { val: 'a',                 count: 1 },
      { val: 'a,b',               count: 2 },
      { val: 'a, b, c',           count: 3 },
      { val: 'a, ,b',             count: 2 },
      { val: ', , ',              count: 0 },
    ];
    for (const { val, count } of cases) {
      const r = engine.calculate({ synchronous_standby_names: val });
      const m = r.allMetrics.find(x => x.name === 'sync_count');
      assert.equal(m.value, count, `value="${val}" should count ${count}, got ${m.value}`);
    }
  });
});

describe('Derived formula: oracle_memory_pct_of_ram (v1.10.0)', () => {
  const metric = {
    metric_id: 'D-ORAMEM', subcategory: 'perf_cache', legacy_name: 'oracle_memory_pct_of_ram',
    display_name: 'Instance memory vs RAM', description: 'derived', criticality: 'important', weight: null,
    evaluation_type: 'range', evaluation_config: { min: 40, max: 80, unit: 'percent_ram' },
    derived: true,
    derived_from: { formula: 'oracle_memory_pct_of_ram', inputs: ['sga_target', 'pga_aggregate_target', 'ram_kb'] },
    sources: ['sql'], agent_only: false, deployment_profiles: null, min_pg_version: null,
    extension_requirement: null, metric_tier: 'baseline', remediation: 'right-size', cis_reference: null,
  };

  it('computes (sga_target + pga_aggregate_target) / ram × 100', () => {
    const engine = makeEngine(makeCatalog(metric));
    // 8 GB SGA + 1.6 GB PGA = 9.6 GB of 16 GB RAM ≈ 60 %
    const result = engine.calculate(
      { sga_target: 8589934592, pga_aggregate_target: 1717986918 },
      { systemFacts: { ram_kb: 16777216 } });
    const m = result.allMetrics.find(x => x.name === 'oracle_memory_pct_of_ram');
    assert.ok(m.value > 59 && m.value < 61, `expected ~60, got ${m.value}`);
    assert.equal(m.score, m.maxScore, 'in the 40–80 band → full score');
  });

  it('fails the range when the instance over-allocates RAM', () => {
    const engine = makeEngine(makeCatalog(metric));
    // 14 GB SGA + 1 GB PGA = 15 GB of 16 GB ≈ 94 % → over the max:80
    const result = engine.calculate(
      { sga_target: 15032385536, pga_aggregate_target: 1073741824 },
      { systemFacts: { ram_kb: 16777216 } });
    const m = result.allMetrics.find(x => x.name === 'oracle_memory_pct_of_ram');
    assert.ok(m.value > 80, `expected >80 %, got ${m.value}`);
    assert.ok(m.score < m.maxScore, 'over-allocation → not full score');
  });

  it('reports not-provided when ram is missing from systemFacts', () => {
    const engine = makeEngine(makeCatalog(metric));
    const result = engine.calculate({ sga_target: 8589934592, pga_aggregate_target: 1717986918 });
    const m = result.allMetrics.find(x => x.name === 'oracle_memory_pct_of_ram');
    assert.equal(m.scored, false);
  });
});
