# Oracle Scoring Reference

> Auto-generated from catalog v1.11.0. Do not edit manually — modify the JSON catalog and re-run `npm run generate-docs`.

## Overview

| Property | Value |
|----------|-------|
| Technology | Oracle |
| Catalog Version | 1.11.0 |
| Total Metrics | 160 |
| Critical | 28 (weight: 3x) |
| Important | 58 (weight: 2x) |
| Advisory | 74 (weight: 1x) |
| Max Score | 100 points (5 pillars x 20 points) |

## Scoring Summary

| Pillar | Subcategory | Points | Metrics | Critical |
|--------|-------------|--------|---------|----------|
| **Backup & Recovery** (20pts) | Log Archiving | 5 | 6 | 3 |
|  | Scheduled Backups | 4 | 6 | 2 |
|  | Backup Tools | 3 | 7 | 1 |
|  | Recovery Readiness | 5 | 10 | 3 |
|  | Retention Compliance | 3 | 4 | 1 |
| **Security** (20pts) | Authentication | 5 | 9 | 4 |
|  | Encryption | 5 | 8 | 2 |
|  | Audit & Logging | 5 | 8 | 1 |
|  | Access Control | 5 | 9 | 2 |
| **Capacity** (20pts) | Storage | 6 | 9 | 2 |
|  | Connections | 5 | 6 | 2 |
|  | Maintenance | 5 | 10 | 0 |
|  | Planning | 4 | 9 | 0 |
| **Performance** (20pts) | Caching | 5 | 11 | 0 |
|  | Query Performance | 7 | 12 | 1 |
|  | Locking | 4 | 5 | 0 |
|  | Replication | 4 | 7 | 2 |
| **Future-Proofing** (20pts) | Version Currency | 7 | 6 | 2 |
|  | Configuration | 4 | 6 | 0 |
|  | Upgrade Planning | 5 | 7 | 0 |
|  | Health Foundation | 4 | 5 | 0 |

## 1. Backup & Recovery (20 points)

### 1.1 Log Archiving (5 points)

| ID | Metric | Criticality | Type | Source(s) | Pass Criteria |
|----|--------|-------------|------|-----------|---------------|
| BAK-1.1 | Archive Log Mode Enabled | **CRITICAL** | enum | SQL | `ARCHIVELOG` |
| BAK-1.2 | Archive Destination Configured | **CRITICAL** | boolean | SQL | = true |
| BAK-1.5 | Redo Log Size Adequate | Advisory | threshold | SQL | >= 512 |
| BAK-1.6 | Log Switch Rate Healthy | Advisory | threshold | SQL | <= 6 |
| BAK-1.7 | Redo Log Member Redundancy | **CRITICAL** | threshold | SQL | >= 2 |
| BAK-1.8 | Standby Redo Logs Present | Important | boolean | SQL | = true |

> **Applies when**: BAK-1.8 (Standby Redo Logs Present) — `dataguard_configured` is true.

> **Gate**: BAK-1.1 (Archive Log Mode Enabled) — if this critical metric fails, the entire pillar is zeroed.

**Scoring**: Weight pool = 13 (3x3 + 1x2 + 2x1), normalized to 5 points.
If BAK-1.1 or BAK-1.2 or BAK-1.7 fails, subcategory capped at 3.0 points (60%).

### 1.2 Scheduled Backups (4 points)

| ID | Metric | Criticality | Type | Source(s) | Pass Criteria |
|----|--------|-------------|------|-----------|---------------|
| BAK-2.1 | RMAN Backup Schedule Defined | **CRITICAL** | enum | Manual | `daily`, `hourly`, `continuous`, `level0_level1` |
| BAK-2.2 | Last RMAN Backup Age | Important | threshold | SQL, Monitoring, Worker | <= 24 |
| BAK-2.3 | Backup Verification | Advisory | boolean | Manual | = true |
| BAK-2.4 | Data Pump Export Configured | Advisory | boolean | Manual | = true |
| BAK-2.5 | Last RMAN Backup Status | **CRITICAL** | enum | SQL | `COMPLETED`, `COMPLETED WITH WARNINGS` |
| BAK-2.6 | RMAN Recovery Catalog | Important | boolean | Manual | = true |

**Scoring**: Weight pool = 12 (2x3 + 2x2 + 2x1), normalized to 4 points.
If BAK-2.1 or BAK-2.5 fails, subcategory capped at 2.4 points (60%).

### 1.3 Backup Tools (3 points)

| ID | Metric | Criticality | Type | Source(s) | Pass Criteria |
|----|--------|-------------|------|-----------|---------------|
| BAK-3.1 | RMAN Configured | Important | boolean | SQL | = true |
| BAK-3.2 | RMAN Compression Enabled | Advisory | boolean | SQL | = true |
| BAK-3.3 | Flashback Database Enabled | Important | enum | SQL | `YES` |
| BAK-3.4 | Controlfile Autobackup On | **CRITICAL** | enum | SQL | `ON` |
| BAK-3.5 | Block Change Tracking Enabled | Advisory | enum | SQL | `ENABLED` |
| BAK-3.6 | RMAN Backup Encryption | Advisory | boolean | SQL | = true |
| BAK-3.7 | Archivelog Deletion Policy | Advisory | boolean | SQL | = true |

**Scoring**: Weight pool = 11 (1x3 + 2x2 + 4x1), normalized to 3 points.
If BAK-3.4 fails, subcategory capped at 1.8 points (60%).

### 1.4 Recovery Readiness (5 points)

| ID | Metric | Criticality | Type | Source(s) | Pass Criteria |
|----|--------|-------------|------|-----------|---------------|
| BAK-4.1 | RPO Target Defined | **CRITICAL** | enum | Manual | `rpo_5`, `rpo_15`, `rpo_60`, `rpo_240`, `rpo_1440`, `yes` |
| BAK-4.2 | RTO Target Defined | **CRITICAL** | enum | Manual | `rto_5`, `rto_15`, `rto_60`, `rto_240`, `rto_480`, `rto_1440`, `yes` |
| BAK-4.3 | Restore Tested (90d) | Important | boolean | Manual | = true |
| BAK-4.4 | Data Guard Configured | Important | boolean | SQL, Manual | = true |
| BAK-4.5 | Standby Database Healthy | **CRITICAL** | enum | SQL | `MOUNTED`, `READ ONLY WITH APPLY`, `READ ONLY` |
| BAK-4.6 | Force Logging Enabled | Important | enum | SQL | `YES` |
| BAK-4.7 | Data Guard Broker Managed | Advisory | enum | SQL | `TRUE` |
| BAK-4.8 | Active Data Guard Real-Time Apply | Advisory | boolean | SQL | = true |
| BAK-4.9 | Fast-Start Failover Configured | Advisory | boolean | SQL | = true |
| BAK-4.10 | DR Plan Documented | Advisory | boolean | Manual | = true |

> **Applies when**: BAK-4.5 (Standby Database Healthy) — `dataguard_configured` is true AND `standby_health` is provided.

> **Applies when**: BAK-4.7 (Data Guard Broker Managed) — `dataguard_configured` is true.

> **Applies when**: BAK-4.8 (Active Data Guard Real-Time Apply) — `dataguard_configured` is true.

> **Applies when**: BAK-4.9 (Fast-Start Failover Configured) — `dataguard_configured` is true.

> **Not required when**: BAK-4.4 (Data Guard Configured) — `dr_topology` in `none`. It still counts, but leaves the target and never gates.

**Scoring**: Weight pool = 19 (3x3 + 3x2 + 4x1), normalized to 5 points.
If BAK-4.1 or BAK-4.2 or BAK-4.5 fails, subcategory capped at 3.0 points (60%).

### 1.5 Retention Compliance (3 points)

| ID | Metric | Criticality | Type | Source(s) | Pass Criteria |
|----|--------|-------------|------|-----------|---------------|
| BAK-5.1 | RMAN Retention Policy Set | Important | boolean | SQL | = true |
| BAK-5.2 | FRA Usage Below Threshold | **CRITICAL** | threshold | SQL | <= 80 |
| BAK-5.3 | Archive Log Retention Adequate | Important | boolean | Manual, SQL | = true |
| BAK-5.4 | Offsite Backup Copy | Important | boolean | Manual | = true |

> **Applies when**: BAK-5.2 (FRA Usage Below Threshold) — `fra_usage_pct` is provided.

**Scoring**: Weight pool = 9 (1x3 + 3x2 + 0x1), normalized to 3 points.
If BAK-5.2 fails, subcategory capped at 1.8 points (60%).

## 2. Security (20 points)

### 2.1 Authentication (5 points)

| ID | Metric | Criticality | Type | Source(s) | Pass Criteria |
|----|--------|-------------|------|-----------|---------------|
| SEC-1.1 | Network Encryption Enabled | **CRITICAL** | enum | SQL, Manual | `REQUIRED` |
| SEC-1.2 | Password Verify Function Set | **CRITICAL** | boolean | SQL | = true |
| SEC-1.3 | Failed Login Limit Configured | Important | threshold | SQL | <= 5 |
| SEC-1.4 | Password Lifetime Policy | Advisory | threshold | SQL | <= 90 |
| SEC-1.5 | No Default Passwords | **CRITICAL** | threshold | SQL | <= 0 |
| SEC-1.6 | Password Profiles Defined | Advisory | threshold | SQL | >= 2 |
| SEC-1.7 | Listener Hardening | **CRITICAL** | boolean | Manual | = true |
| SEC-1.8 | Profile Resource Limits | Advisory | boolean | SQL | = true |
| SEC-1.9 | Inactive Account Lockout | Advisory | threshold | SQL | <= 120 |

**Scoring**: Weight pool = 18 (4x3 + 1x2 + 4x1), normalized to 5 points.
If SEC-1.1 or SEC-1.2 or SEC-1.5 or SEC-1.7 fails, subcategory capped at 3.0 points (60%).

### 2.2 Encryption (5 points)

| ID | Metric | Criticality | Type | Source(s) | Pass Criteria |
|----|--------|-------------|------|-----------|---------------|
| SEC-2.1 | TDE Enabled | Important | threshold | SQL | >= 1 |
| SEC-2.2 | TDE Wallet Open | **CRITICAL** | enum | SQL | `OPEN`, `OPEN_NO_MASTER_KEY` |
| SEC-2.3 | Network Checksum Enabled | Important | enum | SQL, Manual | `REQUIRED`, `REQUESTED` |
| SEC-2.4 | Sensitive Tablespaces Encrypted | Advisory | boolean | Manual | = true |
| SEC-2.5 | DB Block Checksum Enabled | Important | enum | SQL | `TYPICAL`, `FULL` |
| SEC-2.6 | TDE Keystore Backed Up | **CRITICAL** | boolean | SQL, Manual | = true |
| SEC-2.7 | Data Redaction Policies | Advisory | boolean | SQL | = true |
| SEC-2.8 | TDE Algorithm Strength | Advisory | enum | SQL | `AES256` |

> **Applies when**: SEC-2.2 (TDE Wallet Open) — `tde_encrypted_tablespaces` >= 1.

> **Applies when**: SEC-2.6 (TDE Keystore Backed Up) — `tde_encrypted_tablespaces` >= 1.

> **Applies when**: SEC-2.8 (TDE Algorithm Strength) — `tde_encrypted_tablespaces` >= 1.

**Scoring**: Weight pool = 15 (2x3 + 3x2 + 3x1), normalized to 5 points.
If SEC-2.2 or SEC-2.6 fails, subcategory capped at 3.0 points (60%).

### 2.3 Audit & Logging (5 points)

| ID | Metric | Criticality | Type | Source(s) | Pass Criteria |
|----|--------|-------------|------|-----------|---------------|
| SEC-3.1 | Unified Auditing Enabled | Important | enum | SQL | `TRUE` |
| SEC-3.2 | Audit Policy Active | **CRITICAL** | boolean | SQL | = true |
| SEC-3.3 | Fine-Grained Auditing Considered | Advisory | boolean | SQL | = true |
| SEC-3.4 | Audit Trail Protected | Important | boolean | Manual | = true |
| SEC-3.5 | Privilege Use Audited | Important | boolean | SQL | = true |
| SEC-3.6 | Audit Trail Purge Configured | Advisory | boolean | SQL | = true |
| SEC-3.7 | SYS Operations Audited | Important | boolean | SQL | = true |
| SEC-3.8 | Audit Trail Destination | Important | enum | SQL | `DB`, `DB,EXTENDED`, `XML`, `XML,EXTENDED`, `OS` |

> **Applies when**: SEC-3.7 (SYS Operations Audited) — `audit_sys_operations` is provided.

> **Applies when**: SEC-3.8 (Audit Trail Destination) — `unified_auditing_enabled` not in `TRUE` AND `audit_trail_destination` is provided.

**Scoring**: Weight pool = 15 (1x3 + 5x2 + 2x1), normalized to 5 points.
If SEC-3.2 fails, subcategory capped at 3.0 points (60%).

### 2.4 Access Control (5 points)

| ID | Metric | Criticality | Type | Source(s) | Pass Criteria |
|----|--------|-------------|------|-----------|---------------|
| SEC-4.1 | DBA Role Minimal Grant | **CRITICAL** | threshold | SQL | <= 5 |
| SEC-4.2 | No ANY Privilege Overuse | **CRITICAL** | threshold | SQL | <= 0 |
| SEC-4.3 | No Dangerous PUBLIC Grants | Important | threshold | SQL | <= 0 |
| SEC-4.4 | SYS Remote Login Restricted | Important | enum | SQL | `NONE`, `EXCLUSIVE` |
| SEC-4.5 | OS Auth Prefix Controlled | Advisory | boolean | SQL | = true |
| SEC-4.6 | Dictionary Protection Enabled | Important | enum | SQL | `FALSE` |
| SEC-4.7 | Least-Privilege Network ACLs | Important | boolean | SQL | = true |
| SEC-4.8 | UTL_FILE_DIR Not Set | Important | boolean | SQL | = true |
| SEC-4.9 | Security Posture Target | Important | enum | Manual | `baseline`, `hardened`, `regulated` |

**Scoring**: Weight pool = 19 (2x3 + 6x2 + 1x1), normalized to 5 points.
If SEC-4.1 or SEC-4.2 fails, subcategory capped at 3.0 points (60%).

## 3. Capacity (20 points)

### 3.1 Storage (6 points)

| ID | Metric | Criticality | Type | Source(s) | Pass Criteria |
|----|--------|-------------|------|-----------|---------------|
| CAP-1.1 | No Critical Tablespaces | **CRITICAL** | threshold | SQL | <= 0 |
| CAP-1.2 | ASM Diskgroup Usage Below 80% | **CRITICAL** | threshold | SQL | per declared growth_headroom_target; otherwise <= 80 |
| CAP-1.3 | Temp Tablespace Adequate | Important | threshold | SQL | <= 90 |
| CAP-1.4 | Autoextend Configured | Advisory | boolean | SQL | = true |
| CAP-1.5 | Segment Growth Monitored | Advisory | boolean | Manual | = true |
| CAP-1.6 | PDBs Open Without Violations | Important | threshold | SQL | <= 0 |
| CAP-1.7 | SYSAUX Growth | Advisory | threshold | SQL | <= 85 |
| CAP-1.8 | Datafile Autoextend Bounded | Important | boolean | SQL | = true |
| CAP-1.9 | Large Tables Partitioned | Advisory | boolean | SQL | = true |

> **Applies when**: CAP-1.2 (ASM Diskgroup Usage Below 80%) — `asm_diskgroup_usage` is provided.

> **Applies when**: CAP-1.6 (PDBs Open Without Violations) — `multitenant_architecture` is true.

**Scoring**: Weight pool = 16 (2x3 + 3x2 + 4x1), normalized to 6 points.
If CAP-1.1 or CAP-1.2 fails, subcategory capped at 3.6 points (60%).

### 3.2 Connections (5 points)

| ID | Metric | Criticality | Type | Source(s) | Pass Criteria |
|----|--------|-------------|------|-----------|---------------|
| CAP-2.1 | Session Usage Below 80% | **CRITICAL** | threshold | SQL | <= 80 |
| CAP-2.2 | Process Usage Below 80% | **CRITICAL** | threshold | SQL | <= 80 |
| CAP-2.3 | Connection Pooling (DRCP) | Advisory | boolean | SQL, Manual | = true |
| CAP-2.5 | Active Session Count | Advisory | threshold | SQL | N/A |
| CAP-2.6 | Open Cursors Headroom | Advisory | threshold | SQL | <= 80 |
| CAP-2.7 | Inactive Session Ratio | Advisory | threshold | SQL | <= 70 |

**Scoring**: Weight pool = 10 (2x3 + 0x2 + 4x1), normalized to 5 points.
If CAP-2.1 or CAP-2.2 fails, subcategory capped at 3.0 points (60%).

### 3.3 Maintenance (5 points)

| ID | Metric | Criticality | Type | Source(s) | Pass Criteria |
|----|--------|-------------|------|-----------|---------------|
| CAP-3.1 | No Stale Object Statistics | Important | threshold | SQL | <= 10 |
| CAP-3.2 | Auto Stats Collection Enabled | Important | enum | SQL | `ENABLED`, `TRUE` |
| CAP-3.3 | Segment Advisor Findings Actioned | Advisory | threshold | SQL | <= 0 |
| CAP-3.4 | Undo Retention Adequate | Important | threshold | SQL | N/A |
| CAP-3.5 | Recyclebin Managed | Advisory | threshold | SQL | <= 100 |
| CAP-3.6 | No Invalid Objects | Important | threshold | SQL | <= 5 |
| CAP-3.7 | Fixed Object Stats Gathered | Advisory | boolean | SQL | = true |
| CAP-3.9 | Failed Scheduler Jobs | Important | threshold | SQL | <= 0 |
| CAP-3.10 | Stats Preferences Sane | Advisory | boolean | SQL | = true |
| CAP-3.11 | System Statistics at Defaults | Advisory | boolean | SQL | = true |

**Scoring**: Weight pool = 15 (0x3 + 5x2 + 5x1), normalized to 5 points.

### 3.4 Planning (4 points)

| ID | Metric | Criticality | Type | Source(s) | Pass Criteria |
|----|--------|-------------|------|-----------|---------------|
| CAP-4.1 | Undo Tablespace Usage | Important | threshold | SQL | <= 80 |
| CAP-4.2 | Sequence Cache Adequate | Advisory | threshold | SQL | >= 20 |
| CAP-4.3 | Archive Log Volume Tracked | Advisory | boolean | SQL, Manual | = true |
| CAP-4.4 | Resource Manager Active | Advisory | boolean | SQL | = true |
| CAP-4.5 | Active Undo Size | Advisory | threshold | SQL | <= 10240 |
| CAP-4.6 | PDB Resource Plan | Important | boolean | SQL | = true |
| CAP-4.7 | PDB Count vs MAX_PDBS | Advisory | threshold | SQL | <= 80 |
| CAP-4.8 | Undo Tablespace Headroom | Important | threshold | SQL | <= 85 |
| CAP-4.9 | Capacity Growth Headroom Target | Important | enum | Manual | `months_3`, `months_6`, `months_12` |

> **Applies when**: CAP-4.2 (Sequence Cache Adequate) — `sequence_cache_size` is provided.

> **Applies when**: CAP-4.3 (Archive Log Volume Tracked) — `archive_log_volume_daily` is provided.

> **Applies when**: CAP-4.6 (PDB Resource Plan) — `multitenant_architecture` is true.

> **Applies when**: CAP-4.7 (PDB Count vs MAX_PDBS) — `multitenant_architecture` is true.

**Scoring**: Weight pool = 13 (0x3 + 4x2 + 5x1), normalized to 4 points.

## 4. Performance (20 points)

### 4.1 Caching (5 points)

| ID | Metric | Criticality | Type | Source(s) | Pass Criteria |
|----|--------|-------------|------|-----------|---------------|
| PERF-1.2 | Library Cache Hit Ratio | Important | threshold | SQL | >= 98 |
| PERF-1.3 | PGA Target Configured | Important | boolean | SQL | = true |
| PERF-1.4 | ASMM in Use | Advisory | boolean | SQL | = true |
| PERF-1.5 | Result Cache Available | Advisory | enum | SQL | `MANUAL`, `FORCE` |
| PERF-1.6 | Shared Pool Free Memory | Advisory | threshold | SQL | >= 100 |
| PERF-1.8 | HugePages Used for SGA | Important | enum | SQL | `ONLY`, `TRUE` |
| PERF-1.9 | SGA Target (capture) | Advisory | threshold | SQL | >= 0 |
| PERF-1.10 | PGA Aggregate Target (capture) | Advisory | threshold | SQL | >= 0 |
| PERF-1.11 | Instance Memory vs Host RAM | Important | range | SQL | >= 40 AND <= 80 |
| PERF-1.12 | PGA Aggregate Limit Set | Advisory | boolean | SQL | = true |
| PERF-1.13 | PGA Aggregate Limit (capture) | Advisory | threshold | SQL | >= 0 |

> **Applies when**: PERF-1.9 (SGA Target (capture)) — `sga_target` is provided.

> **Applies when**: PERF-1.10 (PGA Aggregate Target (capture)) — `pga_aggregate_target` is provided.

**Scoring**: Weight pool = 15 (0x3 + 4x2 + 7x1), normalized to 5 points.

### 4.2 Query Performance (7 points)

| ID | Metric | Criticality | Type | Source(s) | Pass Criteria |
|----|--------|-------------|------|-----------|---------------|
| PERF-2.1 | AWR Enabled and Configured | **CRITICAL** | boolean | SQL | = true |
| PERF-2.2 | SQL Plan Stability | Advisory | boolean | SQL, Manual | = true |
| PERF-2.3 | No Long-Running SQL | Important | threshold | SQL | N/A |
| PERF-2.4 | Low Hard Parse Rate | Important | threshold | SQL | N/A |
| PERF-2.5 | SQL Tuning Advisor Used | Advisory | boolean | SQL | = true |
| PERF-2.7 | Optimizer Mode Appropriate | Advisory | enum | SQL | `ALL_ROWS` |
| PERF-2.8 | Top Wait Events Analyzed | Advisory | boolean | SQL | Non-empty, non-dummy value |
| PERF-2.9 | AWR Snapshot Interval <= 60min | Advisory | threshold | SQL | <= 60 |
| PERF-2.10 | SQL Plan Baselines Active | Advisory | boolean | SQL | = true |
| PERF-2.11 | Adaptive Plans Enabled | Advisory | boolean | SQL | = true |
| PERF-2.12 | Single-Block Read Latency | Important | threshold | SQL | <= 5 |
| PERF-2.13 | Cursor Sharing EXACT | Advisory | enum | SQL | `EXACT` |

> **Applies when**: PERF-2.11 (Adaptive Plans Enabled) — `adaptive_plans` is provided.

> **Applies when**: PERF-2.13 (Cursor Sharing EXACT) — `cursor_sharing_exact` is provided.

**Scoring**: Weight pool = 17 (1x3 + 3x2 + 8x1), normalized to 7 points.
If PERF-2.1 fails, subcategory capped at 4.2 points (60%).

### 4.3 Locking (4 points)

| ID | Metric | Criticality | Type | Source(s) | Pass Criteria |
|----|--------|-------------|------|-----------|---------------|
| PERF-3.1 | Low Enqueue Wait Rate | Important | threshold | SQL | <= 1 |
| PERF-3.2 | No Deadlocks (24h) | Important | threshold | SQL, Monitoring, Worker | <= 0 |
| PERF-3.3 | Low Row Lock Contention | Important | threshold | SQL | <= 100 |
| PERF-3.4 | Library Cache Latch Contention | Advisory | threshold | SQL | <= 1 |
| PERF-3.5 | RAC Global Cache Block Latency | Advisory | threshold | SQL | <= 1 |

**Scoring**: Weight pool = 8 (0x3 + 3x2 + 2x1), normalized to 4 points.

### 4.4 Replication (4 points)

| ID | Metric | Criticality | Type | Source(s) | Pass Criteria |
|----|--------|-------------|------|-----------|---------------|
| PERF-4.1 | Data Guard Apply Lag | **CRITICAL** | threshold | SQL | per declared rpo_target; otherwise <= 30 |
| PERF-4.2 | Data Guard Transport Lag | Important | threshold | SQL | per declared rpo_target; otherwise <= 60 |
| PERF-4.3 | No Archive Gap on Standby | **CRITICAL** | threshold | SQL | <= 0 |
| PERF-4.4 | Data Guard Protection Mode | Advisory | enum | SQL | `MAXIMUM PROTECTION`, `MAXIMUM AVAILABILITY`, `MAXIMUM PERFORMANCE` |
| PERF-4.5 | RAC Application Services | Advisory | boolean | SQL | = true |
| PERF-4.6 | Data Guard Apply Keeps Up | Advisory | boolean | SQL | = true |
| PERF-4.7 | Disaster-Recovery Topology | Important | enum | Manual | `none`, `dg_async`, `dg_sync`, `rac_dg` |

> **Applies when**: PERF-4.1 (Data Guard Apply Lag) — `dataguard_configured` is true AND `standby_health` is provided.

> **Applies when**: PERF-4.2 (Data Guard Transport Lag) — `dataguard_configured` is true AND `standby_health` is provided.

> **Applies when**: PERF-4.3 (No Archive Gap on Standby) — `dataguard_configured` is true AND `standby_health` is provided.

> **Applies when**: PERF-4.4 (Data Guard Protection Mode) — `dataguard_configured` is true AND `standby_health` is provided.

> **Applies when**: PERF-4.6 (Data Guard Apply Keeps Up) — `dataguard_configured` is true AND `standby_health` is provided.

**Scoring**: Weight pool = 13 (2x3 + 2x2 + 3x1), normalized to 4 points.
If PERF-4.1 or PERF-4.3 fails, subcategory capped at 2.4 points (60%).

## 5. Future-Proofing (20 points)

### 5.1 Version Currency (7 points)

| ID | Metric | Criticality | Type | Source(s) | Pass Criteria |
|----|--------|-------------|------|-----------|---------------|
| FUT-1.1 | Oracle Version >= 19c | **CRITICAL** | threshold | SQL | >= 19 |
| FUT-1.2 | Latest RU/PSU Applied | **CRITICAL** | threshold | SQL | <= 12 |
| FUT-1.3 | No Desupport Risk | Important | boolean | Manual | = true |
| FUT-1.4 | Patch Level Documented | Advisory | boolean | Manual | = true |
| FUT-1.5 | Registry Components Valid | Advisory | threshold | SQL | <= 0 |
| FUT-1.6 | Time Zone File Currency | Advisory | threshold | SQL | >= 38 |

> **Gate**: FUT-1.1 (Oracle Version >= 19c) — if this critical metric fails, the entire pillar is zeroed.

**Scoring**: Weight pool = 11 (2x3 + 1x2 + 3x1), normalized to 7 points.
If FUT-1.1 or FUT-1.2 fails, subcategory capped at 4.2 points (60%).

### 5.2 Configuration (4 points)

| ID | Metric | Criticality | Type | Source(s) | Pass Criteria |
|----|--------|-------------|------|-----------|---------------|
| FUT-2.1 | HA Technology Configured | Important | boolean | SQL | = true |
| FUT-2.2 | ASM Storage in Use | Advisory | boolean | SQL | = true |
| FUT-2.3 | SPFILE in Use | Important | boolean | SQL | = true |
| FUT-2.4 | Multitenant Architecture Adopted | Advisory | boolean | SQL | = true |
| FUT-2.5 | Management Pack Access Matches License | Important | enum | SQL | `NONE`, `DIAGNOSTIC`, `DIAGNOSTIC+TUNING` |
| FUT-2.6 | SecureFiles LOB Adoption | Advisory | enum | SQL | `PREFERRED`, `ALWAYS` |

> **Applies when**: FUT-2.5 (Management Pack Access Matches License) — `control_mgmt_pack_access` is provided.

> **Applies when**: FUT-2.6 (SecureFiles LOB Adoption) — `securefiles_adoption` is provided.

**Scoring**: Weight pool = 9 (0x3 + 3x2 + 3x1), normalized to 4 points.

### 5.3 Upgrade Planning (5 points)

| ID | Metric | Criticality | Type | Source(s) | Pass Criteria |
|----|--------|-------------|------|-----------|---------------|
| FUT-3.1 | Upgrade Plan Exists | Important | boolean | Manual | = true |
| FUT-3.2 | No Deprecated Parameters | Important | threshold | SQL | <= 0 |
| FUT-3.3 | Init.ora Best Practices | Advisory | boolean | SQL | = true |
| FUT-3.4 | ORAchk / Exachk Executed | Advisory | boolean | Manual | = true |
| FUT-3.5 | Compatibility Parameter Current | Advisory | boolean | SQL | = true |
| FUT-3.6 | Hidden Parameters Reviewed | Important | boolean | SQL | = true |
| FUT-3.7 | AutoUpgrade Readiness | Advisory | boolean | Manual | = true |

**Scoring**: Weight pool = 10 (0x3 + 3x2 + 4x1), normalized to 5 points.

### 5.4 Health Foundation (4 points)

| ID | Metric | Criticality | Type | Source(s) | Pass Criteria |
|----|--------|-------------|------|-----------|---------------|
| FUT-4.1 | Enterprise Manager Connected | Advisory | boolean | Manual | = true |
| FUT-4.2 | Database Alerting Configured | Important | boolean | Manual | = true |
| FUT-4.3 | AWR Retention Adequate | Advisory | threshold | SQL | >= 30 |
| FUT-4.4 | Database Documentation Current | Advisory | boolean | Manual | = true |
| FUT-4.5 | Configuration Backup Exists | Advisory | boolean | Manual | = true |

**Scoring**: Weight pool = 6 (0x3 + 1x2 + 4x1), normalized to 4 points.

---

## Appendix A: Metrics by Source

### SQL / Healthcheck Scripts (135 metrics)

These metrics are collected via direct database queries.

| ID | Metric | Pillar | Criticality |
|----|--------|--------|-------------|
| BAK-1.1 | Archive Log Mode Enabled | Backup & Recovery | **CRITICAL** |
| BAK-1.2 | Archive Destination Configured | Backup & Recovery | **CRITICAL** |
| BAK-1.5 | Redo Log Size Adequate | Backup & Recovery | Advisory |
| BAK-1.6 | Log Switch Rate Healthy | Backup & Recovery | Advisory |
| BAK-2.2 | Last RMAN Backup Age | Backup & Recovery | Important |
| BAK-3.1 | RMAN Configured | Backup & Recovery | Important |
| BAK-3.2 | RMAN Compression Enabled | Backup & Recovery | Advisory |
| BAK-3.3 | Flashback Database Enabled | Backup & Recovery | Important |
| BAK-3.4 | Controlfile Autobackup On | Backup & Recovery | **CRITICAL** |
| BAK-3.5 | Block Change Tracking Enabled | Backup & Recovery | Advisory |
| BAK-4.4 | Data Guard Configured | Backup & Recovery | Important |
| BAK-4.5 | Standby Database Healthy | Backup & Recovery | **CRITICAL** |
| BAK-4.6 | Force Logging Enabled | Backup & Recovery | Important |
| BAK-4.7 | Data Guard Broker Managed | Backup & Recovery | Advisory |
| BAK-5.1 | RMAN Retention Policy Set | Backup & Recovery | Important |
| BAK-5.2 | FRA Usage Below Threshold | Backup & Recovery | **CRITICAL** |
| BAK-5.3 | Archive Log Retention Adequate | Backup & Recovery | Important |
| SEC-1.1 | Network Encryption Enabled | Security | **CRITICAL** |
| SEC-1.2 | Password Verify Function Set | Security | **CRITICAL** |
| SEC-1.3 | Failed Login Limit Configured | Security | Important |
| SEC-1.4 | Password Lifetime Policy | Security | Advisory |
| SEC-1.5 | No Default Passwords | Security | **CRITICAL** |
| SEC-2.1 | TDE Enabled | Security | Important |
| SEC-2.2 | TDE Wallet Open | Security | **CRITICAL** |
| SEC-2.3 | Network Checksum Enabled | Security | Important |
| SEC-2.5 | DB Block Checksum Enabled | Security | Important |
| SEC-3.1 | Unified Auditing Enabled | Security | Important |
| SEC-3.2 | Audit Policy Active | Security | **CRITICAL** |
| SEC-3.3 | Fine-Grained Auditing Considered | Security | Advisory |
| SEC-3.5 | Privilege Use Audited | Security | Important |
| SEC-3.6 | Audit Trail Purge Configured | Security | Advisory |
| SEC-4.1 | DBA Role Minimal Grant | Security | **CRITICAL** |
| SEC-4.2 | No ANY Privilege Overuse | Security | **CRITICAL** |
| SEC-4.3 | No Dangerous PUBLIC Grants | Security | Important |
| SEC-4.4 | SYS Remote Login Restricted | Security | Important |
| SEC-4.5 | OS Auth Prefix Controlled | Security | Advisory |
| SEC-4.6 | Dictionary Protection Enabled | Security | Important |
| CAP-1.1 | No Critical Tablespaces | Capacity | **CRITICAL** |
| CAP-1.2 | ASM Diskgroup Usage Below 80% | Capacity | **CRITICAL** |
| CAP-1.3 | Temp Tablespace Adequate | Capacity | Important |
| CAP-1.4 | Autoextend Configured | Capacity | Advisory |
| CAP-1.6 | PDBs Open Without Violations | Capacity | Important |
| CAP-2.1 | Session Usage Below 80% | Capacity | **CRITICAL** |
| CAP-2.2 | Process Usage Below 80% | Capacity | **CRITICAL** |
| CAP-2.3 | Connection Pooling (DRCP) | Capacity | Advisory |
| CAP-3.1 | No Stale Object Statistics | Capacity | Important |
| CAP-3.2 | Auto Stats Collection Enabled | Capacity | Important |
| CAP-3.3 | Segment Advisor Findings Actioned | Capacity | Advisory |
| CAP-3.4 | Undo Retention Adequate | Capacity | Important |
| CAP-3.5 | Recyclebin Managed | Capacity | Advisory |
| CAP-3.6 | No Invalid Objects | Capacity | Important |
| CAP-4.1 | Undo Tablespace Usage | Capacity | Important |
| CAP-4.2 | Sequence Cache Adequate | Capacity | Advisory |
| CAP-4.3 | Archive Log Volume Tracked | Capacity | Advisory |
| CAP-4.4 | Resource Manager Active | Capacity | Advisory |
| PERF-1.2 | Library Cache Hit Ratio | Performance | Important |
| PERF-1.3 | PGA Target Configured | Performance | Important |
| PERF-1.4 | ASMM in Use | Performance | Advisory |
| PERF-1.5 | Result Cache Available | Performance | Advisory |
| PERF-2.1 | AWR Enabled and Configured | Performance | **CRITICAL** |
| PERF-2.2 | SQL Plan Stability | Performance | Advisory |
| PERF-2.3 | No Long-Running SQL | Performance | Important |
| PERF-2.4 | Low Hard Parse Rate | Performance | Important |
| PERF-2.5 | SQL Tuning Advisor Used | Performance | Advisory |
| PERF-2.7 | Optimizer Mode Appropriate | Performance | Advisory |
| PERF-3.1 | Low Enqueue Wait Rate | Performance | Important |
| PERF-3.2 | No Deadlocks (24h) | Performance | Important |
| PERF-3.3 | Low Row Lock Contention | Performance | Important |
| PERF-3.4 | Library Cache Latch Contention | Performance | Advisory |
| PERF-4.1 | Data Guard Apply Lag | Performance | **CRITICAL** |
| PERF-4.2 | Data Guard Transport Lag | Performance | Important |
| PERF-4.3 | No Archive Gap on Standby | Performance | **CRITICAL** |
| PERF-4.4 | Data Guard Protection Mode | Performance | Advisory |
| FUT-1.1 | Oracle Version >= 19c | Future-Proofing | **CRITICAL** |
| FUT-1.2 | Latest RU/PSU Applied | Future-Proofing | **CRITICAL** |
| FUT-2.1 | HA Technology Configured | Future-Proofing | Important |
| FUT-2.2 | ASM Storage in Use | Future-Proofing | Advisory |
| FUT-2.3 | SPFILE in Use | Future-Proofing | Important |
| FUT-2.4 | Multitenant Architecture Adopted | Future-Proofing | Advisory |
| FUT-3.2 | No Deprecated Parameters | Future-Proofing | Important |
| FUT-3.3 | Init.ora Best Practices | Future-Proofing | Advisory |
| FUT-3.5 | Compatibility Parameter Current | Future-Proofing | Advisory |
| FUT-4.3 | AWR Retention Adequate | Future-Proofing | Advisory |
| BAK-2.5 | Last RMAN Backup Status | Backup & Recovery | **CRITICAL** |
| SEC-1.6 | Password Profiles Defined | Security | Advisory |
| CAP-2.5 | Active Session Count | Capacity | Advisory |
| CAP-4.5 | Active Undo Size | Capacity | Advisory |
| PERF-2.8 | Top Wait Events Analyzed | Performance | Advisory |
| PERF-2.9 | AWR Snapshot Interval <= 60min | Performance | Advisory |
| PERF-1.6 | Shared Pool Free Memory | Performance | Advisory |
| PERF-1.8 | HugePages Used for SGA | Performance | Important |
| FUT-1.5 | Registry Components Valid | Future-Proofing | Advisory |
| BAK-1.7 | Redo Log Member Redundancy | Backup & Recovery | **CRITICAL** |
| BAK-1.8 | Standby Redo Logs Present | Backup & Recovery | Important |
| BAK-3.6 | RMAN Backup Encryption | Backup & Recovery | Advisory |
| BAK-3.7 | Archivelog Deletion Policy | Backup & Recovery | Advisory |
| BAK-4.8 | Active Data Guard Real-Time Apply | Backup & Recovery | Advisory |
| BAK-4.9 | Fast-Start Failover Configured | Backup & Recovery | Advisory |
| SEC-1.8 | Profile Resource Limits | Security | Advisory |
| SEC-1.9 | Inactive Account Lockout | Security | Advisory |
| SEC-2.6 | TDE Keystore Backed Up | Security | **CRITICAL** |
| SEC-2.7 | Data Redaction Policies | Security | Advisory |
| SEC-2.8 | TDE Algorithm Strength | Security | Advisory |
| SEC-3.7 | SYS Operations Audited | Security | Important |
| SEC-3.8 | Audit Trail Destination | Security | Important |
| SEC-4.7 | Least-Privilege Network ACLs | Security | Important |
| SEC-4.8 | UTL_FILE_DIR Not Set | Security | Important |
| CAP-1.7 | SYSAUX Growth | Capacity | Advisory |
| CAP-1.8 | Datafile Autoextend Bounded | Capacity | Important |
| CAP-1.9 | Large Tables Partitioned | Capacity | Advisory |
| CAP-2.6 | Open Cursors Headroom | Capacity | Advisory |
| CAP-2.7 | Inactive Session Ratio | Capacity | Advisory |
| CAP-3.7 | Fixed Object Stats Gathered | Capacity | Advisory |
| CAP-3.9 | Failed Scheduler Jobs | Capacity | Important |
| CAP-3.10 | Stats Preferences Sane | Capacity | Advisory |
| CAP-3.11 | System Statistics at Defaults | Capacity | Advisory |
| CAP-4.6 | PDB Resource Plan | Capacity | Important |
| CAP-4.7 | PDB Count vs MAX_PDBS | Capacity | Advisory |
| CAP-4.8 | Undo Tablespace Headroom | Capacity | Important |
| PERF-1.9 | SGA Target (capture) | Performance | Advisory |
| PERF-1.10 | PGA Aggregate Target (capture) | Performance | Advisory |
| PERF-1.11 | Instance Memory vs Host RAM | Performance | Important |
| PERF-1.12 | PGA Aggregate Limit Set | Performance | Advisory |
| PERF-1.13 | PGA Aggregate Limit (capture) | Performance | Advisory |
| PERF-2.10 | SQL Plan Baselines Active | Performance | Advisory |
| PERF-2.11 | Adaptive Plans Enabled | Performance | Advisory |
| PERF-2.12 | Single-Block Read Latency | Performance | Important |
| PERF-2.13 | Cursor Sharing EXACT | Performance | Advisory |
| PERF-3.5 | RAC Global Cache Block Latency | Performance | Advisory |
| PERF-4.5 | RAC Application Services | Performance | Advisory |
| PERF-4.6 | Data Guard Apply Keeps Up | Performance | Advisory |
| FUT-1.6 | Time Zone File Currency | Future-Proofing | Advisory |
| FUT-2.5 | Management Pack Access Matches License | Future-Proofing | Important |
| FUT-2.6 | SecureFiles LOB Adoption | Future-Proofing | Advisory |
| FUT-3.6 | Hidden Parameters Reviewed | Future-Proofing | Important |

### Monitoring (2 metrics)

These metrics are collected from monitoring systems (Zabbix, PMM, worker scripts).

| ID | Metric | Pillar | Criticality |
|----|--------|--------|-------------|
| BAK-2.2 | Last RMAN Backup Age | Backup & Recovery | Important |
| PERF-3.2 | No Deadlocks (24h) | Performance | Important |

### Manual Inputs (33 metrics)

These metrics require manual input from the operator.

| ID | Metric | Pillar | Criticality | Remediation |
|----|--------|--------|-------------|-------------|
| BAK-2.1 | RMAN Backup Schedule Defined | Backup & Recovery | **CRITICAL** | Configure an RMAN backup script and schedule it with Oracle Scheduler or cron |
| BAK-2.3 | Backup Verification | Backup & Recovery | Advisory | Schedule a regular RMAN validation of the database and its archivelogs: BACKUP VALIDATE CHECK LOGICA |
| BAK-2.4 | Data Pump Export Configured | Backup & Recovery | Advisory | Configure regular Data Pump exports for logical backup capability |
| BAK-4.1 | RPO Target Defined | Backup & Recovery | **CRITICAL** | Define and document RPO target based on business requirements |
| BAK-4.2 | RTO Target Defined | Backup & Recovery | **CRITICAL** | Define and document RTO target based on business requirements |
| BAK-4.3 | Restore Tested (90d) | Backup & Recovery | Important | Schedule regular RMAN restore tests to a non-production environment; as a minimum, run a simulated r |
| BAK-4.4 | Data Guard Configured | Backup & Recovery | Important | Configure Oracle Data Guard for high availability and disaster recovery |
| BAK-5.3 | Archive Log Retention Adequate | Backup & Recovery | Important | Ensure archive log destination has sufficient space and DELETE INPUT is not configured too aggressiv |
| BAK-5.4 | Offsite Backup Copy | Backup & Recovery | Important | Replicate RMAN backups to a second site or cloud object store (e.g., OCI Object Storage / S3); confi |
| SEC-1.1 | Network Encryption Enabled | Security | **CRITICAL** | Set SQLNET.ENCRYPTION_SERVER=REQUIRED (or move endpoints to TCPS/TLS). |
| SEC-2.3 | Network Checksum Enabled | Security | Important | Set SQLNET.CRYPTO_CHECKSUM_SERVER = REQUIRED in sqlnet.ora |
| SEC-2.4 | Sensitive Tablespaces Encrypted | Security | Advisory | Encrypt sensitive tablespaces: ALTER TABLESPACE ... ENCRYPTION ONLINE ENCRYPT; |
| SEC-3.4 | Audit Trail Protected | Security | Important | Configure audit trail to OS or DB with restricted access; consider syslog forwarding |
| CAP-1.5 | Segment Growth Monitored | Capacity | Advisory | Schedule Segment Advisor job and review DBA_SEGMENTS growth regularly |
| CAP-2.3 | Connection Pooling (DRCP) | Capacity | Advisory | Configure DRCP: EXECUTE DBMS_CONNECTION_POOL.START_POOL(); or use application connection pool |
| CAP-4.3 | Archive Log Volume Tracked | Capacity | Advisory | Review V$ARCHIVED_LOG for daily volume trends and size FRA accordingly |
| PERF-2.2 | SQL Plan Stability | Performance | Advisory | Use DBMS_SPM to capture and evolve SQL plan baselines for critical queries |
| FUT-1.3 | No Desupport Risk | Future-Proofing | Important | Review My Oracle Support Lifetime Support Policy and plan upgrade before extended support ends |
| FUT-1.4 | Patch Level Documented | Future-Proofing | Advisory | Maintain patch inventory using opatch lspatches output in change management system |
| FUT-3.1 | Upgrade Plan Exists | Future-Proofing | Important | Create an upgrade roadmap and test using Oracle AutoUpgrade tool |
| FUT-3.4 | ORAchk / Exachk Executed | Future-Proofing | Advisory | Download ORAchk from My Oracle Support and run regularly |
| FUT-4.1 | Enterprise Manager Connected | Future-Proofing | Advisory | Deploy Oracle EM agent for centralized monitoring and lifecycle management |
| FUT-4.2 | Database Alerting Configured | Future-Proofing | Important | Configure alert log monitoring and critical threshold alerts (tablespace, process limits) |
| FUT-4.4 | Database Documentation Current | Future-Proofing | Advisory | Maintain up-to-date architecture diagrams, runbooks, and change log |
| BAK-2.6 | RMAN Recovery Catalog | Backup & Recovery | Important | Create and register a recovery catalog (CREATE CATALOG; REGISTER DATABASE) and back it up. |
| BAK-4.10 | DR Plan Documented | Backup & Recovery | Advisory | Document the DR strategy: RTO/RPO objectives, standby/restore runbooks, contact roles, and a periodi |
| SEC-1.7 | Listener Hardening | Security | **CRITICAL** | Set ADMIN_RESTRICTIONS_<listener>=ON, remove extproc, set SECURE_REGISTER_<listener>=TCPS/IPC, enabl |
| SEC-2.6 | TDE Keystore Backed Up | Security | **CRITICAL** | Back up the keystore (ADMINISTER KEY MANAGEMENT BACKUP KEYSTORE). For a software wallet, locate it v |
| SEC-4.9 | Security Posture Target | Security | Important | Declare the security posture matching this database's compliance scope, then align TDE and auditing  |
| CAP-4.9 | Capacity Growth Headroom Target | Capacity | Important | Declare the growth horizon and ensure current tablespace utilisation leaves room to reach it before  |
| PERF-4.7 | Disaster-Recovery Topology | Performance | Important | Declare the DR topology in place and align Data Guard configuration / protection mode to it. |
| FUT-3.7 | AutoUpgrade Readiness | Future-Proofing | Advisory | Run autoupgrade.jar -mode analyze for the target release and clear ERROR-level findings. |
| FUT-4.5 | Configuration Backup Exists | Future-Proofing | Advisory | Back up spfile (RMAN/controlfile autobackup covers spfile), the password file, and listener/tnsnames |

## Appendix B: Gate Metrics

| ID | Metric | Criticality | Gate Scope | Effect |
|----|--------|-------------|------------|--------|
| BAK-1.1 | Archive Log Mode Enabled | **CRITICAL** | pillar | Zeros entire pillar score |
| FUT-1.1 | Oracle Version >= 19c | **CRITICAL** | pillar | Zeros entire pillar score |
