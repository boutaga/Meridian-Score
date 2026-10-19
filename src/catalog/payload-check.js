'use strict';

/**
 * Payload shape checker (v1.15.0).
 *
 * The unit tests score catalog-shaped samples; a real collector payload can
 * disagree with the catalog on shape (prose where a number is expected) or
 * unit (megabytes against a bytes bound) and no test will notice. This module
 * takes a real values map and reports, per catalog metric, whether the value
 * is usable as the catalog expects. It never scores.
 */

const { getCatalog, MetricCatalog } = require('./index');
const { evaluatePredicate } = require('../scoring/consistency');
const { MIN_VERSION_FIELDS } = require('./constants');

const UNIT_HINTS = new Set(['bytes', 'kb', 'seconds', 'ms', 'minutes', 'hours', 'gb', 'mb', 'percent']);
const BOOLEAN_STRINGS = new Set(['true', 'false', 'on', 'off', 'yes', 'no', '1', '0']);

function isMissing(v) {
  return v === null || v === undefined || v === '';
}

/** Flat bounds of a config, falling back to the default profile or the absolute floor. */
function flatBounds(config) {
  if (!config) return null;
  if (config.profiles && typeof config.profiles === 'object') {
    return flatBounds(config.profiles.default || config.profiles.mixed || null);
  }
  const src = (config.min === undefined && config.max === undefined && config.absolute_floor)
    ? config.absolute_floor
    : config;
  const out = {};
  if (Number.isFinite(src.min)) out.min = src.min;
  if (Number.isFinite(src.max)) out.max = src.max;
  return (out.min === undefined && out.max === undefined) ? null : out;
}

function resolveCatalog(technology, options) {
  const c = options.catalog;
  if (!c) return getCatalog(technology);
  if (c instanceof MetricCatalog) return c;
  return MetricCatalog.fromData(technology, c);
}

function classify(metric, raw, payload, ctx) {
  const config = metric.evaluation_config || {};
  if (metric.derived) return { status: 'derived', detail: 'engine-computed, not collected' };
  if (metric.applies_when && !evaluatePredicate(metric.applies_when, payload, ctx)) {
    return { status: 'not_applicable', detail: 'applies_when is false for this payload' };
  }
  if (raw === '') return { status: 'not_provided', detail: 'empty string; the engine treats it as not provided' };
  if (isMissing(raw)) return { status: 'not_provided', detail: 'no value in the payload' };

  if (metric.evaluation_type === 'threshold' || metric.evaluation_type === 'range') {
    const n = parseFloat(raw);
    // The engine coerces with parseFloat, so "19.21.0.0.0" scores as 19.21;
    // prose after the number ("12 files (1 GB)") scores as 12 and is exactly
    // the class of collector bug this checker exists to expose.
    const looksNumeric = typeof raw === 'number' || /^\s*-?\d+(\.\d+)*\s*$/.test(String(raw));
    if (!Number.isFinite(n) || !looksNumeric) {
      return { status: 'unparseable', detail: `expected a number, got ${JSON.stringify(raw)}${Number.isFinite(n) ? ` (the engine would read ${n})` : ''}` };
    }
    const unit = String(config.unit || '').toLowerCase();
    if (UNIT_HINTS.has(unit)) {
      // A percent above 100 can be legitimate (usage 240 percent of a pool, XID age past
      // the wraparound threshold); only a negative percent is a shape error.
      if (unit === 'percent' && n < 0) {
        return { status: 'unit_suspect', detail: `${n} is negative for a percent metric` };
      }
      const b = flatBounds(config);
      if (b) {
        const bound = b.min !== undefined ? b.min : b.max;
        if (bound >= 10 && n > 0 && (n / bound >= 1000 || bound / n >= 1000)) {
          return { status: 'unit_suspect', detail: `${n} differs from the ${b.min !== undefined ? 'min' : 'max'} bound ${bound} (${unit}) by 1000x or more` };
        }
      }
    }
    return { status: 'ok', detail: '' };
  }

  if (metric.evaluation_type === 'enum') {
    const pass = (config.pass_values || []).map(String);
    // Case-insensitive, as the engine's evaluateEnum compares (1.16.0).
    if (!pass.some((p) => p.toLowerCase() === String(raw).toLowerCase())) {
      // A declaration outside its vocabulary (for example "yes" for an RPO)
      // is scored as a failed declaration; say which rungs exist (1.16.0).
      if (metric.declared_target) {
        return { status: 'enum_mismatch', detail: `${JSON.stringify(raw)} is not a declared rung; the engine scores it as a failed declaration. Declare one of ${pass.join(', ')}` };
      }
      return { status: 'enum_mismatch', detail: `${JSON.stringify(raw)} is not a pass value; may be a legitimate failing value` };
    }
    return { status: 'ok', detail: '' };
  }

  if (metric.evaluation_type === 'boolean') {
    if (config.check) {
      return String(raw).trim().length > 0
        ? { status: 'ok', detail: '' }
        : { status: 'unparseable', detail: 'empty string for a non-empty check' };
    }
    if (typeof raw === 'boolean' || BOOLEAN_STRINGS.has(String(raw).toLowerCase())) {
      return { status: 'ok', detail: '' };
    }
    return { status: 'unparseable', detail: `expected a boolean, got ${JSON.stringify(raw)}` };
  }

  return { status: 'ok', detail: '' };
}

function inactiveReason(metric, active, options, technology) {
  if (active.has(metric.legacy_name)) return null;
  if (metric.agent_only && (options.mode || 'standalone') === 'standalone') return 'agent-only metric in standalone mode';
  if (metric.extension_requirement) return `needs the ${metric.extension_requirement} extension`;
  if (metric.deployment_profiles) return `profile-specific metric (${metric.deployment_profiles.join(', ')})`;
  const minVersion = metric[MIN_VERSION_FIELDS[technology] || 'min_pg_version'];
  if (minVersion && (options.serverVersion ?? options.pgVersion)) return `needs version ${minVersion} or later`;
  return 'not in the active metric set for these options';
}

function licenseExcluded(metric, options) {
  if (!metric.license_requirement) return false;
  const owned = new Set((options.licensedOptions || []).map(x => String(x).toLowerCase()));
  const edition = String((options.systemFacts || {}).edition || '').toLowerCase();
  if (edition === 'enterprise') owned.add('enterprise_edition');
  return !owned.has(String(metric.license_requirement).toLowerCase());
}

/**
 * @param {string} technology
 * @param {Object} values - flat legacy_name -> value map (a real collection)
 * @param {Object} [options] - { catalog?, systemFacts?, workloadProfile?, licensedOptions?,
 *   mode?, serverVersion? (or its alias pgVersion), deploymentProfile?, installedExtensions?, availableSources? }
 *   (the same options ScoringEngine.calculate takes; they decide applicability)
 */
function checkPayload(technology, values, options = {}) {
  const cat = resolveCatalog(technology, options);
  const payload = values && typeof values === 'object' ? values : {};
  const ctx = { systemFacts: options.systemFacts || {}, workloadProfile: options.workloadProfile || 'mixed' };
  const active = new Set(cat.getActiveMetrics({
    mode: options.mode,
    serverVersion: options.serverVersion ?? options.pgVersion,
    deploymentProfile: options.deploymentProfile,
    installedExtensions: options.installedExtensions,
    availableSources: options.availableSources,
  }).map(m => m.legacy_name));
  const counts = { ok: 0, notProvided: 0, criticalNotProvided: 0, notApplicable: 0, unparseable: 0, enumMismatch: 0, unitSuspect: 0, derived: 0, unknownKeys: 0 };
  const COUNT_KEY = { ok: 'ok', not_provided: 'notProvided', not_applicable: 'notApplicable', unparseable: 'unparseable', enum_mismatch: 'enumMismatch', unit_suspect: 'unitSuspect', derived: 'derived' };
  const metrics = [];

  for (const m of cat.metrics) {
    const raw = payload[m.legacy_name];
    const inactive = inactiveReason(m, active, options, cat.technology);
    const license = !inactive && licenseExcluded(m, options);
    const { status, detail } = inactive
      ? { status: 'not_applicable', detail: inactive }
      : license
        ? { status: 'not_applicable', detail: `needs the ${m.license_requirement} license option` }
        : classify(m, raw, payload, ctx);
    counts[COUNT_KEY[status]] += 1;
    if (status === 'not_provided' && m.criticality === 'critical') counts.criticalNotProvided += 1;
    metrics.push({
      metric_id: m.metric_id,
      legacy_name: m.legacy_name,
      display_name: m.display_name,
      evaluation_type: m.evaluation_type,
      criticality: m.criticality,
      status,
      detail,
      value: raw === undefined ? null : raw,
    });
  }

  const known = new Set(cat.metrics.map(m => m.legacy_name));
  const unknownKeys = Object.keys(payload).filter(k => !known.has(k)).sort();
  counts.unknownKeys = unknownKeys.length;

  return { technology, catalogVersion: cat.version, counts, metrics, unknownKeys };
}

module.exports = { checkPayload };
