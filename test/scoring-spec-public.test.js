'use strict';

/**
 * The public workbook set (--no-links) must build from this repository alone:
 * the checker is private, so an outside contributor has no checkout of it.
 * Runs the generator as a dry run against a checker path that does not exist.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { spawnSync } = require('child_process');
const { measurementPointer } = require('../scripts/generate-scoring-spec');

const SCRIPT = path.resolve(__dirname, '../scripts/generate-scoring-spec.js');
const MISSING = path.resolve(__dirname, '../does-not-exist-checker');

describe('generate-scoring-spec public set', () => {
  it('runs --no-links without a checker checkout', () => {
    const r = spawnSync(process.execPath, [SCRIPT, '--no-links', '--check', '--tech', 'postgresql', '--checker-path', MISSING], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /checker SHA: +\(not used: --no-links\)/);
    assert.match(r.stdout, /postgresql +\| +\d+ metrics \| anchored:\d+/);
  });

  it('still refuses the internal set without a checker checkout', () => {
    const r = spawnSync(process.execPath, [SCRIPT, '--check', '--checker-path', MISSING], { encoding: 'utf8' });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /db-health-checker not found/);
  });
});

describe('Measurement column', () => {
  it('names the collection sources beside the pointer', () => {
    assert.equal(measurementPointer({ technical_anchor: {}, sources: ['sql'] }), 'See Anchor SQL');
    assert.equal(measurementPointer({ technical_anchor: {}, sources: ['sql', 'zabbix'] }), 'See Anchor SQL (also Zabbix)');
    assert.equal(measurementPointer({ sources: ['manual'] }), 'Manual entry');
    assert.equal(measurementPointer({ technical_anchor: {}, sources: ['zabbix'] }), 'See Anchor SQL (collected by Zabbix)');
    assert.equal(measurementPointer({ derived: true, sources: ['sql'] }), 'Engine-derived (formula in the scoring policy)');
    const warnings = [];
    assert.equal(measurementPointer({ metric_id: 'X', sources: ['zabbix', 'worker'] }, warnings), 'Collected by Zabbix or Worker; not documented yet');
    assert.equal(measurementPointer({ metric_id: 'Y', sources: ['sql', 'zabbix'] }, warnings), 'Not documented yet (also Zabbix)');
    assert.equal(warnings.length, 2, 'undocumented measurements are still reported');
  });
});
