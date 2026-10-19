'use strict';

/**
 * The README is the first thing a reader copies: its example must print what
 * it says it prints, and its catalog table must name the shipped catalog
 * versions. Both drifted before 1.16.0 (the example read 71.4 in a comment and
 * 10 when run; the table named PostgreSQL 1.12.0 and Oracle 1.9.0).
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { getCatalog, SUPPORTED_TECHNOLOGIES } = require('../src');

const readme = fs.readFileSync(path.join(__dirname, '..', 'README.md'), 'utf8');

describe('README', () => {
  it('the "See it in action" example, run exactly as written from the repo root, prints what its comments state', () => {
    const section = readme.slice(readme.indexOf('## See it in action'));
    const code = section.slice(section.indexOf('```javascript') + '```javascript'.length, section.indexOf('```', section.indexOf('```javascript') + 3));
    const r = spawnSync(process.execPath, ['-e', code], { cwd: path.join(__dirname, '..'), encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    const lines = r.stdout.trim().split('\n');
    const [score, status] = lines[0].split(' ');
    assert.ok(code.includes(`// ${score} '${status}'`), `README comment should read ${score} '${status}'`);
    const gated = lines.slice(1, 6).filter((l) => l.endsWith('(critical gate)')).map((l) => l.split(' ')[0]);
    assert.deepEqual(gated, ['Capacity', 'Performance']);
    assert.ok(code.includes('// Capacity and Performance read 12 / 20 (critical gate)'));
    assert.ok(lines.slice(1, 6).filter((l) => l.includes('12 / 20 (critical gate)')).length === 2, lines.join('\n'));
    assert.ok(code.includes('the other three 20 / 20'));
    assert.equal(lines.slice(1, 6).filter((l) => / 20 \/ 20 $/.test(l)).length, 3, lines.join('\n'));
    const critical = lines.slice(6).join(' ').replace(/\s+/g, ' ');
    const commented = (code.match(/\/\/ (\[ '.*' \])/) || [])[1];
    assert.equal(critical, commented);
  });

  it('the supported-technologies table names each shipped catalog version', () => {
    for (const tech of SUPPORTED_TECHNOLOGIES) {
      const { version, maturity } = getCatalog(tech);
      assert.match(readme, new RegExp(`\\| ${version} \\| ${maturity} \\|`), `${tech} ${version} ${maturity}`);
    }
  });
});
