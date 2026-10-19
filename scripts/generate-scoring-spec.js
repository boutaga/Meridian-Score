'use strict';

/**
 * Generate one Excel workbook per technology that documents the full scoring
 * model — pillars, subcategories, points, criticality gates, every metric,
 * its evaluation logic, and a clickable link to the SQL/code in the sibling
 * db-health-checker repo that collects it (Zabbix and worker metrics get
 * text references instead).
 *
 * Output: docs/scoring-spec/<technology>.xlsx (one per tech) plus a README.
 *
 * Usage: node scripts/generate-scoring-spec.js [options]
 *   --checker-path <path>   default: ../db-health-checker
 *   --checker-ref <ref>     default: HEAD SHA of <checker-path>
 *   --scoring-ref <ref>     default: HEAD SHA of this repo
 *   --no-links              public set: no collection links, no checker checkout needed
 *   --owner <org>           default: dbiservices
 *   --checker-repo <name>   default: dbi-db-health-checker
 *   --scoring-repo <name>   default: dbi-db-health-scoring-core
 *   --tech <csv>            default: all (postgresql,mysql,mariadb,...)
 *   --out <dir>             default: docs/scoring-spec (public set) or docs/scoring-spec-internal (git-ignored)
 *   --check                 dry run (warn-only, do not write xlsx)
 *   --strict                exit 1 if any warning fires
 *   --allow-dirty           pin to a dirty checker worktree
 *   --verbose               per-metric resolution log
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const ExcelJS = require('exceljs');
const { getCatalog, SUPPORTED_TECHNOLOGIES, CRITICALITY_WEIGHTS } = require('../src');
const { CATALOG_FILES } = require('../src/catalog/constants');

function loadRawCatalog(tech) {
  const file = CATALOG_FILES[tech];
  if (!file) return {};
  delete require.cache[require.resolve(file)];
  return require(file);
}

// The public set links to the public repository, whose history is separate
// from this one: it names the package version, not a commit it cannot open.
const PUBLIC_REPO = 'https://github.com/boutaga/Meridian-Score';
const PACKAGE_VERSION = require('../package.json').version;

// ───────────────────────────────────────────────────────────────────────────
// CLI

function parseArgs(argv) {
  const opts = {
    checkerPath: path.resolve(__dirname, '../../db-health-checker'),
    checkerRef: null,
    scoringRef: null,
    owner: 'dbiservices',
    noLinks: false,
    checkerRepo: 'dbi-db-health-checker',
    scoringRepo: 'dbi-db-health-scoring-core',
    tech: SUPPORTED_TECHNOLOGIES,
    out: null, // resolved after parsing: the public set or the internal folder
    check: false,
    strict: false,
    allowDirty: false,
    verbose: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) { fail(2, `Missing value for ${a}`); }
      return v;
    };
    switch (a) {
      case '--checker-path': opts.checkerPath = path.resolve(next()); break;
      case '--checker-ref':  opts.checkerRef = next(); break;
      case '--scoring-ref':  opts.scoringRef = next(); break;
      case '--owner':        opts.owner = next(); break;
      case '--no-links':     opts.noLinks = true; break;
      case '--checker-repo': opts.checkerRepo = next(); break;
      case '--scoring-repo': opts.scoringRepo = next(); break;
      case '--tech':         opts.tech = next().split(',').map(s => s.trim()).filter(Boolean); break;
      case '--out':          opts.out = path.resolve(next()); break;
      case '--check':        opts.check = true; break;
      case '--strict':       opts.strict = true; break;
      case '--allow-dirty':  opts.allowDirty = true; break;
      case '--verbose':      opts.verbose = true; break;
      case '-h': case '--help': printHelp(); process.exit(0);
      default: fail(2, `Unknown argument: ${a}`);
    }
  }
  // The committed workbooks are the public set. The internal set (links into
  // the private checker) defaults to a git-ignored folder so it can never
  // overwrite them by accident.
  if (!opts.out) {
    opts.out = path.resolve(__dirname, opts.noLinks ? '../docs/scoring-spec' : '../docs/scoring-spec-internal');
  }
  return opts;
}

function printHelp() {
  console.log([
    'Usage: node scripts/generate-scoring-spec.js [options]',
    '',
    '  --checker-path <path>   path to db-health-checker (default: ../db-health-checker)',
    '  --checker-ref <ref>     git ref to pin permalinks (default: HEAD of checker repo)',
    '  --scoring-ref <ref>     git ref for scoring-core links (default: HEAD of this repo)',
    '  --owner <org>           GitHub org (default: dbiservices)',
    '  --checker-repo <name>   checker repo name (default: dbi-db-health-checker)',
    '  --scoring-repo <name>   scoring-core repo name (default: dbi-db-health-scoring-core)',
    '  --no-links              public set: no collection links, reads no checker checkout',
    '  --tech <csv>            comma-separated tech list (default: all)',
    '  --out <dir>             output directory (default: docs/scoring-spec with --no-links, else docs/scoring-spec-internal, git-ignored)',
    '  --check                 dry run (warn-only, do not write xlsx)',
    '  --strict                exit 1 if any warning fires',
    '  --allow-dirty           pin to a dirty checker worktree',
    '  --verbose               per-metric resolution log',
  ].join('\n'));
}

function fail(code, msg) {
  console.error(`generate-scoring-spec: ${msg}`);
  process.exit(code);
}

// ───────────────────────────────────────────────────────────────────────────
// Git helpers

function gitSha(repoPath) {
  try {
    return execFileSync('git', ['-C', repoPath, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch (err) {
    fail(1, `cannot read HEAD from ${repoPath}: ${err.message}`);
  }
}

function gitDirty(repoPath) {
  try {
    return execFileSync('git', ['-C', repoPath, 'status', '--porcelain'], { encoding: 'utf8' }).trim().length > 0;
  } catch {
    return false;
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Display + format helpers

const TECH_DISPLAY = {
  postgresql: 'PostgreSQL',
  mysql: 'MySQL',
  mariadb: 'MariaDB',
  mongodb: 'MongoDB',
  oracle: 'Oracle',
  sqlserver: 'SQL Server',
};

const PILLAR_TAG = {
  backup: 'BAK',
  security: 'SEC',
  capacity: 'CAP',
  performance: 'PRF',
  futureproof: 'FUT',
};

function pillarTag(pillarId) {
  return PILLAR_TAG[pillarId] || pillarId.slice(0, 3).toUpperCase();
}

function sanitizeSheetName(name) {
  // Excel: ≤31 chars, no [ ] : * ? / \, no leading/trailing apostrophe.
  let s = String(name).replace(/[[\]:*?/\\]/g, '').replace(/\s+/g, ' ').trim();
  s = s.replace(/^'+|'+$/g, '');
  if (s.length > 31) s = s.slice(0, 31).trim();
  return s || 'Sheet';
}

function uniqueSheetName(name, used, warnings) {
  const base = sanitizeSheetName(name);
  if (!used.has(base)) {
    used.add(base);
    return base;
  }
  warnings.push({ kind: 'sheet_name_collision', detail: `Collision on '${base}'` });
  let n = 2;
  while (used.has(sanitizeSheetName(`${base.slice(0, 27)} (${n})`))) n++;
  const final = sanitizeSheetName(`${base.slice(0, 27)} (${n})`);
  used.add(final);
  return final;
}

function criticalityBadge(c) {
  switch (c) {
    case 'critical': return 'Critical';
    case 'important': return 'Important';
    case 'advisory': return 'Advisory';
    default: return c || '';
  }
}

function formatSources(sources) {
  return (sources || []).map(s => {
    switch (s) {
      case 'sql': return 'SQL';
      case 'manual': return 'Manual';
      case 'zabbix': return 'Zabbix';
      case 'worker': return 'Worker';
      default: return s;
    }
  }).join(', ');
}

// Public-set replacement for the collection link: where a reviewer finds the
// definition of the measurement without access to the checker repository.
// Names the non-SQL sources too, so a Zabbix or backup-worker collection is
// visible without reading the Sources column.
function measurementPointer(metric, warnings) {
  if (metric.derived) return 'Engine-derived (formula in the scoring policy)';
  const sources = metric.sources || [];
  const others = sources.filter(s => s !== 'sql' && s !== 'manual').map(s => formatSources([s]));
  const also = others.length ? ` (also ${others.join(', ')})` : '';
  if (metric.technical_anchor) {
    if (!sources.includes('sql') && others.length) return `See Anchor SQL (collected by ${others.join(' or ')})`;
    return `See Anchor SQL${also}`;
  }
  if (sources.includes('manual')) return `Manual entry${also}`;
  if (warnings) warnings.push({ kind: 'measurement_undocumented', detail: `${metric.metric_id} (${metric.legacy_name}) has no technical_anchor` });
  if (!sources.includes('sql') && others.length) return `Collected by ${others.join(' or ')}; not documented yet`;
  return `Not documented yet${also}`;
}

function effectiveWeight(metric) {
  if (metric.weight != null) return metric.weight;
  return CRITICALITY_WEIGHTS[metric.criticality] || 1;
}

function formatPassCriteria(metric) {
  const ec = metric.evaluation_config || {};
  switch (metric.evaluation_type) {
    case 'boolean':
      if (ec.check === 'not_empty_or_dummy') return 'Non-empty, non-dummy value';
      if (ec.pass_value === undefined) return 'truthy';
      return `= ${ec.pass_value}`;
    case 'enum':
      return `in [${(ec.pass_values || []).map(v => `\`${v}\``).join(', ')}]`;
    case 'threshold':
    case 'range':
      return formatThresholdShape(ec);
    default:
      return 'truthy';
  }
}

function formatThresholdShape(ec) {
  if (!ec || typeof ec !== 'object') return 'N/A';

  // Declaration-keyed (by_declaration): the bound follows a declared target,
  // so show every band instead of the fallback alone (DEC-008: reviewers are
  // not anchored on an absolute bound where the declaration decides it).
  if (ec.by_declaration && ec.by_declaration.bands) {
    const bd = ec.by_declaration;
    const { by_declaration, ...base } = ec;
    const bands = Object.entries(bd.bands).map(([k, b]) => `${k}: ${formatThresholdShape({ unit: ec.unit, ...b })}`);
    const otherwise = formatThresholdShape(base);
    const unless = bd.unless ? `; declaration ignored when ${renderClause(bd.unless)}` : '';
    return `by declared ${bd.metric}: ${bands.join(' / ')}; otherwise ${otherwise}${unless}`;
  }

  // Profile-keyed (oltp / olap / mixed / default)
  if (ec.profiles && typeof ec.profiles === 'object') {
    const lines = [];
    for (const [pName, pCfg] of Object.entries(ec.profiles)) {
      lines.push(`${pName}: ${formatThresholdShape(pCfg)}`);
    }
    return lines.join(' / ');
  }

  const parts = [];
  if (ec.min !== undefined) parts.push(`>= ${ec.min}`);
  if (ec.max !== undefined) parts.push(`<= ${ec.max}`);
  if (ec.unit) parts.push(`(${ec.unit})`);

  if (ec.min_pct !== undefined) {
    parts.push(`>= ${ec.min_pct}% of ${ec.min_pct_of}`);
  }
  if (ec.max_pct !== undefined) {
    parts.push(`<= ${ec.max_pct}% of ${ec.max_pct_of}`);
  }
  if (ec.absolute_floor) {
    const af = ec.absolute_floor;
    const afParts = [];
    if (af.min !== undefined) afParts.push(`>= ${af.min}`);
    if (af.max !== undefined) afParts.push(`<= ${af.max}`);
    if (afParts.length) parts.push(`(floor: ${afParts.join(' AND ')})`);
  }
  return parts.length ? parts.join(' AND ') : 'N/A';
}

function formatDeploymentProfiles(metric) {
  const dp = metric.deployment_profiles;
  if (!dp || (Array.isArray(dp) && dp.length === 0)) return 'All';
  return Array.isArray(dp) ? dp.join(', ') : String(dp);
}

function formatMinVersion(metric, tech) {
  const candidates = [
    metric.min_pg_version,
    metric.min_mysql_version,
    metric.min_mariadb_version,
    metric.min_mongo_version,
    metric.min_version,
  ];
  for (const v of candidates) {
    if (v != null) {
      if (typeof v === 'number' && v >= 10000 && tech === 'postgresql') {
        // PG integer version like 120000 → 12.x
        return `${Math.floor(v / 10000)}.x`;
      }
      return String(v);
    }
  }
  return '';
}

// ───────────────────────────────────────────────────────────────────────────
// File scanning (legacy_name → line resolution)

function readLinesCached(filePath, cache) {
  if (cache.has(filePath)) return cache.get(filePath);
  if (!fs.existsSync(filePath)) {
    cache.set(filePath, null);
    return null;
  }
  const text = fs.readFileSync(filePath, 'utf8');
  const lines = text.split(/\r?\n/);
  cache.set(filePath, lines);
  return lines;
}

function buildNameIndex(filePath, pattern, cache) {
  const lines = readLinesCached(filePath, cache);
  if (!lines) return null;
  const index = new Map();
  const re = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g');
  for (let i = 0; i < lines.length; i++) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(lines[i])) !== null) {
      const name = m[1];
      if (!index.has(name)) {
        index.set(name, i + 1);
      }
    }
  }
  return index;
}

// PG queries live across multiple files under src/providers/postgresql/queries/.
// Build one index per file, keyed by file basename.
const PG_QUERY_FILES = ['backup.js', 'security.js', 'capacity.js', 'performance.js', 'futureproof.js', 'supplementary.js'];

// Hint which file to look in first based on a metric's subcategory id.
function pgPreferredFile(subcategoryId) {
  if (subcategoryId.startsWith('backup_')) return 'backup.js';
  if (subcategoryId.startsWith('security_')) return 'security.js';
  if (subcategoryId.startsWith('capacity_')) return 'capacity.js';
  if (subcategoryId.startsWith('performance_') || subcategoryId.startsWith('perf_')) return 'performance.js';
  if (subcategoryId.startsWith('future_')) return 'futureproof.js';
  return 'supplementary.js';
}

const NAME_PROP_PATTERN = /(?:^|[^\w])name:\s*['"]([\w.-]+)['"]/;
const SQL_ALIAS_PATTERN = /\bAS\s+([\w]+)(?=[\s,)])/i;

function buildCheckerIndexes(checkerPath, fileCache) {
  const indexes = {
    pg: new Map(), // legacy_name → { file, line }
    pgFiles: {},   // basename → full path (so we can also resolve subcategory hints)
    monolith: {},  // tech → Map<legacy_name, line>
    monolithPaths: {}, // tech → file path
    worker: null,  // Map<legacy_name, line> for dbi_health_check.sql
    workerPath: path.join(checkerPath, 'agent-scripts', 'dbi_health_check.sql'),
    zabbix: new Map(), // legacy_name → string[] of zabbix keys
  };

  // PG queries
  for (const base of PG_QUERY_FILES) {
    const filePath = path.join(checkerPath, 'src', 'providers', 'postgresql', 'queries', base);
    indexes.pgFiles[base] = filePath;
    const fileIndex = buildNameIndex(filePath, NAME_PROP_PATTERN, fileCache);
    if (!fileIndex) continue;
    for (const [name, line] of fileIndex) {
      if (!indexes.pg.has(name)) {
        indexes.pg.set(name, { file: base, line });
      }
    }
  }

  // Monolithic providers (mysql index.js, oracle, sqlserver, mongodb).
  // mariadb shares the mysql provider.
  for (const tech of ['mysql', 'oracle', 'sqlserver', 'mongodb']) {
    const filePath = path.join(checkerPath, 'src', 'providers', tech, 'index.js');
    indexes.monolithPaths[tech] = filePath;
    const idx = buildNameIndex(filePath, NAME_PROP_PATTERN, fileCache);
    indexes.monolith[tech] = idx;
  }

  // Worker script (PG)
  indexes.worker = buildNameIndex(indexes.workerPath, SQL_ALIAS_PATTERN, fileCache);

  // Zabbix mapping — require() the JS module to invert it
  try {
    const zabbixModulePath = path.join(checkerPath, 'src', 'collectors', 'zabbix-mapping.js');
    delete require.cache[require.resolve(zabbixModulePath)];
    const { ZABBIX_KEY_MAP } = require(zabbixModulePath);
    for (const [key, target] of Object.entries(ZABBIX_KEY_MAP || {})) {
      if (target == null || String(target).startsWith('__json_')) continue;
      const arr = indexes.zabbix.get(target) || [];
      arr.push(key);
      indexes.zabbix.set(target, arr);
    }
  } catch (err) {
    // not fatal — zabbix metrics will warn
  }

  return indexes;
}

// ───────────────────────────────────────────────────────────────────────────
// Link resolution

function urlPaths(opts, checkerRef, scoringRef) {
  return {
    checkerBlob: `https://github.com/${opts.owner}/${opts.checkerRepo}/blob/${checkerRef}`,
    checkerTree: `https://github.com/${opts.owner}/${opts.checkerRepo}/tree/${checkerRef}`,
    scoringTree: `https://github.com/${opts.owner}/${opts.scoringRepo}/tree/${scoringRef}`,
  };
}

function resolveLink(metric, tech, indexes, urls, warnings) {
  const sources = metric.sources || [];
  const others = sources.filter(s => s !== 'sql' && s !== 'worker' && s !== 'zabbix' && s !== 'manual');

  const tryOrder = ['sql', 'worker', 'zabbix', 'manual'];
  for (const src of tryOrder) {
    if (!sources.includes(src)) continue;
    const r = resolveSingleSource(metric, tech, src, indexes, urls, warnings);
    if (r) {
      r.tooltip = `Sources: ${formatSources(sources)}${others.length ? ` (other: ${others.join(', ')})` : ''}`;
      return r;
    }
  }
  return { text: 'Unspecified', tooltip: `Sources: ${formatSources(sources)}` };
}

function resolveSingleSource(metric, tech, src, indexes, urls, warnings) {
  const ln = metric.legacy_name;
  switch (src) {
    case 'sql':
      return resolveSqlLink(metric, tech, indexes, urls, warnings);
    case 'worker':
      return resolveWorkerLink(metric, tech, indexes, urls, warnings);
    case 'zabbix':
      return resolveZabbixLink(metric, tech, indexes, warnings);
    case 'manual':
      return { text: 'Manual entry' };
    default:
      return { text: src };
  }
}

function resolveSqlLink(metric, tech, indexes, urls, warnings) {
  const ln = metric.legacy_name;
  if (tech === 'postgresql') {
    // First try the modular queries/*.js files.
    const fromGlobal = indexes.pg.get(ln);
    if (fromGlobal) {
      const rel = `src/providers/postgresql/queries/${fromGlobal.file}`;
      return {
        text: `${rel}:${fromGlobal.line}`,
        hyperlink: `${urls.checkerBlob}/${rel}#L${fromGlobal.line}`,
      };
    }
    // Many PG sql-sourced metrics are collected by the worker bundle (also a SQL query).
    if (indexes.worker && indexes.worker.has(ln)) {
      const line = indexes.worker.get(ln);
      return {
        text: `agent-scripts/dbi_health_check.sql:${line}`,
        hyperlink: `${urls.checkerBlob}/agent-scripts/dbi_health_check.sql#L${line}`,
      };
    }
    warnings.push({ kind: 'unresolved_collection', detail: `${metric.metric_id} (${ln}) — no PG provider file or worker bundle matched` });
    const hint = pgPreferredFile(metric.subcategory);
    return {
      text: 'src/providers/postgresql/queries/',
      hyperlink: `${urls.checkerBlob}/src/providers/postgresql/queries/${hint}`,
    };
  }

  // Monolithic providers
  const providerTech = (tech === 'mariadb') ? 'mysql' : tech;
  const idx = indexes.monolith[providerTech];
  const rel = `src/providers/${providerTech}/index.js`;
  if (idx && idx.has(ln)) {
    const line = idx.get(ln);
    return {
      text: `${rel}:${line}`,
      hyperlink: `${urls.checkerBlob}/${rel}#L${line}`,
    };
  }
  if (tech === 'mariadb') {
    warnings.push({ kind: 'mariadb_only_metric_missing_in_mysql', detail: `${metric.metric_id} (${ln}) — not found in mysql provider` });
  } else {
    warnings.push({ kind: 'unresolved_collection', detail: `${metric.metric_id} (${ln}) — not found in ${rel}` });
  }
  return {
    text: rel,
    hyperlink: `${urls.checkerBlob}/${rel}`,
  };
}

function resolveWorkerLink(metric, tech, indexes, urls, warnings) {
  if (tech !== 'postgresql') {
    warnings.push({ kind: 'worker_no_script', detail: `${metric.metric_id} (${metric.legacy_name}) — no worker script for ${tech}` });
    return { text: 'Worker (planned — no script yet)' };
  }
  const ln = metric.legacy_name;
  if (indexes.worker && indexes.worker.has(ln)) {
    const line = indexes.worker.get(ln);
    return {
      text: `agent-scripts/dbi_health_check.sql:${line}`,
      hyperlink: `${urls.checkerBlob}/agent-scripts/dbi_health_check.sql#L${line}`,
    };
  }
  // Fall back to file-level link
  return {
    text: 'agent-scripts/dbi_health_check.sql',
    hyperlink: `${urls.checkerBlob}/agent-scripts/dbi_health_check.sql`,
  };
}

function resolveZabbixLink(metric, tech, indexes, warnings) {
  const keys = indexes.zabbix.get(metric.legacy_name);
  if (keys && keys.length > 0) {
    return { text: `Zabbix: ${keys.join(', ')}` };
  }
  warnings.push({ kind: 'missing_zabbix_mapping', detail: `${metric.metric_id} (${metric.legacy_name}) on ${tech} — no zabbix mapping` });
  return { text: 'Zabbix (no mapping)' };
}

// ───────────────────────────────────────────────────────────────────────────
// Consistency-rule rendering

function renderClause(node) {
  if (!node || typeof node !== 'object') return String(node);
  if (Array.isArray(node.all_of)) {
    return node.all_of.map(renderClause).join(' AND ');
  }
  if (Array.isArray(node.any_of)) {
    return '(' + node.any_of.map(renderClause).join(' OR ') + ')';
  }
  if (Array.isArray(node.none_of)) {
    return 'NONE OF (' + node.none_of.map(renderClause).join(' OR ') + ')';
  }
  const m = node.metric || '?';
  if (node.equals !== undefined) return `${m} = ${JSON.stringify(node.equals)}`;
  if (Array.isArray(node.in)) return `${m} in [${node.in.map(v => JSON.stringify(v)).join(', ')}]`;
  if (Array.isArray(node.not_in)) return `${m} not in [${node.not_in.map(v => JSON.stringify(v)).join(', ')}]`;
  if (node.gt !== undefined) return `${m} > ${node.gt}`;
  if (node.gte !== undefined) return `${m} >= ${node.gte}`;
  if (node.lt !== undefined) return `${m} < ${node.lt}`;
  if (node.lte !== undefined) return `${m} <= ${node.lte}`;
  if (node.is_truthy !== undefined) return `${m} is truthy`;
  if (node.provided !== undefined) return `${m} is provided`;
  return JSON.stringify(node);
}

function renderAdjustment(sa) {
  if (!sa || sa.type === 'none' || !sa.type) return 'none';
  switch (sa.type) {
    case 'subcategory_cap': return `cap subcategory '${sa.target}' at ${sa.cap_pct}%`;
    case 'subcategory_deduction': return `deduct ${sa.points} pts from subcategory '${sa.target}'`;
    case 'pillar_deduction': return `deduct ${sa.points} pts from pillar '${sa.target}'`;
    default: return JSON.stringify(sa);
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Workbook builders

const HEADER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F3A5F' } };
const HEADER_FONT = { color: { argb: 'FFFFFFFF' }, bold: true };
const SECTION_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE6EDF5' } };
const CRIT_FILLS = {
  critical: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFCE3E1' } },
  important: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF4DA' } },
  advisory: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8F5E9' } },
};

function setColumnWidths(sheet, widths) {
  for (let i = 0; i < widths.length; i++) {
    sheet.getColumn(i + 1).width = widths[i];
  }
}

function buildGeneralSheet(wb, tech, catalog, raw, urls, subcatSheetNames, warnings) {
  const ws = wb.addWorksheet('General', { views: [{ state: 'frozen', ySplit: 1 }] });
  const techLabel = TECH_DISPLAY[tech] || tech;
  const techVersion = raw.technology_version || '';

  setColumnWidths(ws, [22, 30, 12, 14, 36, 50]);

  // Row 1 — title
  ws.mergeCells('A1:F1');
  const title = ws.getCell('A1');
  title.value = `dbi Database Health Score — ${techLabel}${techVersion ? ' ' + techVersion : ''}`;
  title.font = { size: 14, bold: true, color: { argb: 'FFFFFFFF' } };
  title.fill = HEADER_FILL;
  title.alignment = { vertical: 'middle', horizontal: 'left' };
  ws.getRow(1).height = 26;

  let row = 3;
  // Metadata block
  ws.mergeCells(`A${row}:F${row}`);
  const meta = ws.getCell(`A${row}`);
  meta.value = 'Metadata';
  meta.font = { bold: true };
  meta.fill = SECTION_FILL;
  row++;

  const criticalityCounts = { critical: 0, important: 0, advisory: 0 };
  const sourceCounts = { sql: 0, manual: 0, zabbix: 0, worker: 0 };
  for (const m of catalog.metrics) {
    criticalityCounts[m.criticality] = (criticalityCounts[m.criticality] || 0) + 1;
    for (const s of m.sources || []) {
      if (sourceCounts[s] !== undefined) sourceCounts[s]++;
    }
  }

  const releaseNotes = (raw.release_notes || '').toString().split('\n')[0].slice(0, 200);

  const metaRows = [
    ['Technology', techLabel],
    ['Technology version', techVersion || '—'],
    ['Catalog version', catalog.version || '—'],
    ['Release notes', releaseNotes || '—'],
    ['Total metrics', catalog.metrics.length],
    ['By criticality',
      `Critical: ${criticalityCounts.critical} · Important: ${criticalityCounts.important} · Advisory: ${criticalityCounts.advisory}`],
    ['By source',
      `SQL: ${sourceCounts.sql} · Zabbix: ${sourceCounts.zabbix} · Worker: ${sourceCounts.worker} · Manual: ${sourceCounts.manual}`],
    ['Effective weights', `critical=${CRITICALITY_WEIGHTS.critical}, important=${CRITICALITY_WEIGHTS.important}, advisory=${CRITICALITY_WEIGHTS.advisory}`],
  ];
  for (const [k, v] of metaRows) {
    ws.getCell(`A${row}`).value = k;
    ws.getCell(`A${row}`).font = { bold: true };
    ws.mergeCells(`B${row}:F${row}`);
    ws.getCell(`B${row}`).value = v;
    ws.getCell(`B${row}`).alignment = { wrapText: true, vertical: 'top' };
    row++;
  }
  // Links to repo trees
  ws.getCell(`A${row}`).value = urls.noLinks ? 'Package version' : 'scoring-core SHA';
  ws.getCell(`A${row}`).font = { bold: true };
  ws.mergeCells(`B${row}:F${row}`);
  ws.getCell(`B${row}`).value = urls.noLinks
    ? { text: PACKAGE_VERSION, hyperlink: PUBLIC_REPO, tooltip: 'Open Meridian-Score on GitHub' }
    : { text: urls.scoringSha, hyperlink: urls.scoringTree, tooltip: 'Open scoring-core tree on GitHub' };
  ws.getCell(`B${row}`).font = { color: { argb: 'FF1559E0' }, underline: true };
  row++;
  if (!urls.noLinks) {
    ws.getCell(`A${row}`).value = 'checker SHA';
    ws.getCell(`A${row}`).font = { bold: true };
    ws.mergeCells(`B${row}:F${row}`);
    ws.getCell(`B${row}`).value = { text: urls.checkerSha, hyperlink: urls.checkerTree, tooltip: 'Open db-health-checker tree on GitHub' };
    ws.getCell(`B${row}`).font = { color: { argb: 'FF1559E0' }, underline: true };
    row++;
  }
  row++;

  // Pillars table
  ws.mergeCells(`A${row}:F${row}`);
  ws.getCell(`A${row}`).value = 'Pillars';
  ws.getCell(`A${row}`).font = { bold: true };
  ws.getCell(`A${row}`).fill = SECTION_FILL;
  row++;

  const pillarsHeader = ['Pillar ID', 'Name', 'Max points', '# subcategories', '# metrics', 'Pillar gate?'];
  for (let i = 0; i < pillarsHeader.length; i++) {
    const c = ws.getCell(row, i + 1);
    c.value = pillarsHeader[i];
    c.font = HEADER_FONT;
    c.fill = HEADER_FILL;
    c.alignment = { vertical: 'middle' };
  }
  row++;
  for (const pillarId of catalog.getPillarIds()) {
    const pillar = catalog.getPillar(pillarId);
    const subcats = catalog.getSubcategoryIds(pillarId);
    const pillarMetrics = catalog.metrics.filter(m => subcats.includes(m.subcategory));
    const hasPillarGate = pillarMetrics.some(m => m.gate_scope === 'pillar');
    ws.getCell(row, 1).value = pillarId;
    ws.getCell(row, 2).value = pillar.name;
    ws.getCell(row, 3).value = pillar.maxPoints;
    ws.getCell(row, 4).value = subcats.length;
    ws.getCell(row, 5).value = pillarMetrics.length;
    ws.getCell(row, 6).value = hasPillarGate ? 'yes' : '—';
    row++;
  }
  row++;

  // Subcategories table (with hyperlinks to sheets)
  ws.mergeCells(`A${row}:F${row}`);
  ws.getCell(`A${row}`).value = 'Subcategories (click to jump)';
  ws.getCell(`A${row}`).font = { bold: true };
  ws.getCell(`A${row}`).fill = SECTION_FILL;
  row++;
  const subcatHeader = ['Pillar', 'Subcategory ID', 'Display name', 'Max points', '# metrics', 'Sheet'];
  for (let i = 0; i < subcatHeader.length; i++) {
    const c = ws.getCell(row, i + 1);
    c.value = subcatHeader[i];
    c.font = HEADER_FONT;
    c.fill = HEADER_FILL;
  }
  row++;
  for (const pillarId of catalog.getPillarIds()) {
    const pillar = catalog.getPillar(pillarId);
    for (const subcatId of catalog.getSubcategoryIds(pillarId)) {
      const subcat = catalog.getSubcategory(subcatId);
      const sheetName = subcatSheetNames.get(subcatId);
      const metricsHere = catalog.metrics.filter(m => m.subcategory === subcatId);
      ws.getCell(row, 1).value = pillar.name;
      ws.getCell(row, 2).value = subcatId;
      ws.getCell(row, 3).value = subcat.name;
      ws.getCell(row, 4).value = subcat.maxPoints;
      ws.getCell(row, 5).value = metricsHere.length;
      const linkCell = ws.getCell(row, 6);
      if (sheetName) {
        linkCell.value = {
          text: sheetName,
          hyperlink: `#'${sheetName.replace(/'/g, "''")}'!A1`,
          tooltip: `Jump to ${sheetName}`,
        };
        linkCell.font = { color: { argb: 'FF1559E0' }, underline: true };
      } else {
        linkCell.value = '—';
      }
      row++;
    }
  }
  row += 2;

  // Scoring rules block
  ws.mergeCells(`A${row}:F${row}`);
  ws.getCell(`A${row}`).value = 'Scoring rules';
  ws.getCell(`A${row}`).font = { bold: true };
  ws.getCell(`A${row}`).fill = SECTION_FILL;
  row++;
  const rules = [
    ['Total score', 'Sum of 5 pillars × 20 pts = 100 pts maximum.'],
    ['Effective weights',
      `Metrics with no \`weight\` override use criticality: critical=${CRITICALITY_WEIGHTS.critical}, important=${CRITICALITY_WEIGHTS.important}, advisory=${CRITICALITY_WEIGHTS.advisory}. Subcategory scores are normalized: (weighted sum / total weight) × maxPoints.`],
    ['Subcategory gate',
      'If any metric with criticality="critical" inside a subcategory fails, that subcategory is capped at 60% of its maxPoints. A gate finding is emitted even if the raw score is already ≤60% so the cause is documented.'],
    ['Pillar gate',
      'If any metric with criticality="critical" AND gate_scope="pillar" fails, the entire pillar score is set to 0 (not capped). Used for foundational requirements (e.g. WAL archiving for backup).'],
    ['Threshold partial credit',
      'For threshold/range metrics: full credit when value is within bounds; 50% credit when within 2× the bound (e.g. min=100 → 50% at value ≥ 50); 0 beyond 2×.'],
    ['Boolean / enum',
      'Pass (matches pass_value / pass_values) = full credit. Fail = 0. Weighted by the metric\'s effective weight.'],
    ['Missing data',
      'Since 1.17.0 every check with no value counts 0 points and is reported as not assessed; a missing critical also triggers the gate, except a check outside the run\'s collection scope. A non-critical declared target left blank costs nothing. A check guarded on its own value (applies_when on itself) does not apply when absent, and a critical the declared targets do not require never gates.'],
  ];
  for (const [k, v] of rules) {
    ws.getCell(`A${row}`).value = k;
    ws.getCell(`A${row}`).font = { bold: true };
    ws.getCell(`A${row}`).alignment = { vertical: 'top' };
    ws.mergeCells(`B${row}:F${row}`);
    ws.getCell(`B${row}`).value = v;
    ws.getCell(`B${row}`).alignment = { wrapText: true, vertical: 'top' };
    ws.getRow(row).height = 36;
    row++;
  }
  row++;

  // Sources legend
  ws.mergeCells(`A${row}:F${row}`);
  ws.getCell(`A${row}`).value = 'Sources legend';
  ws.getCell(`A${row}`).font = { bold: true };
  ws.getCell(`A${row}`).fill = SECTION_FILL;
  row++;
  const sourcesLegend = [
    ['SQL', urls.noLinks
      ? 'Collected via direct database query. The Anchor SQL column carries the query that measures the value.'
      : 'Collected via direct database query in db-health-checker. The collection-link column points to the line of code that issues the query.'],
    ['Zabbix', 'Collected from a Zabbix monitoring item. The cell shows the Zabbix item key (no clickable link). PostgreSQL today; other techs would need a per-tech zabbix-mapping.'],
    ['Worker', 'Computed by an agent worker (in-agent SQL bundle or background calculation). PostgreSQL has a worker SQL script bundled for Zabbix custom queries; other techs are planned.'],
    ['Manual', 'User-entered value (e.g. backup tool in use, DR plan documented). No collector exists — the operator provides the answer.'],
  ];
  for (const [k, v] of sourcesLegend) {
    ws.getCell(`A${row}`).value = k;
    ws.getCell(`A${row}`).font = { bold: true };
    ws.mergeCells(`B${row}:F${row}`);
    ws.getCell(`B${row}`).value = v;
    ws.getCell(`B${row}`).alignment = { wrapText: true, vertical: 'top' };
    ws.getRow(row).height = 30;
    row++;
  }
  row++;

  // Deployment profiles legend
  ws.mergeCells(`A${row}:F${row}`);
  ws.getCell(`A${row}`).value = 'Deployment profiles';
  ws.getCell(`A${row}`).font = { bold: true };
  ws.getCell(`A${row}`).fill = SECTION_FILL;
  row++;
  const profilesLegend = [
    ['default', 'Applies when no specific deployment profile is declared by the operator.'],
    ['oltp', 'Transactional workload — short, frequent queries. Affects threshold selection.'],
    ['olap', 'Analytical workload — long-running, scan-heavy queries. Affects threshold selection.'],
    ['mixed', 'Mixed OLTP/OLAP workload.'],
  ];
  for (const [k, v] of profilesLegend) {
    ws.getCell(`A${row}`).value = k;
    ws.getCell(`A${row}`).font = { bold: true };
    ws.mergeCells(`B${row}:F${row}`);
    ws.getCell(`B${row}`).value = v;
    ws.getCell(`B${row}`).alignment = { wrapText: true };
    row++;
  }
  return ws;
}

function buildSubcategorySheet(wb, sheetName, subcatId, catalog, indexes, urls, warnings, tech) {
  const ws = wb.addWorksheet(sheetName);
  const subcat = catalog.getSubcategory(subcatId);
  const pillar = catalog.getPillar(subcat.pillar);

  setColumnWidths(ws, [10, 32, 11, 9, 11, 30, 16, 50, 18, 12, 16, 9, 12, 60, 60, 70, 50]);

  // Row 1 — title
  ws.mergeCells('A1:O1');
  const titleCell = ws.getCell('A1');
  titleCell.value = `${pillar.name} · ${subcat.name} — max ${subcat.maxPoints} pts`;
  titleCell.font = { size: 13, bold: true, color: { argb: 'FFFFFFFF' } };
  titleCell.fill = HEADER_FILL;
  titleCell.alignment = { vertical: 'middle' };
  ws.getRow(1).height = 24;

  // Row 2 — counts
  const metrics = catalog.metrics.filter(m => m.subcategory === subcatId).sort((a, b) => a.metric_id.localeCompare(b.metric_id));
  const cc = { critical: 0, important: 0, advisory: 0 };
  for (const m of metrics) cc[m.criticality] = (cc[m.criticality] || 0) + 1;
  const hasCritGate = metrics.some(m => m.criticality === 'critical');
  const hasPillarGate = metrics.some(m => m.gate_scope === 'pillar');
  ws.mergeCells('A2:O2');
  const sumCell = ws.getCell('A2');
  sumCell.value = `${metrics.length} metrics: ${cc.critical} critical, ${cc.important} important, ${cc.advisory} advisory` +
    (hasCritGate ? '  ·  Subcategory gate: critical-fail caps at 60%' : '') +
    (hasPillarGate ? '  ·  Pillar gate metric present' : '');
  sumCell.alignment = { vertical: 'middle' };
  sumCell.font = { italic: true };
  sumCell.fill = SECTION_FILL;

  // Row 4 — column headers
  const headers = [
    'Metric ID', 'Display name', 'Criticality', 'Effective weight', 'Evaluation type',
    'Pass criteria', 'Sources', urls.noLinks ? 'Measurement' : 'Collection link', 'Deployment profiles', 'Min version',
    'Extension required', 'Gate scope', 'CIS reference', 'Remediation', 'Description',
    'Anchor SQL', 'Rationale',
  ];
  for (let i = 0; i < headers.length; i++) {
    const c = ws.getCell(4, i + 1);
    c.value = headers[i];
    c.font = HEADER_FONT;
    c.fill = HEADER_FILL;
    c.alignment = { vertical: 'middle', wrapText: true };
  }
  ws.getRow(4).height = 28;

  // Data rows
  let r = 5;
  for (const m of metrics) {
    // Public set: no checker checkout is read, so there is no link to resolve.
    const link = urls.noLinks ? null : resolveLink(m, tech, indexes, urls, warnings);
    ws.getCell(r, 1).value = m.metric_id;
    ws.getCell(r, 2).value = m.display_name;
    ws.getCell(r, 3).value = criticalityBadge(m.criticality);
    ws.getCell(r, 4).value = effectiveWeight(m);
    ws.getCell(r, 5).value = m.evaluation_type;
    ws.getCell(r, 6).value = formatPassCriteria(m);
    ws.getCell(r, 7).value = formatSources(m.sources);
    if (urls.noLinks) {
      // Public set: the checker repository is private, so a code location would
      // mean nothing to an outside reader; say where the measurement is defined.
      ws.getCell(r, 8).value = measurementPointer(m, warnings);
    } else if (link.hyperlink) {
      ws.getCell(r, 8).value = { text: link.text, hyperlink: link.hyperlink, tooltip: link.tooltip || '' };
      ws.getCell(r, 8).font = { color: { argb: 'FF1559E0' }, underline: true };
    } else {
      ws.getCell(r, 8).value = link.text;
      if (link.tooltip) ws.getCell(r, 8).note = link.tooltip;
    }
    ws.getCell(r, 9).value = formatDeploymentProfiles(m);
    ws.getCell(r, 10).value = formatMinVersion(m, tech);
    ws.getCell(r, 11).value = m.extension_requirement || '';
    ws.getCell(r, 12).value = m.gate_scope || '';
    ws.getCell(r, 13).value = m.cis_reference || '';
    ws.getCell(r, 14).value = m.remediation || '';
    ws.getCell(r, 15).value = m.description || '';
    // v1.15.0: the SQL behind the metric (technical_anchor) and the provenance of
    // its threshold (rationale) travel with the workbook, so a reviewer no longer
    // depends on the collection link into the (private) checker repository.
    const anchor = m.technical_anchor || null;
    ws.getCell(r, 16).value = anchor ? `${anchor.summary}\n\n${anchor.query}` : '';
    ws.getCell(r, 17).value = m.rationale || '';
    // Wrap long text cells
    [2, 6, 8, 14, 15, 16, 17].forEach(col => {
      ws.getCell(r, col).alignment = { wrapText: true, vertical: 'top' };
    });
    // Tint criticality column
    const fill = CRIT_FILLS[m.criticality];
    if (fill) ws.getCell(r, 3).fill = fill;
    r++;
  }

  ws.views = [{ state: 'frozen', xSplit: 1, ySplit: 4 }];
  if (metrics.length > 0) {
    ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: r - 1, column: headers.length } };
  }
}

function buildConsistencyRulesSheet(wb, rules) {
  const ws = wb.addWorksheet('Consistency Rules');
  setColumnWidths(ws, [12, 36, 12, 22, 60, 12, 36, 36, 60, 60]);

  ws.mergeCells('A1:J1');
  const title = ws.getCell('A1');
  title.value = 'Catalog-level consistency rules (cross-metric checks)';
  title.font = { size: 13, bold: true, color: { argb: 'FFFFFFFF' } };
  title.fill = HEADER_FILL;
  ws.getRow(1).height = 24;

  ws.mergeCells('A2:J2');
  ws.getCell('A2').value = 'These rules evaluate combinations of metric values and emit findings (and optionally adjust scores) when conditions are met. They are evaluated separately from per-metric scoring.';
  ws.getCell('A2').alignment = { wrapText: true };
  ws.getCell('A2').fill = SECTION_FILL;
  ws.getRow(2).height = 32;

  const headers = ['Rule ID', 'Title', 'Pillar hint', 'Tags', 'Applies when', 'Severity', 'Score adjustment', 'Violation title', 'Violation description', 'Remediation'];
  for (let i = 0; i < headers.length; i++) {
    const c = ws.getCell(4, i + 1);
    c.value = headers[i];
    c.font = HEADER_FONT;
    c.fill = HEADER_FILL;
    c.alignment = { vertical: 'middle', wrapText: true };
  }
  ws.getRow(4).height = 28;

  let r = 5;
  for (const rule of rules) {
    ws.getCell(r, 1).value = rule.rule_id;
    ws.getCell(r, 2).value = rule.title || '';
    ws.getCell(r, 3).value = rule.pillar_hint || '';
    ws.getCell(r, 4).value = (rule.tags || []).join(', ');
    ws.getCell(r, 5).value = renderClause(rule.applies_when);
    ws.getCell(r, 6).value = rule.on_violation?.severity || '';
    ws.getCell(r, 7).value = renderAdjustment(rule.on_violation?.score_adjustment);
    ws.getCell(r, 8).value = rule.on_violation?.title || '';
    ws.getCell(r, 9).value = rule.on_violation?.description || '';
    ws.getCell(r, 10).value = rule.on_violation?.remediation || '';
    [2, 5, 8, 9, 10].forEach(col => {
      ws.getCell(r, col).alignment = { wrapText: true, vertical: 'top' };
    });
    r++;
  }

  ws.views = [{ state: 'frozen', ySplit: 4 }];
  if (rules.length > 0) {
    ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: r - 1, column: headers.length } };
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Main pipeline

async function buildOne(tech, indexes, urls, opts) {
  const catalog = getCatalog(tech);
  const raw = loadRawCatalog(tech);
  const warnings = [];
  const wb = new ExcelJS.Workbook();
  // Deterministic timestamps so git diff stays empty on identical regens.
  const epoch = new Date(0);
  wb.created = epoch;
  wb.modified = epoch;
  wb.creator = 'generate-scoring-spec.js';

  // Pre-compute subcategory sheet names
  const used = new Set(['General', 'Consistency Rules']);
  const sheetNames = new Map();
  for (const pillarId of catalog.getPillarIds()) {
    const pillar = catalog.getPillar(pillarId);
    const tag = pillarTag(pillarId);
    for (const subcatId of catalog.getSubcategoryIds(pillarId)) {
      const subcat = catalog.getSubcategory(subcatId);
      const proposed = `${tag} - ${subcat.name}`;
      const final = uniqueSheetName(proposed, used, warnings);
      sheetNames.set(subcatId, final);
    }
  }

  // Build sheets
  buildGeneralSheet(wb, tech, catalog, raw, urls, sheetNames, warnings);
  for (const pillarId of catalog.getPillarIds()) {
    for (const subcatId of catalog.getSubcategoryIds(pillarId)) {
      const sheetName = sheetNames.get(subcatId);
      buildSubcategorySheet(wb, sheetName, subcatId, catalog, indexes, urls, warnings, tech);
    }
  }
  const consRules = catalog.getConsistencyRules ? catalog.getConsistencyRules() : (catalog.consistencyRules || []);
  if (consRules && consRules.length > 0) {
    buildConsistencyRulesSheet(wb, consRules);
  }

  // Tech version for the summary
  const techVersion = raw.technology_version || '';

  // Stats
  const linkStats = computeLinkStats(catalog, tech, indexes);
  const unresolved = warnings.filter(w =>
    w.kind === 'unresolved_collection' ||
    w.kind === 'mariadb_only_metric_missing_in_mysql' ||
    w.kind === 'worker_no_script' ||
    w.kind === 'missing_zabbix_mapping'
  ).length;

  if (!opts.check) {
    fs.mkdirSync(opts.out, { recursive: true });
    const outPath = path.join(opts.out, `${tech}.xlsx`);
    await wb.xlsx.writeFile(outPath);
  }

  return { tech, catalog, raw, techVersion, warnings, linkStats, unresolved };
}

function computeLinkStats(catalog, tech, indexes) {
  const stats = { total: catalog.metrics.length, sqlLinked: 0, zabbixMapped: 0, workerLinked: 0, manual: 0 };
  stats.anchored = catalog.metrics.filter(m => m.technical_anchor).length;
  if (!indexes) return stats; // public set: no checker index to link against
  for (const m of catalog.metrics) {
    const sources = m.sources || [];
    const ln = m.legacy_name;
    if (sources.includes('sql')) {
      if (tech === 'postgresql') {
        if (indexes.pg.has(ln) || (indexes.worker && indexes.worker.has(ln))) stats.sqlLinked++;
      } else {
        const providerTech = (tech === 'mariadb') ? 'mysql' : tech;
        const idx = indexes.monolith[providerTech];
        if (idx && idx.has(ln)) stats.sqlLinked++;
      }
    }
    if (sources.includes('zabbix')) {
      if (indexes.zabbix.has(ln)) stats.zabbixMapped++;
    }
    if (sources.includes('worker')) {
      if (tech === 'postgresql' && indexes.worker && indexes.worker.has(ln)) stats.workerLinked++;
    }
    if (sources.includes('manual')) stats.manual++;
  }
  return stats;
}

// README for the public set (--no-links): no checker references at all.
function buildPublicReadme(results, urls) {
  const lines = [];
  lines.push('# Scoring spec workbooks');
  lines.push('');
  lines.push('One Excel workbook per database technology. Each workbook documents the full 100-point health-score model: pillars, subcategories, points, criticality gates and every metric, with the SQL that measures the value (Anchor SQL column) and the provenance of its threshold (Rationale column).');
  lines.push('');
  lines.push('**Audience:** database specialists reviewing the scoring without reading JavaScript. Open in Excel, use the General tab\'s subcategory list, and drill into any metric. The Measurement column says where each measurement is defined: the Anchor SQL column, the scoring policy for engine-derived metrics, or a manual entry, and names any other collection source (Zabbix, Worker).');
  lines.push('');
  lines.push('## Files');
  lines.push('');
  lines.push('| File | Technology | Catalog version | Tech version | Total metrics | With Anchor SQL |');
  lines.push('|------|------------|-----------------|--------------|---------------|-----------------|');
  for (const r of results) {
    lines.push(`| \`${r.tech}.xlsx\` | ${TECH_DISPLAY[r.tech] || r.tech} | ${r.catalog.version} | ${r.techVersion || '—'} | ${r.linkStats.total} | ${r.linkStats.anchored} |`);
  }
  lines.push('');
  lines.push(`Generated from package ${PACKAGE_VERSION} (source commit \`${urls.scoringSha.slice(0, 7)}\`).`);
  lines.push('');
  lines.push('## Regeneration');
  lines.push('');
  lines.push('```bash');
  lines.push('npm install                                 # installs exceljs');
  lines.push('npm run generate-scoring-spec              # writes 6 xlsx + this README, from this repository alone');
  lines.push('```');
  lines.push('');
  lines.push('`npm run generate-scoring-spec:internal` builds the internal set instead: it adds per-metric links into the private collector repository, needs a checkout of it next to this one, and writes to `docs/scoring-spec-internal/`, which git ignores.');
  lines.push('');
  lines.push('Generated by `scripts/generate-scoring-spec.js`. Do not edit the XLSX files by hand: re-run the generator.');
  return lines.join('\n') + '\n';
}

function buildReadme(opts, results, urls) {
  const lines = [];
  lines.push('# Scoring spec workbooks');
  lines.push('');
  lines.push('One Excel workbook per database technology. Each workbook documents the full 100-point health-score model — pillars, subcategories, points, criticality gates, every metric — with clickable per-metric links to the SQL/code that collects the value (or a text reference for Zabbix / worker / manual sources).');
  lines.push('');
  lines.push('**Audience:** dbi technical leadership. Open in Excel, jump around via the General tab\'s subcategory list, drill into any metric, follow the link to the collector code in the `db-health-checker` repo.');
  lines.push('');
  lines.push('## Files');
  lines.push('');
  lines.push('| File | Technology | Catalog version | Tech version | Total metrics | SQL-linked | Zabbix-mapped | Worker-linked | Manual | Gaps |');
  lines.push('|------|------------|-----------------|--------------|---------------|------------|---------------|---------------|--------|------|');
  for (const r of results) {
    const cat = r.catalog;
    const techVer = r.techVersion || '—';
    lines.push(`| \`${r.tech}.xlsx\` | ${TECH_DISPLAY[r.tech] || r.tech} | ${cat.version} | ${techVer} | ${r.linkStats.total} | ${r.linkStats.sqlLinked} | ${r.linkStats.zabbixMapped} | ${r.linkStats.workerLinked} | ${r.linkStats.manual} | ${r.unresolved} |`);
  }
  lines.push('');
  lines.push('"Gaps" = metrics declared in the catalog but missing a resolvable collector link in this version (no entry in provider code, no Zabbix mapping, or no worker script). Each gap is recorded as a warning by the generator. Open the corresponding XLSX to see exactly which metric IDs are affected; the link cell falls back to a file-level URL so readers still land in the right area.');
  lines.push('');
  lines.push('## Pinned SHAs');
  lines.push('');
  lines.push(`- **scoring-core**: \`${urls.scoringSha}\` — [tree](${urls.scoringTree})`);
  lines.push(`- **db-health-checker**: \`${urls.checkerSha}\` — [tree](${urls.checkerTree})`);
  lines.push('');
  lines.push('All collection-link permalinks in the workbooks point at these exact SHAs. Re-running the generator will refresh both pins to whatever HEAD is at the time.');
  lines.push('');
  lines.push('## Regeneration');
  lines.push('');
  lines.push('```bash');
  lines.push('npm install                       # installs exceljs');
  lines.push('npm run generate-scoring-spec     # writes 6 xlsx + this README');
  lines.push('```');
  lines.push('');
  lines.push('The generator assumes the sibling `db-health-checker` repo is checked out at `../db-health-checker`. Override with `--checker-path <path>`.');
  lines.push('');
  lines.push('Useful flags:');
  lines.push('');
  lines.push('- `--check` — dry run (warn-only, no writes). Run this before committing catalog changes to see if any metric has lost its collector link.');
  lines.push('- `--strict` — exit 1 if any warning fires (good for CI).');
  lines.push('- `--owner boutaga --checker-repo db-health-checker --scoring-repo db-health-scoring-core` — re-render permalinks against the public mirrors instead of the internal dbi org.');
  lines.push('- `--no-links` — omit the collection permalinks (public set: the checker repository is private, so they would 404; the Anchor SQL column carries the query instead).');
  lines.push('- `--tech postgresql,oracle` — regenerate only specific techs.');
  lines.push('');
  lines.push('## Notes');
  lines.push('');
  lines.push('- **Internal repo links** — these permalinks point at the private `dbiservices/` mirrors. Non-dbi viewers will get a 404. To produce a public-mirror set, re-run with `--owner boutaga`.');
  lines.push('- **Deterministic content** — workbook content (cells, formulas, hyperlinks) is generated deterministically from catalog + checker SHA. The XLSX file bytes themselves are not bit-stable because the underlying zip writer stamps each entry with a creation time; `git diff` may show file-size noise even with no semantic change. Inspect the workbook itself if you want to verify what actually moved.');
  lines.push('- **Zabbix metrics** — currently only PostgreSQL has a populated `ZABBIX_KEY_MAP`. Zabbix-sourced metrics on other techs render as `Zabbix (no mapping)` with a warning until per-tech mappings ship.');
  lines.push('- **Worker metrics** — only PostgreSQL has an agent worker script (`agent-scripts/dbi_health_check.sql`). Non-PG worker metrics render as `Worker (planned)`.');
  lines.push('- **MariaDB** — the agent shares the MySQL provider; MariaDB-only metrics that have no MySQL counterpart will warn (`mariadb_only_metric_missing_in_mysql`).');
  lines.push('');
  lines.push('Generated by `scripts/generate-scoring-spec.js`. Do not edit the XLSX files by hand — re-run the generator.');
  return lines.join('\n') + '\n';
}

function printSummary(results, opts) {
  console.log('');
  let totalWarnings = 0;
  const byKind = new Map();
  for (const r of results) {
    const ls = r.linkStats;
    const wByKind = new Map();
    for (const w of r.warnings) {
      wByKind.set(w.kind, (wByKind.get(w.kind) || 0) + 1);
      byKind.set(w.kind, (byKind.get(w.kind) || 0) + 1);
    }
    totalWarnings += r.warnings.length;
    const warnSummary = wByKind.size === 0 ? 'no warnings' :
      Array.from(wByKind, ([k, v]) => `${k}:${v}`).join(', ');
    const linkSummary = opts.noLinks
      ? `anchored:${ls.anchored}`
      : `sql:${ls.sqlLinked} zabbix:${ls.zabbixMapped} worker:${ls.workerLinked} manual:${ls.manual}`;
    console.log(`${r.tech.padEnd(11)} | ${String(ls.total).padStart(3)} metrics | ${linkSummary} | ${warnSummary}`);
  }
  console.log('');
  console.log(`Total warnings: ${totalWarnings}`);
  if (byKind.size > 0) {
    for (const [k, v] of byKind) console.log(`  ${k}: ${v}`);
  }
  if (opts.verbose) {
    for (const r of results) {
      for (const w of r.warnings) {
        console.log(`  [${r.tech}] ${w.kind}: ${w.detail}`);
      }
    }
  }
}

async function main() {
  const opts = parseArgs(process.argv);
  const scoringRoot = path.resolve(__dirname, '..');

  // The public set (--no-links) is built from this repository alone: the
  // checker is private, so an outside contributor must be able to regenerate
  // the workbooks without it.
  if (!opts.noLinks) {
    if (!fs.existsSync(opts.checkerPath)) {
      fail(1, `db-health-checker not found at ${opts.checkerPath}. Use --checker-path to override, or --no-links for the public set.`);
    }
    if (!opts.allowDirty && gitDirty(opts.checkerPath)) {
      fail(1, `db-health-checker worktree is dirty (${opts.checkerPath}). Commit or pass --allow-dirty.`);
    }
  }

  const checkerSha = opts.noLinks ? null : (opts.checkerRef || gitSha(opts.checkerPath));
  const scoringSha = opts.scoringRef || gitSha(scoringRoot);
  const u = urlPaths(opts, checkerSha, scoringSha);
  const urls = { ...u, checkerSha, scoringSha, noLinks: !!opts.noLinks };

  console.log(`Generating scoring spec workbooks`);
  console.log(`  scoring-core SHA: ${scoringSha}`);
  console.log(`  checker SHA:      ${checkerSha || '(not used: --no-links)'}`);
  console.log(`  owner:            ${opts.owner}`);
  console.log(`  output:           ${opts.out}${opts.check ? '  (--check: dry run)' : ''}`);
  console.log('');

  const fileCache = new Map();
  const indexes = opts.noLinks ? null : buildCheckerIndexes(opts.checkerPath, fileCache);

  const results = [];
  for (const tech of opts.tech) {
    if (!SUPPORTED_TECHNOLOGIES.includes(tech)) {
      console.error(`  skipping unknown tech: ${tech}`);
      continue;
    }
    const r = await buildOne(tech, indexes, urls, opts);
    results.push(r);
    if (!opts.check) {
      console.log(`${tech}: wrote ${path.relative(process.cwd(), path.join(opts.out, tech + '.xlsx'))} — ${r.linkStats.total} metrics`);
    } else {
      console.log(`${tech}: dry-run OK — ${r.linkStats.total} metrics`);
    }
  }

  if (!opts.check) {
    const readmePath = path.join(opts.out, 'README.md');
    fs.writeFileSync(readmePath, opts.noLinks ? buildPublicReadme(results, urls) : buildReadme(opts, results, urls));
    console.log(`wrote ${path.relative(process.cwd(), readmePath)}`);
  }

  printSummary(results, opts);

  const totalWarnings = results.reduce((sum, r) => sum + r.warnings.length, 0);
  if (opts.strict && totalWarnings > 0) {
    console.error(`\nFAILED: ${totalWarnings} warning(s) under --strict.`);
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch(err => {
    console.error('generate-scoring-spec: unexpected error');
    console.error(err.stack || err);
    process.exit(1);
  });
}

module.exports = { measurementPointer };
