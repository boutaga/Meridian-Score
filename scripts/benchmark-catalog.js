'use strict';

/**
 * Benchmark a modified catalog against the original.
 *
 * Scores every sample of the technology (data/samples/<tech>-*.json) with its
 * own context (system facts, workload profile, licensed options, deployment
 * profile, extensions) under both catalogs, and reports structural differences
 * (points, metrics, criticality, weights, thresholds, applicability, rules)
 * and score deltas.
 *
 * Usage: node scripts/benchmark-catalog.js <technology> <path-to-modified-catalog.json>
 *
 * Example: node scripts/benchmark-catalog.js postgresql ./postgresql-catalog-modified.json
 */

const fs = require('fs');
const path = require('path');
const { getCatalog, MetricCatalog, SUPPORTED_TECHNOLOGIES } = require('../src');
const ScoringEngine = require('../src/scoring/engine');

const args = process.argv.slice(2);
if (args.length < 2) {
  console.log('Usage: node scripts/benchmark-catalog.js <technology> <modified-catalog.json>');
  console.log(`Supported technologies: ${SUPPORTED_TECHNOLOGIES.join(', ')}`);
  process.exit(1);
}

const [tech, modifiedPath] = args;

if (!SUPPORTED_TECHNOLOGIES.includes(tech)) {
  console.error(`Unsupported technology: ${tech}. Supported: ${SUPPORTED_TECHNOLOGIES.join(', ')}`);
  process.exit(1);
}

if (!fs.existsSync(modifiedPath)) {
  console.error(`File not found: ${modifiedPath}`);
  process.exit(1);
}

// Load catalogs
const originalCat = getCatalog(tech);
const modifiedData = JSON.parse(fs.readFileSync(modifiedPath, 'utf8'));

let modifiedCat;
try {
  modifiedCat = MetricCatalog.fromData(tech, modifiedData);
} catch (err) {
  console.error(`Failed to load modified catalog: ${err.message}`);
  process.exit(1);
}

// Load sample data: every sample of this technology, with its context.
const samplesDir = path.resolve(__dirname, '../data/samples');
function loadSamples() {
  return fs.readdirSync(samplesDir)
    .filter(f => f.startsWith(`${tech}-`) && f.endsWith('.json'))
    .sort()
    .map(f => ({ scenario: f.slice(tech.length + 1, -5), sample: JSON.parse(fs.readFileSync(path.join(samplesDir, f), 'utf8')) }));
}

// Validation
function validateCatalog(data) {
  const errors = [];
  const pillarSums = {};
  for (const [id, sub] of Object.entries(data.subcategories || {})) {
    pillarSums[sub.pillar] = (pillarSums[sub.pillar] || 0) + sub.maxPoints;
  }
  for (const [pillar, sum] of Object.entries(pillarSums)) {
    if (Math.abs(sum - 20) > 0.01) {
      errors.push(`${pillar}: subcategory points sum to ${sum}, expected 20`);
    }
  }
  const ids = (data.metrics || []).map(m => m.metric_id);
  const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
  if (dupes.length > 0) {
    errors.push(`Duplicate metric IDs: ${[...new Set(dupes)].join(', ')}`);
  }
  return errors;
}

// Score with both catalogs, carrying the sample's own context: without it,
// size-relative, profile-keyed, declaration-keyed and license-gated metrics
// are never exercised.
function sampleOptions(sample) {
  const o = {};
  for (const k of ['systemFacts', 'workloadProfile', 'licensedOptions', 'deploymentProfile', 'installedExtensions', 'serverVersion', 'pgVersion']) {
    if (sample[k] !== undefined) o[k] = sample[k];
  }
  return o;
}

// Each sample is scored twice: standalone with its own options (what the
// simulator shows), and as an agent run with every source, so a change to an
// agent-only, Zabbix or worker metric moves a number instead of reading 0.00.
const RUNS = [
  { label: 'standalone', extra: {} },
  { label: 'agent', extra: { mode: 'agent', availableSources: ['sql', 'manual', 'zabbix', 'worker'] } },
];

function score(catalog, sample, extra = {}) {
  const engine = new ScoringEngine(tech, { catalog });
  return engine.calculate(sample.values, { ...sampleOptions(sample), ...extra });
}

// Metric fields that decide whether and how a metric scores, beyond the
// criticality, weight, threshold, applies_when and optional_when compared on
// their own.
const SCORING_FIELDS = ['evaluation_type', 'subcategory', 'sources', 'agent_only', 'license_requirement', 'gate_scope',
  'deployment_profiles', 'extension_requirement', 'derived', 'derived_from'];

// Structural comparison
function compareStructure() {
  const origSubcats = originalCat.subcategories;
  const modSubcats = modifiedData.subcategories;
  const pointChanges = [];

  for (const [id, orig] of Object.entries(origSubcats)) {
    const mod = modSubcats[id];
    if (!mod) {
      pointChanges.push({ subcategory: id, original: orig.maxPoints, modified: 'REMOVED' });
    } else if (orig.maxPoints !== mod.maxPoints) {
      pointChanges.push({ subcategory: id, name: orig.name, original: orig.maxPoints, modified: mod.maxPoints, delta: mod.maxPoints - orig.maxPoints });
    }
  }

  const origIds = new Set(originalCat.metrics.map(m => m.metric_id));
  const modIds = new Set(modifiedData.metrics.map(m => m.metric_id));

  const added = modifiedData.metrics.filter(m => !origIds.has(m.metric_id));
  const removed = originalCat.metrics.filter(m => !modIds.has(m.metric_id));

  const critChanges = [];
  const fieldChanges = [];
  const weightChanges = [];
  const thresholdChanges = [];
  const appliesChanges = [];
  const requirementChanges = [];
  const same = (a, b) => JSON.stringify(a === undefined ? null : a) === JSON.stringify(b === undefined ? null : b);
  for (const mod of modifiedData.metrics) {
    const orig = originalCat.metrics.find(m => m.metric_id === mod.metric_id);
    if (!orig) continue;
    if (orig.criticality !== mod.criticality) {
      critChanges.push({ metric_id: mod.metric_id, name: mod.display_name, original: orig.criticality, modified: mod.criticality });
    }
    if (!same(orig.weight, mod.weight)) {
      weightChanges.push({ metric_id: mod.metric_id, original: orig.weight == null ? 'default' : orig.weight, modified: mod.weight == null ? 'default' : mod.weight });
    }
    if (!same(orig.evaluation_config, mod.evaluation_config)) {
      thresholdChanges.push({ metric_id: mod.metric_id, original: JSON.stringify(orig.evaluation_config), modified: JSON.stringify(mod.evaluation_config) });
    }
    if (!same(orig.applies_when, mod.applies_when)) {
      appliesChanges.push({ metric_id: mod.metric_id, original: JSON.stringify(orig.applies_when || null), modified: JSON.stringify(mod.applies_when || null) });
    }
    if (!same(orig.optional_when, mod.optional_when)) {
      requirementChanges.push({ metric_id: mod.metric_id, original: JSON.stringify(orig.optional_when || null), modified: JSON.stringify(mod.optional_when || null) });
    }
    // Every other field that decides whether and how a metric scores.
    const keys = new Set([...Object.keys(orig), ...Object.keys(mod)].filter(k => SCORING_FIELDS.includes(k) || /^min_.*version$/.test(k)));
    for (const k of keys) {
      if (!same(orig[k], mod[k])) {
        fieldChanges.push({ metric_id: mod.metric_id, field: k, original: JSON.stringify(orig[k] === undefined ? null : orig[k]), modified: JSON.stringify(mod[k] === undefined ? null : mod[k]) });
      }
    }
  }

  const origRules = new Map((originalCat.consistencyRules || []).map(r => [r.rule_id, r]));
  const modRules = new Map((modifiedData.consistency_rules || []).map(r => [r.rule_id, r]));
  const ruleChanges = [];
  for (const [id, r] of modRules) {
    if (!origRules.has(id)) ruleChanges.push({ rule_id: id, change: 'added', title: r.title });
    else if (!same(origRules.get(id), r)) ruleChanges.push({ rule_id: id, change: 'changed', title: r.title });
  }
  for (const [id, r] of origRules) {
    if (!modRules.has(id)) ruleChanges.push({ rule_id: id, change: 'removed', title: r.title });
  }

  return { pointChanges, added, removed, critChanges, fieldChanges, weightChanges, thresholdChanges, appliesChanges, requirementChanges, ruleChanges };
}

// Run benchmark
console.log(`\n  Benchmark: ${tech}`);
console.log(`  Original: v${originalCat.version} (${originalCat.metrics.length} metrics)`);
console.log(`  Modified: v${modifiedData.version || '?'} (${modifiedData.metrics.length} metrics)`);
console.log('  ' + '='.repeat(60));

// Validation
const errors = validateCatalog(modifiedData);
if (errors.length > 0) {
  console.log('\n  VALIDATION FAILED:');
  errors.forEach(e => console.log(`    - ${e}`));
  process.exit(1);
}
console.log('\n  Validation: PASSED');

// Structural changes
const struct = compareStructure();

if (struct.pointChanges.length > 0) {
  console.log('\n  Subcategory Point Changes:');
  for (const c of struct.pointChanges) {
    const sign = c.delta > 0 ? '+' : '';
    console.log(`    ${c.subcategory} (${c.name}): ${c.original} -> ${c.modified} (${sign}${c.delta})`);
  }
}

if (struct.added.length > 0) {
  console.log(`\n  Metrics Added (${struct.added.length}):`);
  for (const m of struct.added) {
    console.log(`    + ${m.metric_id} ${m.display_name} [${m.criticality}] in ${m.subcategory}`);
  }
}

if (struct.removed.length > 0) {
  console.log(`\n  Metrics Removed (${struct.removed.length}):`);
  for (const m of struct.removed) {
    console.log(`    - ${m.metric_id} ${m.display_name} [${m.criticality}] from ${m.subcategory}`);
  }
}

if (struct.critChanges.length > 0) {
  console.log(`\n  Criticality Changes (${struct.critChanges.length}):`);
  for (const c of struct.critChanges) {
    console.log(`    ${c.metric_id} ${c.name}: ${c.original} -> ${c.modified}`);
  }
}

const listSections = [
  ['Weight Changes', struct.weightChanges, c => `${c.metric_id}: ${c.original} -> ${c.modified}`],
  ['Threshold Changes', struct.thresholdChanges, c => `${c.metric_id}:\n      was ${c.original}\n      now ${c.modified}`],
  ['Applicability Changes', struct.appliesChanges, c => `${c.metric_id}:\n      was ${c.original}\n      now ${c.modified}`],
  ['Requirement Changes (optional_when)', struct.requirementChanges, c => `${c.metric_id}:\n      was ${c.original}\n      now ${c.modified}`],
  ['Other Scoring-Field Changes', struct.fieldChanges, c => `${c.metric_id} ${c.field}: ${c.original} -> ${c.modified}`],
  ['Consistency Rule Changes', struct.ruleChanges, c => `${c.change.padEnd(7)} ${c.rule_id} ${c.title || ''}`],
];
for (const [title, items, fmt] of listSections) {
  if (items.length === 0) continue;
  console.log(`\n  ${title} (${items.length}):`);
  for (const c of items) console.log(`    ${fmt(c)}`);
}

const structuralCount = struct.pointChanges.length + struct.added.length + struct.removed.length + struct.critChanges.length
  + struct.fieldChanges.length + struct.weightChanges.length + struct.thresholdChanges.length + struct.appliesChanges.length
  + struct.requirementChanges.length + struct.ruleChanges.length;
if (structuralCount === 0) {
  console.log('\n  No changes in the compared fields (subcategory points, metrics added or removed, criticality, weights,');
  console.log('  thresholds, applies_when, optional_when, scoring fields, consistency rules). Prose fields are not compared.');
}

// Score comparison: every sample, each with its own context. Pillars are
// listed only when they moved, so a quiet sample stays one line.
const samples = loadSamples();
if (samples.length === 0) console.log(`\n  No ${tech} samples found under data/samples.`);
else console.log('\n  Score comparison (every sample with its own context, standalone and as an agent run with every source):');
for (const { scenario, sample } of samples) for (const run of RUNS) {
  const origResult = score(originalCat, sample, run.extra);
  const modResult = score(modifiedCat, sample, run.extra);

  const totalDelta = modResult.totalScore - origResult.totalScore;
  const totalSign = totalDelta > 0 ? '+' : '';
  const statusText = origResult.status === modResult.status ? origResult.status : `${origResult.status} -> ${modResult.status}`;
  const dispText = origResult.disposition.state === modResult.disposition.state
    ? '' : `, disposition ${origResult.disposition.state} -> ${modResult.disposition.state}`;
  const targetText = origResult.targetScore === modResult.targetScore
    ? '' : `, target ${origResult.targetScore} -> ${modResult.targetScore}`;
  const findingsText = origResult.allFindings.length === modResult.allFindings.length
    ? '' : `, findings ${origResult.allFindings.length} -> ${modResult.allFindings.length}`;

  console.log(`    ${scenario} [${run.label}]: ${origResult.totalScore}/${origResult.totalMaxScore} -> ${modResult.totalScore}/${modResult.totalMaxScore} (${totalSign}${totalDelta.toFixed(2)})${targetText}, ${statusText}${dispText}${findingsText}`);
  for (const pillarId of originalCat.getPillarIds()) {
    const op = origResult.pillars[pillarId];
    const mp = modResult.pillars[pillarId];
    if (!op || !mp) continue;
    const delta = mp.score - op.score;
    if (Math.abs(delta) <= 0.01) continue;
    const sign = delta > 0 ? '+' : '';
    console.log(`        ${op.name.padEnd(20)} ${op.score.toFixed(2).padStart(6)} -> ${mp.score.toFixed(2).padStart(6)} (${sign}${delta.toFixed(2)})`);
  }
}

console.log('\n  ' + '='.repeat(60));
console.log('  Benchmark complete.\n');
