#!/usr/bin/env node
'use strict';

/**
 * Check a real collector payload against a catalog's expected shapes.
 *
 * Usage: node scripts/check-payload.js <technology> <payload.json>
 *
 * The payload is either a flat { legacy_name: value } map or an object with a
 * `values` key (the shape of data/samples/*.json and of the agent push).
 * Exit 1 when any metric is unparseable or a critical metric is not provided.
 */

const fs = require('fs');
const path = require('path');
const { checkPayload } = require('../src/catalog/payload-check');

const argv = process.argv.slice(2);
const modeIdx = argv.indexOf('--mode');
const mode = modeIdx !== -1 ? argv[modeIdx + 1] : undefined;
const positional = argv.filter((a, i) => a !== '--mode' && (modeIdx === -1 || i !== modeIdx + 1));
const [technology, file] = positional;
if (!technology || !file) {
  console.log('Usage: node scripts/check-payload.js <technology> <payload.json> [--mode standalone|agent]');
  console.log('  --mode agent includes agent-only metrics in the active set (default: standalone, or the payload\'s own "mode" key)');
  process.exit(2);
}

const raw = JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));
const values = raw && typeof raw === 'object' && raw.values && typeof raw.values === 'object' ? raw.values : raw;

const options = raw && raw.values
  ? { systemFacts: raw.systemFacts, workloadProfile: raw.workloadProfile, licensedOptions: raw.licensedOptions, mode: mode || raw.mode, pgVersion: raw.pgVersion, serverVersion: raw.serverVersion, deploymentProfile: raw.deploymentProfile, installedExtensions: raw.installedExtensions, availableSources: raw.availableSources }
  : { mode };
const report = checkPayload(technology, values, options);
const c = report.counts;
console.log(`${technology} catalog v${report.catalogVersion}: ${c.ok} ok, ${c.notProvided} not provided (${c.criticalNotProvided} critical), ${c.notApplicable} not applicable, ${c.unparseable} unparseable, ${c.enumMismatch} enum mismatch, ${c.unitSuspect} unit suspect, ${c.derived} derived, ${c.unknownKeys} unknown keys`);

const ORDER = ['unparseable', 'unit_suspect', 'enum_mismatch', 'not_provided'];
const rows = report.metrics
  .filter(m => m.status !== 'ok' && m.status !== 'derived' && m.status !== 'not_applicable')
  .sort((a, b) => (ORDER.indexOf(a.status) - ORDER.indexOf(b.status)) || a.metric_id.localeCompare(b.metric_id));
for (const m of rows) {
  const crit = m.criticality === 'critical' ? ' [critical]' : '';
  console.log(`  ${m.status.padEnd(14)} ${m.metric_id.padEnd(10)} ${m.legacy_name}${crit}${m.detail ? ': ' + m.detail : ''}`);
}
if (report.unknownKeys.length) {
  console.log(`  unknown keys: ${report.unknownKeys.join(', ')}`);
}
// Exit 1 when a critical metric cannot be scored as the catalog expects:
// unparseable, missing, or an enum value outside its pass list (R-002).
const criticalEnumMismatch = report.metrics.some(m => m.status === 'enum_mismatch' && m.criticality === 'critical');
process.exit(c.unparseable > 0 || c.criticalNotProvided > 0 || criticalEnumMismatch ? 1 : 0);
