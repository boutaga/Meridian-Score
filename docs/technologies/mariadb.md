# MariaDB Scoring Reference

> Auto-generated from catalog v1.3.1. Do not edit manually — modify the JSON catalog and re-run `npm run generate-docs`.

## Overview

| Property | Value |
|----------|-------|
| Technology | MariaDB |
| Catalog Version | 1.3.1 |
| Total Metrics | 111 |
| Critical | 24 (weight: 3x) |
| Important | 38 (weight: 2x) |
| Advisory | 49 (weight: 1x) |
| Max Score | 100 points (5 pillars x 20 points) |

## Scoring Summary

| Pillar | Subcategory | Points | Metrics | Critical |
|--------|-------------|--------|---------|----------|
| **Backup & Recovery** (20pts) | Log Archiving | 5 | 5 | 2 |
|  | Scheduled Backups | 4 | 4 | 1 |
|  | Backup Tools | 4 | 4 | 0 |
|  | Recovery Readiness | 4 | 4 | 2 |
|  | Retention Compliance | 3 | 3 | 0 |
| **Security** (20pts) | Authentication | 5 | 5 | 1 |
|  | Encryption | 5 | 6 | 2 |
|  | Audit & Logging | 5 | 6 | 1 |
|  | Access Control | 5 | 5 | 2 |
| **Capacity** (20pts) | Storage | 5 | 8 | 1 |
|  | Connections | 5 | 4 | 1 |
|  | Maintenance | 6 | 6 | 0 |
|  | Planning | 4 | 4 | 1 |
| **Performance** (20pts) | Caching | 5 | 9 | 2 |
|  | Query Performance | 7 | 9 | 1 |
|  | Locking | 4 | 5 | 0 |
|  | Replication | 4 | 5 | 4 |
| **Future-Proofing** (20pts) | Version Currency | 7 | 5 | 2 |
|  | Configuration | 3 | 3 | 0 |
|  | Upgrade Planning | 6 | 7 | 0 |
|  | Health Foundation | 4 | 4 | 1 |

## 1. Backup & Recovery (20 points)

### 1.1 Log Archiving (5 points)

| ID | Metric | Criticality | Type | Source(s) | Pass Criteria |
|----|--------|-------------|------|-----------|---------------|
| BAK-1.1 | Binary Log Enabled | **CRITICAL** | enum | SQL | `ON`, `1` |
| BAK-1.2 | Binlog Format ROW | **CRITICAL** | enum | SQL | `ROW` |
| BAK-1.3 | Binary Log Expire Configured | Important | threshold | SQL | >= 86400 AND <= 2592000 |
| BAK-1.4 | GTID Mode Enabled | Important | enum | SQL | `slave_pos`, `current_pos` |
| BAK-1.5 | Binlog Sync Durable | Advisory | enum | SQL | `1` |

> **Gate**: BAK-1.1 (Binary Log Enabled) — if this critical metric fails, the entire pillar is zeroed.

**Scoring**: Weight pool = 11 (2x3 + 2x2 + 1x1), normalized to 5 points.
If BAK-1.1 or BAK-1.2 fails, subcategory capped at 3.0 points (60%).

### 1.2 Scheduled Backups (4 points)

| ID | Metric | Criticality | Type | Source(s) | Pass Criteria |
|----|--------|-------------|------|-----------|---------------|
| BAK-2.1 | Backup Schedule Defined | **CRITICAL** | enum | Manual | `daily`, `hourly`, `continuous`, `binlog_only` |
| BAK-2.2 | Last Backup Age | Important | threshold | Monitoring, Worker | <= 24 |
| BAK-2.3 | Logical Backup Scheduled | Advisory | boolean | Manual | = true |
| BAK-2.4 | Backup Verification | Advisory | boolean | Manual | = true |

**Scoring**: Weight pool = 7 (1x3 + 1x2 + 2x1), normalized to 4 points.
If BAK-2.1 fails, subcategory capped at 2.4 points (60%).

### 1.3 Backup Tools (4 points)

| ID | Metric | Criticality | Type | Source(s) | Pass Criteria |
|----|--------|-------------|------|-----------|---------------|
| BAK-3.1 | mariadb-backup Used | Important | enum | Manual | `mariadb-backup`, `xtrabackup`, `mariadb_backup` |
| BAK-3.2 | PITR Capability | Important | boolean | Manual | = true |
| BAK-3.3 | Backup Encryption | Advisory | boolean | Manual | = true |
| BAK-3.4 | Replica Used for DR | Advisory | boolean | Manual | = true |

**Scoring**: Weight pool = 6 (0x3 + 2x2 + 2x1), normalized to 4 points.

### 1.4 Recovery Readiness (4 points)

| ID | Metric | Criticality | Type | Source(s) | Pass Criteria |
|----|--------|-------------|------|-----------|---------------|
| BAK-4.1 | RPO Target Defined | **CRITICAL** | enum | Manual | `rpo_5`, `rpo_15`, `rpo_60`, `rpo_240`, `rpo_1440`, `yes` |
| BAK-4.2 | RTO Target Defined | **CRITICAL** | enum | Manual | `rto_5`, `rto_15`, `rto_60`, `rto_240`, `rto_480`, `rto_1440`, `yes` |
| BAK-4.3 | Restore Tested (90d) | Important | boolean | Manual | = true |
| BAK-4.4 | DR Plan Documented | Advisory | boolean | Manual | = true |

**Scoring**: Weight pool = 9 (2x3 + 1x2 + 1x1), normalized to 4 points.
If BAK-4.1 or BAK-4.2 fails, subcategory capped at 2.4 points (60%).

### 1.5 Retention Compliance (3 points)

| ID | Metric | Criticality | Type | Source(s) | Pass Criteria |
|----|--------|-------------|------|-----------|---------------|
| BAK-5.1 | Retention Policy Met | Important | boolean | Manual | = true |
| BAK-5.2 | Binlog Retention Adequate | Advisory | boolean | Manual | = true |
| BAK-5.3 | Offsite Backup Copy | Advisory | boolean | Manual | = true |

**Scoring**: Weight pool = 4 (0x3 + 1x2 + 2x1), normalized to 3 points.

## 2. Security (20 points)

### 2.1 Authentication (5 points)

| ID | Metric | Criticality | Type | Source(s) | Pass Criteria |
|----|--------|-------------|------|-----------|---------------|
| SEC-1.1 | TLS Connections 100% | **CRITICAL** | threshold | SQL | >= 100 |
| SEC-1.2 | Modern Auth Plugin Used | Important | enum | SQL | `ed25519`, `ed25519-available`, `caching_sha2_password` |
| SEC-1.3 | Password Validation Enabled | Important | boolean | SQL | = true |
| SEC-1.4 | Low Failed Logins (24h) | Important | threshold | Monitoring, Worker | <= 10 |
| SEC-1.5 | Password Expiry Policy | Advisory | threshold | SQL | <= 90 |

**Scoring**: Weight pool = 10 (1x3 + 3x2 + 1x1), normalized to 5 points.
If SEC-1.1 fails, subcategory capped at 3.0 points (60%).

### 2.2 Encryption (5 points)

| ID | Metric | Criticality | Type | Source(s) | Pass Criteria |
|----|--------|-------------|------|-----------|---------------|
| SEC-2.1 | Secure Transport Required | **CRITICAL** | enum | SQL | `ON`, `1` |
| SEC-2.2 | TLS 1.2+ Required | **CRITICAL** | enum | SQL | `TLSv1.2`, `TLSv1.3`, `TLSv1.2,TLSv1.3` |
| SEC-2.3 | InnoDB TDE Enabled | Advisory | boolean | SQL | = true |
| SEC-2.4 | Binlog Encryption | Advisory | enum | SQL | `ON`, `1` |
| SEC-2.5 | SSL Certificate Valid | Important | threshold | SQL | >= 30 |
| SEC-2.6 | SSL Available | Important | enum | SQL | `YES` |

**Scoring**: Weight pool = 12 (2x3 + 2x2 + 2x1), normalized to 5 points.
If SEC-2.1 or SEC-2.2 fails, subcategory capped at 3.0 points (60%).

### 2.3 Audit & Logging (5 points)

| ID | Metric | Criticality | Type | Source(s) | Pass Criteria |
|----|--------|-------------|------|-----------|---------------|
| SEC-3.1 | MariaDB Audit Plugin Enabled | Important | enum | SQL | `ON`, `1`, `FORCE`, `FORCE_PLUS_PERMANENT` |
| SEC-3.2 | Slow Query Log Enabled | Important | enum | SQL | `ON`, `1` |
| SEC-3.3 | Error Log Configured | Important | boolean | SQL | = true |
| SEC-3.4 | Log Raw Passwords Off | **CRITICAL** | enum | SQL | `OFF`, `0` |
| SEC-3.5 | Log Retention (90d) | Advisory | threshold | Manual | >= 90 |
| SEC-3.51 | Audit Plugin Enabled | Important | boolean | SQL | = true |

**Scoring**: Weight pool = 12 (1x3 + 4x2 + 1x1), normalized to 5 points.
If SEC-3.4 fails, subcategory capped at 3.0 points (60%).

### 2.4 Access Control (5 points)

| ID | Metric | Criticality | Type | Source(s) | Pass Criteria |
|----|--------|-------------|------|-----------|---------------|
| SEC-4.1 | Root Remote Access Blocked | **CRITICAL** | boolean | SQL | = true |
| SEC-4.2 | Limited SUPER Privilege | Important | threshold | SQL | <= 3 |
| SEC-4.3 | No Anonymous Accounts | **CRITICAL** | threshold | SQL | <= 0 |
| SEC-4.4 | No Wildcard Host Accounts | Important | threshold | SQL | <= 0 |
| SEC-4.5 | GRANT OPTION Minimal | Advisory | threshold | SQL | <= 2 |

**Scoring**: Weight pool = 11 (2x3 + 2x2 + 1x1), normalized to 5 points.
If SEC-4.1 or SEC-4.3 fails, subcategory capped at 3.0 points (60%).

## 3. Capacity (20 points)

### 3.1 Storage (5 points)

| ID | Metric | Criticality | Type | Source(s) | Pass Criteria |
|----|--------|-------------|------|-----------|---------------|
| CAP-1.1 | Disk Usage < 85% | **CRITICAL** | threshold | SQL | <= 85 |
| CAP-1.2 | InnoDB Tablespace Growth Healthy | Important | threshold | Monitoring, Worker | <= 180 |
| CAP-1.3 | Table Fragmentation Low | Advisory | threshold | SQL | <= 20 |
| CAP-1.4 | Aria Engine Storage Adequate | Advisory | boolean | SQL | = true |
| CAP-1.5 | Data Directory Monitored | Advisory | boolean | Monitoring, Worker | = true |
| CAP-1.7 | Buffer Pool Size Configured | Important | boolean | SQL | Non-empty, non-dummy value |
| CAP-1.6 | Total Data Size Tracked | Advisory | boolean | SQL | Non-empty, non-dummy value |
| CAP-1.54 | Redo Log Sized Adequately | Advisory | boolean | SQL | = true |

**Scoring**: Weight pool = 12 (1x3 + 2x2 + 5x1), normalized to 5 points.
If CAP-1.1 fails, subcategory capped at 3.0 points (60%).

### 3.2 Connections (5 points)

| ID | Metric | Criticality | Type | Source(s) | Pass Criteria |
|----|--------|-------------|------|-----------|---------------|
| CAP-2.1 | Connection Usage < 80% | **CRITICAL** | threshold | SQL | <= 80 |
| CAP-2.2 | Thread Pool Enabled | Advisory | enum | SQL | `pool-of-threads` |
| CAP-2.3 | Low Aborted Connections | Advisory | threshold | SQL | <= 1 |
| CAP-2.4 | Peak Connection Headroom | Important | threshold | SQL | <= 80 |

**Scoring**: Weight pool = 7 (1x3 + 1x2 + 2x1), normalized to 5 points.
If CAP-2.1 fails, subcategory capped at 3.0 points (60%).

### 3.3 Maintenance (6 points)

| ID | Metric | Criticality | Type | Source(s) | Pass Criteria |
|----|--------|-------------|------|-----------|---------------|
| CAP-3.2 | InnoDB Purge Lag Healthy | Important | threshold | SQL | N/A |
| CAP-3.3 | Tables Not Needing OPTIMIZE | Advisory | threshold | SQL | <= 0 |
| CAP-3.4 | Statistics Up to Date | Advisory | boolean | SQL | = true |
| CAP-3.5 | Event Scheduler Status | Advisory | boolean | SQL | = true |
| CAP-3.6 | Aria Page Cache Sized | Advisory | boolean | SQL | = true |
| CAP-3.56 | Buffer Pool Instances Tuned | Advisory | boolean | SQL | = true |

**Scoring**: Weight pool = 7 (0x3 + 1x2 + 5x1), normalized to 6 points.

### 3.4 Planning (4 points)

| ID | Metric | Criticality | Type | Source(s) | Pass Criteria |
|----|--------|-------------|------|-----------|---------------|
| CAP-4.1 | Auto-Increment Headroom | **CRITICAL** | threshold | SQL | <= 80 |
| CAP-4.2 | Disk Space Projection | Important | threshold | Monitoring, Worker | >= 180 |
| CAP-4.3 | Capacity Review | Advisory | boolean | Manual | = true |
| CAP-4.4 | Partitioning for Large Tables | Advisory | boolean | SQL | = true |

**Scoring**: Weight pool = 7 (1x3 + 1x2 + 2x1), normalized to 4 points.
If CAP-4.1 fails, subcategory capped at 2.4 points (60%).

## 4. Performance (20 points)

### 4.1 Caching (5 points)

| ID | Metric | Criticality | Type | Source(s) | Pass Criteria |
|----|--------|-------------|------|-----------|---------------|
| CAP-2.5 | Thread Cache Effective | Advisory | threshold | SQL | >= 90 |
| CAP-3.1 | InnoDB Buffer Pool Hit Ratio Healthy | **CRITICAL** | threshold | SQL | N/A |
| PERF-1.1 | Buffer Pool Read Hit Rate Healthy | **CRITICAL** | threshold | SQL | N/A |
| PERF-1.2 | Query Cache Disabled (10.11+) | Advisory | enum | SQL | `OFF`, `0`, `DEMAND` |
| PERF-1.3 | Aria Page Cache Hit Rate | Advisory | threshold | SQL | >= 95 |
| PERF-1.4 | Table Open Cache Effective | Advisory | threshold | SQL | >= 90 |
| PERF-1.5 | Join Buffer Size Tuned | Advisory | boolean | SQL | = true |
| PERF-1.53 | Key Buffer Minimal (InnoDB) | Advisory | boolean | SQL | = true |
| PERF-1.55 | Sort Buffer Size Tuned | Advisory | boolean | SQL | = true |

**Scoring**: Weight pool = 13 (2x3 + 0x2 + 7x1), normalized to 5 points.
If CAP-3.1 or PERF-1.1 fails, subcategory capped at 3.0 points (60%).

### 4.2 Query Performance (7 points)

| ID | Metric | Criticality | Type | Source(s) | Pass Criteria |
|----|--------|-------------|------|-----------|---------------|
| PERF-2.1 | Performance Schema Enabled | **CRITICAL** | enum | SQL | `ON`, `1` |
| PERF-2.2 | Slow Query Log Active | Important | enum | SQL | `ON`, `1` |
| PERF-2.3 | Long Query Time Threshold | Important | threshold | SQL | <= 1 |
| PERF-2.4 | Log Full Scans Enabled | Advisory | enum | SQL | `ON`, `1` |
| PERF-2.5 | Top Queries Reviewed | Advisory | boolean | Manual | = true |
| PERF-2.6 | Full Table Scan Rate Healthy | Important | threshold | SQL | N/A |
| PERF-2.7 | User Statistics Enabled | Advisory | enum | SQL | `ON`, `1` |
| PERF-2.8 | Query Throughput Tracked | Advisory | boolean | SQL | Non-empty, non-dummy value |
| PERF-2.57 | Low Filesort Rate | Advisory | threshold | SQL | <= 5 |

**Scoring**: Weight pool = 14 (1x3 + 3x2 + 5x1), normalized to 7 points.
If PERF-2.1 fails, subcategory capped at 4.2 points (60%).

### 4.3 Locking (4 points)

| ID | Metric | Criticality | Type | Source(s) | Pass Criteria |
|----|--------|-------------|------|-----------|---------------|
| PERF-3.1 | InnoDB Lock Waits Healthy | Important | threshold | SQL | N/A |
| PERF-3.2 | Deadlocks Minimal | Important | threshold | SQL | <= 5 |
| PERF-3.3 | Metadata Lock Contention Healthy | Important | threshold | SQL | N/A |
| PERF-3.4 | Galera Flow Control Low | Important | threshold | SQL | <= 5 |
| PERF-3.54 | Table Lock Contention Low | Advisory | threshold | SQL | <= 5 |

**Scoring**: Weight pool = 9 (0x3 + 4x2 + 1x1), normalized to 4 points.

### 4.4 Replication (4 points)

| ID | Metric | Criticality | Type | Source(s) | Pass Criteria |
|----|--------|-------------|------|-----------|---------------|
| PERF-4.1 | Replica Lag < 30s | **CRITICAL** | threshold | SQL | <= 30 |
| PERF-4.2 | Replica SQL Thread Running | **CRITICAL** | enum | SQL | `Yes` |
| PERF-4.3 | Replica IO Thread Running | **CRITICAL** | enum | SQL | `Yes` |
| PERF-4.4 | Galera Cluster Size Consistent | **CRITICAL** | boolean | SQL | = true |
| PERF-4.54 | GTID Consistency Maintained | Important | boolean | SQL | = true |

**Scoring**: Weight pool = 14 (4x3 + 1x2 + 0x1), normalized to 4 points.
If PERF-4.1 or PERF-4.2 or PERF-4.3 or PERF-4.4 fails, subcategory capped at 2.4 points (60%).

## 5. Future-Proofing (20 points)

### 5.1 Version Currency (7 points)

| ID | Metric | Criticality | Type | Source(s) | Pass Criteria |
|----|--------|-------------|------|-----------|---------------|
| FUT-1.1 | MariaDB Version Current | **CRITICAL** | boolean | SQL | Non-empty, non-dummy value |
| FUT-1.2 | Latest Minor Version Applied | Important | boolean | SQL | = true |
| FUT-1.3 | Not End-of-Life | **CRITICAL** | enum | SQL | `supported` |
| FUT-1.4 | InnoDB Storage Engine Used | Important | threshold | SQL | <= 0 |
| FUT-1.5 | LTS Release Track | Advisory | boolean | SQL | = true |

> **Gate**: FUT-1.3 (Not End-of-Life) — if this critical metric fails, the entire pillar is zeroed.

**Scoring**: Weight pool = 11 (2x3 + 2x2 + 1x1), normalized to 7 points.
If FUT-1.1 or FUT-1.3 fails, subcategory capped at 4.2 points (60%).

### 5.2 Configuration (3 points)

| ID | Metric | Criticality | Type | Source(s) | Pass Criteria |
|----|--------|-------------|------|-----------|---------------|
| FUT-2.1 | HA Solution Deployed | Important | boolean | Manual | = true |
| FUT-2.2 | MaxScale/ProxySQL Used | Advisory | boolean | Manual | = true |
| FUT-2.3 | InnoDB Strict Mode | Advisory | enum | SQL | `ON`, `1` |

**Scoring**: Weight pool = 4 (0x3 + 1x2 + 2x1), normalized to 3 points.

### 5.3 Upgrade Planning (6 points)

| ID | Metric | Criticality | Type | Source(s) | Pass Criteria |
|----|--------|-------------|------|-----------|---------------|
| FUT-3.1 | Upgrade Plan Documented | Advisory | boolean | Manual | = true |
| FUT-3.2 | Strict SQL Mode Enabled | Important | boolean | SQL | Non-empty, non-dummy value |
| FUT-3.3 | No Deprecated Features | Advisory | boolean | SQL | = true |
| FUT-3.4 | No MyISAM User Tables | Important | threshold | SQL | <= 0 |
| FUT-3.5 | utf8mb4 Character Set | Advisory | boolean | SQL | = true |
| FUT-3.6 | System Versioning Considered | Advisory | boolean | SQL | = true |
| FUT-3.52 | mysql_native_password Not Used | Important | threshold | SQL | <= 0 |

**Scoring**: Weight pool = 10 (0x3 + 3x2 + 4x1), normalized to 6 points.

### 5.4 Health Foundation (4 points)

| ID | Metric | Criticality | Type | Source(s) | Pass Criteria |
|----|--------|-------------|------|-----------|---------------|
| FUT-4.1 | Monitoring Connected | **CRITICAL** | boolean | Manual | = true |
| FUT-4.2 | Alerting Configured | Important | boolean | Manual | = true |
| FUT-4.3 | Slow Query Analysis | Advisory | boolean | Manual | = true |
| FUT-4.4 | Change Management Process | Advisory | boolean | Manual | = true |

**Scoring**: Weight pool = 7 (1x3 + 1x2 + 2x1), normalized to 4 points.
If FUT-4.1 fails, subcategory capped at 2.4 points (60%).

---

## Appendix A: Metrics by Source

### SQL / Healthcheck Scripts (82 metrics)

These metrics are collected via direct database queries.

| ID | Metric | Pillar | Criticality |
|----|--------|--------|-------------|
| BAK-1.1 | Binary Log Enabled | Backup & Recovery | **CRITICAL** |
| BAK-1.2 | Binlog Format ROW | Backup & Recovery | **CRITICAL** |
| BAK-1.3 | Binary Log Expire Configured | Backup & Recovery | Important |
| BAK-1.4 | GTID Mode Enabled | Backup & Recovery | Important |
| BAK-1.5 | Binlog Sync Durable | Backup & Recovery | Advisory |
| SEC-1.1 | TLS Connections 100% | Security | **CRITICAL** |
| SEC-1.2 | Modern Auth Plugin Used | Security | Important |
| SEC-1.3 | Password Validation Enabled | Security | Important |
| SEC-1.5 | Password Expiry Policy | Security | Advisory |
| SEC-2.1 | Secure Transport Required | Security | **CRITICAL** |
| SEC-2.2 | TLS 1.2+ Required | Security | **CRITICAL** |
| SEC-2.3 | InnoDB TDE Enabled | Security | Advisory |
| SEC-2.4 | Binlog Encryption | Security | Advisory |
| SEC-2.5 | SSL Certificate Valid | Security | Important |
| SEC-3.1 | MariaDB Audit Plugin Enabled | Security | Important |
| SEC-3.2 | Slow Query Log Enabled | Security | Important |
| SEC-3.3 | Error Log Configured | Security | Important |
| SEC-3.4 | Log Raw Passwords Off | Security | **CRITICAL** |
| SEC-4.1 | Root Remote Access Blocked | Security | **CRITICAL** |
| SEC-4.2 | Limited SUPER Privilege | Security | Important |
| SEC-4.3 | No Anonymous Accounts | Security | **CRITICAL** |
| SEC-4.4 | No Wildcard Host Accounts | Security | Important |
| SEC-4.5 | GRANT OPTION Minimal | Security | Advisory |
| CAP-1.1 | Disk Usage < 85% | Capacity | **CRITICAL** |
| CAP-1.3 | Table Fragmentation Low | Capacity | Advisory |
| CAP-1.4 | Aria Engine Storage Adequate | Capacity | Advisory |
| CAP-2.1 | Connection Usage < 80% | Capacity | **CRITICAL** |
| CAP-2.2 | Thread Pool Enabled | Capacity | Advisory |
| CAP-2.3 | Low Aborted Connections | Capacity | Advisory |
| CAP-2.4 | Peak Connection Headroom | Capacity | Important |
| CAP-2.5 | Thread Cache Effective | Performance | Advisory |
| CAP-3.1 | InnoDB Buffer Pool Hit Ratio Healthy | Performance | **CRITICAL** |
| CAP-3.2 | InnoDB Purge Lag Healthy | Capacity | Important |
| CAP-3.3 | Tables Not Needing OPTIMIZE | Capacity | Advisory |
| CAP-3.4 | Statistics Up to Date | Capacity | Advisory |
| CAP-3.5 | Event Scheduler Status | Capacity | Advisory |
| CAP-3.6 | Aria Page Cache Sized | Capacity | Advisory |
| CAP-4.1 | Auto-Increment Headroom | Capacity | **CRITICAL** |
| CAP-4.4 | Partitioning for Large Tables | Capacity | Advisory |
| PERF-1.1 | Buffer Pool Read Hit Rate Healthy | Performance | **CRITICAL** |
| PERF-1.2 | Query Cache Disabled (10.11+) | Performance | Advisory |
| PERF-1.3 | Aria Page Cache Hit Rate | Performance | Advisory |
| PERF-1.4 | Table Open Cache Effective | Performance | Advisory |
| PERF-1.5 | Join Buffer Size Tuned | Performance | Advisory |
| PERF-2.1 | Performance Schema Enabled | Performance | **CRITICAL** |
| PERF-2.2 | Slow Query Log Active | Performance | Important |
| PERF-2.3 | Long Query Time Threshold | Performance | Important |
| PERF-2.4 | Log Full Scans Enabled | Performance | Advisory |
| PERF-2.6 | Full Table Scan Rate Healthy | Performance | Important |
| PERF-2.7 | User Statistics Enabled | Performance | Advisory |
| PERF-3.1 | InnoDB Lock Waits Healthy | Performance | Important |
| PERF-3.2 | Deadlocks Minimal | Performance | Important |
| PERF-3.3 | Metadata Lock Contention Healthy | Performance | Important |
| PERF-3.4 | Galera Flow Control Low | Performance | Important |
| PERF-4.1 | Replica Lag < 30s | Performance | **CRITICAL** |
| PERF-4.2 | Replica SQL Thread Running | Performance | **CRITICAL** |
| PERF-4.3 | Replica IO Thread Running | Performance | **CRITICAL** |
| PERF-4.4 | Galera Cluster Size Consistent | Performance | **CRITICAL** |
| FUT-1.1 | MariaDB Version Current | Future-Proofing | **CRITICAL** |
| FUT-1.2 | Latest Minor Version Applied | Future-Proofing | Important |
| FUT-1.3 | Not End-of-Life | Future-Proofing | **CRITICAL** |
| FUT-1.4 | InnoDB Storage Engine Used | Future-Proofing | Important |
| FUT-1.5 | LTS Release Track | Future-Proofing | Advisory |
| FUT-2.3 | InnoDB Strict Mode | Future-Proofing | Advisory |
| FUT-3.2 | Strict SQL Mode Enabled | Future-Proofing | Important |
| FUT-3.3 | No Deprecated Features | Future-Proofing | Advisory |
| FUT-3.4 | No MyISAM User Tables | Future-Proofing | Important |
| FUT-3.5 | utf8mb4 Character Set | Future-Proofing | Advisory |
| FUT-3.6 | System Versioning Considered | Future-Proofing | Advisory |
| PERF-4.54 | GTID Consistency Maintained | Performance | Important |
| SEC-2.6 | SSL Available | Security | Important |
| SEC-3.51 | Audit Plugin Enabled | Security | Important |
| CAP-1.7 | Buffer Pool Size Configured | Capacity | Important |
| CAP-1.6 | Total Data Size Tracked | Capacity | Advisory |
| CAP-3.56 | Buffer Pool Instances Tuned | Capacity | Advisory |
| CAP-1.54 | Redo Log Sized Adequately | Capacity | Advisory |
| PERF-2.8 | Query Throughput Tracked | Performance | Advisory |
| PERF-1.53 | Key Buffer Minimal (InnoDB) | Performance | Advisory |
| PERF-1.55 | Sort Buffer Size Tuned | Performance | Advisory |
| PERF-2.57 | Low Filesort Rate | Performance | Advisory |
| PERF-3.54 | Table Lock Contention Low | Performance | Advisory |
| FUT-3.52 | mysql_native_password Not Used | Future-Proofing | Important |

### Monitoring (5 metrics)

These metrics are collected from monitoring systems (Zabbix, PMM, worker scripts).

| ID | Metric | Pillar | Criticality |
|----|--------|--------|-------------|
| BAK-2.2 | Last Backup Age | Backup & Recovery | Important |
| SEC-1.4 | Low Failed Logins (24h) | Security | Important |
| CAP-1.2 | InnoDB Tablespace Growth Healthy | Capacity | Important |
| CAP-1.5 | Data Directory Monitored | Capacity | Advisory |
| CAP-4.2 | Disk Space Projection | Capacity | Important |

### Manual Inputs (24 metrics)

These metrics require manual input from the operator.

| ID | Metric | Pillar | Criticality | Remediation |
|----|--------|--------|-------------|-------------|
| BAK-2.1 | Backup Schedule Defined | Backup & Recovery | **CRITICAL** | Document and implement a backup schedule (daily recommended) |
| BAK-2.3 | Logical Backup Scheduled | Backup & Recovery | Advisory | Schedule regular mariadb-dump for logical backup in addition to physical backups |
| BAK-2.4 | Backup Verification | Backup & Recovery | Advisory | Implement backup verification process (restore tests on non-production) |
| BAK-3.1 | mariadb-backup Used | Backup & Recovery | Important | Install mariadb-backup for consistent online physical backups (replaces XtraBackup for MariaDB) |
| BAK-3.2 | PITR Capability | Backup & Recovery | Important | Enable binary logging and test PITR procedures using mariadb-binlog |
| BAK-3.3 | Backup Encryption | Backup & Recovery | Advisory | Enable backup encryption using mariadb-backup --encrypt or encrypted storage |
| BAK-3.4 | Replica Used for DR | Backup & Recovery | Advisory | Configure a delayed replica (CHANGE MASTER TO ... MASTER_DELAY = N) for DR |
| BAK-4.1 | RPO Target Defined | Backup & Recovery | **CRITICAL** | Define and document RPO target based on business requirements |
| BAK-4.2 | RTO Target Defined | Backup & Recovery | **CRITICAL** | Define and document RTO target based on business requirements |
| BAK-4.3 | Restore Tested (90d) | Backup & Recovery | Important | Schedule regular restore tests (at least quarterly) |
| BAK-4.4 | DR Plan Documented | Backup & Recovery | Advisory | Document disaster recovery procedures and runbooks |
| BAK-5.1 | Retention Policy Met | Backup & Recovery | Important | Configure backup retention to meet compliance requirements |
| BAK-5.2 | Binlog Retention Adequate | Backup & Recovery | Advisory | Ensure expire_logs_days covers required recovery window |
| BAK-5.3 | Offsite Backup Copy | Backup & Recovery | Advisory | Implement offsite backup copies to S3, Azure Blob, or remote storage |
| SEC-3.5 | Log Retention (90d) | Security | Advisory | Configure log rotation to retain logs for compliance period |
| CAP-4.3 | Capacity Review | Capacity | Advisory | Establish a regular capacity review process |
| PERF-2.5 | Top Queries Reviewed | Performance | Advisory | Review performance_schema.events_statements_summary_by_digest or use pt-query-digest |
| FUT-2.1 | HA Solution Deployed | Future-Proofing | Important | Implement Galera Cluster or MariaDB MaxScale for automatic failover (MariaDB does NOT use InnoDB Clu |
| FUT-2.2 | MaxScale/ProxySQL Used | Future-Proofing | Advisory | Deploy MariaDB MaxScale for connection pooling, query routing, and failover transparency |
| FUT-3.1 | Upgrade Plan Documented | Future-Proofing | Advisory | Document upgrade path and schedule before current version approaches EOL |
| FUT-4.1 | Monitoring Connected | Future-Proofing | **CRITICAL** | Connect MariaDB to Percona Monitoring and Management (PMM) or Zabbix |
| FUT-4.2 | Alerting Configured | Future-Proofing | Important | Configure alerts for replication lag, Galera flow control, connection saturation, disk usage |
| FUT-4.3 | Slow Query Analysis | Future-Proofing | Advisory | Use pt-query-digest or analyze performance_schema.events_statements_summary_by_digest periodically |
| FUT-4.4 | Change Management Process | Future-Proofing | Advisory | Implement schema migration tooling (Liquibase, Flyway) and change approval process |

## Appendix B: Gate Metrics

| ID | Metric | Criticality | Gate Scope | Effect |
|----|--------|-------------|------------|--------|
| BAK-1.1 | Binary Log Enabled | **CRITICAL** | pillar | Zeros entire pillar score |
| FUT-1.3 | Not End-of-Life | **CRITICAL** | pillar | Zeros entire pillar score |
