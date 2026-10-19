## What this changes

<!-- One paragraph: which catalog, engine, simulator or docs surface, and why. -->

## Catalog checklist (delete if no catalog changed)

- [ ] `npm run validate-catalogs` is green
- [ ] `npm test` is green, including the content-lock tests of the catalog
- [ ] `npm run generate-docs` was run and `docs/technologies/` is committed
- [ ] Sample impact stated below (`npm run benchmark <technology> <file>` or the simulator's Impact Analyzer)
- [ ] New metrics carry `technical_anchor` (the SQL or command that measures them) and `rationale`
- [ ] Changed thresholds or criticalities carry an updated `rationale`
- [ ] Changed input shapes or units are recorded in `docs/consumer-contract.md`

## Sample impact

<!-- Paste the before/after totals per sample, or "no sample moves". -->

## Engine checklist (delete if no engine changed)

- [ ] Behaviour-preserving refactors are proven by the existing suite; new behaviour has tests
- [ ] Numbers that define the score live in `src/scoring/policy.js`, not in code
- [ ] A changed design choice is explained in the summary above
