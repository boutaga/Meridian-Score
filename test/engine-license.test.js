'use strict';

/**
 * License/pack applicability (engine v1.9.0+).
 *
 * A metric whose `license_requirement` is not in the customer's owned set
 * (`options.licensedOptions`, with `enterprise_edition` auto-derived from
 * systemFacts.edition='enterprise') is NOT-APPLICABLE: excluded from numerator,
 * denominator, and gates — no penalty — and reported in `result.licenseExcluded`.
 * The full catalog stays the scoring basis; license determines per-customer
 * relevance, so a Standard-Edition estate can still reach 100% on its applicable
 * subset.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const ScoringEngine = require('../src/scoring/engine');
const { MetricCatalog } = require('../src/catalog');
const { validateLicenseRequirement } = require('../src/catalog/validation');

function makeCatalog() {
  const base = {
    weight: null,
    evaluation_type: 'boolean',
    evaluation_config: { pass_value: true },
    sources: ['sql'],
    agent_only: false,
    deployment_profiles: null,
    min_pg_version: null,
    extension_requirement: null,
    metric_tier: 'baseline',
    remediation: 'fix it',
  };
  return {
    version: '1.0.0',
    pillars: { test: { name: 'Test', maxPoints: 20, order: 1 } },
    subcategories: { test_sub: { pillar: 'test', name: 'Test Sub', maxPoints: 20, order: 1 } },
    metrics: [
      // baseline: always-applicable, gives the subcategory a denominator
      { ...base, metric_id: 'T-AW', subcategory: 'test_sub', legacy_name: 'aw', display_name: 'Always', description: 'baseline', criticality: 'important' },
      // pack-gated (Diagnostic Pack) — critical, so if it ever counts-and-fails it gates
      { ...base, metric_id: 'T-DIAG', subcategory: 'test_sub', legacy_name: 'awr_metric', display_name: 'AWR Enabled', description: 'needs Diagnostic Pack', criticality: 'critical', license_requirement: 'diagnostic_pack' },
      // edition-gated (Enterprise Edition) — critical
      { ...base, metric_id: 'T-EE', subcategory: 'test_sub', legacy_name: 'ee_metric', display_name: 'EE Feature', description: 'needs Enterprise Edition', criticality: 'critical', license_requirement: 'enterprise_edition' },
      // value-gated (applies_when) — to prove the exclusion_reason discriminator
      { ...base, metric_id: 'T-COND', subcategory: 'test_sub', legacy_name: 'cond_metric', display_name: 'Conditional', description: 'gated by flag', criticality: 'important', applies_when: { metric: 'flag', is_truthy: true } },
    ],
  };
}

function engineFor(cat) {
  const e = new ScoringEngine();
  e.catalog = MetricCatalog.fromData('test', cat);
  return e;
}

// flag intentionally absent → cond_metric is not-applicable via applies_when.
// awr_metric/ee_metric values present but ignored when license-excluded.
const VALUES = { aw: true, awr_metric: true, ee_metric: true };

function byName(result, name) {
  return result.allMetrics.find((m) => m.name === name);
}

describe('license/pack applicability', () => {
  it('A — no context: pack/EE metrics not-applicable, reported, no penalty (SE2 fairness)', () => {
    const r = engineFor(makeCatalog()).calculate(VALUES);

    // both license-gated metrics excluded; reported with their requirement
    assert.equal(r.licenseExcluded.length, 2);
    const names = r.licenseExcluded.map((x) => x.name).sort();
    assert.deepEqual(names, ['awr_metric', 'ee_metric']);
    const diag = r.licenseExcluded.find((x) => x.name === 'awr_metric');
    assert.equal(diag.license_requirement, 'diagnostic_pack');
    assert.equal(diag.pillar, 'test');

    // per-metric audit: not-applicable + reason discriminator
    assert.equal(byName(r, 'awr_metric').applicable, false);
    assert.equal(byName(r, 'awr_metric').exclusion_reason, 'license');
    assert.equal(byName(r, 'awr_metric').license_requirement, 'diagnostic_pack');
    assert.equal(byName(r, 'awr_metric').maxScore, 0);

    // applies_when exclusion carries the OTHER reason and no license_requirement
    assert.equal(byName(r, 'cond_metric').applicable, false);
    assert.equal(byName(r, 'cond_metric').exclusion_reason, 'applies_when');
    assert.equal(byName(r, 'cond_metric').license_requirement, undefined);

    // headline: the estate still reaches 100% on its applicable subset (just `aw`),
    // NOT penalized for the pack/EE metrics it cannot license. No findings.
    assert.equal(r.totalPercentage, 100);
    assert.equal(r.allFindings.length, 0);
  });

  it('B — owns diagnostic_pack: that metric scores, EE still excluded', () => {
    const r = engineFor(makeCatalog()).calculate(VALUES, { licensedOptions: ['diagnostic_pack'] });
    assert.notEqual(byName(r, 'awr_metric').applicable, false);
    assert.equal(byName(r, 'awr_metric').scored, true);
    assert.deepEqual(r.licenseExcluded.map((x) => x.name), ['ee_metric']);
  });

  it('C — edition=enterprise auto-derives EE ownership; diagnostic_pack still not owned', () => {
    const r = engineFor(makeCatalog()).calculate(VALUES, { systemFacts: { edition: 'enterprise' } });
    assert.notEqual(byName(r, 'ee_metric').applicable, false);
    assert.equal(byName(r, 'ee_metric').scored, true);
    assert.deepEqual(r.licenseExcluded.map((x) => x.name), ['awr_metric']);
  });

  it('D — EE edition + diagnostic_pack owned: nothing excluded', () => {
    const r = engineFor(makeCatalog()).calculate(VALUES, {
      systemFacts: { edition: 'enterprise' },
      licensedOptions: ['diagnostic_pack'],
    });
    assert.equal(r.licenseExcluded.length, 0);
    assert.notEqual(byName(r, 'awr_metric').applicable, false);
    assert.notEqual(byName(r, 'ee_metric').applicable, false);
  });

  it('a license-gated critical that is owned-and-failing DOES gate (no free pass when owned)', () => {
    const r = engineFor(makeCatalog()).calculate(
      { aw: true, awr_metric: false, ee_metric: true },
      { systemFacts: { edition: 'enterprise' }, licensedOptions: ['diagnostic_pack'] }
    );
    // awr_metric is critical, owned, and failing → 60% gate active → below 100
    assert.notEqual(byName(r, 'awr_metric').applicable, false);
    assert.ok(r.totalPercentage < 100, `expected gated score < 100, got ${r.totalPercentage}`);
  });
});

describe('license_requirement validation', () => {
  it('rejects an unrecognized value', () => {
    const errors = [];
    validateLicenseRequirement({ metric_id: 'X', license_requirement: 'bogus_pack' }, errors);
    assert.equal(errors.length, 1);
  });
  it('accepts a recognized value and an absent field', () => {
    const errors = [];
    validateLicenseRequirement({ metric_id: 'Y', license_requirement: 'tuning_pack' }, errors);
    validateLicenseRequirement({ metric_id: 'Z' }, errors);
    assert.equal(errors.length, 0);
  });
});
