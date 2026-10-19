# PostgreSQL Scoring Reference

> Auto-generated from catalog v1.14.0. Do not edit manually — modify the JSON catalog and re-run `npm run generate-docs`.

## Overview

| Property | Value |
|----------|-------|
| Technology | PostgreSQL |
| Catalog Version | 1.14.0 |
| Total Metrics | 172 |
| Critical | 27 (weight: 3x) |
| Important | 76 (weight: 2x) |
| Advisory | 69 (weight: 1x) |
| Max Score | 100 points (5 pillars x 20 points) |

## Scoring Summary

| Pillar | Subcategory | Points | Metrics | Critical |
|--------|-------------|--------|---------|----------|
| **Backup & Recovery** (20pts) | Log Archiving | 5 | 7 | 2 |
|  | Scheduled Backups | 4 | 3 | 1 |
|  | Backup Tools | 3 | 4 | 0 |
|  | Recovery Readiness | 5 | 11 | 3 |
|  | Retention Compliance | 3 | 4 | 0 |
| **Security** (20pts) | Authentication | 5 | 6 | 2 |
|  | Encryption | 5 | 7 | 2 |
|  | Audit & Logging | 5 | 5 | 0 |
|  | Access Control | 5 | 8 | 0 |
| **Capacity** (20pts) | Storage | 5 | 9 | 2 |
|  | Connections | 5 | 9 | 1 |
|  | Maintenance | 6 | 15 | 3 |
|  | Planning | 4 | 8 | 2 |
| **Performance** (20pts) | Caching | 5 | 14 | 0 |
|  | Query Performance | 7 | 25 | 1 |
|  | Locking | 3 | 4 | 0 |
|  | Replication | 5 | 11 | 4 |
| **Future-Proofing** (20pts) | Version Currency | 6 | 5 | 2 |
|  | Configuration | 5 | 10 | 2 |
|  | Upgrade Planning | 5 | 4 | 0 |
|  | Health Foundation | 4 | 3 | 0 |

## 1. Backup & Recovery (20 points)

### 1.1 Log Archiving (5 points)

| ID | Metric | Criticality | Type | Source(s) | Pass Criteria |
|----|--------|-------------|------|-----------|---------------|
| BAK-1.1 | Archive Mode Enabled | **CRITICAL** | enum | SQL | `on`, `always` |
| BAK-1.2 | Archive Command Configured | **CRITICAL** | boolean | SQL | Non-empty, non-dummy value |
| BAK-1.3 | No Archive Failures (24h) | Important | threshold | SQL, Monitoring | <= 0 |
| BAK-1.4 | WAL Level Adequate | Important | enum | SQL | `replica`, `logical` |
| BAK-1.5 | WAL Summarization Enabled | Advisory | enum | SQL | `on` |
| BAK-1.6 | WAL Compression Enabled | Advisory | enum | SQL | `on`, `lz4`, `zstd` |
| BAK-1.7 | Archive Timeout Bounds the Declared RPO | Advisory | threshold | SQL | per declared rpo_target; otherwise >= 0 |

> **Applies when**: BAK-1.2 (Archive Command Configured) — `archive_mode` in `on`, `always`.

> **Applies when**: BAK-1.3 (No Archive Failures (24h)) — `archive_mode` in `on`, `always`.

> **Applies when**: BAK-1.7 (Archive Timeout Bounds the Declared RPO) — `archive_mode` in `on`, `always`.

> **Not required when**: BAK-1.1 (Archive Mode Enabled) — `rpo_target` in `rpo_1440`. It still counts, but leaves the target and never gates.

> **Not required when**: BAK-1.2 (Archive Command Configured) — `rpo_target` in `rpo_1440`. It still counts, but leaves the target and never gates.

> **Not required when**: BAK-1.3 (No Archive Failures (24h)) — `rpo_target` in `rpo_1440`. It still counts, but leaves the target and never gates.

> **Not required when**: BAK-1.5 (WAL Summarization Enabled) — `rpo_target` in `rpo_1440`. It still counts, but leaves the target and never gates.

> **Not required when**: BAK-1.7 (Archive Timeout Bounds the Declared RPO) — `rpo_target` in `rpo_1440`. It still counts, but leaves the target and never gates.

**Scoring**: Weight pool = 13 (2x3 + 2x2 + 3x1), normalized to 5 points.
If BAK-1.1 or BAK-1.2 fails, subcategory capped at 3.0 points (60%).

### 1.2 Scheduled Backups (4 points)

| ID | Metric | Criticality | Type | Source(s) | Pass Criteria |
|----|--------|-------------|------|-----------|---------------|
| BAK-2.1 | Backup Schedule Defined | **CRITICAL** | enum | Manual | `daily`, `hourly`, `continuous`, `wal_only` |
| BAK-2.2 | Last Backup Age | Important | threshold | Monitoring, Worker | per declared rpo_target; otherwise <= 24 |
| BAK-2.3 | Backup Verification | Advisory | boolean | Manual | = true |

**Scoring**: Weight pool = 6 (1x3 + 1x2 + 1x1), normalized to 4 points.
If BAK-2.1 fails, subcategory capped at 2.4 points (60%).

### 1.3 Backup Tools (3 points)

| ID | Metric | Criticality | Type | Source(s) | Pass Criteria |
|----|--------|-------------|------|-----------|---------------|
| BAK-3.1 | Enterprise Backup Tool | Important | enum | Manual | `pgbackrest`, `barman`, `pg_probackup`, `wal-g` |
| BAK-3.2 | PITR Capability | Important | boolean | Manual | = true |
| BAK-3.3 | Backup Encryption | Advisory | boolean | Manual | = true |
| CHK-BAK-2 | Backup Tool Detected | Advisory | boolean | SQL | = true |

> **Not required when**: BAK-3.1 (Enterprise Backup Tool) — `rpo_target` in `rpo_1440` AND `rto_target` in `rto_480`, `rto_1440`. It still counts, but leaves the target and never gates.

> **Not required when**: BAK-3.2 (PITR Capability) — `rpo_target` in `rpo_1440` AND `rto_target` in `rto_480`, `rto_1440`. It still counts, but leaves the target and never gates.

> **Not required when**: BAK-3.3 (Backup Encryption) — `security_posture` in `baseline`. It still counts, but leaves the target and never gates.

> **Not required when**: CHK-BAK-2 (Backup Tool Detected) — `rpo_target` in `rpo_1440`. It still counts, but leaves the target and never gates.

**Scoring**: Weight pool = 6 (0x3 + 2x2 + 2x1), normalized to 3 points.

### 1.4 Recovery Readiness (5 points)

| ID | Metric | Criticality | Type | Source(s) | Pass Criteria |
|----|--------|-------------|------|-----------|---------------|
| BAK-4.1 | RPO Target Defined | **CRITICAL** | enum | Manual | `rpo_5`, `rpo_15`, `rpo_60`, `rpo_240`, `rpo_1440` |
| BAK-4.2 | RTO Target Defined | **CRITICAL** | enum | Manual | `rto_5`, `rto_15`, `rto_60`, `rto_240`, `rto_480`, `rto_1440` |
| BAK-4.3 | Restore Tested (90d) | Important | boolean | Manual | = true |
| BAK-4.4 | DR Plan Documented | Advisory | boolean | Manual | = true |
| BAK-4.5 | Replica Connected | Important | boolean | SQL | = true |
| BAK-4.6 | Synchronous Mode | Advisory | enum | SQL | `sync`, `async`, `on`, `off` |
| HA-1.3 | Failover Candidate Available | **CRITICAL** | boolean | Monitoring, Worker | = true |
| HA-2.7 | Failover Frequency Normal | Important | threshold | Monitoring, Worker | <= 3 |
| BAK-4.7 | HA Standby Available | Important | threshold | SQL, Monitoring | >= 1 |
| BAK-4.8 | Restore Throughput Attested | Advisory | threshold | Manual | >= 0 |
| BAK-4.9 | Restore Time Within Declared RTO | Important | threshold | SQL | per declared rto_target; otherwise <= 1440 |

> **Not required when**: BAK-4.5 (Replica Connected) — `ha_topology` in `none`. It still counts, but leaves the target and never gates.

> **Not required when**: BAK-4.7 (HA Standby Available) — `ha_topology` in `none`. It still counts, but leaves the target and never gates.

> **Not required when**: BAK-4.9 (Restore Time Within Declared RTO) — `ha_topology` in `async_standby`, `sync_standby`, `cluster_managed`. It still counts, but leaves the target and never gates.

**Scoring**: Weight pool = 22 (3x3 + 5x2 + 3x1), normalized to 5 points.
If BAK-4.1 or BAK-4.2 or HA-1.3 fails, subcategory capped at 3.0 points (60%).

### 1.5 Retention Compliance (3 points)

| ID | Metric | Criticality | Type | Source(s) | Pass Criteria |
|----|--------|-------------|------|-----------|---------------|
| BAK-5.1 | Retention Policy Met | Important | boolean | Manual | = true |
| BAK-5.2 | Offsite Backup Copy | Important | boolean | Manual | = true |
| EXT-TS-3 | TimescaleDB Retention Policy Active | Advisory | boolean | SQL | = true |
| EXT-PM-2 | pg_partman Retention Active | Advisory | boolean | SQL | = true |

**Scoring**: Weight pool = 6 (0x3 + 2x2 + 2x1), normalized to 3 points.

## 2. Security (20 points)

### 2.1 Authentication (5 points)

| ID | Metric | Criticality | Type | Source(s) | Pass Criteria |
|----|--------|-------------|------|-----------|---------------|
| SEC-1.1 | SSL Connections 100% | **CRITICAL** | threshold | SQL | >= 100 |
| SEC-1.2 | Password Encryption SCRAM | **CRITICAL** | enum | SQL | `scram-sha-256` |
| SEC-1.3 | No Remote Superuser | Important | threshold | SQL | <= 0 |
| SEC-1.4 | Low Failed Logins (24h) | Important | threshold | Monitoring, Worker | <= 10 |
| SEC-1.5 | Password Policy | Advisory | threshold | SQL | <= 90 |
| SEC-1.6 | No MD5 Auth in pg_hba | Important | threshold | SQL | <= 0 |

**Scoring**: Weight pool = 13 (2x3 + 3x2 + 1x1), normalized to 5 points.
If SEC-1.1 or SEC-1.2 fails, subcategory capped at 3.0 points (60%).

### 2.2 Encryption (5 points)

| ID | Metric | Criticality | Type | Source(s) | Pass Criteria |
|----|--------|-------------|------|-----------|---------------|
| SEC-2.1 | SSL Enabled | **CRITICAL** | enum | SQL | `on` |
| SEC-2.2 | TLS 1.2+ Required | **CRITICAL** | enum | SQL | `TLSv1.2`, `TLSv1.3` |
| SEC-2.3 | SSL Certificate Valid | Important | threshold | SQL | >= 30 |
| SEC-2.4 | Data at Rest Encrypted | Advisory | boolean | Manual, SQL | = true |
| SEC-2.5 | Data Checksums Enabled | Important | enum | SQL | `on` |
| HA-2.4 | DCS Communication Encrypted | Important | boolean | Manual | = true |
| HA-3.1 | Patroni REST API TLS | Advisory | boolean | Manual | = true |

> **Applies when**: SEC-2.2 (TLS 1.2+ Required) — `ssl_enabled` is true.

> **Applies when**: SEC-2.3 (SSL Certificate Valid) — `ssl_enabled` is true.

> **Not required when**: SEC-2.4 (Data at Rest Encrypted) — `security_posture` in `baseline`. It still counts, but leaves the target and never gates.

**Scoring**: Weight pool = 14 (2x3 + 3x2 + 2x1), normalized to 5 points.
If SEC-2.1 or SEC-2.2 fails, subcategory capped at 3.0 points (60%).

### 2.3 Audit & Logging (5 points)

| ID | Metric | Criticality | Type | Source(s) | Pass Criteria |
|----|--------|-------------|------|-----------|---------------|
| SEC-3.1 | Log Connections | Important | enum | SQL | `on` |
| SEC-3.2 | Log Disconnections | Advisory | enum | SQL | `on` |
| SEC-3.3 | Log DDL Statements | Important | enum | SQL | `ddl`, `mod`, `all` |
| SEC-3.4 | pgAudit Enabled | Important | boolean | SQL | = true |
| SEC-3.5 | Log Retention (90d) | Advisory | threshold | Manual | >= 90 |

> **Not required when**: SEC-3.4 (pgAudit Enabled) — `security_posture` in `baseline`, `hardened`. It still counts, but leaves the target and never gates.

**Scoring**: Weight pool = 8 (0x3 + 3x2 + 2x1), normalized to 5 points.

### 2.4 Access Control (5 points)

| ID | Metric | Criticality | Type | Source(s) | Pass Criteria |
|----|--------|-------------|------|-----------|---------------|
| SEC-4.1 | No Public Grants | Important | boolean | SQL | = true |
| SEC-4.2 | Limited Superusers | Important | threshold | SQL | <= 3 |
| SEC-4.3 | Role-Based Access | Advisory | boolean | SQL | = true |
| SEC-4.4 | Row-Level Security | Advisory | boolean | SQL | = true |
| SEC-4.5 | allow_alter_system Off | Important | enum | SQL | `off` |
| HA-2.5 | Patroni REST API Authenticated | Important | boolean | Manual | = true |
| SEC-4.6 | Azure PG Admin Membership Limited | Important | threshold | SQL | <= 2 |
| SEC-4.7 | Security Posture Target | Important | enum | Manual | `baseline`, `hardened`, `regulated` |

**Scoring**: Weight pool = 14 (0x3 + 6x2 + 2x1), normalized to 5 points.

## 3. Capacity (20 points)

### 3.1 Storage (5 points)

| ID | Metric | Criticality | Type | Source(s) | Pass Criteria |
|----|--------|-------------|------|-----------|---------------|
| CAP-1.1 | Database Size (capture) | Advisory | threshold | SQL, Monitoring | >= 0 |
| CAP-1.2 | Healthy Growth Rate | Important | threshold | Monitoring, Worker | per declared growth_headroom_target; otherwise >= 90 |
| CAP-1.3 | Tablespace Usage < 90% | Important | threshold | SQL | <= 90 |
| CAP-1.5 | Partition Count Healthy | Important | threshold | SQL | <= 4000 |
| EXT-TS-2 | TimescaleDB Chunk Count Healthy | Important | threshold | SQL | <= 2000 |
| EXT-CIT-1 | Citus Shard Placement Health | **CRITICAL** | threshold | SQL | <= 0 |
| CAP-1.6 | Top Tables Analysis | Advisory | boolean | Manual | = true |
| CAP-1.7 | Disk Usage < 85% | **CRITICAL** | threshold | Monitoring, Worker | <= 85 |
| CAP-1.8 | Temp File Limit Set | Advisory | threshold | SQL | >= 1 |

> **Applies when**: CAP-1.3 (Tablespace Usage < 90%) — `tablespace_headroom` is provided.

**Scoring**: Weight pool = 17 (2x3 + 4x2 + 3x1), normalized to 5 points.
If EXT-CIT-1 or CAP-1.7 fails, subcategory capped at 3.0 points (60%).

### 3.2 Connections (5 points)

| ID | Metric | Criticality | Type | Source(s) | Pass Criteria |
|----|--------|-------------|------|-----------|---------------|
| CAP-2.1 | Connection Usage < 80% | **CRITICAL** | threshold | SQL, Monitoring | <= 80 |
| CAP-2.2 | Connection Pooler | Important | boolean | Manual, SQL | = true |
| CAP-2.3 | Idle Connections < 50% | Advisory | threshold | SQL | <= 50 |
| CAP-2.4 | Reserved Connections > 0 | Advisory | threshold | SQL | >= 1 |
| CAP-2.6 | PgBouncer Pool Mode Transaction | Important | enum | SQL | `transaction` |
| CAP-2.7 | PgBouncer Pool Size Configured | Advisory | threshold | SQL | >= 5 AND <= 100 |
| CAP-2.8 | PgBouncer Max Client Connections | Advisory | threshold | SQL | >= 50 |
| CAP-2.9 | PgBouncer Min Pool Size Set | Advisory | threshold | SQL | >= 1 |
| CAP-2.10 | PgBouncer Startup Params Safe | Advisory | boolean | SQL | = true |

> **Applies when**: CAP-2.3 (Idle Connections < 50%) — `connection_pooler` is not true.

> **Applies when**: CAP-2.9 (PgBouncer Min Pool Size Set) — `pgbouncer_min_pool_size` is provided.

> **Applies when**: CAP-2.10 (PgBouncer Startup Params Safe) — `pgbouncer_ignore_startup_params` is provided.

**Scoring**: Weight pool = 13 (1x3 + 2x2 + 6x1), normalized to 5 points.
If CAP-2.1 fails, subcategory capped at 3.0 points (60%).

### 3.3 Maintenance (6 points)

| ID | Metric | Criticality | Type | Source(s) | Pass Criteria |
|----|--------|-------------|------|-----------|---------------|
| CAP-3.1 | Autovacuum Enabled | **CRITICAL** | enum | SQL | `on` |
| CAP-3.2 | Table Bloat Healthy | Important | threshold | SQL, Monitoring | N/A |
| CAP-3.3 | Index Bloat < 30% | Important | threshold | SQL | <= 30 |
| CAP-3.4 | Dead Tuples < 10% | Advisory | threshold | SQL | <= 10 |
| CAP-3.5 | Vacuum Timing Healthy | Advisory | threshold | SQL | <= 3600 |
| CAP-3.6 | Maintenance Work Mem Sized to RAM | Advisory | threshold | SQL | N/A |
| EXT-VEC-2 | pgvector Dead Tuple Impact | Important | threshold | SQL | <= 10 |
| EXT-TS-1 | TimescaleDB Compression Jobs OK | Important | boolean | SQL | = true |
| EXT-CRON-1 | pg_cron No Failed Jobs (24h) | Important | threshold | SQL | <= 0 |
| CAP-3.7 | Freeze Max Age Configured | **CRITICAL** | threshold | SQL | >= 200000000 AND <= 1500000000 |
| CAP-3.8 | No Autovacuum-Disabled Tables | **CRITICAL** | threshold | SQL | <= 0 |
| CAP-3.9 | Unused Index Count | Advisory | threshold | SQL | <= 10 |
| CAP-3.10 | Statistics Collection Enabled | Important | enum | SQL | `on` |
| CAP-3.11 | Autovacuum Workers Adequate | Advisory | threshold | SQL | >= 3 |
| CAP-3.12 | Autovacuum Cost Limit Tuned | Advisory | threshold | SQL | >= 1000 |

**Scoring**: Weight pool = 27 (3x3 + 6x2 + 6x1), normalized to 6 points.
If CAP-3.1 or CAP-3.7 or CAP-3.8 fails, subcategory capped at 3.6 points (60%).

### 3.4 Planning (4 points)

| ID | Metric | Criticality | Type | Source(s) | Pass Criteria |
|----|--------|-------------|------|-----------|---------------|
| CAP-4.1 | XID Wraparound Safe | **CRITICAL** | threshold | SQL, Monitoring | <= 50 |
| CAP-4.2 | Growth Projection | Advisory | boolean | Manual | = true |
| CAP-4.3 | Scaling Strategy Documented | Advisory | boolean | Manual | = true |
| CAP-4.4 | No Stale Replication Slots | **CRITICAL** | threshold | SQL | <= 0 |
| CAP-4.5 | Idle Slot Timeout Set | Important | boolean | SQL | = true |
| CAP-4.6 | Default Partition Overflow | Important | threshold | SQL | <= 1 |
| EXT-PM-1 | pg_partman Premake Healthy | Important | boolean | SQL | = true |
| CAP-4.7 | Capacity Growth Headroom Target | Important | enum | Manual | `months_3`, `months_6`, `months_12` |

**Scoring**: Weight pool = 16 (2x3 + 4x2 + 2x1), normalized to 4 points.
If CAP-4.1 or CAP-4.4 fails, subcategory capped at 2.4 points (60%).

## 4. Performance (20 points)

### 4.1 Caching (5 points)

| ID | Metric | Criticality | Type | Source(s) | Pass Criteria |
|----|--------|-------------|------|-----------|---------------|
| PER-1.1 | Cache Hit Ratio Healthy | Important | threshold | SQL, Monitoring | N/A |
| PER-1.2 | Shared Buffers Sized | Advisory | threshold | SQL | >= 20 AND <= 40 |
| PER-1.3 | Effective Cache Size | Advisory | boolean | SQL | = true |
| PER-1.4 | Checkpoint Requested Ratio Healthy | Advisory | threshold | SQL | N/A |
| PER-1.5 | track_io_timing Enabled | Important | enum | SQL | `on` |
| PER-1.6 | Async I/O Method | Advisory | enum | SQL | `io_uring`, `worker` |
| PER-1.7 | Checkpoint Target Healthy | Advisory | threshold | SQL | >= 0.9 |
| EXT-VEC-3 | pgvector Index Cache Hit | Important | threshold | SQL | >= 95 |
| CHK-PER-1 | Index Hit Ratio | Advisory | threshold | SQL | >= 95 |
| PER-1.8 | Huge Pages Configured | Important | enum | SQL | `try`, `on` |
| PER-1.9 | OS Huge Pages Allocated | Advisory | threshold | Manual | >= 1 |
| PER-1.10 | Memory Budget Within Safe Headroom | Important | threshold | SQL | <= 80 |
| PER-1.11 | WAL Buffers Size | Advisory | threshold | SQL | >= 8388608 |
| PER-1.13 | Shared Buffers (Bytes) | Advisory | threshold | SQL | >= 134217728 |

**Scoring**: Weight pool = 19 (0x3 + 5x2 + 9x1), normalized to 5 points.

### 4.2 Query Performance (7 points)

| ID | Metric | Criticality | Type | Source(s) | Pass Criteria |
|----|--------|-------------|------|-----------|---------------|
| PER-2.1 | pg_stat_statements Enabled | **CRITICAL** | boolean | SQL | = true |
| PER-2.2 | Slow Queries (1h) < 10 | Important | threshold | SQL, Monitoring | <= 10 |
| PER-2.3 | Long Running < 5 | Important | threshold | SQL | <= 5 |
| PER-2.4 | Query Review Performed (90d) | Advisory | boolean | Manual | = true |
| PER-2.5 | transaction_timeout Set | Advisory | boolean | SQL | = true |
| PER-2.6 | Partition Pruning Enabled | Important | enum | SQL | `on` |
| PER-2.7 | Work Mem Sized to RAM | Advisory | threshold | SQL | N/A |
| PER-2.8 | Random Page Cost (SSD) | Advisory | threshold | SQL | <= 1.5 |
| PER-2.9 | Temp File Usage Bounded by RAM | Advisory | threshold | SQL | N/A |
| EXT-VEC-1 | pgvector HNSW Index Health | Important | threshold | SQL | <= 20 |
| CHK-PER-2 | Sequential Scan Ratio | Advisory | threshold | SQL | <= 20 |
| PER-2.10 | IO Concurrency Configured | Important | threshold | SQL | >= 100 |
| PER-2.11 | Slow Query Logging Configured | Important | threshold | SQL | >= 0 AND <= 5000 |
| PER-2.12 | Worker Process Budget Adequate | Important | threshold | SQL | >= 2 |
| PER-2.13 | Max Parallel Workers Configured | Important | threshold | SQL | N/A |
| PER-2.14 | Parallel Workers Per Gather Configured | Important | threshold | SQL | N/A |
| PER-2.15 | Background Worker Breakdown | Advisory | boolean | SQL | = true |
| PER-2.16 | Azure Query Store Enabled | Important | enum | SQL | `top`, `all`, `TOP`, `ALL` |
| PER-2.17 | Azure Wait Sampling Enabled | Advisory | enum | SQL | `all`, `ALL` |
| PER-2.18 | Azure Intelligent Tuning | Advisory | boolean | SQL | Non-empty, non-dummy value |
| PER-2.19 | JIT Compilation State | Advisory | enum | SQL | `on`, `off`, `true`, `false` |
| PER-2.20 | Default Statistics Target | Advisory | threshold | SQL | N/A |
| PER-2.21 | Work Mem (Bytes) | Advisory | threshold | SQL | >= 4194304 |
| PER-2.22 | Max Connections (Cap) | Advisory | threshold | SQL | >= 10 |
| PER-2.23 | Statement Timeout Set | Advisory | threshold | SQL | >= 1 |

> **Applies when**: PER-2.10 (IO Concurrency Configured) — `pg_version` <= 17.

> **Applies when**: PER-2.16 (Azure Query Store Enabled) — `query_store_mode` is provided.

> **Applies when**: PER-2.17 (Azure Wait Sampling Enabled) — `wait_sampling_mode` is provided.

> **Applies when**: PER-2.18 (Azure Intelligent Tuning) — `intelligent_tuning` is provided.

**Scoring**: Weight pool = 37 (1x3 + 10x2 + 14x1), normalized to 7 points.
If PER-2.1 fails, subcategory capped at 4.2 points (60%).

### 4.3 Locking (3 points)

| ID | Metric | Criticality | Type | Source(s) | Pass Criteria |
|----|--------|-------------|------|-----------|---------------|
| PER-3.1 | Lock Waits < 5 | Important | threshold | SQL | <= 5 |
| PER-3.2 | Deadlocks (24h) <= 2 | Important | threshold | SQL | <= 2 |
| PER-3.3 | Blocked Queries < 3 | Advisory | threshold | SQL | <= 3 |
| PER-3.4 | Idle-in-Transaction Timeout Set | Important | threshold | SQL | >= 1 AND <= 86400000 |

**Scoring**: Weight pool = 7 (0x3 + 3x2 + 1x1), normalized to 3 points.

### 4.4 Replication (5 points)

| ID | Metric | Criticality | Type | Source(s) | Pass Criteria |
|----|--------|-------------|------|-----------|---------------|
| PER-4.1 | Replication Lag < 60s | **CRITICAL** | threshold | SQL, Monitoring | per declared rpo_target; otherwise <= 60 |
| HA-1.1 | Cluster Has Single Leader | **CRITICAL** | boolean | Monitoring, Worker | = true |
| HA-1.2 | All Members Same Timeline | **CRITICAL** | boolean | Monitoring, Worker | = true |
| HA-2.1 | Replication Slot Health | Important | boolean | Monitoring, Worker | = true |
| HA-2.6 | Cluster Member Count Adequate | Important | threshold | Monitoring, Worker | >= 2 |
| EXT-CIT-2 | Citus Worker Node Connectivity | **CRITICAL** | boolean | SQL | = true |
| PER-4.2 | Synchronous Commit Mode | Important | enum | SQL | `on`, `remote_apply`, `remote_write`, `local` |
| PER-4.3 | Synchronous Standby Count | Advisory | threshold | SQL | >= 0 |
| PER-4.4 | Synchronous Standby Names Declared | Advisory | boolean | SQL | Non-empty, non-dummy value |
| PER-4.5 | Logical Subscriptions Healthy | Important | threshold | SQL | <= 0 |
| PER-4.6 | HA / Replication Topology | Important | enum | Manual | `none`, `async_standby`, `sync_standby`, `cluster_managed` |

> **Applies when**: PER-4.1 (Replication Lag < 60s) — `streaming_status` is true OR `ha_standby_count` >= 1.

> **Applies when**: PER-4.4 (Synchronous Standby Names Declared) — `synchronous_standby_names` is provided.

> **Not required when**: PER-4.4 (Synchronous Standby Names Declared) — `ha_topology` in `none`, `async_standby`. It still counts, but leaves the target and never gates.

**Scoring**: Weight pool = 24 (4x3 + 5x2 + 2x1), normalized to 5 points.
If PER-4.1 or HA-1.1 or HA-1.2 or EXT-CIT-2 fails, subcategory capped at 3.0 points (60%).

## 5. Future-Proofing (20 points)

### 5.1 Version Currency (6 points)

| ID | Metric | Criticality | Type | Source(s) | Pass Criteria |
|----|--------|-------------|------|-----------|---------------|
| FUT-1.1 | Current Major Version | **CRITICAL** | threshold | SQL | >= 16 |
| FUT-1.2 | Version Supported | **CRITICAL** | boolean | SQL | = true |
| FUT-1.3 | Versions Behind <= 2 | Important | threshold | SQL | <= 2 |
| FUT-1.4 | Patch Version Current | Important | threshold | SQL | <= 2 |
| HA-2.8 | Patroni Version Current | Important | boolean | Manual | = true |

> **Gate**: FUT-1.2 (Version Supported) — if this critical metric fails, the entire pillar is zeroed.

**Scoring**: Weight pool = 12 (2x3 + 3x2 + 0x1), normalized to 6 points.
If FUT-1.1 or FUT-1.2 fails, subcategory capped at 3.6 points (60%).

### 5.2 Configuration (5 points)

| ID | Metric | Criticality | Type | Source(s) | Pass Criteria |
|----|--------|-------------|------|-----------|---------------|
| HA-1.4 | Watchdog Enabled | **CRITICAL** | boolean | Monitoring, Worker | = true |
| HA-2.2 | Timing Parameters Valid | Important | boolean | Monitoring, Worker | = true |
| HA-2.3 | No Pending Restart | Important | boolean | Monitoring, Worker | = true |
| HA-3.2 | DCS Failsafe Mode | Advisory | boolean | Monitoring, Worker | = true |
| FUT-2.1 | Checkpoint Timeout Configured | Advisory | threshold | SQL | >= 900 |
| FUT-2.2 | Max WAL Size Configured | Important | threshold | SQL | >= 1024 |
| FUT-2.3 | Azure Extensions Allowlist | Advisory | boolean | SQL | Non-empty, non-dummy value |
| FUT-2.4 | fsync Enabled | **CRITICAL** | enum | SQL | `on` |
| FUT-2.5 | Full Page Writes Enabled | Important | enum | SQL | `on` |
| FUT-2.6 | Min WAL Size Configured | Advisory | threshold | SQL | >= 512 |

**Scoring**: Weight pool = 18 (2x3 + 4x2 + 4x1), normalized to 5 points.
If HA-1.4 or FUT-2.4 fails, subcategory capped at 3.0 points (60%).

### 5.3 Upgrade Planning (5 points)

| ID | Metric | Criticality | Type | Source(s) | Pass Criteria |
|----|--------|-------------|------|-----------|---------------|
| FUT-3.1 | Upgrade Plan Documented | Important | enum | Manual | `yes`, `planned`, `documented`, `no`, `none` |
| FUT-3.2 | Extension Compatibility | Advisory | boolean | Manual | = true |
| FUT-3.3 | No Deprecated Features | Advisory | boolean | SQL | = true |
| FUT-3.4 | No Deprecated MD5 | Important | threshold | SQL | <= 0 |

**Scoring**: Weight pool = 6 (0x3 + 2x2 + 2x1), normalized to 5 points.

### 5.4 Health Foundation (4 points)

| ID | Metric | Criticality | Type | Source(s) | Pass Criteria |
|----|--------|-------------|------|-----------|---------------|
| FUT-4.1 | Monitoring Connected | Important | boolean | Manual | = true |
| FUT-4.2 | Alerting Configured | Advisory | boolean | Manual | = true |
| FUT-4.3 | Documentation Current | Advisory | boolean | Manual | = true |

**Scoring**: Weight pool = 4 (0x3 + 1x2 + 2x1), normalized to 4 points.

---

## Appendix A: Metrics by Source

### SQL / Healthcheck Scripts (128 metrics)

These metrics are collected via direct database queries.

| ID | Metric | Pillar | Criticality |
|----|--------|--------|-------------|
| BAK-1.1 | Archive Mode Enabled | Backup & Recovery | **CRITICAL** |
| BAK-1.2 | Archive Command Configured | Backup & Recovery | **CRITICAL** |
| BAK-1.3 | No Archive Failures (24h) | Backup & Recovery | Important |
| BAK-1.4 | WAL Level Adequate | Backup & Recovery | Important |
| BAK-1.5 | WAL Summarization Enabled | Backup & Recovery | Advisory |
| BAK-1.6 | WAL Compression Enabled | Backup & Recovery | Advisory |
| BAK-1.7 | Archive Timeout Bounds the Declared RPO | Backup & Recovery | Advisory |
| BAK-4.5 | Replica Connected | Backup & Recovery | Important |
| BAK-4.6 | Synchronous Mode | Backup & Recovery | Advisory |
| SEC-1.1 | SSL Connections 100% | Security | **CRITICAL** |
| SEC-1.2 | Password Encryption SCRAM | Security | **CRITICAL** |
| SEC-1.3 | No Remote Superuser | Security | Important |
| SEC-1.5 | Password Policy | Security | Advisory |
| SEC-1.6 | No MD5 Auth in pg_hba | Security | Important |
| SEC-2.1 | SSL Enabled | Security | **CRITICAL** |
| SEC-2.2 | TLS 1.2+ Required | Security | **CRITICAL** |
| SEC-2.3 | SSL Certificate Valid | Security | Important |
| SEC-2.4 | Data at Rest Encrypted | Security | Advisory |
| SEC-2.5 | Data Checksums Enabled | Security | Important |
| SEC-3.1 | Log Connections | Security | Important |
| SEC-3.2 | Log Disconnections | Security | Advisory |
| SEC-3.3 | Log DDL Statements | Security | Important |
| SEC-3.4 | pgAudit Enabled | Security | Important |
| SEC-4.1 | No Public Grants | Security | Important |
| SEC-4.2 | Limited Superusers | Security | Important |
| SEC-4.3 | Role-Based Access | Security | Advisory |
| SEC-4.4 | Row-Level Security | Security | Advisory |
| SEC-4.5 | allow_alter_system Off | Security | Important |
| CAP-1.1 | Database Size (capture) | Capacity | Advisory |
| CAP-1.3 | Tablespace Usage < 90% | Capacity | Important |
| CAP-1.5 | Partition Count Healthy | Capacity | Important |
| CAP-2.1 | Connection Usage < 80% | Capacity | **CRITICAL** |
| CAP-2.2 | Connection Pooler | Capacity | Important |
| CAP-2.3 | Idle Connections < 50% | Capacity | Advisory |
| CAP-2.4 | Reserved Connections > 0 | Capacity | Advisory |
| CAP-3.1 | Autovacuum Enabled | Capacity | **CRITICAL** |
| CAP-3.2 | Table Bloat Healthy | Capacity | Important |
| CAP-3.3 | Index Bloat < 30% | Capacity | Important |
| CAP-3.4 | Dead Tuples < 10% | Capacity | Advisory |
| CAP-3.5 | Vacuum Timing Healthy | Capacity | Advisory |
| CAP-3.6 | Maintenance Work Mem Sized to RAM | Capacity | Advisory |
| CAP-4.1 | XID Wraparound Safe | Capacity | **CRITICAL** |
| CAP-4.4 | No Stale Replication Slots | Capacity | **CRITICAL** |
| CAP-4.5 | Idle Slot Timeout Set | Capacity | Important |
| CAP-4.6 | Default Partition Overflow | Capacity | Important |
| PER-1.1 | Cache Hit Ratio Healthy | Performance | Important |
| PER-1.2 | Shared Buffers Sized | Performance | Advisory |
| PER-1.3 | Effective Cache Size | Performance | Advisory |
| PER-1.4 | Checkpoint Requested Ratio Healthy | Performance | Advisory |
| PER-1.5 | track_io_timing Enabled | Performance | Important |
| PER-1.6 | Async I/O Method | Performance | Advisory |
| PER-1.7 | Checkpoint Target Healthy | Performance | Advisory |
| PER-2.1 | pg_stat_statements Enabled | Performance | **CRITICAL** |
| PER-2.2 | Slow Queries (1h) < 10 | Performance | Important |
| PER-2.3 | Long Running < 5 | Performance | Important |
| PER-2.5 | transaction_timeout Set | Performance | Advisory |
| PER-2.6 | Partition Pruning Enabled | Performance | Important |
| PER-2.7 | Work Mem Sized to RAM | Performance | Advisory |
| PER-2.8 | Random Page Cost (SSD) | Performance | Advisory |
| PER-2.9 | Temp File Usage Bounded by RAM | Performance | Advisory |
| PER-3.1 | Lock Waits < 5 | Performance | Important |
| PER-3.2 | Deadlocks (24h) <= 2 | Performance | Important |
| PER-3.3 | Blocked Queries < 3 | Performance | Advisory |
| PER-3.4 | Idle-in-Transaction Timeout Set | Performance | Important |
| PER-4.1 | Replication Lag < 60s | Performance | **CRITICAL** |
| FUT-1.1 | Current Major Version | Future-Proofing | **CRITICAL** |
| FUT-1.2 | Version Supported | Future-Proofing | **CRITICAL** |
| FUT-1.3 | Versions Behind <= 2 | Future-Proofing | Important |
| FUT-1.4 | Patch Version Current | Future-Proofing | Important |
| FUT-3.3 | No Deprecated Features | Future-Proofing | Advisory |
| FUT-3.4 | No Deprecated MD5 | Future-Proofing | Important |
| EXT-VEC-1 | pgvector HNSW Index Health | Performance | Important |
| EXT-VEC-2 | pgvector Dead Tuple Impact | Capacity | Important |
| EXT-VEC-3 | pgvector Index Cache Hit | Performance | Important |
| EXT-TS-1 | TimescaleDB Compression Jobs OK | Capacity | Important |
| EXT-TS-2 | TimescaleDB Chunk Count Healthy | Capacity | Important |
| EXT-TS-3 | TimescaleDB Retention Policy Active | Backup & Recovery | Advisory |
| EXT-CIT-1 | Citus Shard Placement Health | Capacity | **CRITICAL** |
| EXT-CIT-2 | Citus Worker Node Connectivity | Performance | **CRITICAL** |
| EXT-PM-1 | pg_partman Premake Healthy | Capacity | Important |
| EXT-PM-2 | pg_partman Retention Active | Backup & Recovery | Advisory |
| EXT-CRON-1 | pg_cron No Failed Jobs (24h) | Capacity | Important |
| CHK-BAK-2 | Backup Tool Detected | Backup & Recovery | Advisory |
| CHK-PER-1 | Index Hit Ratio | Performance | Advisory |
| CHK-PER-2 | Sequential Scan Ratio | Performance | Advisory |
| BAK-4.7 | HA Standby Available | Backup & Recovery | Important |
| BAK-4.9 | Restore Time Within Declared RTO | Backup & Recovery | Important |
| SEC-4.6 | Azure PG Admin Membership Limited | Security | Important |
| CAP-2.6 | PgBouncer Pool Mode Transaction | Capacity | Important |
| CAP-2.7 | PgBouncer Pool Size Configured | Capacity | Advisory |
| CAP-2.8 | PgBouncer Max Client Connections | Capacity | Advisory |
| CAP-2.9 | PgBouncer Min Pool Size Set | Capacity | Advisory |
| CAP-2.10 | PgBouncer Startup Params Safe | Capacity | Advisory |
| CAP-1.8 | Temp File Limit Set | Capacity | Advisory |
| CAP-3.7 | Freeze Max Age Configured | Capacity | **CRITICAL** |
| CAP-3.8 | No Autovacuum-Disabled Tables | Capacity | **CRITICAL** |
| CAP-3.9 | Unused Index Count | Capacity | Advisory |
| CAP-3.10 | Statistics Collection Enabled | Capacity | Important |
| CAP-3.11 | Autovacuum Workers Adequate | Capacity | Advisory |
| CAP-3.12 | Autovacuum Cost Limit Tuned | Capacity | Advisory |
| PER-2.10 | IO Concurrency Configured | Performance | Important |
| PER-2.11 | Slow Query Logging Configured | Performance | Important |
| PER-2.12 | Worker Process Budget Adequate | Performance | Important |
| PER-2.13 | Max Parallel Workers Configured | Performance | Important |
| PER-2.14 | Parallel Workers Per Gather Configured | Performance | Important |
| PER-2.15 | Background Worker Breakdown | Performance | Advisory |
| PER-2.16 | Azure Query Store Enabled | Performance | Important |
| PER-2.17 | Azure Wait Sampling Enabled | Performance | Advisory |
| PER-2.18 | Azure Intelligent Tuning | Performance | Advisory |
| FUT-2.1 | Checkpoint Timeout Configured | Future-Proofing | Advisory |
| FUT-2.2 | Max WAL Size Configured | Future-Proofing | Important |
| FUT-2.3 | Azure Extensions Allowlist | Future-Proofing | Advisory |
| FUT-2.4 | fsync Enabled | Future-Proofing | **CRITICAL** |
| FUT-2.5 | Full Page Writes Enabled | Future-Proofing | Important |
| FUT-2.6 | Min WAL Size Configured | Future-Proofing | Advisory |
| PER-1.8 | Huge Pages Configured | Performance | Important |
| PER-1.10 | Memory Budget Within Safe Headroom | Performance | Important |
| PER-1.11 | WAL Buffers Size | Performance | Advisory |
| PER-1.13 | Shared Buffers (Bytes) | Performance | Advisory |
| PER-2.19 | JIT Compilation State | Performance | Advisory |
| PER-2.20 | Default Statistics Target | Performance | Advisory |
| PER-2.21 | Work Mem (Bytes) | Performance | Advisory |
| PER-2.22 | Max Connections (Cap) | Performance | Advisory |
| PER-2.23 | Statement Timeout Set | Performance | Advisory |
| PER-4.2 | Synchronous Commit Mode | Performance | Important |
| PER-4.3 | Synchronous Standby Count | Performance | Advisory |
| PER-4.4 | Synchronous Standby Names Declared | Performance | Advisory |
| PER-4.5 | Logical Subscriptions Healthy | Performance | Important |

### Monitoring (23 metrics)

These metrics are collected from monitoring systems (Zabbix, PMM, worker scripts).

| ID | Metric | Pillar | Criticality |
|----|--------|--------|-------------|
| BAK-1.3 | No Archive Failures (24h) | Backup & Recovery | Important |
| BAK-2.2 | Last Backup Age | Backup & Recovery | Important |
| SEC-1.4 | Low Failed Logins (24h) | Security | Important |
| CAP-1.1 | Database Size (capture) | Capacity | Advisory |
| CAP-1.2 | Healthy Growth Rate | Capacity | Important |
| CAP-2.1 | Connection Usage < 80% | Capacity | **CRITICAL** |
| CAP-3.2 | Table Bloat Healthy | Capacity | Important |
| CAP-4.1 | XID Wraparound Safe | Capacity | **CRITICAL** |
| PER-1.1 | Cache Hit Ratio Healthy | Performance | Important |
| PER-2.2 | Slow Queries (1h) < 10 | Performance | Important |
| PER-4.1 | Replication Lag < 60s | Performance | **CRITICAL** |
| HA-1.1 | Cluster Has Single Leader | Performance | **CRITICAL** |
| HA-1.2 | All Members Same Timeline | Performance | **CRITICAL** |
| HA-1.3 | Failover Candidate Available | Backup & Recovery | **CRITICAL** |
| HA-1.4 | Watchdog Enabled | Future-Proofing | **CRITICAL** |
| HA-2.1 | Replication Slot Health | Performance | Important |
| HA-2.2 | Timing Parameters Valid | Future-Proofing | Important |
| HA-2.3 | No Pending Restart | Future-Proofing | Important |
| HA-2.6 | Cluster Member Count Adequate | Performance | Important |
| HA-2.7 | Failover Frequency Normal | Backup & Recovery | Important |
| HA-3.2 | DCS Failsafe Mode | Future-Proofing | Advisory |
| BAK-4.7 | HA Standby Available | Backup & Recovery | Important |
| CAP-1.7 | Disk Usage < 85% | Capacity | **CRITICAL** |

### Manual Inputs (32 metrics)

These metrics require manual input from the operator.

| ID | Metric | Pillar | Criticality | Remediation |
|----|--------|--------|-------------|-------------|
| BAK-2.1 | Backup Schedule Defined | Backup & Recovery | **CRITICAL** | Document and implement a backup schedule (daily recommended) |
| BAK-2.3 | Backup Verification | Backup & Recovery | Advisory | Implement backup verification process (restore tests) |
| BAK-3.1 | Enterprise Backup Tool | Backup & Recovery | Important | Consider implementing pgBackRest or Barman for enterprise backup |
| BAK-3.2 | PITR Capability | Backup & Recovery | Important | Enable WAL archiving and test PITR procedures |
| BAK-3.3 | Backup Encryption | Backup & Recovery | Advisory | Enable backup encryption in pgBackRest or use encrypted storage |
| BAK-4.1 | RPO Target Defined | Backup & Recovery | **CRITICAL** | Define and document RPO target based on business requirements |
| BAK-4.2 | RTO Target Defined | Backup & Recovery | **CRITICAL** | Define and document RTO target based on business requirements |
| BAK-4.3 | Restore Tested (90d) | Backup & Recovery | Important | Schedule regular restore tests (at least quarterly) |
| BAK-4.4 | DR Plan Documented | Backup & Recovery | Advisory | Document disaster recovery procedures and runbooks |
| BAK-5.1 | Retention Policy Met | Backup & Recovery | Important | Configure backup retention to meet compliance requirements |
| BAK-5.2 | Offsite Backup Copy | Backup & Recovery | Important | Replicate backups to a second site or cloud target; verify the copy is restorable independently. |
| SEC-2.4 | Data at Rest Encrypted | Security | Advisory | Implement disk-level encryption or use encrypted tablespaces |
| SEC-3.5 | Log Retention (90d) | Security | Advisory | Configure log rotation to retain logs for compliance period |
| CAP-2.2 | Connection Pooler | Capacity | Important | Implement PgBouncer or Pgpool-II for connection pooling |
| CAP-4.2 | Growth Projection | Capacity | Advisory | Document expected growth and plan capacity accordingly |
| CAP-4.3 | Scaling Strategy Documented | Capacity | Advisory | Document the next two scaling steps for this database and the trigger conditions for each. |
| PER-2.4 | Query Review Performed (90d) | Performance | Advisory | Schedule a quarterly top-N query review against pg_stat_statements. |
| FUT-3.1 | Upgrade Plan Documented | Future-Proofing | Important | Create and maintain upgrade planning documentation |
| FUT-3.2 | Extension Compatibility | Future-Proofing | Advisory | Test extension compatibility before major upgrades |
| FUT-4.1 | Monitoring Connected | Future-Proofing | Important | Connect database to monitoring solution (Zabbix, PMM, Datadog, etc.) |
| FUT-4.2 | Alerting Configured | Future-Proofing | Advisory | Configure alerts for critical health metrics |
| FUT-4.3 | Documentation Current | Future-Proofing | Advisory | Maintain current documentation for database configuration |
| HA-2.4 | DCS Communication Encrypted | Security | Important | Enable TLS for DCS client connections |
| HA-2.5 | Patroni REST API Authenticated | Security | Important | Configure Patroni REST API authentication credentials |
| HA-2.8 | Patroni Version Current | Future-Proofing | Important | Upgrade Patroni to latest stable version |
| HA-3.1 | Patroni REST API TLS | Security | Advisory | Configure TLS certificates for Patroni REST API |
| CAP-4.7 | Capacity Growth Headroom Target | Capacity | Important | Declare the growth horizon and ensure current storage utilization leaves room to reach it before cap |
| BAK-4.8 | Restore Throughput Attested | Backup & Recovery | Advisory | Record the throughput observed during the last restore test (restored bytes divided by elapsed secon |
| SEC-4.7 | Security Posture Target | Security | Important | Declare the security posture matching this instance's compliance scope, then align SSL/TLS and audit |
| CAP-1.6 | Top Tables Analysis | Capacity | Advisory | Review large tables for dead rows (VACUUM), abandoned data (DROP), or archival candidates |
| PER-1.9 | OS Huge Pages Allocated | Performance | Advisory | Reserve huge pages on the host: set vm.nr_hugepages = (shared_buffers / 2 MB) in /etc/sysctl.conf an |
| PER-4.6 | HA / Replication Topology | Performance | Important | Declare the HA topology in place and align streaming / synchronous replication configuration to it. |

## Appendix B: Gate Metrics

| ID | Metric | Criticality | Gate Scope | Effect |
|----|--------|-------------|------------|--------|
| FUT-1.2 | Version Supported | **CRITICAL** | pillar | Zeros entire pillar score |

## Appendix C: Conditional Metrics

### Extension-Required

| ID | Metric | Required Extension |
|----|--------|--------------------|
| HA-1.1 | Cluster Has Single Leader | patroni |
| HA-1.2 | All Members Same Timeline | patroni |
| HA-1.3 | Failover Candidate Available | patroni |
| HA-1.4 | Watchdog Enabled | patroni |
| HA-2.1 | Replication Slot Health | patroni |
| HA-2.2 | Timing Parameters Valid | patroni |
| HA-2.3 | No Pending Restart | patroni |
| HA-2.4 | DCS Communication Encrypted | patroni |
| HA-2.5 | Patroni REST API Authenticated | patroni |
| HA-2.6 | Cluster Member Count Adequate | patroni |
| HA-2.7 | Failover Frequency Normal | patroni |
| HA-2.8 | Patroni Version Current | patroni |
| HA-3.1 | Patroni REST API TLS | patroni |
| HA-3.2 | DCS Failsafe Mode | patroni |
| EXT-VEC-1 | pgvector HNSW Index Health | vector |
| EXT-VEC-2 | pgvector Dead Tuple Impact | vector |
| EXT-VEC-3 | pgvector Index Cache Hit | vector |
| EXT-TS-1 | TimescaleDB Compression Jobs OK | timescaledb |
| EXT-TS-2 | TimescaleDB Chunk Count Healthy | timescaledb |
| EXT-TS-3 | TimescaleDB Retention Policy Active | timescaledb |
| EXT-CIT-1 | Citus Shard Placement Health | citus |
| EXT-CIT-2 | Citus Worker Node Connectivity | citus |
| EXT-PM-1 | pg_partman Premake Healthy | pg_partman |
| EXT-PM-2 | pg_partman Retention Active | pg_partman |
| EXT-CRON-1 | pg_cron No Failed Jobs (24h) | pg_cron |

### Version-Gated

| ID | Metric | Minimum Version |
|----|--------|-----------------|
| BAK-1.5 | WAL Summarization Enabled | 17.x |
| SEC-4.5 | allow_alter_system Off | 17.x |
| CAP-2.4 | Reserved Connections > 0 | 16.x |
| CAP-3.5 | Vacuum Timing Healthy | 18.x |
| CAP-4.4 | No Stale Replication Slots | 17.x |
| CAP-4.5 | Idle Slot Timeout Set | 18.x |
| PER-1.4 | Checkpoint Requested Ratio Healthy | 17.x |
| PER-1.6 | Async I/O Method | 18.x |
| PER-2.5 | transaction_timeout Set | 17.x |
| FUT-3.4 | No Deprecated MD5 | 18.x |
| PER-2.19 | JIT Compilation State | 12.x |
| PER-4.5 | Logical Subscriptions Healthy | 10.x |

### Deployment-Profile-Specific

| ID | Metric | Profiles |
|----|--------|----------|
| SEC-4.6 | Azure PG Admin Membership Limited | azure-flexible |
| CAP-2.6 | PgBouncer Pool Mode Transaction | azure-flexible |
| CAP-2.7 | PgBouncer Pool Size Configured | azure-flexible |
| CAP-2.8 | PgBouncer Max Client Connections | azure-flexible |
| CAP-2.9 | PgBouncer Min Pool Size Set | azure-flexible |
| CAP-2.10 | PgBouncer Startup Params Safe | azure-flexible |
| PER-2.12 | Worker Process Budget Adequate | azure-flexible |
| PER-2.16 | Azure Query Store Enabled | azure-flexible |
| PER-2.17 | Azure Wait Sampling Enabled | azure-flexible |
| PER-2.18 | Azure Intelligent Tuning | azure-flexible |
| FUT-2.3 | Azure Extensions Allowlist | azure-flexible |
