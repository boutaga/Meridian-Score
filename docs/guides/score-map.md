# Score Map — reading the scoring dependency graph

The **Score Map** (simulator tab *Score Map*, or `/score-map/<tech>`) shows **how a score
is built, top-down** — *category → sub-category → metrics → the cross-metric rules that
link them* — so the parts of the barème that are otherwise only readable in the catalog
JSON or the engine code become explorable.

It reads the same catalogs as everything else (`data/metrics/<tech>.json`) via the shared
extractor `simulator/lib/graph-builder.js`; no scoring logic is duplicated.

## Progressive drill-down (default)

The map opens at the top of the model and drills down one level at a time, so you are
never shown the whole ~300-node graph at once:

1. **Categories** — one card per pillar, with its live score %, status colour, and
   metric/rule counts.
2. **Sub-categories** — click a category → a card per sub-category (live score, counts).
3. **Metrics + relations** — click a sub-category → a focused graph of just that
   sub-category's metrics and the rules/relations between them. Relations that reach
   **other** sub-categories render as dashed **portal** nodes (`↗`) — click one to jump
   to the related sub-category.

A **breadcrumb** (`All categories › Backup & Recovery › Log Archiving`) drills back out.
The view is **responsive** — it fills the page and re-fits as you resize the window.

### Understanding a node

- **Hover** any node for a quick read (points X/Y, pass/fail, current value).
- **Click** a node to **pin** its full explanation into the side panel: what the check is,
  the current value, why it's critical (and whether the 60 % gate is active now), the
  rules it's involved in, and the fix.
- The **legend** in the side panel decodes every shape, colour, and line.

## Visual encoding (leaf graph + Expert view)

**Nodes**

| Node | Look | Meaning |
|------|------|---------|
| Metric | rounded box, fill = pillar colour | a scored metric. Diamond = engine-derived. |
| Rule | hexagon, fill = severity | a cross-metric consistency rule (e.g. `BAK-CR-2`). |
| Portal | dashed pill with `↗` | a metric/rule in another sub-category — click to jump. |
| Sub-category / Pillar | larger boxes in the pillar colour | where scores roll up. |
| System fact / workload | grey pill | a runtime input (`ram_kb`, `cpu_count`, workload) used by a rule or derivation. |

**Borders = live state** (when a scenario is loaded): green = passed · red = failed/missing ·
amber = fired rule / involved · dimmed = not applicable.

**Edges**

| Edge | Style | Source in catalog |
|------|-------|-------------------|
| rule trigger | dashed purple, metric → rule | the rule's `applies_when` |
| rule effect | solid, rule → target, labelled `zero` / `−N` / `cap N%` | `on_violation.score_adjustment(s)` |
| derived from | solid blue, input → derived metric | `derived_from.inputs` |
| applies-when gate | dotted grey, metric → metric | a metric's own `applies_when` |
| criticality gate | dashed orange | `criticality: critical` + `gate_scope` |
| rolls up | faint grey backbone | metric → sub-category → pillar |

## Live highlight

Pick a **Scenario** (and adjust RAM/CPU/storage/workload, then **Recalculate**). The map
calls the same `/simulate/<tech>/calculate` engine endpoint and lights up passed (green) /
failed (red) metrics, fired rules (amber) and their edges, not-applicable metrics (dimmed),
and live category/sub-category scores on the cards. This answers "where did *this* score
come from" for a concrete scenario.

## Expert / Full graph

Toggle **Expert / Full graph** for the original single-screen view: the entire
metrics → rules → score dependency graph with a filter sidebar (full graph, cross-category
rules only, per-pillar / source / edge-type) and click-to-focus. This is the "see
everything" escape hatch and the source for the exports.

## Sharing it

- **Export PNG** — a snapshot of the Expert graph.
- **Export HTML** — a single self-contained file (cytoscape + the graph + the current
  scenario's highlight inlined). Opens offline with no server — the artifact to email a
  CTO or drop in a deck.

## Extending

The graph is built purely from the catalog, so new metrics/rules appear automatically.
The progressive drill (`simulator/public/js/score-map-drill.js`) and the Expert/flat view
(`simulator/public/js/score-map.js`) share one cytoscape style / layout / highlight module
(`simulator/public/js/score-map-style.js`); the graph model is
`simulator/lib/graph-builder.js`. The sub-category card scores read the engine's additive
`subcategories` rollup (post-gate / post-cap), exposed by `ScoringEngine.calculate()`.
