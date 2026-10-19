'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { evaluatePredicate, evaluateRules } = require('../src/scoring/consistency');

describe('consistency.evaluatePredicate', () => {
  it('equals matches case-insensitively', () => {
    assert.equal(evaluatePredicate({ metric: 'm', equals: 'ON' }, { m: 'on' }), true);
    assert.equal(evaluatePredicate({ metric: 'm', equals: 'ON' }, { m: 'off' }), false);
  });

  it('in matches enum membership case-insensitively', () => {
    assert.equal(evaluatePredicate({ metric: 'lvl', in: ['MINIMAL'] }, { lvl: 'minimal' }), true);
    assert.equal(evaluatePredicate({ metric: 'lvl', in: ['replica', 'logical'] }, { lvl: 'minimal' }), false);
  });

  it('not_in is the inverse of in', () => {
    assert.equal(evaluatePredicate({ metric: 'lvl', not_in: ['replica', 'logical'] }, { lvl: 'minimal' }), true);
    assert.equal(evaluatePredicate({ metric: 'lvl', not_in: ['replica', 'logical'] }, { lvl: 'replica' }), false);
  });

  it('lt and gte coerce strings via parseFloat', () => {
    assert.equal(evaluatePredicate({ metric: 'pct', lt: 100 }, { pct: '50' }), true);
    assert.equal(evaluatePredicate({ metric: 'pct', lt: 100 }, { pct: '100' }), false);
    assert.equal(evaluatePredicate({ metric: 'pct', gte: 0.5 }, { pct: 0.7 }), true);
    assert.equal(evaluatePredicate({ metric: 'pct', gte: 1 }, { pct: 'NaN-ish' }), false);
  });

  it('is_truthy matches true, "true", "on", "yes", 1', () => {
    for (const v of [true, 'true', 'TRUE', 'on', 'yes', 1, '1']) {
      assert.equal(evaluatePredicate({ metric: 'b', is_truthy: true }, { b: v }), true, `value ${JSON.stringify(v)} should be truthy`);
    }
    for (const v of [false, 'false', 'off', 'no', 0, '']) {
      assert.equal(evaluatePredicate({ metric: 'b', is_truthy: true }, { b: v }), false, `value ${JSON.stringify(v)} should NOT be truthy`);
    }
  });

  it('all_of requires every child to pass; any_of requires at least one', () => {
    const values = { a: 'on', b: 'minimal' };
    assert.equal(evaluatePredicate({
      all_of: [
        { metric: 'a', equals: 'on' },
        { metric: 'b', in: ['minimal'] },
      ],
    }, values), true);

    assert.equal(evaluatePredicate({
      all_of: [
        { metric: 'a', equals: 'on' },
        { metric: 'b', in: ['replica'] },
      ],
    }, values), false);

    assert.equal(evaluatePredicate({
      any_of: [
        { metric: 'a', equals: 'off' },
        { metric: 'b', in: ['minimal'] },
      ],
    }, values), true);
  });

  it('missing/empty values cause leaves to evaluate as false', () => {
    assert.equal(evaluatePredicate({ metric: 'missing', equals: 'x' }, {}), false);
    assert.equal(evaluatePredicate({ metric: 'empty',   equals: '' }, { empty: '' }), false);
    assert.equal(evaluatePredicate({ metric: 'null',    is_truthy: true }, { null: null }), false);
  });

  it('provided:true checks presence; provided:false checks absence', () => {
    assert.equal(evaluatePredicate({ metric: 'x', provided: true },  { x: 'v' }), true);
    assert.equal(evaluatePredicate({ metric: 'x', provided: true },  { x: '' }),  false);
    assert.equal(evaluatePredicate({ metric: 'x', provided: false }, {}),         true);
  });

  describe('system_fact leaf operand (v1.6.0)', () => {
    const ctx = { systemFacts: { ram_kb: 16777216, cpu_count: 8 } };

    it('reads from ctx.systemFacts and applies numeric comparators', () => {
      assert.equal(evaluatePredicate({ system_fact: 'ram_kb', gte: 8388608 }, {}, ctx), true);
      assert.equal(evaluatePredicate({ system_fact: 'ram_kb', gte: 33554432 }, {}, ctx), false);
      assert.equal(evaluatePredicate({ system_fact: 'cpu_count', lt: 4 }, {}, ctx), false);
      assert.equal(evaluatePredicate({ system_fact: 'cpu_count', gte: 8 }, {}, ctx), true);
      assert.equal(evaluatePredicate({ system_fact: 'cpu_count', equals: 8 }, {}, ctx), true);
    });

    it('returns false when the anchor is missing from systemFacts', () => {
      assert.equal(evaluatePredicate({ system_fact: 'storage_size_kb', gte: 1 }, {}, ctx), false);
      assert.equal(evaluatePredicate({ system_fact: 'ram_kb', gte: 1 }, {}, {}), false);
    });

    it('coerces string anchor values via parseFloat', () => {
      assert.equal(evaluatePredicate({ system_fact: 'ram_kb', gte: 1000 }, {}, { systemFacts: { ram_kb: '2048' } }), true);
    });
  });

  describe('workload_profile leaf operand (v1.6.0)', () => {
    it('string sugar matches the active profile case-insensitively', () => {
      assert.equal(evaluatePredicate({ workload_profile: 'olap' }, {}, { workloadProfile: 'olap' }), true);
      assert.equal(evaluatePredicate({ workload_profile: 'OLAP' }, {}, { workloadProfile: 'olap' }), true);
      assert.equal(evaluatePredicate({ workload_profile: 'olap' }, {}, { workloadProfile: 'oltp' }), false);
    });

    it('object form supports equals / in / not_in', () => {
      const ctx = { workloadProfile: 'mixed' };
      assert.equal(evaluatePredicate({ workload_profile: { equals: 'mixed' } }, {}, ctx), true);
      assert.equal(evaluatePredicate({ workload_profile: { in: ['olap', 'mixed'] } }, {}, ctx), true);
      assert.equal(evaluatePredicate({ workload_profile: { in: ['olap'] } }, {}, ctx), false);
      assert.equal(evaluatePredicate({ workload_profile: { not_in: ['olap'] } }, {}, ctx), true);
      assert.equal(evaluatePredicate({ workload_profile: { not_in: ['mixed'] } }, {}, ctx), false);
    });

    it('returns false when no workloadProfile is set in ctx', () => {
      assert.equal(evaluatePredicate({ workload_profile: 'olap' }, {}, {}), false);
    });
  });

  it('composites combine metric, system_fact, and workload_profile leaves', () => {
    const ctx = { systemFacts: { ram_kb: 16777216 }, workloadProfile: 'olap' };
    assert.equal(evaluatePredicate({
      all_of: [
        { workload_profile: 'olap' },
        { system_fact: 'ram_kb', gte: 8388608 },
        { metric: 'jit', is_truthy: false },
      ],
    }, { jit: false }, ctx), true);

    assert.equal(evaluatePredicate({
      all_of: [
        { workload_profile: 'olap' },
        { metric: 'jit', is_truthy: false },
      ],
    }, { jit: true }, ctx), false);
  });
});

describe('consistency.evaluateRules', () => {
  const rules = [
    {
      rule_id: 'R-1',
      applies_when: {
        all_of: [
          { metric: 'a', equals: 'on' },
          { metric: 'b', in: ['minimal'] },
        ],
      },
      on_violation: {
        severity: 'critical',
        score_adjustment: { type: 'none' },
        title: 'Boom: a={value:a}, b={value:b}',
        description: 'b should not be minimal when a is on',
        remediation: 'fix b',
      },
      pillar_hint: 'backup',
    },
  ];

  it('fires when predicate is true and produces a finding with rule_id and kind=consistency', () => {
    const { findings, fired } = evaluateRules(rules, { a: 'on', b: 'minimal' });
    assert.deepEqual(fired, ['R-1']);
    assert.equal(findings.length, 1);
    assert.equal(findings[0].rule_id, 'R-1');
    assert.equal(findings[0].kind, 'consistency');
    assert.equal(findings[0].severity, 'critical');
    assert.equal(findings[0].pillar, 'backup');
    assert.equal(findings[0].title, 'Boom: a=on, b=minimal');
  });

  it('does not fire when predicate is false', () => {
    const { findings, fired } = evaluateRules(rules, { a: 'on', b: 'replica' });
    assert.deepEqual(fired, []);
    assert.equal(findings.length, 0);
  });

  it('returns empty result for empty/missing rules array', () => {
    assert.deepEqual(evaluateRules([], {}).findings, []);
    assert.deepEqual(evaluateRules(undefined, {}).findings, []);
  });

  it('Phase 1: rules with score_adjustment.type=none produce zero adjustments', () => {
    const { adjustments } = evaluateRules(rules, { a: 'on', b: 'minimal' });
    assert.deepEqual(adjustments, []);
  });
});
