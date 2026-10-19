'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { evaluateMetric, evaluateEnum, evaluateThreshold, resolveThresholdConfig } = require('../src/scoring/evaluator');

describe('evaluateEnum', () => {
  it('returns maxPoints when value matches (case-insensitive)', () => {
    assert.equal(evaluateEnum('on', ['on', 'always'], 3), 3);
    assert.equal(evaluateEnum('ON', ['on', 'always'], 3), 3);
    assert.equal(evaluateEnum('Always', ['on', 'always'], 3), 3);
  });

  it('returns 0 when value does not match', () => {
    assert.equal(evaluateEnum('off', ['on', 'always'], 3), 0);
  });

  it('returns 0 for null/undefined/empty', () => {
    assert.equal(evaluateEnum(null, ['on'], 3), 0);
    assert.equal(evaluateEnum(undefined, ['on'], 3), 0);
    assert.equal(evaluateEnum('', ['on'], 3), 0);
  });
});

describe('evaluateThreshold', () => {
  it('returns maxPoints when value within max bound', () => {
    assert.equal(evaluateThreshold(50, { max: 85 }, 3), 3);
  });

  it('returns 50% when value exceeds max but within 2x', () => {
    assert.equal(evaluateThreshold(100, { max: 85 }, 4), 2);
  });

  it('returns 0 when value exceeds 2x max', () => {
    assert.equal(evaluateThreshold(200, { max: 85 }, 3), 0);
  });

  it('returns maxPoints when value meets min bound', () => {
    assert.equal(evaluateThreshold(95, { min: 90 }, 3), 3);
  });

  it('returns 50% when value below min but within 50%', () => {
    assert.equal(evaluateThreshold(60, { min: 90 }, 4), 2);
  });

  it('returns 0 when value far below min', () => {
    assert.equal(evaluateThreshold(10, { min: 90 }, 3), 0);
  });

  it('handles range (both min and max)', () => {
    assert.equal(evaluateThreshold(50, { min: 10, max: 85 }, 3), 3);
    assert.equal(evaluateThreshold(5, { min: 10, max: 85 }, 4), 2);  // below min, partial
    assert.equal(evaluateThreshold(100, { min: 10, max: 85 }, 4), 2); // above max, partial
  });

  it('returns 0 for null/undefined/empty/NaN', () => {
    assert.equal(evaluateThreshold(null, { max: 85 }, 3), 0);
    assert.equal(evaluateThreshold(undefined, { max: 85 }, 3), 0);
    assert.equal(evaluateThreshold('', { max: 85 }, 3), 0);
    assert.equal(evaluateThreshold('abc', { max: 85 }, 3), 0);
  });

  it('parses string numbers', () => {
    assert.equal(evaluateThreshold('50', { max: 85 }, 3), 3);
  });
});

describe('evaluateMetric', () => {
  describe('boolean type', () => {
    it('passes when value matches expected (true)', () => {
      const metric = { evaluation_type: 'boolean', evaluation_config: { pass_value: true } };
      const result = evaluateMetric(metric, true, 3);
      assert.equal(result.score, 3);
      assert.equal(result.passed, true);
    });

    it('passes with string "true"', () => {
      const metric = { evaluation_type: 'boolean', evaluation_config: { pass_value: true } };
      const result = evaluateMetric(metric, 'true', 3);
      assert.equal(result.score, 3);
      assert.equal(result.passed, true);
    });

    it('fails when value does not match expected', () => {
      const metric = { evaluation_type: 'boolean', evaluation_config: { pass_value: true } };
      const result = evaluateMetric(metric, false, 3);
      assert.equal(result.score, 0);
      assert.equal(result.passed, false);
    });

    it('handles not_empty_or_dummy check', () => {
      const metric = { evaluation_type: 'boolean', evaluation_config: { check: 'not_empty_or_dummy' } };

      assert.equal(evaluateMetric(metric, '/usr/bin/pgbackrest', 3).score, 3);
      assert.equal(evaluateMetric(metric, '/bin/true', 3).score, 0);
      assert.equal(evaluateMetric(metric, '(disabled)', 3).score, 0);
      assert.equal(evaluateMetric(metric, 'none', 3).score, 0);
      assert.equal(evaluateMetric(metric, '', 3).score, 0);
    });

    it('defaults pass_value to true when not specified', () => {
      const metric = { evaluation_type: 'boolean', evaluation_config: {} };
      assert.equal(evaluateMetric(metric, true, 3).score, 3);
      assert.equal(evaluateMetric(metric, false, 3).score, 0);
    });
  });

  describe('enum type', () => {
    it('passes when value in pass_values', () => {
      const metric = { evaluation_type: 'enum', evaluation_config: { pass_values: ['on', 'always'] } };
      const result = evaluateMetric(metric, 'on', 3);
      assert.equal(result.score, 3);
      assert.equal(result.passed, true);
    });

    it('fails when value not in pass_values', () => {
      const metric = { evaluation_type: 'enum', evaluation_config: { pass_values: ['on', 'always'] } };
      const result = evaluateMetric(metric, 'off', 3);
      assert.equal(result.score, 0);
      assert.equal(result.passed, false);
    });

    it('returns 0 / false (no throw) when pass_values is missing or empty', () => {
      // Missing pass_values
      const metricMissing = { evaluation_type: 'enum', evaluation_config: {} };
      const r1 = evaluateMetric(metricMissing, 'on', 3);
      assert.equal(r1.score, 0);
      assert.equal(r1.passed, false);

      // Empty pass_values array
      const metricEmpty = { evaluation_type: 'enum', evaluation_config: { pass_values: [] } };
      const r2 = evaluateMetric(metricEmpty, 'on', 3);
      assert.equal(r2.score, 0);
      assert.equal(r2.passed, false);
    });
  });

  describe('threshold type', () => {
    it('delegates to evaluateThreshold', () => {
      const metric = { evaluation_type: 'threshold', evaluation_config: { max: 85 } };
      const result = evaluateMetric(metric, 50, 3);
      assert.equal(result.score, 3);
      assert.equal(result.passed, true);
    });

    // Adoption review 2026-09-04: rounding gave a weight-1 metric outside its
    // bound full credit AND passed=true. Half credit is exact, never passed.
    it('awards exactly half credit and never reports a value outside its bound as passed', () => {
      const metric = { evaluation_type: 'threshold', evaluation_config: { max: 80 } };
      for (const [weight, half] of [[0.5, 0.25], [1, 0.5], [2, 1], [3, 1.5]]) {
        const result = evaluateMetric(metric, 100, weight);
        assert.equal(result.score, half, `weight ${weight}`);
        assert.equal(result.passed, false, `weight ${weight}`);
      }
      assert.equal(evaluateMetric(metric, 100, 0).passed, false, 'passed follows the bound, not the points');
      assert.equal(evaluateMetric(metric, 50, 0).passed, true);
    });
  });

  describe('range type', () => {
    it('behaves same as threshold', () => {
      const metric = { evaluation_type: 'range', evaluation_config: { min: 10, max: 90 } };
      assert.equal(evaluateMetric(metric, 50, 3).passed, true);
      assert.equal(evaluateMetric(metric, 200, 3).passed, false);
    });
  });

  describe('unknown type', () => {
    it('fails closed (v1.7.1 — no truthy fallback)', () => {
      const metric = { evaluation_type: 'custom', evaluation_config: {} };
      assert.equal(evaluateMetric(metric, 'something', 3).score, 0);
      assert.equal(evaluateMetric(metric, 0, 3).score, 0);
    });
  });

  describe('null/undefined/empty values', () => {
    it('returns score 0 and passed false', () => {
      const metric = { evaluation_type: 'boolean', evaluation_config: { pass_value: true } };
      assert.deepEqual(evaluateMetric(metric, null, 3), { score: 0, passed: false });
      assert.deepEqual(evaluateMetric(metric, undefined, 3), { score: 0, passed: false });
      assert.deepEqual(evaluateMetric(metric, '', 3), { score: 0, passed: false });
    });
  });
});

describe('resolveThresholdConfig (v1.5.0 size-relative + profiles)', () => {
  describe('flat config (backward compat)', () => {
    it('passes flat min/max through unchanged', () => {
      const resolved = resolveThresholdConfig({ min: 95 }, {});
      assert.equal(resolved.min, 95);
      assert.equal(resolved._derivation, undefined);
      assert.equal(resolved._unresolved, undefined);
    });

    it('returns empty object when given empty config', () => {
      assert.deepEqual(resolveThresholdConfig({}, {}), {});
    });
  });

  describe('profile selection', () => {
    const cfg = {
      profiles: {
        default: { min: 95 },
        oltp:    { min: 98 },
        olap:    { min: 85 },
        mixed:   { min: 95 },
      },
    };

    it('selects oltp profile', () => {
      assert.equal(resolveThresholdConfig(cfg, { workloadProfile: 'oltp' }).min, 98);
    });

    it('selects olap profile', () => {
      assert.equal(resolveThresholdConfig(cfg, { workloadProfile: 'olap' }).min, 85);
    });

    it('selects default when no profile given', () => {
      assert.equal(resolveThresholdConfig(cfg, {}).min, 95);
    });

    it('falls back to default for unknown profile', () => {
      assert.equal(resolveThresholdConfig(cfg, { workloadProfile: 'htap' }).min, 95);
    });
  });

  describe('size-relative resolution (min_pct + min_pct_of)', () => {
    it('resolves min from ram_kb when systemFact is present', () => {
      const cfg = {
        min_pct: 0.5,
        min_pct_of: 'ram_kb',
        absolute_floor: { min: 4096 },
        unit: 'kB',
      };
      // 16 GB RAM = 16 * 1024 * 1024 kB
      const ramKb = 16 * 1024 * 1024;
      const resolved = resolveThresholdConfig(cfg, { systemFacts: { ram_kb: ramKb } });
      assert.equal(resolved.min, ramKb * 0.005);
      assert.match(resolved._derivation, /0.5% of ram_kb/);
      assert.equal(resolved._fallback, undefined);
    });

    it('falls back to absolute_floor when systemFact missing', () => {
      const cfg = {
        min_pct: 0.5,
        min_pct_of: 'ram_kb',
        absolute_floor: { min: 4096 },
      };
      const resolved = resolveThresholdConfig(cfg, { systemFacts: {} });
      assert.equal(resolved.min, 4096);
      assert.equal(resolved._fallback, true);
      assert.match(resolved._derivation, /absolute_floor/);
    });

    it('marks unresolved when no fact and no absolute_floor', () => {
      const cfg = { min_pct: 0.5, min_pct_of: 'ram_kb' };
      const resolved = resolveThresholdConfig(cfg, { systemFacts: {} });
      assert.equal(resolved._unresolved, true);
    });

    it('resolves max from ram_kb (max_pct path)', () => {
      const cfg = {
        max_pct: 10,
        max_pct_of: 'ram_kb',
        absolute_floor: { max: 1073741824 },
        unit: 'bytes',
      };
      const ramKb = 16 * 1024 * 1024;
      const resolved = resolveThresholdConfig(cfg, { systemFacts: { ram_kb: ramKb } });
      assert.equal(resolved.max, ramKb * 0.1);
    });
  });

  describe('composite (profiles + relative)', () => {
    const cfg = {
      profiles: {
        default: { min_pct: 0.5, min_pct_of: 'ram_kb', absolute_floor: { min: 4096 } },
        olap:    { min_pct: 2,   min_pct_of: 'ram_kb', absolute_floor: { min: 16384 } },
      },
    };

    it('resolves olap profile relative to ram_kb', () => {
      const ramKb = 16 * 1024 * 1024;
      const resolved = resolveThresholdConfig(cfg, {
        workloadProfile: 'olap',
        systemFacts: { ram_kb: ramKb },
      });
      assert.equal(resolved.min, ramKb * 0.02);
    });

    it('falls back to default profile absolute floor when fact missing', () => {
      const resolved = resolveThresholdConfig(cfg, { systemFacts: {} });
      assert.equal(resolved.min, 4096);
      assert.equal(resolved._fallback, true);
    });
  });
});

describe('evaluateMetric — v1.5.0 size-relative + profile threshold paths', () => {
  it('size-relative threshold passes when value meets relative min', () => {
    const metric = {
      evaluation_type: 'threshold',
      evaluation_config: {
        min_pct: 5,
        min_pct_of: 'ram_kb',
        absolute_floor: { min: 65536 },
        unit: 'kB',
      },
    };
    const ramKb = 16 * 1024 * 1024; // 16 GB
    // 5% of 16 GB = 819200 kB
    const result = evaluateMetric(metric, 1048576, 3, { systemFacts: { ram_kb: ramKb } });
    assert.equal(result.score, 3);
    assert.equal(result.passed, true);
    assert.match(result.derivation, /5% of ram_kb/);
  });

  it('size-relative threshold reports fallback when fact missing', () => {
    const metric = {
      evaluation_type: 'threshold',
      evaluation_config: {
        min_pct: 5,
        min_pct_of: 'ram_kb',
        absolute_floor: { min: 65536 },
      },
    };
    const result = evaluateMetric(metric, 100000, 3, {});
    assert.equal(result.score, 3); // 100000 >= 65536
    assert.equal(result.passed, true);
    assert.equal(result.fallback, true);
  });

  it('size-relative threshold returns unresolved when no fact and no floor', () => {
    const metric = {
      evaluation_type: 'threshold',
      evaluation_config: { min_pct: 5, min_pct_of: 'ram_kb' },
    };
    const result = evaluateMetric(metric, 100000, 3, {});
    assert.equal(result.score, 0);
    assert.equal(result.passed, false);
    assert.equal(result.unresolved, true);
  });

  it('profile-keyed threshold: same value, different profile, different outcome', () => {
    const metric = {
      evaluation_type: 'threshold',
      evaluation_config: {
        profiles: {
          default: { min: 95 },
          oltp:    { min: 98 },
          olap:    { min: 85 },
        },
      },
    };
    // Value 88: passes olap (>=85), partial credit on default (>= 95*0.5=47.5, < 95), fails oltp similarly
    const oltp = evaluateMetric(metric, 88, 3, { workloadProfile: 'oltp' });
    const olap = evaluateMetric(metric, 88, 3, { workloadProfile: 'olap' });
    assert.equal(olap.score, 3, '88 should pass under olap profile (min 85)');
    assert.equal(olap.passed, true);
    assert.equal(oltp.passed, false, '88 should not fully pass under oltp profile (min 98)');
  });

  it('backward compat: existing flat threshold with no ctx behaves unchanged', () => {
    const metric = { evaluation_type: 'threshold', evaluation_config: { max: 85 } };
    assert.equal(evaluateMetric(metric, 50, 3).score, 3);
    assert.equal(evaluateMetric(metric, 200, 3).score, 0);
  });
});
