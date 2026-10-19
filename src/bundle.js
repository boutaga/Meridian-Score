'use strict';

/**
 * Rules bundle (1.16.0): one JSON file that carries a catalog, the versions it
 * was exported from, optionally the exporter's declared targets, and both
 * fingerprints, so another organization can score its own estate against the
 * same bar. The catalog travels in the file; engine code cannot, so a bundle
 * from another engine version imports but reports the version difference.
 *
 * The codes are plain checksums, not signatures: they catch a damaged file or
 * a naive edit, not someone who recomputes them with the exported functions.
 * Authenticity comes from where the file was obtained.
 */

const { MetricCatalog, getCatalog } = require('./catalog');
const { validateCatalogData } = require('./catalog/validation');
const { SUPPORTED_TECHNOLOGIES } = require('./catalog/constants');
const { SCORING_POLICY } = require('./scoring/policy');
const { version: ENGINE_VERSION } = require('../package.json');
const {
  ALGORITHM, CANONICAL_VERSION, catalogContent, rulesFingerprint, catalogFingerprint,
  declarationsFingerprint, declarationsOf,
} = require('./fingerprint');

const FORMAT = 'scoring-core-rules-bundle';
const FORMAT_VERSION = 1;

/**
 * Build a rules bundle.
 * @param {string} technology
 * @param {Object} [options]
 * @param {MetricCatalog} [options.catalog] - defaults to the embedded catalog
 * @param {Object} [options.declarations] - the exporter's declared targets, keyed by legacy_name
 */
function exportRulesBundle(technology, { catalog, declarations } = {}) {
  const cat = catalog || getCatalog(technology);
  const { technology: _technology, ...catalogData } = catalogContent(cat);
  const bundle = {
    format: FORMAT,
    formatVersion: FORMAT_VERSION,
    technology,
    engineVersion: ENGINE_VERSION,
    policyVersion: SCORING_POLICY.version,
    catalog: catalogData,
    fingerprint: {
      algorithm: ALGORITHM,
      canonicalVersion: CANONICAL_VERSION,
      rules: rulesFingerprint(cat),
      catalog: catalogFingerprint(cat),
    },
  };
  if (declarations) {
    const known = declarationsOf(cat, declarations);
    if (Object.keys(known).length === 0) throw new Error(`the ${technology} catalog has no declared targets`);
    if (Object.values(known).every((v) => v === null)) {
      throw new Error('no declared target recognised in the declarations given (expected one of '
        + `${Object.keys(known).join(', ')})`);
    }
    bundle.declarations = known;
    bundle.fingerprint.declarations = declarationsFingerprint(cat, declarations);
  }
  return bundle;
}

/**
 * Load and check a rules bundle. Throws with the reason when the file is not a
 * bundle, its catalog fails validation, or its rules fingerprint does not
 * match its content (a damaged or hand-edited file).
 * @param {string|Object} input - the bundle JSON text or parsed object
 * @returns {{ technology, catalog: MetricCatalog, declarations: Object|null,
 *   fingerprint: Object, engineVersion: string, sameEngine: boolean, notes: string[] }}
 */
function loadRulesBundle(input) {
  const bundle = typeof input === 'string' ? JSON.parse(input) : input;
  if (!bundle || bundle.format !== FORMAT) throw new Error(`not a rules bundle (format must be "${FORMAT}")`);
  if (bundle.formatVersion !== FORMAT_VERSION) {
    throw new Error(`unsupported bundle format version ${JSON.stringify(bundle.formatVersion)} (this package reads ${FORMAT_VERSION})`);
  }
  if (!bundle.technology || !bundle.catalog || !bundle.fingerprint) {
    throw new Error('bundle is missing technology, catalog or fingerprint');
  }
  if (bundle.fingerprint.algorithm !== ALGORITHM || bundle.fingerprint.canonicalVersion !== CANONICAL_VERSION) {
    throw new Error(`bundle fingerprint uses ${bundle.fingerprint.algorithm} canonical version ${bundle.fingerprint.canonicalVersion}; this package computes ${ALGORITHM} version ${CANONICAL_VERSION}`);
  }
  const validation = validateCatalogData(bundle.catalog);
  if (!validation.valid) throw new Error(`bundle catalog fails validation: ${validation.errors.join('; ')}`);

  // A shipped technology is read in its catalog spelling (trimmed, lower
  // case) everywhere, so "Oracle" loads as "oracle" (its version field, its
  // codes); a hand-edited name therefore no longer matches its codes.
  const trimmed = String(bundle.technology).trim().toLowerCase();
  const isShipped = SUPPORTED_TECHNOLOGIES.includes(trimmed);
  const technology = isShipped ? trimmed : bundle.technology;
  const catalog = MetricCatalog.fromData(technology, bundle.catalog);
  const notes = [];
  // The catalog code checks the file itself, whatever engine imports it.
  if (catalogFingerprint(catalog) !== bundle.fingerprint.catalog) {
    throw new Error('bundle catalog fingerprint does not match its content (damaged or edited after export)');
  }
  const sameEngine = bundle.engineVersion === ENGINE_VERSION;
  if (!sameEngine) {
    notes.push(`bundle exported by engine ${bundle.engineVersion}, scored by ${ENGINE_VERSION}: the rules fingerprint differs from the bundle's because engine code can change scoring`);
  } else if (rulesFingerprint(catalog) !== bundle.fingerprint.rules) {
    throw new Error('bundle rules fingerprint does not match its content (damaged or edited after export)');
  }
  if (bundle.policyVersion !== SCORING_POLICY.version) {
    notes.push(`bundle exported under scoring policy ${bundle.policyVersion}, this package applies ${SCORING_POLICY.version}`);
  }
  // Declarations: only the catalog's declared targets, and always with their
  // code, so a collected value cannot ride in as a "declaration".
  let declarations = null;
  if (bundle.declarations !== undefined || bundle.fingerprint.declarations !== undefined) {
    if (!bundle.declarations || typeof bundle.declarations !== 'object' || !bundle.fingerprint.declarations) {
      throw new Error('bundle declarations and their fingerprint must come together');
    }
    // Declared targets by the bundle's catalog and, when this package ships the
    // technology, by its own catalog too: an edited catalog cannot promote a
    // collected value to a "declaration" that travels.
    const flagged = new Set(catalog.metrics.filter((m) => m.declared_target === true).map((m) => m.legacy_name));
    // The shipped catalog is the reference for which values are declared
    // targets; a technology this package does not ship has no reference, so
    // its bundle may carry rules but no declarations.
    if (!isShipped) {
      throw new Error(`bundle declarations need a technology this package ships (${SUPPORTED_TECHNOLOGIES.join(', ')}), got "${bundle.technology}"`);
    }
    const embedded = getCatalog(technology);
    const embeddedFlagged = new Set(embedded.metrics.filter((m) => m.declared_target === true).map((m) => m.legacy_name));
    const foreign = Object.keys(bundle.declarations).filter((k) => !flagged.has(k) || !embeddedFlagged.has(k));
    if (foreign.length > 0) throw new Error(`bundle declarations name values that are not declared targets: ${foreign.join(', ')}`);
    declarations = declarationsOf(catalog, bundle.declarations);
    if (declarationsFingerprint(catalog, declarations) !== bundle.fingerprint.declarations) {
      throw new Error('bundle declarations fingerprint does not match its declarations (damaged or edited after export)');
    }
  }
  return {
    technology,
    catalog,
    declarations,
    fingerprint: bundle.fingerprint,
    engineVersion: bundle.engineVersion,
    sameEngine,
    notes,
  };
}

module.exports = { FORMAT, FORMAT_VERSION, exportRulesBundle, loadRulesBundle };
