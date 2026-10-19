'use strict';

/**
 * Fingerprints (1.16.0): two content checksums that tell, without reading the
 * rules, whether two scores are comparable.
 *
 * - The rules fingerprint answers "same ruler?": engine version, scoring
 *   policy and the whole catalog (metrics with their texts, subcategories,
 *   pillars, consistency rules). Release notes and catalog-level prose are left
 *   out, so a platform that loads the catalog from its database without them
 *   gets the same code.
 * - The declarations fingerprint answers "same declared targets?": the
 *   declared targets only (metrics flagged declared_target), in the catalog
 *   spelling. Since 1.17.0 the same rules and declarations give the same
 *   target, unless an applicability fact changed (a practice switched on, a
 *   check guarded on a collected value present or not, a server version).
 *
 * Collected values never enter either code. Both are SHA-256 over a canonical
 * JSON form (keys sorted, metrics sorted by metric_id, rules by rule_id), so
 * reformatting or reordering a file never changes a code.
 */

const crypto = require('crypto');
const { SCORING_POLICY } = require('./scoring/policy');
const { version: ENGINE_VERSION } = require('../package.json');

const ALGORITHM = 'sha256';
// Bumped when the canonical form itself changes, so a code computed by an older
// method is never silently compared with a newer one.
const CANONICAL_VERSION = 1;
const SHORT_LENGTH = 12;

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))) {
      if (value[key] !== undefined) out[key] = canonicalize(value[key]);
    }
    return out;
  }
  return value;
}

const canonicalJson = (value) => JSON.stringify(canonicalize(value));
const digest = (value) => crypto.createHash(ALGORITHM).update(canonicalJson(value)).digest('hex');
// Plain UTF-16 code-unit order (the same as code points for these ASCII
// identifiers): independent of the runtime's locale and ICU build.
const byKey = (key) => (a, b) => {
  const x = String(a[key]);
  const y = String(b[key]);
  return x < y ? -1 : x > y ? 1 : 0;
};

/** The scoring content of a MetricCatalog instance or raw catalog data. */
function catalogContent(cat) {
  return {
    technology: cat.technology,
    version: cat.version,
    maturity: cat.maturity || null,
    pillars: cat.pillars,
    subcategories: cat.subcategories,
    metrics: [...cat.metrics].sort(byKey('metric_id')),
    consistency_rules: [...(cat.consistencyRules || cat.consistency_rules || [])].sort(byKey('rule_id')),
  };
}

// Computed once per catalog object: hashing the catalog costs more than
// scoring it. A catalog is treated as immutable once scored; an edited catalog
// is a new MetricCatalog (MetricCatalog.fromData), which gets its own code.
const RULES_CACHE = new WeakMap();

function rulesFingerprint(cat) {
  if (RULES_CACHE.has(cat)) return RULES_CACHE.get(cat);
  const code = digest({
    canonical: CANONICAL_VERSION,
    engineVersion: ENGINE_VERSION,
    policy: SCORING_POLICY,
    catalog: catalogContent(cat),
  });
  RULES_CACHE.set(cat, code);
  return code;
}

/**
 * The catalog alone, without engine or policy: what a rules bundle records to
 * detect a damaged or edited file independently of the importer's version.
 */
function catalogFingerprint(cat) {
  return digest({ canonical: CANONICAL_VERSION, catalog: catalogContent(cat) });
}

/** A declared value in the catalog's own spelling; null when not declared. */
function normalizeDeclaration(metric, value) {
  if (value === undefined || value === null || value === '') return null;
  const passValues = (metric.evaluation_config && metric.evaluation_config.pass_values) || [];
  const s = String(value);
  const match = passValues.find((p) => String(p).toLowerCase() === s.toLowerCase());
  return match !== undefined ? match : s;
}

/** Every declared target of the catalog, normalised, keyed by legacy_name. */
function declarationsOf(cat, values = {}) {
  const out = {};
  for (const m of [...cat.metrics].sort(byKey('legacy_name'))) {
    if (m.declared_target === true) out[m.legacy_name] = normalizeDeclaration(m, values[m.legacy_name]);
  }
  return out;
}

function declarationsFingerprint(cat, values = {}) {
  return digest({ canonical: CANONICAL_VERSION, technology: cat.technology, declarations: declarationsOf(cat, values) });
}

/** Both codes, full for programs and short for people. */
function fingerprints(cat, values = {}) {
  const rules = rulesFingerprint(cat);
  const declarations = declarationsFingerprint(cat, values);
  return {
    algorithm: ALGORITHM,
    canonicalVersion: CANONICAL_VERSION,
    rules,
    rulesShort: rules.slice(0, SHORT_LENGTH),
    declarations,
    declarationsShort: declarations.slice(0, SHORT_LENGTH),
  };
}

module.exports = {
  ALGORITHM,
  CANONICAL_VERSION,
  canonicalJson,
  catalogContent,
  rulesFingerprint,
  catalogFingerprint,
  declarationsFingerprint,
  declarationsOf,
  normalizeDeclaration,
  fingerprints,
};
