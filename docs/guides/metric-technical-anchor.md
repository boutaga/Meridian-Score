# Technical anchors and rationale

Two optional fields make a metric readable without the collector's code: `technical_anchor` says how the value is measured, `rationale` says why the threshold or the criticality is what it is. Both are validated by `npm run validate-catalogs` and rendered by the simulator's metric card and by the scoring-spec workbooks.

## Schema

```json
"technical_anchor": {
  "summary": "Reads the archive_mode setting from pg_settings.",
  "query": "SELECT setting FROM pg_settings WHERE name = 'archive_mode'"
},
"rationale": "Without WAL archiving there is no point-in-time recovery; PostgreSQL documentation, Continuous Archiving."
```

- `technical_anchor` is a top-level, optional object. When present, `summary` and `query` are both required, non-empty strings. Soft caps: 280 characters for the summary, 4000 for the query (the validator warns, it does not fail).
- `rationale` is a top-level, optional string.
- Every new metric carries a `rationale`. Every new collected metric also carries a `technical_anchor`. Manual attestations carry one when a command backs the attestation (for example `RMAN> RESTORE DATABASE VALIDATE;`); derived metrics carry none, their formula is published in the scoring policy (DEC-011).

## Three worked examples

Backup, PostgreSQL BAK-1.1 (a setting read):

```json
"technical_anchor": {
  "summary": "Reads the archive_mode setting from pg_settings.",
  "query": "SELECT setting FROM pg_settings WHERE name = 'archive_mode'"
}
```

Security, Oracle SEC-2.3 (an observation on the current session, supplied by the Oracle Technology Leader):

```json
"technical_anchor": {
  "summary": "Counts session banners of the current session that mention Crypto-checksumming; 0 means no integrity check.",
  "query": "select count(*)\nfrom v$session_connect_info\nwhere SID = sys_context('USERENV','SID') and instr(NETWORK_SERVICE_BANNER,'Crypto-checksumming') > 1"
},
"rationale": "Oracle Technology Leader review (2026-08-27): the parameter the collector read (sec_protocol_error_further_action) controls bad-packet handling, not checksumming; the session banner is the evidence."
```

Capacity, PostgreSQL CAP-3.2 (a computed measure):

```json
"technical_anchor": {
  "summary": "Estimates size-weighted dead space from pg_stat_user_tables and the relation sizes.",
  "query": "SELECT round(100.0 * sum(n_dead_tup::numeric * pg_relation_size(relid) / greatest(n_live_tup + n_dead_tup, 1)) / greatest(sum(pg_relation_size(relid)), 1), 1) AS bloat_pct\nFROM pg_stat_user_tables"
},
"rationale": "PostgreSQL Technology Leader review (2026-09-03): the previous average over the twenty worst tables with more than a thousand rows rested on arbitrary filters; a size-weighted measure needs none."
```

## Style rules

- The summary is one sentence, verb first: "Reads ...", "Counts ...", "Computes ...". It names the view or table and, when it matters, the unit.
- The query is verbatim and runnable as written, with real newlines in the JSON string (`\n`). About 15 lines is the comfortable maximum; a longer query is a sign the metric measures too many things.
- Non-SQL probes hold the literal command (an RMAN command, a shell command, a MongoDB shell expression).
- The unit of the emitted value must be stated when the catalog threshold carries a unit: the collector and the catalog must agree (when they do not, a healthy value can score as failed; `scripts/check-payload.js` reports it as unit suspect).
- The rationale names its source: vendor documentation, a benchmark (CIS, MAA), a Technology Leader review with its date, field practice. "Where does this number come from" must have an answer a reader can check.
- Author from vendor documentation and your own knowledge; never copy a query from a closed-source tool.

## What the anchor is, and is not

The anchor is documentation: it tells a reader how the value is produced so the metric can be reviewed without opening the collector. The collector's code (the checker project) remains the runtime truth. When the two disagree, the collector must be fixed or the anchor updated, and the contract recorded in `docs/consumer-contract.md`.

## Backfilling from a collector

`scripts/extract-anchors-from-checker.js --tech postgresql --out anchors.json` pairs each metric emission in the sibling checker repository with the SQL executed just before it and writes a map keyed by `legacy_name`. It is a seed: review every pairing before merging it into a catalog (the 2026-09 backfill kept only pairings within 25 lines, without template interpolation, and dropped one wrong pairing found by reading).
