#!/usr/bin/env node
'use strict';

/**
 * Extract technical anchors (the SQL behind each metric) from the sibling
 * db-health-checker repository. Dev tool: read-only on the checker, never
 * wired into npm test. Output is a JSON map keyed by legacy_name that a
 * catalog editor merges into data/metrics/<tech>.json `technical_anchor`.
 *
 * Usage:
 *   node scripts/extract-anchors-from-checker.js --tech postgresql|oracle
 *        [--checker-path ../db-health-checker] [--out <file>]
 *
 * Heuristic: every `metrics.push({ name: '<legacy_name>' ... })` is paired
 * with the nearest preceding SQL string literal (template or quoted, holding
 * SELECT / SHOW / WITH) within 80 lines. For the Oracle agent SQL script every
 * `AS "<legacy_name>"` alias is paired with its enclosing sub-select.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const args = process.argv.slice(2);
function opt(name, def) {
  const i = args.indexOf(name);
  return i !== -1 && args[i + 1] ? args[i + 1] : def;
}
const tech = opt('--tech', null);
const checkerPath = path.resolve(opt('--checker-path', path.join(__dirname, '..', '..', 'db-health-checker')));
const outFile = opt('--out', null);
if (!tech || !['postgresql', 'oracle'].includes(tech)) {
  console.log('Usage: node scripts/extract-anchors-from-checker.js --tech postgresql|oracle [--checker-path <p>] [--out <file>]');
  process.exit(2);
}

const SOURCES = {
  postgresql: { js: ['src/providers/postgresql/queries'], sql: [] },
  oracle: { js: ['src/providers/oracle/index.js'], sql: ['agent-scripts/oracle/dbi_health_check_oracle.sql'] },
};

function listJs(rel) {
  const abs = path.join(checkerPath, rel);
  if (!fs.existsSync(abs)) return [];
  if (fs.statSync(abs).isFile()) return [rel];
  return fs.readdirSync(abs).filter(f => f.endsWith('.js')).sort().map(f => path.join(rel, f));
}

function dedent(sql) {
  const lines = sql.replace(/\r/g, '').split('\n');
  while (lines.length && !lines[0].trim()) lines.shift();
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  const indents = lines.filter(l => l.trim()).map(l => l.match(/^\s*/)[0].length);
  const min = indents.length ? Math.min(...indents) : 0;
  return lines.map(l => l.slice(min)).join('\n');
}

function tablesOf(sql) {
  const names = new Set();
  const re = /\b(?:FROM|JOIN)\s+([A-Za-z_][\w.$]*)/gi;
  let m;
  while ((m = re.exec(sql))) { if (!/^(dual|now|lateral|unnest|generate_series)$/i.test(m[1])) names.add(m[1]); }
  return [...names];
}

function summaryFor(sql) {
  const t = tablesOf(sql);
  return t.length ? `Reads ${t.slice(0, 4).join(', ')}` : 'Reads the collector query below';
}

/** Blank out JavaScript comments (keeping line breaks) so an apostrophe in a
 *  comment cannot open a phantom string literal that swallows real SQL. */
function stripComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
    .replace(/^(\s*)\/\/.*$/gm, (m, ws) => ws)
    .replace(/([;{},)])\s*\/\/.*$/gm, '$1');
}

/** Find SQL string literals (template or quoted) with their starting line. */
function findSqlLiterals(rawText) {
  const text = stripComments(rawText);
  const out = [];
  const re = /`((?:[^`\\]|\\.)*)`|'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"/g;
  let m;
  while ((m = re.exec(text))) {
    const body = m[1] !== undefined ? m[1] : (m[2] !== undefined ? m[2] : m[3]);
    if (!/\b(SELECT|SHOW|WITH)\b/i.test(body) || body.length < 12) continue;
    const line = text.slice(0, m.index).split('\n').length;
    out.push({ line, sql: dedent(body) });
  }
  return out;
}

function findPushes(text) {
  const out = [];
  const re = /metrics\.push\(\s*\{[\s\S]{0,200}?name:\s*['"]([A-Za-z_][\w]*)['"]/g;
  let m;
  while ((m = re.exec(text))) {
    const line = text.slice(0, m.index).split('\n').length;
    out.push({ line, name: m[1] });
  }
  return out;
}

function extractJs(rel, anchors) {
  const text = fs.readFileSync(path.join(checkerPath, rel), 'utf8');
  const sqls = findSqlLiterals(text);
  const pushes = findPushes(text);
  for (const p of pushes) {
    const candidates = sqls.filter(q => q.line <= p.line && p.line - q.line <= 80);
    if (!candidates.length) continue;
    const q = candidates[candidates.length - 1];
    if (anchors[p.name]) continue; // first occurrence wins
    anchors[p.name] = { summary: summaryFor(q.sql), query: q.sql, source_file: rel, line: q.line, distance: p.line - q.line };
  }
}

/** Oracle agent script: pair `AS "name"` aliases with the enclosing sub-select. */
function extractAgentSql(rel, anchors) {
  const text = fs.readFileSync(path.join(checkerPath, rel), 'utf8');
  const re = /\)\s*AS\s+"([A-Za-z_][\w]*)"/g;
  let m;
  while ((m = re.exec(text))) {
    const name = m[1];
    if (anchors[name]) continue;
    // walk backwards from the closing parenthesis to its opener
    let depth = 0;
    let i = m.index;
    for (; i >= 0; i--) {
      const ch = text[i];
      if (ch === ')') depth++;
      else if (ch === '(') { depth--; if (depth === 0) break; }
    }
    if (i < 0) continue;
    const body = text.slice(i + 1, m.index);
    if (!/\bSELECT\b/i.test(body)) continue;
    const line = text.slice(0, i).split('\n').length;
    anchors[name] = { summary: summaryFor(body), query: dedent(body), source_file: rel, line };
  }
}


/**
 * Second pass: settings collected in bulk (a list of GUC or parameter names
 * fed to one pg_settings / V$PARAMETER query, then pushed in a loop) have no
 * literal `metrics.push({ name })`. When the quoted legacy_name appears in a
 * file that queries the settings view, the per-setting query is implied.
 */
function inferSettingAnchors(rel, anchors, names) {
  const text = fs.readFileSync(path.join(checkerPath, rel), 'utf8');
  const lower = text.toLowerCase();
  const pg = lower.includes('pg_settings');
  const ora = lower.includes('v$parameter');
  if (!pg && !ora) return;
  for (const name of names) {
    if (anchors[name]) continue;
    const idx = text.indexOf(`'${name}'`);
    if (idx === -1) continue;
    const line = text.slice(0, idx).split('\n').length;
    anchors[name] = pg
      ? { summary: `Reads the ${name} setting from pg_settings`, query: `SELECT setting FROM pg_settings WHERE name = '${name}'`, source_file: rel, line, inferred: true }
      : { summary: `Reads the ${name} parameter from V$PARAMETER`, query: `SELECT VALUE FROM V$PARAMETER WHERE NAME = '${name}'`, source_file: rel, line, inferred: true };
  }
}

let checkerSha = 'unknown';
try { checkerSha = execSync('git rev-parse HEAD', { cwd: checkerPath, encoding: 'utf8' }).trim(); } catch (_) { /* leave unknown */ }

if (!fs.existsSync(checkerPath)) {
  console.error(`checker repository not found at ${checkerPath} (use --checker-path)`);
  process.exit(2);
}
const sourceFiles = SOURCES[tech].js.flatMap(listJs);
if (sourceFiles.length === 0) {
  console.error(`no collector sources found under ${checkerPath} for ${tech}: ${SOURCES[tech].js.join(', ')}`);
  process.exit(2);
}
const anchors = {};
for (const f of sourceFiles) extractJs(f, anchors);
for (const rel of SOURCES[tech].sql) if (fs.existsSync(path.join(checkerPath, rel))) extractAgentSql(rel, anchors);

const catalog = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'metrics', `${tech}.json`), 'utf8'));
const names = catalog.metrics.map(m => m.legacy_name);
for (const rel of SOURCES[tech].js) for (const f of listJs(rel)) inferSettingAnchors(f, anchors, names);
const covered = names.filter(n => anchors[n]);
const result = { technology: tech, checkerSha, extractedAt: new Date().toISOString(), anchors };
const json = JSON.stringify(result, null, 2) + '\n';
if (outFile) {
  fs.writeFileSync(path.resolve(outFile), json);
  console.log(`${tech}: ${Object.keys(anchors).length} anchors extracted, ${covered.length}/${names.length} catalog metrics covered -> ${outFile}`);
} else {
  process.stdout.write(json);
}
