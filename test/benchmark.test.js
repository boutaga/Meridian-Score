'use strict';

/**
 * scripts/benchmark-catalog.js (1.15.0, adoption review): every sample of the
 * technology is scored with its own context, and threshold, weight,
 * applicability and rule changes are reported, not only points and criticality.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const SCRIPT = path.resolve(__dirname, '../scripts/benchmark-catalog.js');
const PG = path.resolve(__dirname, '../data/metrics/postgresql.json');

function run(file) {
  const r = spawnSync(process.execPath, [SCRIPT, 'postgresql', file], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout;
}

describe('benchmark-catalog', () => {
  it('scores every PostgreSQL sample and finds no change in an unchanged catalog', () => {
    const out = run(PG);
    assert.match(out, /No changes in the compared fields/);
    const samples = fs.readdirSync(path.resolve(__dirname, '../data/samples')).filter(f => f.startsWith('postgresql-'));
    for (const f of samples) {
      const name = f.slice('postgresql-'.length, -5);
      assert.match(out, new RegExp(`\\n +${name} \\[standalone\\]: `), f);
      assert.match(out, new RegExp(`\\n +${name} \\[agent\\]: `), f);
    }
    // Context-dependent: without its workload profile and system facts the
    // OLAP sample scores 94.08, so 95.12 proves the sample's context is passed
    // (1.17.0: the sample now carries every check it was written before).
    assert.match(out, /olap \[standalone\]: 95\.12\/100 -> 95\.12\/100 \(0\.00\), good/);
  });

  it('reports a scoring-field change such as a new pillar gate', () => {
    const cat = JSON.parse(fs.readFileSync(PG, 'utf8'));
    cat.metrics.find(m => m.metric_id === 'CAP-1.7').gate_scope = 'pillar';
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bench-')), 'pg.json');
    fs.writeFileSync(file, JSON.stringify(cat));
    assert.match(run(file), /Other Scoring-Field Changes \(1\):\n +CAP-1\.7 gate_scope: null -> "pillar"/);
  });

  it('reports threshold and rule changes and the score they move', () => {
    const cat = JSON.parse(fs.readFileSync(PG, 'utf8'));
    cat.metrics.find(m => m.metric_id === 'FUT-2.1').evaluation_config = { min: 300 };
    cat.consistency_rules = cat.consistency_rules.filter(r => r.rule_id !== 'PG-CR-RTO-3');
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bench-')), 'pg.json');
    fs.writeFileSync(file, JSON.stringify(cat));
    const out = run(file);
    assert.match(out, /Threshold Changes \(1\):\n +FUT-2\.1:/);
    assert.match(out, /Consistency Rule Changes \(1\):\n +removed PG-CR-RTO-3/);
    assert.match(out, /critical \[standalone\]: 47\.33\/100 -> 47\.33\/100 \(0\.00\), critical, findings 37 -> 36/);
  });
});
