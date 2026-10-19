/* Score Map — progressive drill-down controller (default view).
 *
 * Renders the scoring model the way it is built: category → sub-category →
 * metrics + the cross-metric rules that link them. Levels 0 and 1 are
 * OpsHub-style score cards; level 2 is a focused cytoscape graph of one
 * sub-category (with "portal" nodes for relations that reach other
 * sub-categories). The "Expert / Full graph" toggle hands off to
 * window.ScoreMapExpert (score-map.js) for the flat, see-everything view.
 *
 * All data is already inlined in window.SCORE_MAP_DATA = { tech, graph, result,
 * values }; this controller never needs a server round-trip except Recalculate.
 * The leaf graph reuses the shared cytoscape style/layout/highlight helpers from
 * score-map-style.js.
 */
(function () {
  var DATA = window.SCORE_MAP_DATA;
  if (!DATA || !window.cytoscape) return;
  var graph = DATA.graph;
  var meta = graph.meta;

  // --- Indexes (built once from the graph) ----------------------------------
  var nodeById = {};
  graph.nodes.forEach(function (n) { nodeById[n.data.id] = n.data; });

  var pillars = meta.pillars;            // [{id, name, color}] in catalog order
  var pillarColorMap = {};
  pillars.forEach(function (p) { pillarColorMap[p.id] = p.color; });

  var subcatsByPillar = {};              // pid -> [{id, name, maxPoints}]
  var subcatPillar = {};                 // sid -> pid
  var subcatName = {};                   // sid -> display name
  var metricsBySubcat = {};              // sid -> [metric node data]
  graph.nodes.forEach(function (n) {
    var d = n.data;
    if (d.kind === 'subcategory') {
      (subcatsByPillar[d.pillarId] = subcatsByPillar[d.pillarId] || []).push({
        id: d.subcatId, name: d.baseLabel || d.label, maxPoints: d.maxPoints,
      });
      subcatPillar[d.subcatId] = d.pillarId;
      subcatName[d.subcatId] = d.baseLabel || d.label;
    } else if (d.kind === 'metric' && !d.ghost) {
      (metricsBySubcat[d.subcatId] = metricsBySubcat[d.subcatId] || []).push(d);
    }
  });

  // rules touching each sub-category (via triggers/affects to its metrics or itself)
  var rulesBySubcat = {};                // sid -> Set(ruleId)
  graph.edges.forEach(function (e) {
    if (e.data.kind !== 'triggers' && e.data.kind !== 'affects') return;
    var ruleId = e.data.kind === 'triggers' ? e.data.target : e.data.source;
    var other = e.data.kind === 'triggers' ? e.data.source : e.data.target;
    if (ruleId.indexOf('r:') !== 0) return;
    var od = nodeById[other];
    if (!od) return;
    var sid = (od.kind === 'metric' || od.kind === 'subcategory') ? od.subcatId : null;
    if (!sid) return;
    (rulesBySubcat[sid] = rulesBySubcat[sid] || {})[ruleId] = true;
  });
  function ruleCountForSubcat(sid) { return rulesBySubcat[sid] ? Object.keys(rulesBySubcat[sid]).length : 0; }
  function metricCountForPillar(pid) {
    var c = 0; (subcatsByPillar[pid] || []).forEach(function (s) { c += (metricsBySubcat[s.id] || []).length; });
    return c;
  }
  function ruleCountForPillar(pid) {
    var set = {};
    (subcatsByPillar[pid] || []).forEach(function (s) {
      if (rulesBySubcat[s.id]) Object.keys(rulesBySubcat[s.id]).forEach(function (r) { set[r] = true; });
    });
    return Object.keys(set).length;
  }
  function pillarName(pid) { for (var i = 0; i < pillars.length; i++) if (pillars[i].id === pid) return pillars[i].name; return pid; }

  // --- View state -----------------------------------------------------------
  var view = { mode: 'drill', level: 0, pillarId: null, subcatId: null, result: DATA.result };
  var leafCy = null;

  // --- DOM refs -------------------------------------------------------------
  var cardsEl = document.getElementById('sm-cards');
  var leafWrapEl = document.getElementById('sm-leaf-wrap');
  var leafEl = document.getElementById('sm-leaf');
  var stageEl = document.getElementById('sm-stage');
  var bcEl = document.getElementById('smBreadcrumb');
  var modeToggle = document.getElementById('smModeToggle');
  var expertTools = document.getElementById('smExpertTools');
  var railEl = document.getElementById('sm-leaf-rail');
  var legendEl = document.getElementById('sm-legend');
  var detailEl = document.getElementById('sm-detail');
  var tipEl = document.getElementById('sm-tip');
  var metricByName = {};       // legacy_name -> { score, maxScore, value, passed, scored, applicable }
  var legendRendered = false;

  // --- Small helpers --------------------------------------------------------
  function show(el, on) { if (!el) return; if (on) el.removeAttribute('hidden'); else el.setAttribute('hidden', ''); }
  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function round2(n) { return Math.round(n * 100) / 100; }
  function clampPct(p) { return Math.max(0, Math.min(100, p)); }
  function statusFromPct(p) { if (p >= 90) return 'excellent'; if (p >= 70) return 'good'; if (p >= 50) return 'needs_improvement'; return 'critical'; }
  function clone(o) { var r = {}; for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) r[k] = o[k]; return r; }

  // --- Navigation -----------------------------------------------------------
  function goOverview() { view.level = 0; view.pillarId = null; view.subcatId = null; render(); }
  function goSubcats(pid) { view.level = 1; view.pillarId = pid; view.subcatId = null; render(); }
  function goLeaf(pid, sid) { view.level = 2; view.pillarId = pid || subcatPillar[sid]; view.subcatId = sid; render(); }

  // --- Cards ----------------------------------------------------------------
  function card(o) {
    var pctTxt = (o.pct == null) ? '—'
      : (o.target === 0) ? 'not required'
        : (o.pct + (o.pctOf === 'max' ? '% of max' : '% of target'));
    var bar = (o.pct == null) ? '' :
      '<div class="sm-bar"><div class="sm-bar-fill" style="width:' + clampPct(o.pct) + '%"></div></div>';
    var pts = (o.score != null && o.maxScore != null) ? (round2(o.score) + '/' + o.maxScore + ' pts') : '';
    return '<button type="button" class="sm-card sm-st-' + (o.status || 'na') + '" ' + o.dataAttr +
      ' style="--accent:' + (o.accent || '#3b82f6') + '">' +
      '<span class="sm-card-accent"></span>' +
      '<div class="sm-card-head"><span class="sm-card-title">' + esc(o.title) + '</span>' +
      '<span class="sm-card-score">' + pctTxt + '</span></div>' +
      bar +
      '<div class="sm-card-meta"><span class="sm-card-pts">' + pts + '</span>' +
      '<span class="sm-card-counts">' + esc(o.counts) + '</span></div>' +
      '</button>';
  }

  function renderPillarCards() {
    var pr = view.result.pillars || {};
    cardsEl.innerHTML = pillars.map(function (p) {
      var r = pr[p.id] || {};
      // 1.16.0: the share of the target reached, the number the status colour follows.
      var pct = (r.targetAttainment != null) ? r.targetAttainment
        : (r.percentage != null) ? r.percentage : (r.maxScore > 0 ? Math.round((r.score / r.maxScore) * 100) : null);
      return card({
        dataAttr: 'data-pillar="' + esc(p.id) + '"',
        title: p.name, pct: pct, status: r.status || (pct == null ? 'na' : statusFromPct(pct)),
        target: r.target, pctOf: r.targetAttainment != null ? 'target' : 'max',
        score: r.score, maxScore: r.maxScore,
        counts: metricCountForPillar(p.id) + ' metrics · ' + ruleCountForPillar(p.id) + ' rules',
        accent: pillarColorMap[p.id],
      });
    }).join('');
  }

  function renderSubcatCards() {
    var pid = view.pillarId;
    var subs = subcatsByPillar[pid] || [];
    var sr = view.result.subcategories || {};
    cardsEl.innerHTML = subs.map(function (s) {
      var r = sr[s.id] || {};
      var has = (r.percentage != null) || (r.maxScore > 0);
      // 1.16.0: the share of the target reached, the number the status colour follows.
      var pct = (r.targetAttainment != null) ? r.targetAttainment
        : (r.percentage != null) ? r.percentage : (r.maxScore > 0 ? Math.round((r.score / r.maxScore) * 100) : null);
      return card({
        dataAttr: 'data-subcat="' + esc(s.id) + '"',
        title: s.name, pct: has ? pct : null, status: has ? (r.status || statusFromPct(pct)) : 'na',
        target: r.target, pctOf: r.targetAttainment != null ? 'target' : 'max',
        score: r.score, maxScore: (r.maxScore != null ? r.maxScore : s.maxPoints),
        counts: (metricsBySubcat[s.id] || []).length + ' metrics · ' + ruleCountForSubcat(s.id) + ' rules',
        accent: pillarColorMap[pid],
      });
    }).join('');
  }

  // --- Leaf graph (one sub-category + cross-metric relations) ---------------
  function buildLeafElements(sid) {
    var sNodeId = 's:' + sid;
    var inScope = {};
    if (nodeById[sNodeId]) inScope[sNodeId] = true;
    (metricsBySubcat[sid] || []).forEach(function (m) { inScope['m:' + m.legacyName] = true; });

    // rules wired to in-scope metrics or to the sub-category node
    graph.edges.forEach(function (e) {
      if (e.data.kind !== 'triggers' && e.data.kind !== 'affects') return;
      var ruleId = e.data.kind === 'triggers' ? e.data.target : e.data.source;
      var other = e.data.kind === 'triggers' ? e.data.source : e.data.target;
      if (ruleId.indexOf('r:') === 0 && inScope[other]) inScope[ruleId] = true;
    });
    // pull in connected source nodes (facts / workload) — they have no sub-category
    graph.edges.forEach(function (e) {
      [[e.data.source, e.data.target], [e.data.target, e.data.source]].forEach(function (pair) {
        var d = nodeById[pair[0]];
        if (d && (d.kind === 'systemfact' || d.kind === 'workload') && inScope[pair[1]]) inScope[pair[0]] = true;
      });
    });

    var nodes = [], edges = [], portalAdded = {};
    graph.nodes.forEach(function (n) { if (inScope[n.data.id]) nodes.push({ data: clone(n.data), classes: n.classes }); });

    function portalFor(extId) {
      var pid = 'portal:' + extId;
      if (portalAdded[pid]) return pid;
      portalAdded[pid] = true;
      var od = nodeById[extId] || {};
      var tSub = od.subcatId || null;
      var tPil = od.pillarId || (tSub ? subcatPillar[tSub] : null) || null;
      nodes.push({
        data: {
          id: pid, kind: 'portal', label: (od.baseLabel || od.label || extId) + '  ↗',
          targetId: extId, targetKind: od.kind || null, targetSubcat: tSub, targetPillar: tPil,
        },
        classes: 'portal portal-' + (od.kind || 'node'),
      });
      return pid;
    }
    function resolve(id) {
      if (inScope[id]) return id;
      var d = nodeById[id];
      if (!d) return null;
      if (d.kind === 'metric' || d.kind === 'subcategory') return portalFor(id);
      return null; // pillar / out-of-model endpoint → drop the crossing edge
    }

    graph.edges.forEach(function (e) {
      var s = e.data.source, t = e.data.target;
      if (!inScope[s] && !inScope[t]) return;       // edge entirely outside the leaf
      var rs = resolve(s), rt = resolve(t);
      if (rs === null || rt === null || rs === rt) return;
      var d = clone(e.data); d.source = rs; d.target = rt;
      edges.push({ data: d, classes: e.classes });
    });
    return { nodes: nodes, edges: edges };
  }

  function destroyLeaf() { if (leafCy) { leafCy.destroy(); leafCy = null; } }
  function applyLeafHighlight() { if (leafCy) window.scoreMapApplyHighlight(leafCy, window.scoreMapHighlightFromResult(view.result)); }

  // --- Plain-language explanations (legend + hover tooltip + pinned detail) --
  function nodeLabelOf(id) { var d = nodeById[id]; return d ? (d.baseLabel || d.label || id) : id; }
  function ruleFired(ruleId) { return (view.result.firedRules || []).indexOf(ruleId) >= 0; }
  function rulesForMetric(metricNodeId) {
    var out = [];
    graph.edges.forEach(function (e) {
      if (e.data.kind !== 'triggers' || e.data.source !== metricNodeId) return;
      var rd = nodeById[e.data.target];
      if (rd && rd.kind === 'rule') out.push(rd);
    });
    return out;
  }
  function effectsOfRule(ruleNodeId) {
    var out = [];
    graph.edges.forEach(function (e) {
      if (e.data.kind !== 'affects' || e.data.source !== ruleNodeId) return;
      var t = nodeLabelOf(e.data.target);
      if (e.data.effect === 'zero') out.push('zeroes ' + t);
      else if (e.data.effect === 'cap') out.push('caps ' + t + ' (' + (e.data.label || 'cap') + ')');
      else if (e.data.effect === 'deduct' || e.data.effect === 'pillar_deduct') out.push('deducts ' + (e.data.label || '') + ' from ' + t);
      else out.push('affects ' + t);
    });
    return out;
  }
  function statusWord(mr) {
    if (!mr) return '';
    if (mr.applicable === false) return 'Not applicable';
    if (mr.passed) return 'Passed';
    if (mr.scored && mr.score > 0) return 'Partial credit';
    return 'Failed';
  }
  function statusClassOf(mr) {
    if (!mr) return 'na';
    if (mr.applicable === false) return 'na';
    if (mr.passed) return 'excellent';
    return (mr.score > 0) ? 'needs_improvement' : 'critical';
  }
  function ptsText(mr) { return (mr && mr.maxScore != null) ? (round2(mr.score || 0) + '/' + mr.maxScore + ' pts') : ''; }
  function valText(d, mr) {
    var v = (mr && mr.value !== undefined && mr.value !== null) ? mr.value
      : (DATA.values && DATA.values[d.legacyName] !== undefined ? DATA.values[d.legacyName] : undefined);
    return (v === undefined || v === '') ? '(not provided)' : String(v);
  }
  function ptsSpan(mr) { return '<span class="sm-pts sm-st-' + statusClassOf(mr) + '">' + esc(ptsText(mr)) + (statusWord(mr) ? ' · ' + esc(statusWord(mr)) : '') + '</span>'; }

  function explainMetric(d) {
    var mr = metricByName[d.legacyName];
    var sub = (view.result.subcategories || {})[view.subcatId] || {};
    var subName = subcatName[view.subcatId] || view.subcatId;
    var head = '<b>' + esc(d.label) + '</b>' + (d.derived ? ' <span class="badge badge-derived">Derived</span>' : '');
    var notApplicable = mr && mr.applicable === false;

    var short = head + '<br>' + (notApplicable ? '<span class="text-muted">Not applicable here</span>' : (ptsSpan(mr) + '<br>Currently: <code>' + esc(valText(d, mr)) + '</code>'));

    var full = '<h3>' + head + '</h3><p><code>' + esc(d.metricId || '') + '</code> · ' + ptsSpan(mr) + '</p>';
    if (notApplicable) {
      full += '<p>Not evaluated in this scenario — its applicability condition isn’t met, so <b>0 points are at stake</b>.</p>';
      return { short: short, full: full };
    }
    full += '<p>Currently: <code>' + esc(valText(d, mr)) + '</code></p>';
    if (d.description) full += '<p>' + esc(d.description) + '</p>';
    if (d.criticality === 'critical') {
      var line = 'Critical check — if it fails, <b>' + esc(subName) + '</b> is capped at <b>60%</b> of its points.';
      if (mr && !mr.passed && sub.hasCriticalFailure) line += ' That cap is <b>active now</b>: ' + esc(subName) + ' = ' + round2(sub.score) + '/' + sub.maxScore + ' pts.';
      full += '<p>' + line + '</p>';
    } else {
      full += '<p>' + (d.criticality === 'important' ? 'Important' : 'Advisory') + ' check' + (mr && mr.maxScore != null ? ' (weight ' + mr.maxScore + ').' : '.') + '</p>';
    }
    var rules = rulesForMetric('m:' + d.legacyName);
    if (rules.length) {
      full += '<p><b>Related rules</b></p><ul class="sm-rules">' + rules.map(function (rd) {
        return '<li>' + (ruleFired(rd.ruleId) ? '⚡ <b>Fires</b> ' : 'Involved in ') + '<code>' + esc(rd.ruleId) + '</code>: ' + esc(rd.title || '') + '</li>';
      }).join('') + '</ul>';
    }
    if (mr && !mr.passed && d.remediation) full += '<p class="finding-remediation"><b>Fix:</b> ' + esc(d.remediation) + '</p>';
    return { short: short, full: full };
  }

  function explainSubcat(d) {
    var sub = (view.result.subcategories || {})[d.subcatId] || {};
    var name = d.baseLabel || d.label;
    var line = (sub.score != null) ? (round2(sub.score) + '/' + sub.maxScore + ' pts' + (sub.target != null ? ', target ' + round2(sub.target) + ' (' + sub.targetAttainment + '% reached)' : ' (' + sub.percentage + '%)')) : (d.maxPoints + ' pts max');
    var span = '<span class="sm-pts sm-st-' + (sub.status || 'na') + '">' + esc(line) + '</span>';
    var full = '<h3><b>' + esc(name) + '</b></h3><p>' + span + '</p><p class="text-muted">Every check in this view rolls up into this sub-category score.</p>';
    if (sub.hasCriticalFailure) {
      var failed = [];
      (metricsBySubcat[d.subcatId] || []).forEach(function (m) {
        var mr = metricByName[m.legacyName];
        if (m.criticality === 'critical' && mr && mr.applicable !== false && !mr.passed) failed.push(m.label);
      });
      full += '<p><b>Capped at 60%</b> because a critical check failed' + (failed.length ? ': ' + esc(failed.join(', ')) : '') + '.</p>';
    }
    return { short: '<b>' + esc(name) + '</b><br>' + span, full: full };
  }

  function explainRule(d) {
    var fired = ruleFired(d.ruleId);
    var head = '<b>' + esc(d.ruleId) + '</b> <span class="rule-severity rule-sev-' + esc(d.severity === 'warning' ? 'warning' : d.severity) + '">' + esc(d.severity) + '</span>';
    var firedSpan = fired ? '<span class="sm-st-critical"><b>Firing now</b></span>' : '<span class="text-muted">Not firing</span>';
    var full = '<h3>' + head + '</h3><p>' + esc(d.title || '') + ' · ' + firedSpan + '</p>';
    full += '<p><b>Fires when:</b> ' + esc(d.appliesWhen || '') + '</p>';
    var eff = effectsOfRule('r:' + d.ruleId);
    if (eff.length) full += '<p><b>When it fires it:</b> ' + esc(eff.join('; ')) + '.</p>';
    if (d.tags && d.tags.length) full += '<p class="text-muted">tags: ' + esc(d.tags.join(', ')) + '</p>';
    return { short: head + '<br>' + esc(d.title || '') + '<br>' + firedSpan, full: full };
  }

  function explainPortal(d) {
    var name = (d.label || '').replace(/\s*↗\s*$/, '');
    var where = d.targetSubcat ? (subcatName[d.targetSubcat] || d.targetSubcat) : (d.targetPillar ? pillarName(d.targetPillar) : '');
    var pil = d.targetPillar ? pillarName(d.targetPillar) : '';
    var loc = where + (pil && pil !== where ? ' (' + pil + ')' : '');
    return {
      short: '<b>' + esc(name) + '</b><br>in ' + esc(loc) + '<br><span class="text-muted">click to jump ↗</span>',
      full: '<h3>' + esc(name) + ' ↗</h3><p>This metric/rule lives in <b>' + esc(loc) + '</b> and relates to something in this view. <b>Click</b> it to open that sub-category.</p>',
    };
  }

  function explainNode(d) {
    if (!d) return { short: '', full: '' };
    if (d.kind === 'metric') return explainMetric(d);
    if (d.kind === 'rule') return explainRule(d);
    if (d.kind === 'portal') return explainPortal(d);
    if (d.kind === 'subcategory') return explainSubcat(d);
    if (d.kind === 'systemfact' || d.kind === 'workload') return { short: '<b>' + esc(d.label) + '</b><br><span class="text-muted">input signal</span>', full: '<h3>' + esc(d.label) + '</h3><p class="text-muted">A system input used by rules or derived metrics in this view.</p>' };
    return { short: '<b>' + esc(d.label) + '</b>', full: '<h3>' + esc(d.label) + '</h3>' };
  }

  function renderLegend() {
    if (legendRendered || !legendEl) return;
    legendRendered = true;
    legendEl.innerHTML =
      '<h4>Nodes</h4><div class="map-legend">' +
        '<div><span class="lg-node lg-metric"></span> metric (fill = category)</div>' +
        '<div><span class="lg-node lg-derived"></span> derived (computed)</div>' +
        '<div><span class="lg-node lg-rule"></span> rule (fill = severity)</div>' +
        '<div><span class="lg-node lg-portal"></span> portal ↗ — jump to a related sub-category</div>' +
        '<div><span class="lg-node lg-sub"></span> this sub-category (the roll-up)</div>' +
      '</div>' +
      '<h4>Live state (borders)</h4><div class="map-legend">' +
        '<div><span class="lg-node lg-b-failed"></span> failed check</div>' +
        '<div><span class="lg-node lg-b-fired"></span> fired rule / involved</div>' +
        '<div><span class="lg-node lg-b-pass"></span> passed check</div>' +
        '<div><span class="lg-node lg-b-dim"></span> not applicable (dimmed)</div>' +
      '</div>' +
      '<h4>Links</h4><div class="map-legend">' +
        '<div><span class="lg-line lg-triggers"></span> triggers a rule</div>' +
        '<div><span class="lg-line lg-affects"></span> rule changes score (zero / −pts / cap)</div>' +
        '<div><span class="lg-line lg-derives"></span> derived from</div>' +
        '<div><span class="lg-line lg-gates"></span> applies-when gate</div>' +
        '<div><span class="lg-line lg-rollup"></span> rolls up to sub-category</div>' +
        '<div><span class="lg-line lg-critgate"></span> critical 60% gate</div>' +
      '</div>';
  }

  function resetDetail() { if (detailEl) detailEl.innerHTML = '<p class="text-muted">Hover a node for a quick read; click it to pin the full explanation here.</p>'; }
  function hideTip() { if (tipEl) tipEl.hidden = true; }
  function showTip(node) {
    if (!tipEl) return;
    var ex = explainNode(node.data());
    if (!ex.short) { hideTip(); return; }
    tipEl.innerHTML = ex.short;
    tipEl.hidden = false;
    var rp = node.renderedPosition();
    var parent = tipEl.offsetParent;
    var maxW = parent ? parent.clientWidth : 9999;
    var maxH = parent ? parent.clientHeight : 9999;
    var x = rp.x + 16, y = rp.y + 16;
    if (x + tipEl.offsetWidth > maxW - 8) x = Math.max(8, rp.x - tipEl.offsetWidth - 16);
    if (y + tipEl.offsetHeight > maxH - 8) y = Math.max(8, maxH - tipEl.offsetHeight - 8);
    tipEl.style.left = Math.max(8, x) + 'px';
    tipEl.style.top = Math.max(8, y) + 'px';
  }

  function buildLeaf(sid) {
    destroyLeaf();
    metricByName = {};
    (view.result.metrics || []).forEach(function (m) { metricByName[m.name] = m; });
    if (window.cytoscapeDagre && !window.__cyDagreUsed) { cytoscape.use(window.cytoscapeDagre); window.__cyDagreUsed = true; }
    var els = buildLeafElements(sid);
    leafCy = cytoscape({
      container: leafEl,
      elements: { nodes: els.nodes, edges: els.edges },
      style: window.SCORE_MAP_STYLE_DARK,
      wheelSensitivity: 0.25, minZoom: 0.1, maxZoom: 3,
    });
    leafCy.layout(window.SCORE_MAP_LAYOUT).run();
    leafCy.resize();
    leafCy.fit(undefined, 36);
    applyLeafHighlight();

    leafCy.on('tap', 'node.portal', function (evt) {
      var d = evt.target.data();
      if (d.targetSubcat) goLeaf(d.targetPillar, d.targetSubcat);
      else if (d.targetPillar) goSubcats(d.targetPillar);
    });
    leafCy.on('tap', 'node', function (evt) {
      if (evt.target.hasClass('portal')) return;
      leafCy.elements().addClass('faded');
      evt.target.closedNeighborhood().removeClass('faded');
      var ex = explainNode(evt.target.data());
      if (detailEl && ex.full) detailEl.innerHTML = ex.full;
    });
    leafCy.on('tap', function (evt) { if (evt.target === leafCy) { leafCy.elements().removeClass('faded'); resetDetail(); } });
    leafCy.on('mouseover', 'node', function (evt) { showTip(evt.target); });
    leafCy.on('mouseout', 'node', hideTip);
    leafCy.on('pan zoom', hideTip);
  }

  // --- Breadcrumb -----------------------------------------------------------
  function renderBreadcrumb() {
    show(bcEl, true);
    if (view.mode === 'expert') { bcEl.innerHTML = '<span class="sm-bc-cur">Expert · full graph</span>'; return; }
    var parts = ['<a href="#" data-go="0" class="sm-bc-link">All categories</a>'];
    if (view.level >= 1 && view.pillarId) {
      parts.push(view.level === 1
        ? '<span class="sm-bc-cur">' + esc(pillarName(view.pillarId)) + '</span>'
        : '<a href="#" data-go="1" class="sm-bc-link">' + esc(pillarName(view.pillarId)) + '</a>');
    }
    if (view.level >= 2 && view.subcatId) parts.push('<span class="sm-bc-cur">' + esc(subcatName[view.subcatId] || view.subcatId) + '</span>');
    bcEl.innerHTML = parts.join('<span class="sm-bc-sep">›</span>');
  }

  // --- Render dispatch ------------------------------------------------------
  function render() {
    renderBreadcrumb();
    if (view.mode === 'expert') return;
    if (view.level === 2) {
      show(cardsEl, false); show(stageEl, false); show(leafWrapEl, true);
      renderLegend();
      resetDetail();
      buildLeaf(view.subcatId);
    } else {
      destroyLeaf();
      show(leafWrapEl, false); show(stageEl, false); show(cardsEl, true);
      if (view.level === 0) renderPillarCards(); else renderSubcatCards();
    }
  }

  // --- Mode toggle (drill ⇄ expert) -----------------------------------------
  function setMode(mode) {
    view.mode = mode;
    if (mode === 'expert') {
      destroyLeaf();
      show(cardsEl, false); show(leafWrapEl, false); show(stageEl, true); show(expertTools, true);
      window.ScoreMapExpert.init();
      if (window._scoreMapCy) { window._scoreMapCy.resize(); window._scoreMapCy.fit(window._scoreMapCy.elements(':visible'), 30); }
      renderBreadcrumb();
    } else {
      show(stageEl, false); show(expertTools, false);
      render();
    }
  }

  // --- Recalculate (shared toolbar) -----------------------------------------
  function gatherContext() {
    var sf = {};
    var ram = document.getElementById('sysRamGb'), cpu = document.getElementById('sysCpu'), sto = document.getElementById('sysStorageGb');
    if (ram && ram.value !== '') { var r = parseFloat(ram.value); if (!isNaN(r) && r > 0) sf.ram_kb = r * 1024 * 1024; }
    if (cpu && cpu.value !== '') { var c = parseFloat(cpu.value); if (!isNaN(c) && c > 0) sf.cpu_count = c; }
    if (sto && sto.value !== '') { var s = parseFloat(sto.value); if (!isNaN(s) && s > 0) sf.storage_size_kb = s * 1024 * 1024; }
    var prof = document.getElementById('workloadProfile');
    return { values: DATA.values || {}, systemFacts: sf, workloadProfile: prof ? prof.value : 'mixed' };
  }
  function recalc() {
    fetch('/simulate/' + DATA.tech + '/calculate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(gatherContext()),
    })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        view.result = data;
        if (view.mode === 'expert') { if (window.ScoreMapExpert) window.ScoreMapExpert.applyResult(data); }
        else { render(); }
      })
      .catch(function () {});
  }

  // --- Wire controls --------------------------------------------------------
  if (cardsEl) cardsEl.addEventListener('click', function (e) {
    var el = e.target.closest && e.target.closest('.sm-card');
    if (!el) return;
    if (el.hasAttribute('data-pillar')) goSubcats(el.getAttribute('data-pillar'));
    else if (el.hasAttribute('data-subcat')) goLeaf(view.pillarId, el.getAttribute('data-subcat'));
  });
  if (bcEl) bcEl.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('[data-go]');
    if (!a) return;
    e.preventDefault();
    var lvl = parseInt(a.getAttribute('data-go'), 10);
    if (lvl === 0) goOverview(); else if (lvl === 1) goSubcats(view.pillarId);
  });
  if (modeToggle) modeToggle.addEventListener('change', function () { setMode(modeToggle.checked ? 'expert' : 'drill'); });
  var recalcBtn = document.getElementById('mapRecalc'); if (recalcBtn) recalcBtn.addEventListener('click', recalc);
  document.querySelectorAll('.context-input').forEach(function (el) { el.addEventListener('change', recalc); });

  // Responsive: re-fit the leaf graph when the window is resized (debounced).
  // No fullscreen mode — the view fills the page and adapts to the window size.
  var _resizeTimer = null;
  window.addEventListener('resize', function () {
    if (_resizeTimer) clearTimeout(_resizeTimer);
    _resizeTimer = setTimeout(function () {
      if (leafCy) { leafCy.resize(); leafCy.fit(undefined, 36); }
      if (window._scoreMapCy) window._scoreMapCy.resize();
    }, 150);
  });
  // Legend-rail toggle for the leaf graph
  var railToggleBtn = document.getElementById('smLeafRailToggle');
  if (railToggleBtn) railToggleBtn.addEventListener('click', function () {
    if (!railEl) return;
    if (railEl.hasAttribute('hidden')) { railEl.removeAttribute('hidden'); railToggleBtn.textContent = 'Hide legend'; }
    else { railEl.setAttribute('hidden', ''); railToggleBtn.textContent = 'Show legend'; }
    if (leafCy) { leafCy.resize(); leafCy.fit(undefined, 36); }
  });

  // --- First paint ----------------------------------------------------------
  render();
})();
