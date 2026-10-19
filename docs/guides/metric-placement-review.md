# Metric Placement Review — For Tech Leader Discussion

**Version**: 1.0.0
**Date**: 2026-04-15
**Purpose**: Document areas where the implementation diverges from the architecture specification, for tech-leader review before catalog finalization.

---

## 1. Subcategory Point Split Differences

Each pillar totals 20 points (invariant). An early architecture draft prescribed specific subcategory splits. The implementation used different splits from its very first commit, and all 6 technology catalogs share the same allocations.

**No changes are being made.** This table is provided for discussion.

| Pillar | Subcategory | Spec | Implementation | Delta | Analysis |
|--------|-------------|------|----------------|-------|----------|
| Capacity | Storage | 6 | 5 | -1 | Reduced storage weight. Storage metrics tend to be fewer and more binary (disk full or not). |
| Capacity | Maintenance | 5 | 6 | +1 | Increased maintenance weight. Bloat, vacuum, fragmentation have more gradation and more metrics. |
| Performance | Query Performance | 6 | 7 | +1 | Increased query perf weight. Slow queries are the most common performance complaint in practice. |
| Performance | Replication | 5 | 4 | -1 | Reduced replication weight. Not all databases use replication; standalone deployments are common. |
| Future-Proof | Version Currency | 6 | 7 | +1 | Increased version weight. Running outdated versions is a top-3 risk in field assessments. |
| Future-Proof | Configuration | 5 | 3 | -2 | Significant reduction. Configuration checks are numerous but often advisory-level, reducing their practical impact on scoring. |
| Future-Proof | Upgrade Planning | 5 | 6 | +1 | Increased planning weight. Upgrade readiness combines documentation, testing, and process maturity. |

**Backup and Security pillars match the spec exactly.**

### Questions for Tech Leaders

1. Should we revert to the spec values, keep the implementation values, or adjust case by case?
2. Is the Configuration subcategory (3 pts) underweighted given its importance for best-practice compliance?
3. Does reducing Replication to 4 pts unfairly penalize HA-focused deployments?

---

## 2. Metric Placement Review

Metrics where the assigned pillar may not match the metric's primary concern. These are flagged for discussion, not unilateral changes.

### 2A: Cache Hit Rate Metrics in Capacity (Recommend: Move to Performance)

These metrics measure cache *effectiveness* (hit ratio), which is a performance concern. They are currently in Capacity subcategories.

| Technology | Metric ID | Name | Current Placement | Suggested |
|------------|-----------|------|-------------------|-----------|
| MySQL | CAP-2.2 | Thread Cache Hit Rate High | Capacity / Connections | Performance / Caching |
| MySQL | CAP-3.1 | InnoDB Buffer Pool Hit Rate | Capacity / Maintenance | Performance / Caching |
| MariaDB | CAP-2.5 | Thread Cache Effective | Capacity / Connections | Performance / Caching |
| MariaDB | CAP-3.1 | InnoDB Buffer Pool Hit Rate | Capacity / Maintenance | Performance / Caching |

**Rationale**: A buffer pool hit rate measures how well the cache serves reads — this is the textbook definition of a performance/caching metric. The `perf_cache` subcategory across all technologies already contains similar metrics (e.g., PostgreSQL's `cache_hit_ratio`, Oracle's `buffer_cache_hit_ratio`).

**Counter-argument**: One could argue that thread cache sizing is a capacity planning concern. However, hit *rate* (not size) is a performance indicator.

### 2B: Metrics That Are Correctly Placed Despite Appearing Cross-Domain

These were flagged during analysis but are **correctly placed** after review. No action needed.

| Technology | Metric ID | Name | Placement | Why It's Correct |
|------------|-----------|------|-----------|-----------------|
| All | BAK-3.3 | Backup Encryption | Backup / Tools | Encryption of backup pipeline is a backup completeness concern, not a data-in-transit security concern |
| PostgreSQL | BAK-4.6 | Synchronous Mode | Backup / Recovery | Sync standby is about data protection guarantees (RPO=0), not replication throughput |
| PostgreSQL | FUT-3.4 | No Deprecated MD5 | Future-Proof / Planning | MD5 deprecation is about upgrade readiness, not a current security vulnerability |
| MySQL | FUT-3.2 | mysql_native_password Not Used | Future-Proof / Planning | Same reasoning — deprecation readiness |
| PostgreSQL | CAP-4.4 | No Stale Replication Slots | Capacity / Planning | Stale slots cause WAL accumulation (disk pressure) — a capacity concern |
| MongoDB | CAP-1.1 | WiredTiger Cache Usage | Capacity / Storage | Cache usage % measures storage pressure, not cache effectiveness |
| MySQL | BAK-1.5 | Binlog Sync Durable | Backup / WAL | Binlog sync durability prevents data loss on crash — a backup concern |
| All | FUT-2.x | HA Solution Deployed | Future-Proof / Config | HA readiness is an architectural maturity indicator, not a replication perf metric |

### Questions for Tech Leaders

1. Should the 4 cache hit rate metrics (MySQL/MariaDB) move to Performance/Caching?
2. If moved, does the point redistribution within Capacity and Performance subcategories need adjustment?
3. Are there any metrics in your technology that feel misplaced but aren't listed here?

---

## How to Use This Document

1. Review the tables above with your technology expertise
2. Use the **Scoring Simulator** (Impact Analyzer page) to test the scoring impact of any proposed changes
3. Export the modified catalog and run `node scripts/benchmark-catalog.js <tech> <file>` for detailed comparison
4. Open a PR with your proposed changes — CI will automatically validate and post a comparison report
