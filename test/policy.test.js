'use strict';

/**
 * SCORING_POLICY (v1.15.0): the single visible source of the engine's shared
 * rules. These tests keep the policy, the engine and the validator in sync.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { SCORING_POLICY, ScoringEngine, CRITICALITY_WEIGHTS, evaluateThreshold } = require('../src');
const v = require('../src/catalog/validation');

describe('SCORING_POLICY', () => {
  it('is deeply frozen', () => {
    assert.ok(Object.isFrozen(SCORING_POLICY));
    assert.ok(Object.isFrozen(SCORING_POLICY.statusBands));
    assert.ok(Object.isFrozen(SCORING_POLICY.derivedFormulas.memory_pressure_pct));
    assert.ok(Object.isFrozen(SCORING_POLICY.vocabularies.predicateOperators));
    assert.throws(() => { 'use strict'; SCORING_POLICY.statusBands.excellent = 1; });
  });

  it('carries the documented numbers', () => {
    assert.deepEqual(SCORING_POLICY.criticalityWeights, { critical: 3, important: 2, advisory: 1 });
    assert.equal(SCORING_POLICY.subcategoryGateCapPct, 0.6);
    assert.equal(SCORING_POLICY.pillarCriticalCapPct, 0.6);
    assert.deepEqual(SCORING_POLICY.partialCredit, { factor: 0.5, withinMultiple: 2 });
    assert.deepEqual(SCORING_POLICY.statusBands, { excellent: 90, good: 70, needs_improvement: 50 });
    assert.equal(SCORING_POLICY.defaults.restoreThroughputMbPerSecond, 200);
  });

  it('is what the engine actually uses', () => {
    assert.equal(CRITICALITY_WEIGHTS, SCORING_POLICY.criticalityWeights);
    const e = new ScoringEngine('postgresql');
    assert.equal(e._getStatus(90), 'excellent');
    assert.equal(e._getStatus(89.99), 'good');
    assert.equal(e._getStatus(70), 'good');
    assert.equal(e._getStatus(50), 'needs_improvement');
    assert.equal(e._getStatus(49.9), 'critical');
    // partial credit: half the points within 2x of the bound, nothing beyond
    assert.equal(evaluateThreshold(150, { max: 100 }, 10), 5);
    assert.equal(evaluateThreshold(201, { max: 100 }, 10), 0);
    assert.equal(evaluateThreshold(60, { min: 100 }, 10), 5);
    assert.equal(evaluateThreshold(49, { min: 100 }, 10), 0);
  });

  it('documents every derived formula the engine registers, and only those', () => {
    const engineNames = Object.keys(ScoringEngine.DERIVED_FORMULAS).sort();
    const policyNames = Object.keys(SCORING_POLICY.derivedFormulas).sort();
    assert.deepEqual(policyNames, engineNames);
    assert.deepEqual([...v.SUPPORTED_DERIVED_FORMULAS].sort(), engineNames);
    for (const name of policyNames) {
      const f = SCORING_POLICY.derivedFormulas[name];
      assert.ok(typeof f.expression === 'string' && f.expression.length > 0, `${name} expression`);
      assert.ok(Array.isArray(f.inputs) && f.inputs.length > 0, `${name} inputs`);
      assert.ok(typeof f.description === 'string' && f.description.length > 0, `${name} description`);
    }
  });

  it('vocabularies mirror the validator sets', () => {
    const voc = SCORING_POLICY.vocabularies;
    assert.deepEqual(voc.sources, [...v.RECOGNIZED_SOURCES]);
    assert.deepEqual(voc.anchors, [...v.RECOGNIZED_ANCHORS]);
    assert.deepEqual(voc.stringFacts, [...v.RECOGNIZED_STRING_FACTS]);
    assert.deepEqual(voc.profiles, [...v.RECOGNIZED_PROFILES]);
    assert.deepEqual(voc.licenseRequirements, [...v.RECOGNIZED_LICENSE_REQUIREMENTS]);
    assert.deepEqual(voc.booleanChecks, [...v.RECOGNIZED_BOOLEAN_CHECKS]);
    assert.deepEqual(voc.predicateOperators.metric, [...v.METRIC_LEAF_OPS]);
    assert.deepEqual(voc.adjustmentTypes, [...v.VALID_ADJUSTMENT_TYPES]);
    assert.deepEqual(voc.evaluationTypes, [...v.VALID_EVAL_TYPES]);
    assert.deepEqual(voc.criticalities, [...v.VALID_CRITICALITY]);
  });
});
