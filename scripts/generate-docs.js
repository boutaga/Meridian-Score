'use strict';

/**
 * Auto-generate per-technology scoring reference documentation.
 *
 * Reads each data/metrics/{tech}.json and generates docs/technologies/{tech}.md
 *
 * Usage: node scripts/generate-docs.js
 */

const fs = require('fs');
const path = require('path');
const { getCatalog, SUPPORTED_TECHNOLOGIES, CRITICALITY_WEIGHTS, SCORING_POLICY } = require('../src');

const OUTPUT_DIR = path.resolve(__dirname, '../docs/technologies');
const SCORING_MODEL_DOC = path.resolve(__dirname, '../docs/scoring-model.md');
const POLICY_START = '<!-- policy:start -->';
const POLICY_END = '<!-- policy:end -->';

function formatPassCriteria(metric) {
  const config = metric.evaluation_config || {};
  switch (metric.evaluation_type) {
    case 'boolean':
      if (config.check === 'not_empty_or_dummy') return 'Non-empty, non-dummy value';
      return `= ${config.pass_value !== undefined ? config.pass_value : true}`;
    case 'enum':
      return (config.pass_values || []).map(v => `\`${v}\``).join(', ');
    case 'threshold': {
      const parts = [];
      if (config.min !== undefined) parts.push(`>= ${config.min}`);
      if (config.max !== undefined) parts.push(`<= ${config.max}`);
      const base = parts.join(' AND ') || 'N/A';
      // The base bound alone misleads when a declared target selects the band.
      if (config.by_declaration) return `per declared ${config.by_declaration.metric}; otherwise ${base}`;
      return base;
    }
    case 'range': {
      const parts = [];
      if (config.min !== undefined) parts.push(`>= ${config.min}`);
      if (config.max !== undefined) parts.push(`<= ${config.max}`);
      return parts.join(' AND ') || 'N/A';
    }
    default:
      return 'truthy';
  }
}

function formatSources(sources) {
  return sources.map(s => {
    switch (s) {
      case 'sql': return 'SQL';
      case 'manual': return 'Manual';
      case 'zabbix': return 'Monitoring';
      case 'worker': return 'Worker';
      default: return s;
    }
  }).join(', ');
}

// Plain rendering of an applies_when / optional_when predicate.
function renderPredicate(node) {
  if (!node || typeof node !== 'object') return '';
  const join = (list, sep) => list.map(renderPredicate).join(sep);
  if (Array.isArray(node.all_of)) return `(${join(node.all_of, ' AND ')})`;
  if (Array.isArray(node.any_of)) return `(${join(node.any_of, ' OR ')})`;
  if (Array.isArray(node.none_of)) return `NOT (${join(node.none_of, ' OR ')})`;
  const subject = node.metric ? `\`${node.metric}\`` : node.system_fact ? `fact \`${node.system_fact}\`` : 'workload profile';
  const ops = { equals: '=', gt: '>', gte: '>=', lt: '<', lte: '<=' };
  for (const [op, sym] of Object.entries(ops)) if (node[op] !== undefined) return `${subject} ${sym} ${JSON.stringify(node[op])}`;
  if (node.in) return `${subject} in ${node.in.map(v => `\`${v}\``).join(', ')}`;
  if (node.not_in) return `${subject} not in ${node.not_in.map(v => `\`${v}\``).join(', ')}`;
  if (node.is_truthy !== undefined) return `${subject} is ${node.is_truthy ? 'true' : 'not true'}`;
  if (node.provided !== undefined) return `${subject} is ${node.provided ? 'provided' : 'not provided'}`;
  if (node.workload_profile !== undefined) return `workload profile = ${JSON.stringify(node.workload_profile)}`;
  return JSON.stringify(node);
}
const unwrap = (text) => text.replace(/^\((.*)\)$/, '$1');

function criticalityBadge(c) {
  switch (c) {
    case 'critical': return '**CRITICAL**';
    case 'important': return 'Important';
    case 'advisory': return 'Advisory';
    default: return c;
  }
}

/**
 * Render the "Scoring policy" block of docs/scoring-model.md from
 * SCORING_POLICY, so the documented numbers can never drift from the engine.
 */
function renderPolicyBlock(policy) {
  const pct = x => `${Math.round(x * 100)} percent`;
  const w = policy.criticalityWeights;
  const b = policy.statusBands;
  const lines = [];
  lines.push(POLICY_START);
  lines.push(`_Generated from \`src/scoring/policy.js\` (policy ${policy.version}) by \`npm run generate-docs\`. Do not edit by hand._`);
  lines.push('');
  lines.push('| Rule | Value |');
  lines.push('|------|-------|');
  lines.push(`| Criticality weights | critical ${w.critical}x, important ${w.important}x, advisory ${w.advisory}x |`);
  lines.push(`| Subcategory gate | a failed critical metric caps its subcategory at ${pct(policy.subcategoryGateCapPct)} of its points |`);
  lines.push(`| Pillar critical cap | a hard-failed or missing critical metric caps its pillar at ${pct(policy.pillarCriticalCapPct)} of its points |`);
  lines.push(`| Partial credit | threshold and range metrics earn ${pct(policy.partialCredit.factor)} of their points when the value is within ${policy.partialCredit.withinMultiple}x of the bound (exact, never rounded; such a value is never reported as passed), nothing beyond |`);
  lines.push(`| Status bands | excellent at ${b.excellent} percent or more, good at ${b.good}, needs improvement at ${b.needs_improvement}, critical below that |`);
  lines.push(`| Default restore throughput | ${policy.defaults.restoreThroughputMbPerSecond} MB/s, used by restore_time_estimate_minutes when no restore test attested a rate |`);
  lines.push('');
  lines.push('**Derived formulas** (engine-computed before scoring; a missing input makes the metric not provided):');
  lines.push('');
  lines.push('| Formula | Expression | Inputs | Unit | Meaning |');
  lines.push('|---------|------------|--------|------|---------|');
  for (const [name, f] of Object.entries(policy.derivedFormulas)) {
    lines.push(`| \`${name}\` | \`${f.expression}\` | ${f.inputs.map(i => `\`${i}\``).join(', ')} | ${f.unit} | ${f.description} |`);
  }
  lines.push('');
  lines.push('**Vocabularies** enforced by `npm run validate-catalogs`:');
  lines.push('');
  const voc = policy.vocabularies;
  const list = arr => arr.map(x => `\`${x}\``).join(', ');
  lines.push(`- Sources: ${list(voc.sources)}`);
  lines.push(`- Numeric system-fact anchors: ${list(voc.anchors)}`);
  lines.push(`- String system facts: ${list(voc.stringFacts)}`);
  lines.push(`- Workload profiles: ${list(voc.profiles)}`);
  lines.push(`- License requirements: ${list(voc.licenseRequirements)}`);
  lines.push(`- Boolean checks: ${list(voc.booleanChecks)}`);
  lines.push(`- Predicate operators: metric leaves ${list(voc.predicateOperators.metric)}; numeric system facts ${list(voc.predicateOperators.systemFact)}; string facts and workload profile ${list(voc.predicateOperators.stringFact)}`);
  lines.push(`- Score adjustment types: ${list(voc.adjustmentTypes)}`);
  lines.push(`- Evaluation types: ${list(voc.evaluationTypes)}; criticalities: ${list(voc.criticalities)}; rule severities: ${list(voc.ruleSeverities)}`);
  lines.push(POLICY_END);
  return lines.join('\n');
}

function updateScoringModelDoc() {
  const doc = fs.readFileSync(SCORING_MODEL_DOC, 'utf8');
  const start = doc.indexOf(POLICY_START);
  const end = doc.indexOf(POLICY_END);
  if (start === -1 || end === -1 || end < start) {
    throw new Error(`docs/scoring-model.md is missing the ${POLICY_START} / ${POLICY_END} markers`);
  }
  const updated = doc.slice(0, start) + renderPolicyBlock(SCORING_POLICY) + doc.slice(end + POLICY_END.length);
  fs.writeFileSync(SCORING_MODEL_DOC, updated);
  console.log('Updated docs/scoring-model.md scoring policy block');
}

function generateTechDoc(technology) {
  const cat = getCatalog(technology);
  const lines = [];

  // Count metrics by criticality and source
  const critCounts = { critical: 0, important: 0, advisory: 0 };
  const sourceCounts = { sql: 0, manual: 0, monitoring: 0 };
  for (const m of cat.metrics) {
    critCounts[m.criticality] = (critCounts[m.criticality] || 0) + 1;
    for (const s of m.sources) {
      if (s === 'sql') sourceCounts.sql++;
      else if (s === 'manual') sourceCounts.manual++;
      else sourceCounts.monitoring++;
    }
  }

  const techName = technology.charAt(0).toUpperCase() + technology.slice(1);
  const techDisplay = {
    postgresql: 'PostgreSQL',
    mysql: 'MySQL',
    mariadb: 'MariaDB',
    mongodb: 'MongoDB',
    oracle: 'Oracle',
    sqlserver: 'SQL Server',
  }[technology] || techName;

  // Header
  lines.push(`# ${techDisplay} Scoring Reference`);
  lines.push('');
  lines.push(`> Auto-generated from catalog v${cat.version}. Do not edit manually — modify the JSON catalog and re-run \`npm run generate-docs\`.`);
  lines.push('');

  // Overview
  lines.push('## Overview');
  lines.push('');
  lines.push(`| Property | Value |`);
  lines.push(`|----------|-------|`);
  lines.push(`| Technology | ${techDisplay} |`);
  lines.push(`| Catalog Version | ${cat.version} |`);
  lines.push(`| Total Metrics | ${cat.metrics.length} |`);
  lines.push(`| Critical | ${critCounts.critical} (weight: ${CRITICALITY_WEIGHTS.critical}x) |`);
  lines.push(`| Important | ${critCounts.important} (weight: ${CRITICALITY_WEIGHTS.important}x) |`);
  lines.push(`| Advisory | ${critCounts.advisory} (weight: ${CRITICALITY_WEIGHTS.advisory}x) |`);
  lines.push(`| Max Score | 100 points (5 pillars x 20 points) |`);
  lines.push('');

  // Scoring Summary Table
  lines.push('## Scoring Summary');
  lines.push('');
  lines.push('| Pillar | Subcategory | Points | Metrics | Critical |');
  lines.push('|--------|-------------|--------|---------|----------|');

  for (const pillarId of cat.getPillarIds()) {
    const pillar = cat.getPillar(pillarId);
    const subcatIds = cat.getSubcategoryIds(pillarId);
    let firstRow = true;

    for (const subcatId of subcatIds) {
      const subcat = cat.getSubcategory(subcatId);
      const metrics = cat.metrics.filter(m => m.subcategory === subcatId);
      const critCount = metrics.filter(m => m.criticality === 'critical').length;
      const pillarCell = firstRow ? `**${pillar.name}** (${pillar.maxPoints}pts)` : '';
      lines.push(`| ${pillarCell} | ${subcat.name} | ${subcat.maxPoints} | ${metrics.length} | ${critCount} |`);
      firstRow = false;
    }
  }
  lines.push('');

  // Per-pillar detailed sections
  let pillarNum = 1;
  for (const pillarId of cat.getPillarIds()) {
    const pillar = cat.getPillar(pillarId);
    const subcatIds = cat.getSubcategoryIds(pillarId);

    lines.push(`## ${pillarNum}. ${pillar.name} (${pillar.maxPoints} points)`);
    lines.push('');

    let subcatNum = 1;
    for (const subcatId of subcatIds) {
      const subcat = cat.getSubcategory(subcatId);
      const metrics = cat.metrics.filter(m => m.subcategory === subcatId);

      lines.push(`### ${pillarNum}.${subcatNum} ${subcat.name} (${subcat.maxPoints} points)`);
      lines.push('');
      lines.push('| ID | Metric | Criticality | Type | Source(s) | Pass Criteria |');
      lines.push('|----|--------|-------------|------|-----------|---------------|');

      for (const m of metrics) {
        const criteria = formatPassCriteria(m);
        lines.push(`| ${m.metric_id} | ${m.display_name} | ${criticalityBadge(m.criticality)} | ${m.evaluation_type} | ${formatSources(m.sources)} | ${criteria} |`);
      }
      lines.push('');

      // Applicability (technical) and requirement (declared targets, 1.16.0)
      for (const m of metrics.filter(x => x.applies_when)) {
        lines.push(`> **Applies when**: ${m.metric_id} (${m.display_name}) — ${unwrap(renderPredicate(m.applies_when))}.`);
        lines.push('');
      }
      for (const m of metrics.filter(x => x.optional_when)) {
        lines.push(`> **Not required when**: ${m.metric_id} (${m.display_name}) — ${unwrap(renderPredicate(m.optional_when))}. It still counts, but leaves the target and never gates.`);
        lines.push('');
      }

      // Gate metrics in this subcategory
      const gateMetrics = metrics.filter(m => m.gate_scope);
      if (gateMetrics.length > 0) {
        for (const gm of gateMetrics) {
          lines.push(`> **Gate**: ${gm.metric_id} (${gm.display_name}) — if this ${gm.criticality} metric fails, the ${gm.gate_scope === 'pillar' ? 'entire pillar is zeroed' : 'subcategory is capped at 60%'}.`);
          lines.push('');
        }
      }

      // Scoring notes
      const critMetrics = metrics.filter(m => m.criticality === 'critical');
      const impMetrics = metrics.filter(m => m.criticality === 'important');
      const advMetrics = metrics.filter(m => m.criticality === 'advisory');
      const weightPool = (critMetrics.length * 3) + (impMetrics.length * 2) + (advMetrics.length * 1);
      lines.push(`**Scoring**: Weight pool = ${weightPool} (${critMetrics.length}x3 + ${impMetrics.length}x2 + ${advMetrics.length}x1), normalized to ${subcat.maxPoints} points.`);
      if (critMetrics.length > 0) {
        lines.push(`If ${critMetrics.map(m => m.metric_id).join(' or ')} fails, subcategory capped at ${(subcat.maxPoints * 0.6).toFixed(1)} points (60%).`);
      }
      lines.push('');
      subcatNum++;
    }
    pillarNum++;
  }

  // Appendix A: Metrics by Source
  lines.push('---');
  lines.push('');
  lines.push('## Appendix A: Metrics by Source');
  lines.push('');

  const sqlMetrics = cat.metrics.filter(m => m.sources.includes('sql'));
  const manualMetrics = cat.metrics.filter(m => m.sources.includes('manual'));
  const monitoringMetrics = cat.metrics.filter(m => m.sources.some(s => ['zabbix', 'worker'].includes(s)));

  lines.push(`### SQL / Healthcheck Scripts (${sqlMetrics.length} metrics)`);
  lines.push('');
  lines.push('These metrics are collected via direct database queries.');
  lines.push('');
  lines.push('| ID | Metric | Pillar | Criticality |');
  lines.push('|----|--------|--------|-------------|');
  for (const m of sqlMetrics) {
    const sub = cat.getSubcategory(m.subcategory);
    const pillarName = sub ? cat.getPillar(sub.pillar).name : 'Unknown';
    lines.push(`| ${m.metric_id} | ${m.display_name} | ${pillarName} | ${criticalityBadge(m.criticality)} |`);
  }
  lines.push('');

  lines.push(`### Monitoring (${monitoringMetrics.length} metrics)`);
  lines.push('');
  lines.push('These metrics are collected from monitoring systems (Zabbix, PMM, worker scripts).');
  lines.push('');
  if (monitoringMetrics.length > 0) {
    lines.push('| ID | Metric | Pillar | Criticality |');
    lines.push('|----|--------|--------|-------------|');
    for (const m of monitoringMetrics) {
      const sub = cat.getSubcategory(m.subcategory);
      const pillarName = sub ? cat.getPillar(sub.pillar).name : 'Unknown';
      lines.push(`| ${m.metric_id} | ${m.display_name} | ${pillarName} | ${criticalityBadge(m.criticality)} |`);
    }
  } else {
    lines.push('No monitoring-specific metrics for this technology.');
  }
  lines.push('');

  lines.push(`### Manual Inputs (${manualMetrics.length} metrics)`);
  lines.push('');
  lines.push('These metrics require manual input from the operator.');
  lines.push('');
  if (manualMetrics.length > 0) {
    lines.push('| ID | Metric | Pillar | Criticality | Remediation |');
    lines.push('|----|--------|--------|-------------|-------------|');
    for (const m of manualMetrics) {
      const sub = cat.getSubcategory(m.subcategory);
      const pillarName = sub ? cat.getPillar(sub.pillar).name : 'Unknown';
      const rem = (m.remediation || '').replace(/\|/g, '\\|').substring(0, 100);
      lines.push(`| ${m.metric_id} | ${m.display_name} | ${pillarName} | ${criticalityBadge(m.criticality)} | ${rem} |`);
    }
  } else {
    lines.push('No manual input metrics for this technology.');
  }
  lines.push('');

  // Appendix B: Gate Metrics
  const gateMetrics = cat.metrics.filter(m => m.gate_scope);
  lines.push('## Appendix B: Gate Metrics');
  lines.push('');
  if (gateMetrics.length > 0) {
    lines.push('| ID | Metric | Criticality | Gate Scope | Effect |');
    lines.push('|----|--------|-------------|------------|--------|');
    for (const m of gateMetrics) {
      const effect = m.gate_scope === 'pillar'
        ? 'Zeros entire pillar score'
        : 'Caps subcategory at 60%';
      lines.push(`| ${m.metric_id} | ${m.display_name} | ${criticalityBadge(m.criticality)} | ${m.gate_scope} | ${effect} |`);
    }
  } else {
    lines.push('No explicit gate metrics. Standard criticality gates still apply: any critical metric failure caps its subcategory at 60%.');
  }
  lines.push('');

  // Appendix C: Conditional Metrics
  const extMetrics = cat.metrics.filter(m => m.extension_requirement);
  const verMetrics = cat.metrics.filter(m => m.min_pg_version);
  const profileMetrics = cat.metrics.filter(m => m.deployment_profiles);

  if (extMetrics.length > 0 || verMetrics.length > 0 || profileMetrics.length > 0) {
    lines.push('## Appendix C: Conditional Metrics');
    lines.push('');

    if (extMetrics.length > 0) {
      lines.push('### Extension-Required');
      lines.push('');
      lines.push('| ID | Metric | Required Extension |');
      lines.push('|----|--------|--------------------|');
      for (const m of extMetrics) {
        lines.push(`| ${m.metric_id} | ${m.display_name} | ${m.extension_requirement} |`);
      }
      lines.push('');
    }

    if (verMetrics.length > 0) {
      lines.push('### Version-Gated');
      lines.push('');
      lines.push('| ID | Metric | Minimum Version |');
      lines.push('|----|--------|-----------------|');
      for (const m of verMetrics) {
        const ver = m.min_pg_version >= 10000
          ? `${Math.floor(m.min_pg_version / 10000)}.x`
          : m.min_pg_version;
        lines.push(`| ${m.metric_id} | ${m.display_name} | ${ver} |`);
      }
      lines.push('');
    }

    if (profileMetrics.length > 0) {
      lines.push('### Deployment-Profile-Specific');
      lines.push('');
      lines.push('| ID | Metric | Profiles |');
      lines.push('|----|--------|----------|');
      for (const m of profileMetrics) {
        lines.push(`| ${m.metric_id} | ${m.display_name} | ${m.deployment_profiles.join(', ')} |`);
      }
      lines.push('');
    }
  }

  return lines.join('\n');
}

// Main
if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

for (const tech of SUPPORTED_TECHNOLOGIES) {
  const doc = generateTechDoc(tech);
  const outPath = path.join(OUTPUT_DIR, `${tech}.md`);
  fs.writeFileSync(outPath, doc);
  const cat = getCatalog(tech);
  console.log(`${tech}: generated ${outPath} (${cat.metrics.length} metrics documented)`);
}

updateScoringModelDoc();

console.log(`\nDocs written to ${OUTPUT_DIR}`);
