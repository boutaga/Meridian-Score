'use strict';

const { humanizePredicate } = require('./graph-builder');

/**
 * Plain-words pass criterion for a metric's evaluation_config. Shared by the
 * Metrics browser table and the metric card, so both say the same thing.
 */

function bounds(cfg, unit) {
  const parts = [];
  const u = unit ? ` ${unit}` : '';
  if (cfg.min !== undefined) parts.push(`at least ${cfg.min}${u}`);
  if (cfg.max !== undefined) parts.push(`at most ${cfg.max}${u}`);
  if (cfg.min_pct !== undefined && cfg.min_pct_of) parts.push(`at least ${cfg.min_pct} percent of ${cfg.min_pct_of}`);
  if (cfg.max_pct !== undefined && cfg.max_pct_of) parts.push(`at most ${cfg.max_pct} percent of ${cfg.max_pct_of}`);
  if (cfg.absolute_floor) {
    const f = cfg.absolute_floor;
    const fp = [];
    if (f.min !== undefined) fp.push(`at least ${f.min}`);
    if (f.max !== undefined) fp.push(`at most ${f.max}`);
    if (fp.length) parts.push(`(${fp.join(' and ')} when the system fact is unknown)`);
  }
  return parts.join(' and ') || 'any value';
}

function describeCriteria(metric) {
  const cfg = metric.evaluation_config || {};
  const type = metric.evaluation_type;
  if (type === 'boolean') {
    if (cfg.check === 'not_empty_or_dummy') return 'a real, non-empty value';
    if (cfg.check === 'not_empty') return 'a non-empty value';
    return `equals ${cfg.pass_value !== undefined ? cfg.pass_value : true}`;
  }
  if (type === 'enum') {
    const vals = cfg.pass_values || [];
    return vals.length ? `one of ${vals.join(', ')}` : 'any listed value';
  }
  if (type === 'threshold' || type === 'range') {
    if (cfg.profiles && typeof cfg.profiles === 'object') {
      const rows = Object.entries(cfg.profiles).map(([p, c]) => `${p}: ${bounds(c, c.unit || cfg.unit)}`);
      return `by workload profile, ${rows.join('; ')}`;
    }
    if (cfg.by_declaration && cfg.by_declaration.bands) {
      const bd = cfg.by_declaration;
      const rows = Object.entries(bd.bands).map(([k, c]) => `${k}: ${bounds(c, c.unit || cfg.unit)}`);
      const unless = bd.unless ? `; the declaration is ignored when ${humanizePredicate(bd.unless)}` : '';
      return `keyed by the declared ${bd.metric}, ${rows.join('; ')}; otherwise ${bounds(cfg, cfg.unit)}${unless}`;
    }
    return bounds(cfg, cfg.unit);
  }
  return '';
}

module.exports = { describeCriteria };
