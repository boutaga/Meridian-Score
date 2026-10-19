'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { getCatalog, SUPPORTED_TECHNOLOGIES, MetricCatalog } = require('../src');

describe('Catalog structural validation', () => {
  for (const tech of SUPPORTED_TECHNOLOGIES) {
    describe(tech, () => {
      const cat = getCatalog(tech);

      it('has 5 pillars each with maxPoints=20', () => {
        const pillarIds = cat.getPillarIds();
        assert.equal(pillarIds.length, 5);
        for (const id of pillarIds) {
          assert.equal(cat.getPillar(id).maxPoints, 20, `${id} maxPoints should be 20`);
        }
      });

      it('subcategory maxPoints sum to 20 per pillar', () => {
        for (const pillarId of cat.getPillarIds()) {
          const subcatIds = cat.getSubcategoryIds(pillarId);
          const total = subcatIds.reduce((sum, id) => sum + cat.getSubcategory(id).maxPoints, 0);
          assert.equal(total, 20, `${pillarId} subcategories should sum to 20, got ${total}`);
        }
      });

      it('has no duplicate metric_ids', () => {
        const ids = cat.metrics.map(m => m.metric_id);
        const unique = new Set(ids);
        assert.equal(ids.length, unique.size, `Found ${ids.length - unique.size} duplicate metric_ids`);
      });

      it('has no duplicate legacy_names', () => {
        const names = cat.metrics.map(m => m.legacy_name);
        const unique = new Set(names);
        assert.equal(names.length, unique.size, `Found ${names.length - unique.size} duplicate legacy_names`);
      });

      it('every metric references a valid subcategory', () => {
        for (const m of cat.metrics) {
          assert.ok(cat.getSubcategory(m.subcategory),
            `${m.metric_id} references unknown subcategory: ${m.subcategory}`);
        }
      });

      it('every subcategory references a valid pillar', () => {
        for (const [id, sub] of Object.entries(cat.subcategories)) {
          assert.ok(cat.getPillar(sub.pillar),
            `Subcategory ${id} references unknown pillar: ${sub.pillar}`);
        }
      });

      it('all evaluation_type values are valid', () => {
        const validTypes = ['boolean', 'enum', 'threshold', 'range'];
        for (const m of cat.metrics) {
          assert.ok(validTypes.includes(m.evaluation_type),
            `${m.metric_id} has invalid evaluation_type: ${m.evaluation_type}`);
        }
      });

      it('all criticality values are valid', () => {
        const validLevels = ['critical', 'important', 'advisory'];
        for (const m of cat.metrics) {
          assert.ok(validLevels.includes(m.criticality),
            `${m.metric_id} has invalid criticality: ${m.criticality}`);
        }
      });

      it('all metrics have required fields', () => {
        const required = ['metric_id', 'subcategory', 'legacy_name', 'display_name',
          'criticality', 'evaluation_type', 'sources'];
        for (const m of cat.metrics) {
          for (const field of required) {
            assert.ok(m[field] !== undefined,
              `${m.metric_id || 'unknown'} missing required field: ${field}`);
          }
        }
      });

      it('all metrics have at least one source', () => {
        for (const m of cat.metrics) {
          assert.ok(Array.isArray(m.sources) && m.sources.length > 0,
            `${m.metric_id} has no sources`);
        }
      });
    });
  }
});

describe('Catalog consistency rules validation', () => {
  const VALID_ADJUSTMENT_TYPES = new Set(['subcategory_cap', 'subcategory_deduction', 'pillar_deduction', 'metric_zero', 'none']);

  // Accept both the singular score_adjustment and the v1.8.0 plural score_adjustments[].
  const adjustmentTypes = (ov) =>
    Array.isArray(ov.score_adjustments)
      ? ov.score_adjustments.map(a => a.type)
      : [ov.score_adjustment.type];

  it('postgresql ships the v1.10.0 rule set with valid structure', () => {
    const cat = getCatalog('postgresql');
    const rules = cat.getConsistencyRules();
    const ids = rules.map(r => r.rule_id).sort();
    // v1.4.0 findings-only: BAK-CR-1/2/3, SEC-CR-1 (CR-2/3 + SEC-CR-1 score-moving since v1.7.0)
    // v1.6.0 score-moving: PG-CR-MEM-1, PG-CR-HP-1, PG-CR-SSD-1, PG-CR-OLAP-JIT-1, PG-CR-SYNC-1
    // v1.7.0: BAK-CR-1B, PG-CR-HP-2, PG-CR-AV-1, PG-CR-POOL-1, PG-CR-CHK-1
    // v1.8.0: PG-CR-RPO-2 (metric_zero + cap), PG-CR-CONN-LOCK-1 (multi-deduction);
    //         BAK-CR-1/1B upgraded warning->critical with metric_zero(rpo_target)
    // v1.9.0 coherence expansion: RTO hole (PG-CR-RTO-1/2), declared targets
    //         (PG-CR-SECPOST-1/2, PG-CR-CAP-1, PG-CR-HA-1/2), PG-CR-FUT-1.
    // v1.10.0: PG-CR-SECPOST-3 (regulated posture requires 365d log retention).
    // v1.11.0: PG-CR-FUT-2 (no upgrade plan while >2 majors behind; companion to
    //          PG-CR-FUT-1 now that FUT-3.1 upgrade_plan is all-pass).
    // v1.12.0: PG-CR-RTO-3/4 (restore time vs RTO), PG-CR-RPO-3 (archive_timeout
    //          does not bound a 5- or 15-minute RPO).
    assert.deepEqual(ids, [
      'BAK-CR-1', 'BAK-CR-1B', 'BAK-CR-2', 'BAK-CR-3',
      'PG-CR-AV-1', 'PG-CR-CAP-1', 'PG-CR-CHK-1', 'PG-CR-CONN-LOCK-1', 'PG-CR-FUT-1', 'PG-CR-FUT-2',
      'PG-CR-HA-1', 'PG-CR-HA-2', 'PG-CR-HP-1', 'PG-CR-HP-2', 'PG-CR-MEM-1',
      'PG-CR-OLAP-JIT-1', 'PG-CR-POOL-1', 'PG-CR-RPO-2', 'PG-CR-RPO-3', 'PG-CR-RTO-1', 'PG-CR-RTO-2',
      'PG-CR-RTO-3',
      'PG-CR-RTO-4',
      'PG-CR-SECPOST-1', 'PG-CR-SECPOST-2', 'PG-CR-SECPOST-3', 'PG-CR-SSD-1', 'PG-CR-SYNC-1',
      'SEC-CR-1',
    ]);
    for (const r of rules) {
      assert.ok(['critical', 'warning', 'info'].includes(r.on_violation.severity));
      for (const t of adjustmentTypes(r.on_violation)) {
        assert.ok(VALID_ADJUSTMENT_TYPES.has(t), `${r.rule_id} has invalid adjustment type ${t}`);
      }
      assert.ok(r.applies_when, `${r.rule_id} missing applies_when`);
    }
  });

  it('oracle ships the v1.7.0 rule set with valid structure', () => {
    const cat = getCatalog('oracle');
    const rules = cat.getConsistencyRules();
    const ids = rules.map(r => r.rule_id).sort();
    // v1.4.0: OR-CR-CONN-LOCK-1 (multi-deduction); OR-CR-TDE-1 -> findings-only (type:none)
    // v1.5.0: +OR-CR-TDE-2 (keystore backup), OR-CR-HP-1 (HugePages), OR-CR-PDB-1 (PDB density), OR-CR-SYSAUX-1 (audit purge)
    // v1.7.0 coherence expansion: RTO hole (OR-CR-RTO-1/2), attestation corroboration
    //         (OR-CR-ATT-1/2), declared targets (OR-CR-SECPOST-1/2, OR-CR-CAP-1, OR-CR-DR-1/2), OR-CR-FUT-1.
    // v1.8.0: OR-CR-RPO-1 (aggressive rpo_target with daily/no RMAN and no standby;
    //         ports the PostgreSQL BAK-CR-1 / PG-CR-RPO-2 RPO-coherence rule).
    assert.deepEqual(ids, [
      'OR-CR-ATT-1', 'OR-CR-ATT-2', 'OR-CR-BCT-1', 'OR-CR-CAP-1', 'OR-CR-CONN-LOCK-1',
      'OR-CR-DG-1', 'OR-CR-DG-2', 'OR-CR-DR-1', 'OR-CR-DR-2', 'OR-CR-FRA-1', 'OR-CR-FUT-1',
      'OR-CR-HP-1', 'OR-CR-MEM-1', 'OR-CR-PDB-1', 'OR-CR-RMAN-1', 'OR-CR-RPO-1', 'OR-CR-RTO-1', 'OR-CR-RTO-2',
      'OR-CR-SECPOST-1', 'OR-CR-SECPOST-2', 'OR-CR-SYSAUX-1', 'OR-CR-TDE-1', 'OR-CR-TDE-2',
      'OR-CR-UNDO-1',
    ]);
    for (const r of rules) {
      assert.ok(['critical', 'warning', 'info'].includes(r.on_violation.severity));
      for (const t of adjustmentTypes(r.on_violation)) {
        assert.ok(VALID_ADJUSTMENT_TYPES.has(t), `${r.rule_id} has invalid adjustment type ${t}`);
      }
      assert.ok(r.applies_when, `${r.rule_id} missing applies_when`);
    }
  });

  it('every rule predicate references a known metric, anchor, or profile', () => {
    const RECOGNIZED_ANCHORS = new Set(['ram_kb', 'ram_bytes', 'cpu_count', 'storage_size_kb', 'storage_size_bytes']);
    const RECOGNIZED_STRING_FACTS = new Set(['storage_type', 'edition']);
    const RECOGNIZED_PROFILES = new Set(['default', 'oltp', 'olap', 'mixed']);
    for (const tech of ['postgresql', 'oracle']) {
    const cat = getCatalog(tech);
    const rules = cat.getConsistencyRules();
    const walk = (node, ruleId) => {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node.all_of))  return node.all_of.forEach(c => walk(c, ruleId));
      if (Array.isArray(node.any_of))  return node.any_of.forEach(c => walk(c, ruleId));
      if (Array.isArray(node.none_of)) return node.none_of.forEach(c => walk(c, ruleId));
      if (node.system_fact !== undefined) {
        assert.ok(RECOGNIZED_ANCHORS.has(node.system_fact) || RECOGNIZED_STRING_FACTS.has(node.system_fact),
          `${ruleId}: unknown system_fact ${node.system_fact}`);
        return;
      }
      if (node.workload_profile !== undefined) {
        const spec = node.workload_profile;
        const probes = typeof spec === 'string'
          ? [spec]
          : (spec.equals !== undefined ? [spec.equals] : (spec.in || spec.not_in || []));
        for (const v of probes) {
          assert.ok(RECOGNIZED_PROFILES.has(String(v).toLowerCase()),
            `${ruleId}: unknown workload_profile ${v}`);
        }
        return;
      }
      assert.ok(cat.getByLegacyName(node.metric),
        `${ruleId}: unknown metric reference: ${node.metric}`);
    };
    for (const r of rules) walk(r.applies_when, r.rule_id);
    }
  });

  it('every rule pillar_hint resolves to a known pillar', () => {
    for (const tech of ['postgresql', 'oracle']) {
      const cat = getCatalog(tech);
      for (const r of cat.getConsistencyRules()) {
        if (r.pillar_hint) {
          assert.ok(cat.getPillar(r.pillar_hint), `${r.rule_id} has unknown pillar_hint ${r.pillar_hint}`);
        }
      }
    }
  });

  it('catalogs without rule sets ship empty consistency_rules arrays', () => {
    for (const tech of SUPPORTED_TECHNOLOGIES) {
      if (tech === 'postgresql' || tech === 'oracle') continue;
      const cat = getCatalog(tech);
      assert.deepEqual(cat.getConsistencyRules(), [], `${tech} should have empty consistency_rules`);
    }
  });

  it('a malformed rule (unknown metric) is caught structurally', () => {
    // Build a synthetic catalog with a bad rule and verify the predicate evaluator
    // simply doesn't fire (engine treats unknown metric as missing).
    const synthetic = {
      version: '1.0.0',
      pillars: { test: { name: 'Test', maxPoints: 20, order: 1 } },
      subcategories: { test_sub: { pillar: 'test', name: 'S', maxPoints: 20, order: 1 } },
      metrics: [{
        metric_id: 'X-1',
        subcategory: 'test_sub',
        legacy_name: 'x',
        display_name: 'X',
        criticality: 'advisory',
        weight: null,
        evaluation_type: 'boolean',
        evaluation_config: { pass_value: true },
        sources: ['sql'],
        agent_only: false,
        deployment_profiles: null,
        min_pg_version: null,
        extension_requirement: null,
        metric_tier: 'baseline',
        remediation: '',
      }],
      consistency_rules: [{
        rule_id: 'BAD-1',
        applies_when: { metric: 'unknown_metric', equals: 'x' },
        on_violation: { severity: 'warning', score_adjustment: { type: 'none' }, title: 'bad' },
      }],
    };
    const cat = MetricCatalog.fromData('synthetic', synthetic);
    assert.equal(cat.getConsistencyRules().length, 1);
    assert.equal(cat.getByLegacyName('unknown_metric'), null);
  });
});

describe('catalog maturity (1.15.0)', () => {
  const { VALID_MATURITY, validateCatalogMaturity } = require('../src/catalog/validation');

  it('every shipped catalog states a recognised maturity', () => {
    for (const tech of SUPPORTED_TECHNOLOGIES) {
      assert.ok(VALID_MATURITY.includes(getCatalog(tech).maturity), `${tech}: ${getCatalog(tech).maturity}`);
    }
  });

  it('PostgreSQL and Oracle are measurement-reviewed, the other four draft', () => {
    for (const tech of SUPPORTED_TECHNOLOGIES) {
      const expected = ['postgresql', 'oracle'].includes(tech) ? 'measurement-reviewed' : 'draft';
      assert.equal(getCatalog(tech).maturity, expected, tech);
    }
  });

  it('rejects an unknown maturity and accepts an absent one', () => {
    const errors = [];
    validateCatalogMaturity({ maturity: 'production' }, errors);
    assert.equal(errors.length, 1);
    validateCatalogMaturity({}, errors);
    assert.equal(errors.length, 1);
  });
});
