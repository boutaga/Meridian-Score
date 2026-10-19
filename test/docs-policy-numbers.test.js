'use strict';

/**
 * DEC-010 / L-005: score-defining numbers that appear in hand-written prose
 * (README, the reading guide, the validation guide, the catalog descriptions
 * of the restore-time metrics) must equal the scoring policy. The generated
 * block in docs/scoring-model.md is rendered from the policy; these files are
 * not, so this test is what keeps them from drifting.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { SCORING_POLICY, getCatalog } = require('../src');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const P = SCORING_POLICY;
const gate = Math.round(P.subcategoryGateCapPct * 100);
const pillarCap = Math.round(P.pillarCriticalCapPct * 100);
const b = P.statusBands;

describe('hand-written docs agree with SCORING_POLICY', () => {
  it('README states the weights, the gates and the multiplier the policy defines', () => {
    const t = read('README.md');
    assert.match(t, new RegExp(`critical metrics count ${P.criticalityWeights.critical}x, important ${P.criticalityWeights.important}x, advisory ${P.criticalityWeights.advisory}x`));
    assert.match(t, new RegExp(`caps its subcategory at ${gate} percent`));
    assert.match(t, new RegExp(`caps its pillar at ${pillarCap} percent`));
    assert.match(t, new RegExp(`excellent: ${b.excellent}, good: ${b.good}, needs_improvement: ${b.needs_improvement}`));
  });

  it('docs/reading-a-catalog.md states the same rules', () => {
    const t = read('docs/reading-a-catalog.md');
    assert.match(t, new RegExp(`critical ${P.criticalityWeights.critical}x, important ${P.criticalityWeights.important}x, advisory ${P.criticalityWeights.advisory}x`));
    assert.match(t, new RegExp(`caps its subcategory at ${gate} percent`));
    assert.match(t, new RegExp(`caps its pillar at ${pillarCap} percent`));
    assert.match(t, new RegExp(`${Math.round(P.partialCredit.factor * 100)} percent of its points when the value is within ${P.partialCredit.withinMultiple}x`));
    assert.match(t, new RegExp(`excellent at ${b.excellent} percent or more, good at ${b.good}, needs improvement at ${b.needs_improvement}`));
  });

  it('the validation guide states the status bands the policy defines', () => {
    const t = read('docs/guides/tl-validation-assignment.md');
    assert.match(t, new RegExp(`\\| excellent \\| ${b.excellent} percent or more \\|`));
    assert.match(t, new RegExp(`\\| good \\| ${b.good} to ${b.excellent - 1} percent \\|`));
    assert.match(t, new RegExp(`\\| needs improvement \\| ${b.needs_improvement} to ${b.good - 1} percent \\|`));
    assert.match(t, new RegExp(`\\| critical \\| below ${b.needs_improvement} percent \\|`));
  });

  it('docs/scoring-model.md prose outside the generated block does not restate a different number', () => {
    const t = read('docs/scoring-model.md');
    const outside = t.replace(/<!-- policy:start -->[\s\S]*?<!-- policy:end -->/, '');
    const stale = outside.match(/capped at (\d+)%/g) || [];
    for (const s of stale) assert.equal(s, `capped at ${gate}%`, s);
    const bandLines = outside.match(/excellent[^\n]{0,40}(\d{2})/gi) || [];
    for (const l of bandLines) assert.ok(l.includes(String(b.excellent)) || /85/.test(l) === false, l);
  });

  it('docs/scoring-model.md states the partial-credit share and multiple the policy defines', () => {
    const t = read('docs/scoring-model.md');
    assert.match(t, new RegExp(`Partial credit: \\*\\*${Math.round(P.partialCredit.factor * 100)}%\\*\\* of points if within ${P.partialCredit.withinMultiple}x of the threshold`));
  });

  it('the restore-time metric descriptions state the policy default throughput', () => {
    const cat = getCatalog('postgresql');
    const d = P.defaults.restoreThroughputMbPerSecond;
    for (const id of ['BAK-4.8', 'BAK-4.9']) {
      const m = cat.metrics.find(x => x.metric_id === id);
      assert.match(m.description, new RegExp(`${d} MB/s`), `${id} description`);
    }
  });
});
