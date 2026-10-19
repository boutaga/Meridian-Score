'use strict';

/**
 * graph-builder.js — turn a MetricCatalog into a dependency-flow graph
 * (cytoscape elements). Pure and technology-agnostic: it reads only the public
 * catalog API, so the live Score Map route and the self-contained HTML export
 * share one builder.
 *
 * Flow direction (left → right): source inputs/facts → metrics → rules →
 * subcategories → pillars. Edges overlay the cross-metric wiring that is
 * otherwise invisible outside the catalog JSON:
 *
 *   derives   : input/metric → derived metric        (metric.derived_from.inputs)
 *   triggers  : metric/fact/workload → rule          (rule.applies_when leaves)
 *   affects   : rule → metric|subcategory|pillar     (on_violation.score_adjustment[s])
 *   gates     : metric/fact/workload → metric        (metric.applies_when leaves)
 *   crit_gate : critical metric → subcategory|pillar (criticality + gate_scope)
 *   rolls_up  : metric → subcategory → pillar        (structural score backbone)
 *
 * Node ids are namespaced by kind so endpoints resolve unambiguously:
 *   p:<pillarId>  s:<subcatId>  m:<legacy_name>  r:<rule_id>
 *   f:<system_fact>  w:workload
 */

// Distinct palette assigned to pillars by declaration order. Works for any
// catalog (PG/Oracle/MySQL/…) regardless of pillar ids — the colour rides on
// node data so the cytoscape stylesheet stays technology-agnostic.
const PILLAR_PALETTE = ['#2563eb', '#dc2626', '#d97706', '#059669', '#7c3aed', '#0891b2', '#db2777', '#65a30d'];

const idP = (p) => `p:${p}`;
const idS = (s) => `s:${s}`;
const idM = (m) => `m:${m}`;
const idR = (r) => `r:${r}`;
const idF = (f) => `f:${f}`;
const idW = () => 'w:workload';

/** Render a single predicate leaf's condition as a short human label. */
function comparator(node) {
  if (node.is_truthy === true) return 'is truthy';
  if (node.is_truthy === false) return 'is not truthy';
  if (node.provided === true) return 'provided';
  if (node.provided === false) return 'not provided';
  if (node.equals !== undefined) return `= ${node.equals}`;
  if (Array.isArray(node.in)) return `in [${node.in.join(', ')}]`;
  if (Array.isArray(node.not_in)) return `not in [${node.not_in.join(', ')}]`;
  if (node.gt !== undefined) return `> ${node.gt}`;
  if (node.gte !== undefined) return `≥ ${node.gte}`;
  if (node.lt !== undefined) return `< ${node.lt}`;
  if (node.lte !== undefined) return `≤ ${node.lte}`;
  return '';
}

function describeLeaf(node) {
  if (node.system_fact !== undefined) return `${node.system_fact} ${comparator(node)}`.trim();
  if (node.workload_profile !== undefined) {
    const spec = node.workload_profile;
    if (typeof spec === 'string') return `profile = ${spec}`;
    if (spec && typeof spec === 'object') {
      if (spec.equals !== undefined) return `profile = ${spec.equals}`;
      if (Array.isArray(spec.in)) return `profile in [${spec.in.join(', ')}]`;
      if (Array.isArray(spec.not_in)) return `profile not in [${spec.not_in.join(', ')}]`;
    }
    return 'profile';
  }
  return `${node.metric} ${comparator(node)}`.trim();
}

/** Full-tree human rendering of a predicate, for tooltips. Mirrors the DSL in src/scoring/consistency.js. */
function humanizePredicate(node) {
  if (!node || typeof node !== 'object') return '';
  if (Array.isArray(node.all_of)) return node.all_of.map(humanizePredicate).join(' AND ');
  if (Array.isArray(node.any_of)) return node.any_of.map(humanizePredicate).join(' OR ');
  if (Array.isArray(node.none_of)) return 'NOT (' + node.none_of.map(humanizePredicate).join(' OR ') + ')';
  return describeLeaf(node);
}

/** Walk a predicate tree, visiting each leaf with {kind, ref, label}. */
function walkLeaves(node, visit) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node.all_of)) { node.all_of.forEach((c) => walkLeaves(c, visit)); return; }
  if (Array.isArray(node.any_of)) { node.any_of.forEach((c) => walkLeaves(c, visit)); return; }
  if (Array.isArray(node.none_of)) { node.none_of.forEach((c) => walkLeaves(c, visit)); return; }
  if (node.system_fact !== undefined) { visit({ kind: 'system_fact', ref: node.system_fact, label: describeLeaf(node) }); return; }
  if (node.workload_profile !== undefined) { visit({ kind: 'workload', ref: 'workload', label: describeLeaf(node) }); return; }
  if (node.metric !== undefined) { visit({ kind: 'metric', ref: node.metric, label: describeLeaf(node) }); }
}

/**
 * Build the dependency-flow graph for a catalog.
 * @param {Object} catalog - a MetricCatalog instance
 * @returns {{ nodes: Array, edges: Array, meta: Object }} cytoscape-ready elements + metadata
 */
function buildGraph(catalog) {
  const nodes = [];
  const edges = [];
  const nodeIds = new Set();
  const edgeKeys = new Set();

  function addNode(id, data, classes) {
    if (nodeIds.has(id)) return;
    nodeIds.add(id);
    nodes.push({ data: { id, ...data }, classes });
  }
  function addEdge(source, target, data, classes) {
    if (!nodeIds.has(source) || !nodeIds.has(target)) return; // skip dangling
    const key = `${classes}|${source}->${target}|${data.label || ''}`;
    if (edgeKeys.has(key)) return;
    edgeKeys.add(key);
    edges.push({ data: { id: `e${edges.length}`, source, target, ...data }, classes });
  }
  function ensureMetricNode(name) {
    if (nodeIds.has(idM(name))) return;
    addNode(idM(name), {
      label: name, kind: 'metric', legacyName: name, criticality: 'advisory',
      sources: [], ghost: true, color: '#94a3b8',
    }, 'metric metric-ghost');
  }
  function ensureFactNode(name) {
    addNode(idF(name), { label: name, kind: 'systemfact', factName: name, color: '#64748b' }, 'systemfact');
  }
  function ensureWorkloadNode() {
    addNode(idW(), { label: 'workload profile', kind: 'workload', color: '#64748b' }, 'workload');
  }

  // --- Pillars + subcategories (the right-hand score columns) -----------------
  const pillarIds = catalog.getPillarIds();
  const pillarColor = {};
  pillarIds.forEach((pid, i) => { pillarColor[pid] = PILLAR_PALETTE[i % PILLAR_PALETTE.length]; });

  for (const pid of pillarIds) {
    const p = catalog.getPillar(pid);
    addNode(idP(pid), {
      label: p.name, baseLabel: p.name, kind: 'pillar', pillarId: pid,
      maxPoints: p.maxPoints, color: pillarColor[pid],
    }, `pillar pil-${pid}`);
    for (const sid of catalog.getSubcategoryIds(pid)) {
      const s = catalog.getSubcategory(sid);
      addNode(idS(sid), {
        label: s.name, baseLabel: s.name, kind: 'subcategory', pillarId: pid,
        subcatId: sid, maxPoints: s.maxPoints, color: pillarColor[pid],
      }, `subcategory pil-${pid}`);
      addEdge(idS(sid), idP(pid), { kind: 'rolls_up' }, 'rolls-up');
    }
  }

  // --- Metric nodes + structural/criticality edges ---------------------------
  const metricByLegacy = new Map();
  for (const m of catalog.metrics) metricByLegacy.set(m.legacy_name, m);

  for (const m of catalog.metrics) {
    const sub = catalog.getSubcategory(m.subcategory);
    const pid = sub ? sub.pillar : null;
    const sources = Array.isArray(m.sources) ? m.sources : [];
    const srcClasses = sources.map((s) => `src-${s}`).join(' ');
    addNode(idM(m.legacy_name), {
      label: m.display_name || m.legacy_name,
      kind: 'metric',
      metricId: m.metric_id,
      legacyName: m.legacy_name,
      criticality: m.criticality,
      sources,
      derived: !!m.derived,
      licenseRequirement: m.license_requirement || null,
      subcatId: m.subcategory,
      pillarId: pid,
      color: pid ? pillarColor[pid] : '#94a3b8',
      gateScope: m.gate_scope || null,
      remediation: m.remediation || '',
      description: m.description || '',
    }, `metric crit-${m.criticality} ${m.derived ? 'derived' : ''} ${m.license_requirement ? 'licensed' : ''} ${srcClasses}`.replace(/\s+/g, ' ').trim());

    if (sub) addEdge(idM(m.legacy_name), idS(m.subcategory), { kind: 'rolls_up' }, 'rolls-up');

    // Criticality gate — failing this metric caps (or zeros) its container.
    if (m.criticality === 'critical' && sub) {
      if (m.gate_scope === 'pillar') {
        addEdge(idM(m.legacy_name), idP(pid), { kind: 'crit_gate', label: 'zeros pillar' }, 'crit-gate crit-gate-pillar');
      } else {
        addEdge(idM(m.legacy_name), idS(m.subcategory), { kind: 'crit_gate', label: '60% gate' }, 'crit-gate');
      }
    }
  }

  // --- Derivation + applicability edges (all metric nodes now exist) ----------
  for (const m of catalog.metrics) {
    if (m.derived && m.derived_from && Array.isArray(m.derived_from.inputs)) {
      for (const input of m.derived_from.inputs) {
        if (metricByLegacy.has(input)) {
          addEdge(idM(input), idM(m.legacy_name), { kind: 'derives' }, 'derives');
        } else {
          ensureFactNode(input);
          addEdge(idF(input), idM(m.legacy_name), { kind: 'derives' }, 'derives');
        }
      }
    }

    if (m.applies_when) {
      walkLeaves(m.applies_when, (leaf) => {
        const target = idM(m.legacy_name);
        if (leaf.kind === 'metric') {
          ensureMetricNode(leaf.ref);
          addEdge(idM(leaf.ref), target, { kind: 'gates', label: 'applies when' }, 'gates');
        } else if (leaf.kind === 'system_fact') {
          ensureFactNode(leaf.ref);
          addEdge(idF(leaf.ref), target, { kind: 'gates', label: 'applies when' }, 'gates');
        } else if (leaf.kind === 'workload') {
          ensureWorkloadNode();
          addEdge(idW(), target, { kind: 'gates', label: leaf.label }, 'gates');
        }
      });
    }
  }

  // --- Rules: trigger inputs + score effects ---------------------------------
  for (const rule of catalog.getConsistencyRules()) {
    const ov = rule.on_violation || {};
    const sev = ov.severity || 'warning';
    addNode(idR(rule.rule_id), {
      label: rule.rule_id,
      kind: 'rule',
      ruleId: rule.rule_id,
      title: rule.title || rule.rule_id,
      severity: sev,
      appliesWhen: humanizePredicate(rule.applies_when),
      tags: Array.isArray(rule.tags) ? rule.tags : [],
      pillarHint: rule.pillar_hint || null,
    }, `rule sev-${sev}`);

    if (rule.applies_when) {
      walkLeaves(rule.applies_when, (leaf) => {
        const target = idR(rule.rule_id);
        if (leaf.kind === 'metric') {
          ensureMetricNode(leaf.ref);
          addEdge(idM(leaf.ref), target, { kind: 'triggers', label: leaf.label }, 'triggers');
        } else if (leaf.kind === 'system_fact') {
          ensureFactNode(leaf.ref);
          addEdge(idF(leaf.ref), target, { kind: 'triggers', label: leaf.label }, 'triggers');
        } else if (leaf.kind === 'workload') {
          ensureWorkloadNode();
          addEdge(idW(), target, { kind: 'triggers', label: leaf.label }, 'triggers');
        }
      });
    }

    const adjustments = Array.isArray(ov.score_adjustments)
      ? ov.score_adjustments
      : (ov.score_adjustment ? [ov.score_adjustment] : []);
    for (const sa of adjustments) {
      if (!sa || !sa.type || sa.type === 'none') continue;
      const from = idR(rule.rule_id);
      if (sa.type === 'metric_zero') {
        ensureMetricNode(sa.target);
        addEdge(from, idM(sa.target), { kind: 'affects', effect: 'zero', label: 'zero' }, 'affects affect-zero');
      } else if (sa.type === 'subcategory_deduction') {
        addEdge(from, idS(sa.target), { kind: 'affects', effect: 'deduct', label: `−${sa.points}` }, 'affects affect-deduct');
      } else if (sa.type === 'subcategory_cap') {
        addEdge(from, idS(sa.target), { kind: 'affects', effect: 'cap', label: `cap ${sa.cap_pct}%` }, 'affects affect-cap');
      } else if (sa.type === 'pillar_deduction') {
        addEdge(from, idP(sa.target), { kind: 'affects', effect: 'pillar_deduct', label: `−${sa.points}` }, 'affects affect-pillar');
      }
    }
  }

  // --- Derived flags: which nodes carry overlay wiring, which rules cross pillars
  const nodePillar = new Map(nodes.map((n) => [n.data.id, n.data.pillarId || null]));
  const overlayFirst = new Set(['triggers', 'affects', 'derives', 'gates']);
  const overlayNodeIds = new Set();
  const rulePillars = new Map();

  for (const e of edges) {
    const first = e.classes.split(' ')[0];
    if (!overlayFirst.has(first)) continue;
    overlayNodeIds.add(e.data.source);
    overlayNodeIds.add(e.data.target);
    let ruleId = null;
    let otherId = null;
    if (first === 'triggers') { ruleId = e.data.target; otherId = e.data.source; }
    else if (first === 'affects') { ruleId = e.data.source; otherId = e.data.target; }
    if (ruleId && ruleId.startsWith('r:')) {
      const pil = nodePillar.get(otherId);
      if (pil) {
        if (!rulePillars.has(ruleId)) rulePillars.set(ruleId, new Set());
        rulePillars.get(ruleId).add(pil);
      }
    }
  }
  for (const n of nodes) {
    if (overlayNodeIds.has(n.data.id)) n.data.overlay = true;
    if (n.data.kind === 'rule') {
      const pset = rulePillars.get(n.data.id);
      n.data.pillars = pset ? [...pset] : [];
      n.data.crossCategory = pset ? pset.size > 1 : false;
    }
  }

  const meta = {
    technology: catalog.technology,
    version: catalog.version,
    pillars: pillarIds.map((pid) => ({ id: pid, name: catalog.getPillar(pid).name, color: pillarColor[pid] })),
    sources: [...new Set(catalog.metrics.flatMap((m) => (Array.isArray(m.sources) ? m.sources : [])))].sort(),
    counts: {
      pillars: pillarIds.length,
      subcategories: nodes.filter((n) => n.data.kind === 'subcategory').length,
      metrics: nodes.filter((n) => n.data.kind === 'metric' && !n.data.ghost).length,
      rules: nodes.filter((n) => n.data.kind === 'rule').length,
      crossCategoryRules: nodes.filter((n) => n.data.kind === 'rule' && n.data.crossCategory).length,
    },
  };

  return { nodes, edges, meta };
}

module.exports = { buildGraph, humanizePredicate, walkLeaves };
