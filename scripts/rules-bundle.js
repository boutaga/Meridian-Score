#!/usr/bin/env node
'use strict';

/**
 * Export, verify and score with a rules bundle (1.16.0).
 *
 * Usage:
 *   node scripts/rules-bundle.js export <technology> [--declarations file.json]
 *       Print a bundle of the embedded catalog; --declarations adds the
 *       exporter's declared targets (a flat map or a file with a `values` key).
 *   node scripts/rules-bundle.js verify <bundle.json>
 *       Exit 1 with the reason when the file is not a valid bundle or its
 *       fingerprint does not match its content.
 *   node scripts/rules-bundle.js score <bundle.json> <payload.json> [--own-declarations]
 *       Score a payload against the bundle's rules. The bundle's declared
 *       targets replace the payload's by default (the exporter's bar); a target
 *       the bundle leaves undeclared keeps the payload's value. With
 *       --own-declarations the payload keeps all its own targets.
 *
 * The codes are checksums, not signatures: they catch a damaged file or a
 * naive edit, not a deliberate one.
 */

const fs = require('fs');
const path = require('path');
const ScoringEngine = require('../src/scoring/engine');
const { exportRulesBundle, loadRulesBundle } = require('../src/bundle');

const argv = process.argv.slice(2);
const KNOWN_FLAGS = { export: ['--declarations'], verify: [], score: ['--own-declarations'] };
const TAKES_VALUE = new Set(['--declarations']);
const flag = (name) => argv.includes(name);
const option = (name) => { const i = argv.indexOf(name); return i === -1 ? undefined : argv[i + 1]; };
const positional = argv.filter((a, i) => !a.startsWith('--') && !(i > 0 && TAKES_VALUE.has(argv[i - 1])));
const [command, first, second] = positional;

// A misspelled or valueless option must not be ignored silently: the
// exporter would believe their targets travelled.
for (const [i, a] of argv.entries()) {
  if (!a.startsWith('--')) continue;
  if (!(KNOWN_FLAGS[command] || []).includes(a)) {
    console.error(`unknown option ${a} for ${command || 'this command'}`);
    process.exit(2);
  }
  if (TAKES_VALUE.has(a) && (argv[i + 1] === undefined || argv[i + 1].startsWith('--'))) {
    console.error(`option ${a} needs a file`);
    process.exit(2);
  }
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));
  } catch (e) {
    console.error(`cannot read ${file}: ${e.message}`);
    process.exit(1);
  }
}
const valuesOf = (raw) => (raw && typeof raw === 'object' && raw.values && typeof raw.values === 'object' ? raw.values : raw);

function usage() {
  console.error('Usage: node scripts/rules-bundle.js export <technology> [--declarations file.json]');
  console.error('       node scripts/rules-bundle.js verify <bundle.json>');
  console.error('       node scripts/rules-bundle.js score <bundle.json> <payload.json> [--own-declarations]');
  process.exit(2);
}

function load(file) {
  try {
    return loadRulesBundle(fs.readFileSync(path.resolve(file), 'utf8'));
  } catch (e) {
    console.error(`INVALID ${file}: ${e.message}`);
    process.exit(1);
  }
}

if (command === 'export' && first) {
  const declFile = option('--declarations');
  const declarations = declFile ? valuesOf(readJson(declFile)) : undefined;
  try {
    process.stdout.write(JSON.stringify(exportRulesBundle(first, { declarations }), null, 2) + '\n');
  } catch (e) {
    console.error(`export failed: ${e.message}`);
    process.exit(1);
  }
} else if (command === 'verify' && first) {
  const b = load(first);
  const rules = b.sameEngine ? `rules ${b.fingerprint.rules.slice(0, 12)}` : 'rules code not verified (other engine version)';
  console.log(`OK ${first}: ${b.technology} catalog ${b.catalog.version}, engine ${b.engineVersion}, ${rules}`);
  for (const n of b.notes) console.log(`  note: ${n}`);
} else if (command === 'score' && first && second) {
  const b = load(first);
  const payload = readJson(second);
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    console.error(`cannot score ${second}: expected a JSON object of values, or an object with a "values" key`);
    process.exit(1);
  }
  const values = { ...valuesOf(payload) };
  const own = flag('--own-declarations');
  let filledByPayload = false;
  if (!own && b.declarations) {
    for (const [name, v] of Object.entries(b.declarations)) {
      if (v !== null) values[name] = v;
      else if (values[name] !== undefined && values[name] !== null && values[name] !== '') filledByPayload = true;
    }
  }
  // Every run option the payload carries, as the checker passes them.
  const options = { systemFacts: payload.systemFacts || {}, workloadProfile: payload.workloadProfile || 'mixed' };
  for (const k of ['mode', 'availableSources', 'licensedOptions', 'deploymentProfile', 'serverVersion', 'pgVersion', 'installedExtensions']) {
    if (payload[k] !== undefined) options[k] = payload[k];
  }
  let r;
  try {
    r = new ScoringEngine(b.technology, { catalog: b.catalog }).calculate(values, options);
  } catch (e) {
    console.error(`scoring failed: ${e.message}`);
    process.exit(1);
  }
  const fp = r.context.fingerprint;
  console.log(`Score ${r.totalScore} of ${r.totalMaxScore}, target ${r.targetScore} (${r.targetAttainment} percent reached), status ${r.status}, disposition ${r.disposition.state}`);
  if (!r.onTarget) console.log(`Target not reached: ${r.requiredMissed.map((m) => m.id).join(', ')}`);
  console.log(`Rules code ${fp.rulesShort}: ${fp.rules === b.fingerprint.rules ? 'same as the bundle' : 'differs from the bundle'}`);
  const declSource = own || !b.declarations ? 'the payload\'s own targets'
    : filledByPayload ? 'the bundle\'s targets, plus your own where the bundle declares none'
      : 'the bundle\'s targets';
  const declMatch = b.fingerprint.declarations
    ? (fp.declarations === b.fingerprint.declarations ? ', same as the bundle' : ', differs from the bundle')
    : '';
  console.log(`Declarations code ${fp.declarationsShort} (${declSource}${declMatch})`);
  for (const n of b.notes) console.log(`  note: ${n}`);
} else {
  usage();
}
