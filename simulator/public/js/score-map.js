/* Score Map — Expert (flat full-graph) controller.
 *
 * This is the "see everything" view: the whole dependency-flow graph
 * (metrics → rules → score) with the filter sidebar, focus mode, and exports.
 * It is NO LONGER the default — score-map-drill.js renders the progressive
 * drill-down and lazily flips here when the user toggles "Expert / Full graph".
 *
 * Exposes window.ScoreMapExpert = { init(), applyResult(result) }:
 *   init()         build the flat cytoscape on #cy + wire the sidebar/exports (once).
 *   applyResult(r) re-apply live highlight from a /calculate response.
 * The shared toolbar (scenario / context inputs / Recalculate / Expert toggle)
 * is owned by score-map-drill.js, which calls applyResult() when in Expert mode.
 *
 * Styling/layout/highlight live in score-map-style.js (shared with the export).
 */
(function () {
  var DATA = window.SCORE_MAP_DATA;
  if (!DATA || !window.cytoscape) return;

  var api = { init: initExpert, applyResult: function () {} };
  window.ScoreMapExpert = api;
  var _inited = false;

  function initExpert() {
    if (_inited) return; // build once; the flat graph then persists (hidden in drill)
    _inited = true;

    if (window.cytoscapeDagre && !window.__cyDagreUsed) {
      cytoscape.use(window.cytoscapeDagre);
      window.__cyDagreUsed = true;
    }

    var cy = cytoscape({
      container: document.getElementById('cy'),
      elements: { nodes: DATA.graph.nodes, edges: DATA.graph.edges },
      style: window.SCORE_MAP_STYLE,
      wheelSensitivity: 0.25,
      minZoom: 0.1,
      maxZoom: 3,
    });
    window._scoreMapCy = cy;

    // --- Filter state -------------------------------------------------------
    var state = {
      full: false,
      crossOnly: false,
      pillars: new Set(DATA.graph.meta.pillars.map(function (p) { return p.id; })),
      sources: new Set(DATA.graph.meta.sources),
      edgeTypes: new Set(['derives', 'triggers', 'affects', 'gates', 'rolls_up']),
    };

    function pillarOK(n) {
      if (n.hasClass('rule')) {
        var ps = n.data('pillars') || [];
        return ps.length === 0 || ps.some(function (p) { return state.pillars.has(p); });
      }
      var pid = n.data('pillarId');
      if (!pid) return true; // facts / workload / ghost
      return state.pillars.has(pid);
    }
    function sourceOK(n) {
      if (!n.hasClass('metric')) return true;
      var src = n.data('sources') || [];
      if (src.length === 0) return true; // derived / ghost
      return src.some(function (s) { return state.sources.has(s); });
    }
    function ruleAllowed(n) {
      if (!n.hasClass('rule')) return true;
      return !(state.crossOnly && !n.data('crossCategory'));
    }

    function recomputeVisibility() {
      var baseAllowed = new Set();
      cy.nodes().forEach(function (n) {
        if (pillarOK(n) && sourceOK(n) && ruleAllowed(n)) baseAllowed.add(n.id());
      });

      var visNodes = new Set();
      var visEdges = new Set();

      // Overlay edges (the cross-metric wiring) drive the rule-centric view.
      cy.edges().forEach(function (e) {
        var k = e.data('kind');
        if (k === 'rolls_up') return;
        if (!state.edgeTypes.has(k)) return;
        var s = e.source(), t = e.target();
        if (!baseAllowed.has(s.id()) || !baseAllowed.has(t.id())) return;
        visEdges.add(e.id());
        visNodes.add(s.id());
        visNodes.add(t.id());
      });

      // Full graph: also show every base-allowed metric/subcategory/pillar.
      if (state.full) {
        cy.nodes().forEach(function (n) {
          if (!baseAllowed.has(n.id())) return;
          var kind = n.data('kind');
          if (kind === 'metric' || kind === 'subcategory' || kind === 'pillar') visNodes.add(n.id());
        });
      }

      // Reveal the rolls-up backbone (metric → subcategory → pillar) for visible
      // nodes so every shown metric reads through to where its score lands.
      if (state.edgeTypes.has('rolls_up')) {
        cy.edges('.rolls-up').forEach(function (e) {
          var s = e.source(), t = e.target();
          if (!visNodes.has(s.id())) return;
          if (!baseAllowed.has(t.id())) return;
          visEdges.add(e.id());
          visNodes.add(t.id());
        });
        // second hop: subcategory → pillar for subcats just revealed above
        cy.edges('.rolls-up').forEach(function (e) {
          var s = e.source(), t = e.target();
          if (s.data('kind') === 'subcategory' && visNodes.has(s.id())) {
            visEdges.add(e.id());
            visNodes.add(t.id());
          }
        });
      }

      cy.batch(function () {
        cy.nodes().forEach(function (n) { n.toggleClass('hidden', !visNodes.has(n.id())); });
        cy.edges().forEach(function (e) { e.toggleClass('hidden', !visEdges.has(e.id())); });
      });
      updateVisibleCount(visNodes.size, visEdges.size);
    }

    function relayout() {
      var vis = cy.elements(':visible');
      var lay = (vis.length ? vis : cy.elements()).layout(window.SCORE_MAP_LAYOUT);
      lay.run();
    }

    function rerender() {
      recomputeVisibility();
      relayout();
    }

    // --- Live highlight -----------------------------------------------------
    function applyResult(result) {
      var hl = window.scoreMapHighlightFromResult(result);
      window.scoreMapApplyHighlight(cy, hl);
    }
    if (DATA.result) applyResult(DATA.result);

    function gatherContext() {
      var systemFacts = {};
      var ram = document.getElementById('sysRamGb');
      var cpu = document.getElementById('sysCpu');
      var sto = document.getElementById('sysStorageGb');
      if (ram && ram.value !== '') { var r = parseFloat(ram.value); if (!isNaN(r) && r > 0) systemFacts.ram_kb = r * 1024 * 1024; }
      if (cpu && cpu.value !== '') { var c = parseFloat(cpu.value); if (!isNaN(c) && c > 0) systemFacts.cpu_count = c; }
      if (sto && sto.value !== '') { var s = parseFloat(sto.value); if (!isNaN(s) && s > 0) systemFacts.storage_size_kb = s * 1024 * 1024; }
      var prof = document.getElementById('workloadProfile');
      return { values: DATA.values || {}, systemFacts: systemFacts, workloadProfile: prof ? prof.value : 'mixed' };
    }

    // --- Node detail panel --------------------------------------------------
    function esc(v) { return String(v == null ? '' : v).replace(/[&<>]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]; }); }
    function showDetail(n) {
      var el = document.getElementById('mapDetail');
      if (!el) return;
      var d = n.data();
      var html = '';
      if (d.kind === 'metric') {
        html = '<h3>' + esc(d.label) + (d.derived ? ' <span class="badge badge-derived">Derived</span>' : '') + '</h3>' +
          '<p><code>' + esc(d.metricId || '') + '</code> · <code>' + esc(d.legacyName) + '</code></p>' +
          '<p><span class="badge badge-' + esc(d.criticality) + '">' + esc(d.criticality) + '</span> ' +
          (d.sources || []).map(function (s) { return '<span class="badge badge-source badge-source-' + esc(s) + '">' + esc(s) + '</span>'; }).join(' ') + '</p>' +
          (d.gateScope ? '<p>Gate scope: <code>' + esc(d.gateScope) + '</code></p>' : '') +
          (d.description ? '<p>' + esc(d.description) + '</p>' : '') +
          (d.remediation ? '<p class="finding-remediation">' + esc(d.remediation) + '</p>' : '');
      } else if (d.kind === 'rule') {
        html = '<h3>' + esc(d.ruleId) + ' <span class="rule-severity rule-sev-' + esc(d.severity === 'warning' ? 'warning' : d.severity) + '">' + esc(d.severity) + '</span></h3>' +
          '<p>' + esc(d.title) + '</p>' +
          (d.crossCategory ? '<p><span class="badge badge-rule">cross-category</span></p>' : '') +
          '<p><strong>Fires when:</strong> ' + esc(d.appliesWhen) + '</p>' +
          ((d.tags && d.tags.length) ? '<p class="text-muted">tags: ' + esc(d.tags.join(', ')) + '</p>' : '');
      } else if (d.kind === 'subcategory' || d.kind === 'pillar') {
        html = '<h3>' + esc(d.baseLabel || d.label) + '</h3><p>' + esc(d.kind) + ' · max ' + esc(d.maxPoints) + ' pts</p>';
      } else {
        html = '<h3>' + esc(d.label) + '</h3><p>' + esc(d.kind) + '</p>';
      }
      el.innerHTML = html;
      el.style.display = 'block';
    }
    function hideDetail() { var el = document.getElementById('mapDetail'); if (el) el.style.display = 'none'; }

    // --- Focus mode ---------------------------------------------------------
    cy.on('tap', 'node', function (evt) {
      var n = evt.target;
      showDetail(n);
      var keep = n.closedNeighborhood();
      cy.elements(':visible').addClass('faded');
      keep.removeClass('faded');
    });
    cy.on('tap', function (evt) {
      if (evt.target === cy) {
        cy.elements().removeClass('faded');
        hideDetail();
      }
    });

    // --- Counters -----------------------------------------------------------
    function updateVisibleCount(nNodes, nEdges) {
      var el = document.getElementById('mapCount');
      if (el) el.textContent = nNodes + ' nodes · ' + nEdges + ' links';
    }

    // --- Exports ------------------------------------------------------------
    function download(blob, filename) {
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url; a.download = filename;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }
    function exportPng() {
      var png = cy.png({ full: true, scale: 2, bg: '#ffffff' });
      fetch(png).then(function (r) { return r.blob(); }).then(function (b) {
        download(b, 'score-map-' + DATA.tech + '.png');
      });
    }
    function exportHtml() {
      var ctx = gatherContext();
      ctx.scenario = (document.getElementById('scenarioSelect') || {}).value || '';
      fetch('/score-map/' + DATA.tech + '/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(ctx),
      })
        .then(function (r) { return r.blob(); })
        .then(function (b) { download(b, 'score-map-' + DATA.tech + '.html'); })
        .catch(function () { alert('Export failed — is the simulator running with dependencies installed?'); });
    }

    // --- Wire sidebar + expert-only toolbar buttons (recalc/context owned by drill)
    function bindCheckbox(id, fn) { var el = document.getElementById(id); if (el) el.addEventListener('change', function () { fn(el.checked); rerender(); }); }

    bindCheckbox('toggleFull', function (v) { state.full = v; });
    bindCheckbox('toggleCrossOnly', function (v) { state.crossOnly = v; });
    ['derives', 'triggers', 'affects', 'gates', 'rolls_up', 'crit_gate'].forEach(function (k) {
      var el = document.getElementById('edge_' + k);
      if (el) el.addEventListener('change', function () {
        if (el.checked) state.edgeTypes.add(k); else state.edgeTypes.delete(k);
        rerender();
      });
    });
    document.querySelectorAll('.pillar-filter').forEach(function (el) {
      el.addEventListener('change', function () {
        if (el.checked) state.pillars.add(el.value); else state.pillars.delete(el.value);
        rerender();
      });
    });
    document.querySelectorAll('.source-filter').forEach(function (el) {
      el.addEventListener('change', function () {
        if (el.checked) state.sources.add(el.value); else state.sources.delete(el.value);
        rerender();
      });
    });

    var fitBtn = document.getElementById('mapFit'); if (fitBtn) fitBtn.addEventListener('click', function () { cy.fit(cy.elements(':visible'), 30); });
    var resetBtn = document.getElementById('mapReset'); if (resetBtn) resetBtn.addEventListener('click', function () {
      state.full = false; state.crossOnly = false;
      state.pillars = new Set(DATA.graph.meta.pillars.map(function (p) { return p.id; }));
      state.sources = new Set(DATA.graph.meta.sources);
      state.edgeTypes = new Set(['derives', 'triggers', 'affects', 'gates', 'rolls_up']);
      document.querySelectorAll('.pillar-filter, .source-filter').forEach(function (el) { el.checked = true; });
      ['derives', 'triggers', 'affects', 'gates', 'rolls_up'].forEach(function (k) { var el = document.getElementById('edge_' + k); if (el) el.checked = true; });
      var cg = document.getElementById('edge_crit_gate'); if (cg) cg.checked = false;
      var tf = document.getElementById('toggleFull'); if (tf) tf.checked = false;
      var tc = document.getElementById('toggleCrossOnly'); if (tc) tc.checked = false;
      rerender();
    });
    var pngBtn = document.getElementById('mapExportPng'); if (pngBtn) pngBtn.addEventListener('click', exportPng);
    var htmlBtn = document.getElementById('mapExportHtml'); if (htmlBtn) htmlBtn.addEventListener('click', exportHtml);

    // First paint: rule-centric default.
    rerender();

    // Expose live-highlight to the drill controller (used on Recalculate in Expert mode).
    api.applyResult = applyResult;
  }
})();
