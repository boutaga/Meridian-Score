# Changelog

All notable changes to `@dbi-services/scoring-core`. Catalog versions move independently of the package version and are listed with each release. Dates are release dates.

## [1.17.0] - 2026-10-08

- Absolute target (collector request and Adrien's decision of 2026-09-29). The target depends on the catalog, the declared targets and the applicability facts only, never on what a run collected: every applicable check stays on the ruler, collected or not, including the checks outside the run's collection scope.
- An uncollected check counts 0 points, whatever its criticality (Adrien, 2026-10-07: "the drop when values are missing is ok, it should be like that"). Before, a missing non-critical check left its section and its neighbours absorbed its points. A section where nothing was collected keeps its points in the maximum and the target; only a section where nothing applies leaves the maximum. A required check with no value is listed in `requiredMissed` with reason `missing`, critical or not, so "target not reached" names it. A derived check whose inputs are missing (memory checks without `systemFacts`) counts the same.
- A non-critical declared target left blank (PostgreSQL security posture, growth headroom, HA topology, upgrade plan; Oracle security posture, growth headroom, DR topology) costs nothing (Adrien, 2026-10-08): it keeps its full points as any declared value would, carries `undeclared: true`, is not a missed required check and never empties its section; an undeclared estate already pays through a target at its maximum. A blank recovery point or recovery time (critical) still counts 0 and gates.
- Checks outside the run's collection scope (agent-only checks in a standalone run, a source not declared in `availableSources`) count 0, stay in the target and are flagged `outOfScope: true` (value `not in scope`) in `allMetrics` and `requiredMissed`. They never trigger a criticality gate or cap and never enter `disposition.items` (`disposition.unassessed` keeps listing the critical ones); a value sent for one is not scored. A standalone run of PostgreSQL, MySQL, MariaDB, MongoDB or SQL Server therefore never reads "excellent". `coverage` keeps its meaning.
- New result field `pointsNotAssessed` at the top level, on every pillar and on every `subcategories` entry: the points of the applicable checks with no value. Score plus points not assessed never exceeds the maximum.
- Unknown server version (confirmed by Adrien, 2026-10-08): a check with a minimum version applies when its value was collected and does not apply when absent (`exclusion_reason: 'version_unknown'`); an info finding per pillar names the checks left out, and a critical one is listed in `disposition.unassessed`. This includes `stale_replication_slots` (PostgreSQL 17 and later), which 1.16.0 counted as a missing critical when neither the version nor the value was sent. The synchronous standby count derived from an uncollected `synchronous_standby_names` is unknown, not 0, so the synchronous-standby rule no longer fires on a value nobody collected; the count check PER-4.3 is then itself not assessed.
- Oracle catalog 1.11.0. Fix: a healthy Data Guard primary, shaped as the collector sends it, scored 84 instead of 100 (the standby open mode and the Data Guard statistics are absent on a primary while `dataguard_configured` is true, so three critical checks read as missing and capped Backup and Performance at 12 of 20). BAK-4.5 now also needs its own value; PERF-4.1 to PERF-4.4 and PERF-4.6 (apply processes, which read false on every primary) apply on a standby (BAK-4.5 present), so a failed statistics query on a standby still reads as missing. Checks the collector omits because they do not apply now apply only when their value is present: BAK-5.2, CAP-4.3, CAP-4.2, PERF-1.9, PERF-1.10, PERF-2.11, PERF-2.13, SEC-3.7, SEC-3.8 (with traditional auditing), FUT-2.5, FUT-2.6. A failed query on these reads "does not apply"; accepted for the critical BAK-5.2 and BAK-4.5 in 1.17.0 (Adrien, 2026-10-08), to be guarded on facts the collector reports in the next release.
- PostgreSQL catalog 1.14.0. SEC-2.3 `ssl_cert_days_remaining` applies only with SSL on; PER-4.4 `synchronous_standby_names` only when not empty (empty is correct for asynchronous replication; PG-CR-HA-1 still catches a declared synchronous standby without names); CAP-1.3, PER-2.16, PER-2.17, PER-2.18, CAP-2.9 and CAP-2.10 only when their value is present. SEC-2.4 `encryption_at_rest` is deliberately left unguarded: it applies everywhere and is attested off Azure.
- Samples: the PostgreSQL healthy sample carries the four agent-only values (an agent run scores 100, a standalone run 95.73 with 4.27 not assessed); PostgreSQL OLAP and OLTP carry the tuning values added to the catalog after they were written, derived from their own settings (OLAP runs 15 connections so its 2 GiB work_mem fits the memory-pressure bound), and their descriptions no longer claim 100. Collector-shaped samples (honest DEV, average, uneven, critical) keep their gaps, which now cost points. The Oracle OLAP, OLTP and SE2 samples are unchanged.
- Simulator 2.2.0: the score card shows the points not assessed beside the target, and "target not reached" says when a check is outside the run's collection scope. The maturity ladder treats declaring a coherent rung as a fix even when the score does not move (a blank declaration already keeps its points). It still scores standalone runs, so PostgreSQL samples read below 100 there.
- Scores move without any change on the instance (standalone runs of the shipped samples): PostgreSQL healthy 100 to 95.73, almost there 95.75 to 91.48, average 79.57 to 74.3, honest DEV 88.38 to 84.28, OLAP 99.39 to 95.12, OLTP 99.7 to 95.43, uneven 63.4 to 59.56, critical 48 to 47.33; Oracle average 82.32 to 81.72, Oracle critical 54.99 to 51.51; the draft catalogs lose their agent-only checks in a standalone run (MySQL healthy 100 to 95.45, MariaDB healthy 100 to 95.47, MongoDB healthy 100 to 97.96, SQL Server healthy 100 to 99). Compare scores within one rules code.

## [1.16.0] - 2026-09-29

- One ruler, a target per estate (score-and-target decision, 2026-09-28). Every check counts for every estate, so 100 means best practice everywhere and each pillar stays at 20 points. Declared targets never switch a check off: the new catalog field `optional_when` names the declared targets under which a check is not required. Such a check still earns or loses its own points, but leaves the target score and never triggers a criticality gate, a pillar cap or a disposition item; lowering a target can therefore raise a score by lifting the caps on the checks it stops requiring. An estate that declares nothing is required to meet every check.
- New result fields `targetScore`, `requiredScore` (points earned on required checks), `targetAttainment` (required points divided by the target), `onTarget` and `requiredMissed` (the required checks missed, for a "target not reached" flag), and `target`, `requiredScore`, `targetAttainment`, `onTarget` per pillar and subcategory. Status (excellent-means-on-target decision, 2026-09-28): "excellent" only when every assessed check the declared targets require is fully met and no rule deduction or cap took required points (`requiredMissed` then names the rule, reason `rule`); below that the bands apply to `targetAttainment` with "good" as the ceiling. Extra effort on checks that are not required raises the score but never makes up for a missed required check. Undeclared estates must meet every check to read "excellent". Per metric: `required` and `optional_because`. A failed check that is not required is an `info` finding with `aboveTarget: true`, recommended after the required work.
- PostgreSQL catalog 1.13.0 (172 metrics, 29 rules). Not required: WAL archiving, its command, failure count and timeout, WAL summarisation and backup tool detection at a 24-hour RPO; enterprise backup tool and PITR at a 24-hour RPO with an 8- or 24-hour RTO; backup and storage encryption at a baseline posture; pgAudit at a baseline or hardened posture; standby streaming and count with no standby declared; synchronous standby names with none or an asynchronous standby; the restore estimate with a declared standby or cluster. pgAudit and the restore estimate now also count where posture or topology is undeclared. The dump schedule no longer decides anything. The archiving failures count applies only with archiving on. Consistency rules reviewed: the nine that read a check which can now be optional fire only when the declaration requires the practice or when a practice is present but broken, and are unchanged, except PG-CR-HA-2, which now fires only on a collected streaming state and no longer offers declaring the standby away as an equal fix. The remediations of BAK-4.9 and of the thirteen rules that react to an overclaimed recovery point, recovery time, posture or topology put fixing the practice first and correcting the declaration second, with its consequence; PG-CR-SECPOST-1 says SSL is required at every posture. The four SSL checks carry the new `floor` flag. `"yes"` is no longer an accepted `rpo_target` or `rto_target`.
- Oracle catalog 1.10.0: the five declarations carry `declared_target`; Data Guard counts on every Enterprise Edition estate and is not required when `dr_topology=none`, so an undeclared Enterprise Edition estate is now required to have it.
- Fingerprints: `context.fingerprint` carries a rules code (engine version, scoring policy, whole catalog) and a declarations code (declared targets in the catalog spelling). `context.declarations` echoes the declared targets in the catalog spelling. New module `@dbi-services/scoring-core/fingerprint`.
- Rules bundle: `exportRulesBundle` and `loadRulesBundle` (`@dbi-services/scoring-core/bundle`) and `scripts/rules-bundle.js export | verify | score` (command `scoring-rules-bundle`). A bundle carries a catalog, optionally the exporter's declared targets, and checksums (not signatures); a damaged or naively edited file is refused, a bundle from another engine version imports with a note. `score` applies the bundle's declared targets by default (the exporter's bar), keeps the importer's own where the bundle declares none, and `--own-declarations` keeps all of the importer's (bundle decision, 2026-09-28).
- `new ScoringEngine(technology, { catalog })` scores with a given catalog; the Impact Analyzer and the benchmark script use it. New validators: `optional_when` reads declared targets only and is refused on SSL, pillar-gate and declaration metrics; `applies_when` may no longer read a declared target. `validateCatalogData` moves into the shared validation module.
- New locked sample `postgresql-dev-loose` (an honest, collector-shaped DEV: 88.38 against a target of 91.15, 96 percent reached, "good", no critical problem, target not reached on five required checks: backup verification, restore test, DR plan, log retention, connection pooler). Sample moves from 1.15.0: PostgreSQL average 80.61 to 79.57, uneven 64.52 to 63.4, OLTP 100 to 99.7 and OLAP 100 to 99.39 (restore estimate now judged with an undeclared topology), almost-there 95.64 to 95.75; critical stays 48. Status moves: PostgreSQL almost-there, OLTP and OLAP, Oracle almost-there and OLTP go from "excellent" to "good" (each misses at least one required check). Oracle scores unchanged.
- Simulator 2.1.0: the score shows its target and the share reached, a "target not reached" box lists the required checks missed, checks that are not required are tagged, the context shows both codes, recommendations above the target are tagged, and the Impact Analyzer exports a rules bundle. The maturity ladder reads the `declared_target` flag and shows, per rung, the score change and the target change; under an honored declaration it never recommends a rung that lowers the target, and a fix that lowers the target says so.
- Rules bundle: the technology name is matched trimmed and case-insensitively against the shipped catalogs, and a bundle carrying declared targets for a technology this package does not ship is refused (a rules-only bundle still loads), so a bundle spelled `PostgreSQL` or `postgres` can no longer skip the check that its declarations are declared targets of the shipped catalog. A shipped technology loads in its catalog spelling, so a hand-edited name no longer matches its codes. In a pillar short of its target with no required check missed, `requiredMissed` lists the rule that took the points, once per section it acted on.
- README: the "See it in action" example now starts from the shipped healthy PostgreSQL sample and prints its real output (84, "good", Capacity and Performance capped, four critical findings); the old example printed 10 while its comment said 71.4. The catalog table names PostgreSQL 1.13.0 and Oracle 1.10.0. A test locks both.

## [1.15.0] - 2026-09-26

- Scoring policy: the weights, gates, partial credit, status bands and defaults now live in one frozen object (`src/scoring/policy.js`, exported as `SCORING_POLICY` and `@dbi-services/scoring-core/policy`); the engine reads it, `npm run generate-docs` renders it into `docs/scoring-model.md`, the simulator renders it on "How the score works".
- New optional metric fields `technical_anchor` (the SQL or command that measures the metric) and `rationale` (where its threshold comes from), validated by the shared module; backfilled on 75 PostgreSQL and 129 Oracle metrics.
- New derived formula `restore_time_estimate_minutes`; `oracle_memory_pct_of_ram` prefers `pga_aggregate_limit` when provided.
- Payload shape checker (`scripts/check-payload.js`, library `src/catalog/payload-check.js`) reporting a real collector payload against a catalog; anchor extractor (`scripts/extract-anchors-from-checker.js`).
- PostgreSQL catalog 1.12.0 (172 metrics, 29 rules): database size becomes a coherence input (restore time against the declared RTO, rules PG-CR-RTO-3 and PG-CR-RTO-4), pgaudit only under a declared regulated posture, size-weighted bloat, provenance on the metrics the Technology Leader questioned.
- Oracle catalog 1.9.0 (160 metrics): five metrics retired per the Technology Leader review, ASM diskgroup usage promoted to critical (guarded on its own presence), redo-log size unit fixed (megabytes), ASMM-only memory management, SEC-3.8 under traditional auditing only, ~35 reviewer-supplied anchors.
- Simulator 2.0.0: "How the score works" page, three-section metric card with the anchor SQL, flat threshold editing on the Impact Analyzer, "Import a collected payload", design tokens with light and dark themes, sidebar shell.
- Repository: CHANGELOG, CODE_OF_CONDUCT, SECURITY, DECISIONS, LESSONS and REGRESSIONS registers, issue and pull-request templates, CI on Node 20 and 22 with a simulator smoke job and a fixed catalog benchmark.

Adoption review fixes (review of 2026-09-04, folded into 1.15.0 before release):

- Partial credit is exact (never rounded) and `passed` follows the bound, so a value outside its bound is never reported as passed. Rounding gave a weight-1 metric its full point. Sample moves, no status change: PostgreSQL almost-there 96.31 to 95.6, average 81.82 to 80.96, uneven 64.79 to 64.52; Oracle almost-there 95.26 to 94.95, average 82.46 to 82.32, uneven 63.27 to 62.47; MariaDB OLAP 100 to 99.81.
- New result field `disposition` (`clear` or `critical_unresolved`, one item per open critical problem, plus the critical metrics never assessed because their collector did not run). Score and status are unchanged; the band alone could read "excellent" over a failed critical check. The Impact Analyzer shows it next to both statuses.
- Coverage adds `collectionScope` (`full` or `partial`) and `outOfScope` (applicable metrics whose collector did not run), so a SQL-only run no longer reads as complete.
- `serverVersion` option (`pgVersion` kept as its alias): the MySQL and MariaDB minimum-version fields are now enforced (MongoDB, Oracle and SQL Server fields are registered but empty today); a version that cannot be read or compared filters nothing; `context.serverVersion` echoes it.
- `by_declaration.unless`: a predicate that makes a declaration-keyed threshold score as undeclared. PostgreSQL BAK-2.2 backup age uses it under WAL archiving, so a daily base backup with continuous archiving no longer fails a short RPO.
- Catalog `maturity` field on all six catalogs (PostgreSQL and Oracle measurement-reviewed, the others draft); MySQL 1.3.1, MariaDB 1.3.1, MongoDB 1.2.1, SQL Server 1.2.1 for that field only. PostgreSQL 1.12.0: BAK-4.9 and PER-1.10 state what the restore estimate and the memory heuristic leave out.
- Docker quickstart fixed (the image lacked the root `package.json`); the simulator listens on 127.0.0.1 unless `SIMULATOR_HOST` says otherwise, compose publishes on 127.0.0.1; new CI job builds and runs the image without mounted folders.
- `generate-scoring-spec --no-links` builds the public workbooks without the private checker checkout; the committed workbooks are now the public set.
- The catalog benchmark scores every sample with its own context and reports weight, threshold, applicability and rule changes.
- PostgreSQL BAK-1.7 `archive_timeout` (advisory, applies with WAL archiving on): with no standby streaming (`streaming_status` or `ha_standby_count`) and an RPO of 4 hours or less declared, it must lie between 1 second and the declared RPO; rule PG-CR-RPO-3 invalidates a 5- or 15-minute RPO it does not bound, and stays silent when the standby state was not collected. Closes the gap the backup-age archiving exception left for quiet databases once the checker collects `archive_timeout`; until then the gap remains. A payload without the value keeps its total score, but with archiving on the uncollected metric counts as one more missing non-critical metric in coverage; samples: PostgreSQL average 80.96 to 80.61, almost-there 95.6 to 95.64.
- The public workbook's Measurement column names the Zabbix and Worker sources beside its pointer.
- SECURITY.md: GitHub private vulnerability reporting is the only reporting channel.

## [1.14.0] - 2026-07-22

- Pillar criticality cap: a hard-failed or missing critical metric caps its whole pillar at 60 percent (12 of 20).
- Declaration-keyed thresholds (`by_declaration`): a metric's bound follows the declared target (RPO, growth headroom).
- PostgreSQL catalog 1.11.0 (target-aware seeding, all-pass upgrade plan, rule PG-CR-FUT-2); Oracle catalog 1.8.0 (CAP-4.8 fix, PERF-2.6 retired, TDE and Data Guard license gating, rule OR-CR-RPO-1); simulator 1.7.0 (critical-gate chip).

## [1.13.2] - 2026-07-21

- Prose proofreading of the PostgreSQL (1.10.1) and Oracle (1.7.1) catalogs: 62 wording fixes and 2 remediation corrections.

## [1.13.1] - 2026-07-21

- Engine fix: a pillar zeroed by a pillar gate now zeroes its subcategory rollup entries too.

## [1.13.0] - 2026-07-21

- PostgreSQL catalog 1.10.0: production-relevance corrections (shared buffers band, deadlock tolerance, version gating, CIS PostgreSQL 16 references).
- Simulator 1.6.0: Technology Leader validation profile set (uneven, average, almost-there) for PostgreSQL and Oracle.

## [1.12.0] - 2026-07-06

- Coherence expansion: declared targets in every pillar (RPO, RTO, security posture, growth headroom, HA and DR topology) with rules that invalidate a declaration its evidence contradicts; the RTO hole closed.
- Additive `context` and `coverage` output keys (assessment context, catalog coverage).
- PostgreSQL catalog 1.9.0, Oracle catalog 1.7.0; simulator 1.4.0 (coherence certificate) and 1.5.0 (maturity ladder).

## [1.11.0] - 2026-07-06

- Oracle catalog 1.6.0: manual-metric gaps closed (offsite backup, DR plan), duplicate memory metric removed.

## [1.10.0] - 2026-06-21

- Oracle catalog 1.5.0: PostgreSQL parity and the license and pack model (160 metrics, 13 rules); engine-derived `oracle_memory_pct_of_ram`.

## [1.9.0] - 2026-06-21

- Engine: generic `license_requirement` metadata and license-aware applicability (metrics for options the estate does not own are not applicable, no penalty).

## [1.8.0] - 2026-06-15

- PostgreSQL catalog 1.8.0 and Oracle catalog 1.4.0 reweighting; per-metric `applies_when`, `metric_zero` and multi-adjustment rules; weight validation.

## [1.7.1] - 2026-06-10

- Engine patch: fixes ported from the checker and from the solution review (recommendation ordering, boolean checks, profile defaults).

## [1.7.0] - 2026-06-10

- PostgreSQL catalog 1.7.0 and Oracle catalog 1.3.0 full-audit content release; engine feature set 1.6.0 (derived metrics, score-moving consistency rules, predicate operators).
