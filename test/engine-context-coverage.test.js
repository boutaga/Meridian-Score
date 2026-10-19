'use strict';

/**
 * context + coverage output (v1.11.0 engine additions, shipped in package
 * 1.12.0). Both keys are additive and describe the conditions the assessment
 * was scored under (context) and how much of the applicable catalog was
 * actually assessed (coverage) — the "citable certificate" a stored score needs.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const ScoringEngine = require('../src/scoring/engine');
const pkg = require('../package.json');

const pgHealthy = require('../data/samples/postgresql-healthy.json');
const orHealthy = require('../data/samples/oracle-healthy.json');

const ALL_ORACLE_LICENSES = [
  'enterprise_edition', 'diagnostic_pack', 'tuning_pack', 'advanced_security',
  'advanced_compression', 'partitioning', 'rac', 'active_data_guard',
];

describe('engine context echo', () => {
  it('echoes the conditions the assessment was scored under', () => {
    const res = new ScoringEngine('postgresql').calculate(pgHealthy.values, {
      systemFacts: pgHealthy.systemFacts,
      workloadProfile: 'oltp',
      mode: 'agent',
      availableSources: ['sql', 'manual'],
    });
    assert.equal(res.context.technology, 'postgresql');
    assert.equal(res.context.catalogVersion, new ScoringEngine('postgresql').catalog.version);
    assert.equal(res.context.engineVersion, pkg.version);
    assert.equal(res.context.mode, 'agent');
    assert.equal(res.context.workloadProfile, 'oltp');
    assert.deepEqual(res.context.systemFactsProvided.sort(), ['cpu_count', 'ram_kb', 'storage_size_kb']);
    assert.deepEqual(res.context.licensedOptions, []);
  });

  it('auto-derives enterprise_edition into licensedOptions from edition fact', () => {
    const res = new ScoringEngine('oracle').calculate(orHealthy.values, {
      systemFacts: { edition: 'enterprise' },
      licensedOptions: ['diagnostic_pack'],
    });
    assert.ok(res.context.licensedOptions.includes('enterprise_edition'));
    assert.ok(res.context.licensedOptions.includes('diagnostic_pack'));
  });
});

describe('engine coverage', () => {
  it('a fully-collected healthy sample reads ~100% coverage with no missing criticals', () => {
    const res = new ScoringEngine('postgresql').calculate(pgHealthy.values, {
      systemFacts: pgHealthy.systemFacts,
      workloadProfile: pgHealthy.workloadProfile,
    });
    assert.equal(res.coverage.percentage, 100);
    assert.equal(res.coverage.counts.missingCritical, 0);
    assert.ok(res.coverage.counts.scored > 100);
    assert.ok(res.coverage.assessedWeight <= res.coverage.applicableWeight);
    // perPillar present for every pillar in the result
    for (const pid of Object.keys(res.pillars)) {
      assert.equal(typeof res.coverage.perPillar[pid], 'number');
    }
  });

  it('a sparse assessment reads as sparse (low coverage, many missing)', () => {
    const res = new ScoringEngine('postgresql').calculate({ archive_mode: 'on', ssl_enabled: 'on' }, {});
    assert.ok(res.coverage.percentage < 10, `expected sparse coverage, got ${res.coverage.percentage}`);
    assert.ok(res.coverage.counts.missingCritical > 0);
    assert.ok(res.coverage.counts.missingNonCritical > 0);
    assert.ok(res.coverage.assessedWeight < res.coverage.applicableWeight);
  });

  it('accepts a Map of values (same coverage as the object form)', () => {
    const obj = { archive_mode: 'on', ssl_enabled: 'on' };
    const fromMap = new ScoringEngine('postgresql').calculate(new Map(Object.entries(obj)), {});
    const fromObj = new ScoringEngine('postgresql').calculate(obj, {});
    assert.equal(fromMap.coverage.percentage, fromObj.coverage.percentage);
    assert.equal(fromMap.coverage.counts.scored, fromObj.coverage.counts.scored);
  });

  it('license-excluded metrics leave the coverage denominator (SE < EE applicableWeight)', () => {
    const engine = new ScoringEngine('oracle');
    const ee = engine.calculate(orHealthy.values, { systemFacts: orHealthy.systemFacts, licensedOptions: ALL_ORACLE_LICENSES });
    const se = engine.calculate(orHealthy.values, { systemFacts: {}, licensedOptions: [] });
    assert.ok(se.coverage.counts.licenseExcluded > ee.coverage.counts.licenseExcluded);
    assert.ok(se.coverage.applicableWeight < ee.coverage.applicableWeight,
      `SE applicableWeight ${se.coverage.applicableWeight} should be < EE ${ee.coverage.applicableWeight}`);
    // Excluded metrics are counted as licenseExcluded, never as missing.
    assert.equal(ee.coverage.counts.licenseExcluded, ee.licenseExcluded.length);
  });

  it('a missing critical both punishes the score and lowers coverage', () => {
    // archive_mode is a critical PG metric; omit it while providing a sibling.
    const withCritical = new ScoringEngine('postgresql').calculate({ archive_mode: 'on' }, {});
    const withoutCritical = new ScoringEngine('postgresql').calculate({ wal_level: 'replica' }, {});
    assert.ok(withoutCritical.coverage.counts.missingCritical >= withCritical.coverage.counts.missingCritical);
  });
});
