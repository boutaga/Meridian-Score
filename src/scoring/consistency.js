'use strict';

/**
 * Cross-metric consistency rules.
 *
 * Rules declare inter-metric constraints that the per-metric scoring engine
 * cannot express on its own (e.g. "rpo_target=rpo_5 is impossible with
 * dump_schedule=daily"). Each rule is a predicate over collected values plus
 * an `on_violation` action.
 *
 * Phase 2 (v1.6.0) — score adjustments are live. `applyAdjustments` consumes
 * the four reserved score_adjustment shapes: subcategory_cap,
 * subcategory_deduction, pillar_deduction, none.
 *
 * Predicate DSL — leaves carry exactly one operator; composites carry exactly
 * one of all_of/any_of/none_of. Three leaf families:
 *
 *   Metric-value leaves (read from `values[node.metric]`):
 *     { metric, equals: v }            — case-insensitive string match
 *     { metric, in: [v...] }           — case-insensitive enum membership
 *     { metric, not_in: [v...] }
 *     { metric, gt|gte|lt|lte: n }     — parseFloat-coerced numeric compare
 *     { metric, is_truthy: true|false }
 *     { metric, provided: true|false }
 *
 *   System-fact leaves (read from `ctx.systemFacts[node.system_fact]`):
 *     { system_fact, gt|gte|lt|lte|equals: n }
 *
 *   Workload-profile leaves (read from `ctx.workloadProfile`):
 *     { workload_profile: "olap" }           — sugar for equals
 *     { workload_profile: { equals: "olap" } }
 *     { workload_profile: { in: ["olap","mixed"] } }
 *     { workload_profile: { not_in: ["oltp"] } }
 *
 *   Composites:
 *     { all_of: [...] } | { any_of: [...] } | { none_of: [...] }
 */

const TRUTHY = new Set(['true', 'on', 'yes', '1', 't', 'y']);

function isProvided(v) {
  return v !== null && v !== undefined && v !== '';
}

function asNumber(v) {
  if (v === null || v === undefined || v === '') return NaN;
  return parseFloat(v);
}

function isTruthy(v) {
  if (v === true) return true;
  if (v === 1) return true;
  if (typeof v === 'number') return v !== 0 && !Number.isNaN(v);
  if (typeof v === 'string') return TRUTHY.has(v.toLowerCase());
  return false;
}

function applyNumericComparator(node, n) {
  if (node.equals !== undefined) return n === Number(node.equals);
  if (node.gt  !== undefined) return n >  Number(node.gt);
  if (node.gte !== undefined) return n >= Number(node.gte);
  if (node.lt  !== undefined) return n <  Number(node.lt);
  if (node.lte !== undefined) return n <= Number(node.lte);
  return false;
}

function evaluatePredicate(node, values, ctx = {}) {
  if (!node || typeof node !== 'object') return false;

  if (Array.isArray(node.all_of)) {
    return node.all_of.every(child => evaluatePredicate(child, values, ctx));
  }
  if (Array.isArray(node.any_of)) {
    return node.any_of.some(child => evaluatePredicate(child, values, ctx));
  }
  if (Array.isArray(node.none_of)) {
    return node.none_of.every(child => !evaluatePredicate(child, values, ctx));
  }

  // System-fact leaf — read from ctx.systemFacts. Numeric anchors (ram_kb,
  // cpu_count, …) use the numeric comparators; string facts (storage_type,
  // edition — v1.8.0+) use case-insensitive equals/in/not_in.
  if (node.system_fact !== undefined) {
    const facts = (ctx && ctx.systemFacts) || {};
    const raw = facts[node.system_fact];
    if (raw === null || raw === undefined) return false;
    if (Array.isArray(node.in)) {
      const lc = String(raw).toLowerCase();
      return node.in.some(x => String(x).toLowerCase() === lc);
    }
    if (Array.isArray(node.not_in)) {
      const lc = String(raw).toLowerCase();
      return !node.not_in.some(x => String(x).toLowerCase() === lc);
    }
    if (node.equals !== undefined) {
      const n = asNumber(raw);
      const en = asNumber(node.equals);
      if (!Number.isNaN(n) && !Number.isNaN(en)) return n === en;
      return String(raw).toLowerCase() === String(node.equals).toLowerCase();
    }
    const n = asNumber(raw);
    if (Number.isNaN(n)) return false;
    return applyNumericComparator(node, n);
  }

  // Workload-profile leaf — read from ctx.workloadProfile.
  if (node.workload_profile !== undefined) {
    const profile = String((ctx && ctx.workloadProfile) || '').toLowerCase();
    if (!profile) return false;
    const spec = node.workload_profile;
    if (typeof spec === 'string') {
      return profile === spec.toLowerCase();
    }
    if (spec && typeof spec === 'object') {
      if (spec.equals !== undefined) return profile === String(spec.equals).toLowerCase();
      if (Array.isArray(spec.in)) return spec.in.some(x => profile === String(x).toLowerCase());
      if (Array.isArray(spec.not_in)) return !spec.not_in.some(x => profile === String(x).toLowerCase());
    }
    return false;
  }

  if (!node.metric) return false;
  const v = values[node.metric];

  if (node.provided === true)  return isProvided(v);
  if (node.provided === false) return !isProvided(v);

  if (!isProvided(v)) return false;

  if (node.is_truthy === true)  return isTruthy(v);
  if (node.is_truthy === false) return !isTruthy(v);

  if (node.equals !== undefined) {
    return String(v).toLowerCase() === String(node.equals).toLowerCase();
  }
  if (Array.isArray(node.in)) {
    const lc = String(v).toLowerCase();
    return node.in.some(x => String(x).toLowerCase() === lc);
  }
  if (Array.isArray(node.not_in)) {
    const lc = String(v).toLowerCase();
    return !node.not_in.some(x => String(x).toLowerCase() === lc);
  }

  const n = asNumber(v);
  if (Number.isNaN(n)) return false;
  if (node.gt  !== undefined) return n >  Number(node.gt);
  if (node.gte !== undefined) return n >= Number(node.gte);
  if (node.lt  !== undefined) return n <  Number(node.lt);
  if (node.lte !== undefined) return n <= Number(node.lte);

  return false;
}

function interpolate(template, values) {
  if (typeof template !== 'string') return template;
  return template.replace(/\{value:([a-zA-Z0-9_]+)\}/g, (_, name) => {
    const v = values[name];
    return v === undefined || v === null ? '' : String(v);
  });
}

/**
 * Annotate an adjustment's originating finding with its realised score
 * movement. Singular-form rules keep the historical `score_movement` object;
 * plural-form rules (score_adjustments[], v1.8.0+) accumulate into a
 * `score_movements` array in application order.
 */
function annotateMovement(adj, movement) {
  if (!adj || !adj.finding) return;
  if (adj.multi) {
    if (!Array.isArray(adj.finding.score_movements)) adj.finding.score_movements = [];
    adj.finding.score_movements.push(movement);
  } else {
    adj.finding.score_movement = movement;
  }
}

function buildFinding(rule, values, catalog) {
  const ov = rule.on_violation || {};
  // Pillar/category attribution follows the FIRST adjustment (plural form)
  // or the singular adjustment — authors order the primary target first.
  const sa = (Array.isArray(ov.score_adjustments) && ov.score_adjustments[0])
    || ov.score_adjustment
    || {};
  let pillar = null;
  let category = 'Cross-metric';

  if (catalog) {
    if (sa.type === 'subcategory_cap' || sa.type === 'subcategory_deduction') {
      const sub = catalog.getSubcategory(sa.target);
      if (sub) {
        pillar = sub.pillar;
        category = sub.name;
      }
    } else if (sa.type === 'pillar_deduction') {
      pillar = sa.target;
    }
  }
  if (pillar === null && rule.pillar_hint) {
    pillar = rule.pillar_hint;
  }

  return {
    pillar,
    category,
    severity: ov.severity || 'warning',
    source: 'engine',
    title: interpolate(ov.title || rule.title || rule.rule_id, values),
    description: interpolate(ov.description || rule.description || '', values),
    remediation: interpolate(ov.remediation || '', values),
    rule_id: rule.rule_id,
    kind: 'consistency',
  };
}

function evaluateRules(rules, values, _subcategoryResults, catalog = null, ctx = {}) {
  const findings = [];
  const adjustments = [];
  const fired = [];

  if (!Array.isArray(rules) || rules.length === 0) {
    return { findings, adjustments, fired };
  }

  for (const rule of rules) {
    if (!rule || !rule.applies_when) continue;
    if (!evaluatePredicate(rule.applies_when, values, ctx)) continue;

    fired.push(rule.rule_id);
    const finding = buildFinding(rule, values, catalog);
    findings.push(finding);

    // Singular `score_adjustment` and plural `score_adjustments` (v1.8.0+)
    // normalize to one list; plural entries carry `multi: true` so the
    // annotation lands in finding.score_movements instead of .score_movement.
    const ov = rule.on_violation || {};
    let saList;
    if (Array.isArray(ov.score_adjustments)) {
      saList = ov.score_adjustments.map(sa => ({ ...sa, multi: true }));
    } else {
      saList = [ov.score_adjustment || { type: 'none' }];
    }
    for (const sa of saList) {
      if (sa.type && sa.type !== 'none') {
        // Bind the originating finding so the adjustment pipeline can annotate
        // it with the realised score movement once the arithmetic runs.
        adjustments.push({ rule_id: rule.rule_id, finding, ...sa });
      }
    }
  }

  return { findings, adjustments, fired };
}

/**
 * Apply rule-driven score adjustments to subcategory and pillar results.
 *
 * Composition order per target:
 *   1. subcategory_deduction (sum across rules, floor at 0)
 *   2. subcategory_cap       (lowest cap wins, applied on top of deduction)
 *   3. pillar_deduction      (applied later in engine.js during pillar rollup)
 *
 * The existing critical-tier 60% cap (applied inside _scoreSubcategory) stacks
 * with rule caps by lower-wins — handled implicitly because rule caps run
 * after the critical-tier cap has already written to subcategoryResults.
 *
 * Adjustments mutate `subcategoryResults` (Map<subcatId, {score, maxScore, …}>)
 * in place. Pillar deductions are returned via `pillarDeductions` (a Map
 * keyed by pillarId → total points to deduct) for the engine to apply.
 *
 * Each fired adjustment annotates its originating finding with a
 * `score_movement` field so downstream consumers (simulator UI, platform)
 * can show "this rule reduced Caching by 1.0 points".
 *
 * @param {Array} adjustments - From evaluateRules (each carries rule_id, finding, type, target, …)
 * @param {Map}   subcategoryResults - Mutated in place for subcategory_cap/deduction
 * @returns {{ pillarDeductions: Map<string, number> }}
 */
function applyAdjustments(adjustments, subcategoryResults) {
  const pillarDeductions = new Map();
  if (!Array.isArray(adjustments) || adjustments.length === 0) {
    return { pillarDeductions };
  }
  if (!(subcategoryResults instanceof Map)) {
    return { pillarDeductions };
  }

  // Pass 1: subcategory_deduction (sum across rules, applied first).
  // metric_zero adjustments are NOT handled here — the engine applies them
  // during subcategory normalization (see engine.js _scoreSubcategory).
  for (const adj of adjustments) {
    if (adj.type !== 'subcategory_deduction') continue;
    const sub = subcategoryResults.get(adj.target);
    if (!sub) continue;
    const points = Number(adj.points) || 0;
    const prior = sub.score;
    const applied = Math.min(points, prior);
    sub.score = Math.max(0, prior - points);
    sub.score = Math.round(sub.score * 100) / 100;
    annotateMovement(adj, {
      type: 'subcategory_deduction',
      target: adj.target,
      requested: points,
      applied,
      prior_score: prior,
      new_score: sub.score,
    });
  }

  // Pass 2: subcategory_cap (lowest cap per subcategory wins).
  const capsBySubcat = new Map();
  for (const adj of adjustments) {
    if (adj.type !== 'subcategory_cap') continue;
    const sub = subcategoryResults.get(adj.target);
    if (!sub) continue;
    const capPct = Number(adj.cap_pct);
    if (!Number.isFinite(capPct)) continue;
    const capPoints = (capPct / 100) * sub.maxScore;
    const current = capsBySubcat.get(adj.target);
    if (!current || capPoints < current.capPoints) {
      capsBySubcat.set(adj.target, { capPoints, capPct, adj });
    }
  }
  for (const [subcatId, { capPoints, capPct, adj }] of capsBySubcat) {
    const sub = subcategoryResults.get(subcatId);
    if (!sub) continue;
    const prior = sub.score;
    if (prior > capPoints) {
      sub.score = Math.round(capPoints * 100) / 100;
    }
    annotateMovement(adj, {
      type: 'subcategory_cap',
      target: subcatId,
      cap_pct: capPct,
      cap_points: Math.round(capPoints * 100) / 100,
      prior_score: prior,
      new_score: sub.score,
    });
  }

  // Pass 3: pillar_deduction — collected here, applied by engine.js during
  // pillar rollup so we can floor against the accumulated pillarScore.
  for (const adj of adjustments) {
    if (adj.type !== 'pillar_deduction') continue;
    const points = Number(adj.points) || 0;
    const prev = pillarDeductions.get(adj.target) || { points: 0, adjustments: [] };
    prev.points += points;
    prev.adjustments.push(adj);
    pillarDeductions.set(adj.target, prev);
  }

  return { pillarDeductions };
}

module.exports = { evaluatePredicate, evaluateRules, applyAdjustments, annotateMovement };
