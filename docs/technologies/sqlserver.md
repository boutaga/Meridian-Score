# SQL Server Scoring Reference

> Auto-generated from catalog v1.2.1. Do not edit manually — modify the JSON catalog and re-run `npm run generate-docs`.

## Overview

| Property | Value |
|----------|-------|
| Technology | SQL Server |
| Catalog Version | 1.2.1 |
| Total Metrics | 105 |
| Critical | 23 (weight: 3x) |
| Important | 46 (weight: 2x) |
| Advisory | 36 (weight: 1x) |
| Max Score | 100 points (5 pillars x 20 points) |

## Scoring Summary

| Pillar | Subcategory | Points | Metrics | Critical |
|--------|-------------|--------|---------|----------|
| **Backup & Recovery** (20pts) | Log Archiving | 5 | 6 | 2 |
|  | Scheduled Backups | 4 | 5 | 2 |
|  | Backup Tools | 4 | 4 | 0 |
|  | Recovery Readiness | 4 | 5 | 3 |
|  | Retention Compliance | 3 | 3 | 0 |
| **Security** (20pts) | Authentication | 5 | 6 | 1 |
|  | Encryption | 5 | 5 | 2 |
|  | Audit & Logging | 5 | 5 | 0 |
|  | Access Control | 5 | 6 | 3 |
| **Capacity** (20pts) | Storage | 5 | 7 | 2 |
|  | Connections | 5 | 4 | 0 |
|  | Maintenance | 6 | 6 | 2 |
|  | Planning | 4 | 4 | 1 |
| **Performance** (20pts) | Caching | 5 | 6 | 1 |
|  | Query Performance | 7 | 8 | 0 |
|  | Locking | 4 | 4 | 0 |
|  | Replication | 4 | 4 | 1 |
| **Future-Proofing** (20pts) | Version Currency | 7 | 5 | 2 |
|  | Configuration | 3 | 3 | 0 |
|  | Upgrade Planning | 6 | 5 | 0 |
|  | Health Foundation | 4 | 4 | 1 |

## 1. Backup & Recovery (20 points)

### 1.1 Log Archiving (5 points)

| ID | Metric | Criticality | Type | Source(s) | Pass Criteria |
|----|--------|-------------|------|-----------|---------------|
| BAK-1.1 | Recovery Model FULL | **CRITICAL** | enum | SQL | `FULL` |
| BAK-1.2 | Log Backup Frequency | **CRITICAL** | threshold | SQL | <= 60 |
| BAK-1.3 | No Log Backup Failures (24h) | Important | threshold | SQL | <= 0 |
| BAK-1.4 | Log File Not Growing Uncontrolled | Important | boolean | SQL | = true |
| BAK-1.5 | VLF Count Under Control | Advisory | threshold | SQL | <= 1000 |
| BAK-1.6 | Simple Recovery Databases | Advisory | threshold | SQL | <= 0 |

> **Gate**: BAK-1.1 (Recovery Model FULL) — if this critical metric fails, the entire pillar is zeroed.

**Scoring**: Weight pool = 12 (2x3 + 2x2 + 2x1), normalized to 5 points.
If BAK-1.1 or BAK-1.2 fails, subcategory capped at 3.0 points (60%).

### 1.2 Scheduled Backups (4 points)

| ID | Metric | Criticality | Type | Source(s) | Pass Criteria |
|----|--------|-------------|------|-----------|---------------|
| BAK-2.1 | Full Backup Schedule Defined | **CRITICAL** | enum | Manual | `daily`, `weekly`, `continuous` |
| BAK-2.2 | Last Full Backup Age | Important | threshold | SQL | <= 168 |
| BAK-2.3 | Differential Backup Configured | Advisory | boolean | SQL | = true |
| BAK-2.4 | Backup Verification (RESTORE VERIFYONLY) | Advisory | boolean | Manual | = true |
| BAK-2.5 | All Databases Backed Up | **CRITICAL** | threshold | SQL | <= 0 |

**Scoring**: Weight pool = 10 (2x3 + 1x2 + 2x1), normalized to 4 points.
If BAK-2.1 or BAK-2.5 fails, subcategory capped at 2.4 points (60%).

### 1.3 Backup Tools (4 points)

| ID | Metric | Criticality | Type | Source(s) | Pass Criteria |
|----|--------|-------------|------|-----------|---------------|
| BAK-3.1 | Backup Compression Enabled | Important | boolean | SQL | = true |
| BAK-3.2 | Backup Encryption | Advisory | boolean | SQL, Manual | = true |
| BAK-3.3 | Enterprise Backup Solution | Advisory | boolean | Manual | = true |
| BAK-3.4 | Backup History Maintained | Important | boolean | SQL | = true |

**Scoring**: Weight pool = 6 (0x3 + 2x2 + 2x1), normalized to 4 points.

### 1.4 Recovery Readiness (4 points)

| ID | Metric | Criticality | Type | Source(s) | Pass Criteria |
|----|--------|-------------|------|-----------|---------------|
| BAK-4.1 | RPO Target Defined | **CRITICAL** | enum | Manual | `rpo_5`, `rpo_15`, `rpo_60`, `rpo_240`, `rpo_1440`, `yes` |
| BAK-4.2 | RTO Target Defined | **CRITICAL** | enum | Manual | `rto_5`, `rto_15`, `rto_60`, `rto_240`, `rto_480`, `rto_1440`, `yes` |
| BAK-4.3 | Restore Tested (90d) | Important | boolean | Manual | = true |
| BAK-4.4 | AG Backup Preference Set | Advisory | enum | SQL | `SECONDARY`, `PREFER_SECONDARY` |
| BAK-4.5 | AG Secondary Healthy | **CRITICAL** | enum | SQL | `SYNCHRONIZED`, `SYNCHRONIZING` |

**Scoring**: Weight pool = 12 (3x3 + 1x2 + 1x1), normalized to 4 points.
If BAK-4.1 or BAK-4.2 or BAK-4.5 fails, subcategory capped at 2.4 points (60%).

### 1.5 Retention Compliance (3 points)

| ID | Metric | Criticality | Type | Source(s) | Pass Criteria |
|----|--------|-------------|------|-----------|---------------|
| BAK-5.1 | Retention Policy Met | Important | boolean | Manual | = true |
| BAK-5.2 | Offsite Backup Copy Exists | Important | boolean | Manual | = true |
| BAK-5.3 | Backup Storage Monitored | Advisory | boolean | Manual | = true |

**Scoring**: Weight pool = 5 (0x3 + 2x2 + 1x1), normalized to 3 points.

## 2. Security (20 points)

### 2.1 Authentication (5 points)

| ID | Metric | Criticality | Type | Source(s) | Pass Criteria |
|----|--------|-------------|------|-----------|---------------|
| SEC-1.1 | Windows Auth Preferred | Important | enum | SQL | `Windows Authentication Mode` |
| SEC-1.2 | SA Login Disabled | **CRITICAL** | boolean | SQL | = true |
| SEC-1.3 | Login Auditing Enabled | Important | enum | SQL | `FAILURE`, `ALL` |
| SEC-1.4 | Password Policy Enforced | Important | boolean | SQL | = true |
| SEC-1.5 | No Orphaned SQL Logins | Advisory | threshold | SQL | <= 0 |
| SEC-1.6 | Windows Authentication Only | Important | enum | SQL | `windows-only` |

**Scoring**: Weight pool = 12 (1x3 + 4x2 + 1x1), normalized to 5 points.
If SEC-1.2 fails, subcategory capped at 3.0 points (60%).

### 2.2 Encryption (5 points)

| ID | Metric | Criticality | Type | Source(s) | Pass Criteria |
|----|--------|-------------|------|-----------|---------------|
| SEC-2.1 | TDE Enabled | Important | threshold | SQL | >= 1 |
| SEC-2.2 | Connections Encrypted (TLS) | **CRITICAL** | boolean | SQL, Manual | = true |
| SEC-2.3 | Always Encrypted Considered | Advisory | boolean | SQL | = true |
| SEC-2.4 | Database Master Key Protected | Important | boolean | Manual | = true |
| SEC-2.5 | TLS 1.2+ Required | **CRITICAL** | boolean | Manual | = true |

**Scoring**: Weight pool = 11 (2x3 + 2x2 + 1x1), normalized to 5 points.
If SEC-2.2 or SEC-2.5 fails, subcategory capped at 3.0 points (60%).

### 2.3 Audit & Logging (5 points)

| ID | Metric | Criticality | Type | Source(s) | Pass Criteria |
|----|--------|-------------|------|-----------|---------------|
| SEC-3.1 | SQL Server Audit Enabled | Important | boolean | SQL | = true |
| SEC-3.2 | DDL Changes Audited | Important | boolean | SQL | = true |
| SEC-3.3 | Privileged Actions Audited | Important | boolean | SQL | = true |
| SEC-3.4 | Audit Destination Protected | Advisory | boolean | Manual | = true |
| SEC-3.5 | C2/Common Criteria Not Blocking | Advisory | boolean | SQL | = false |

**Scoring**: Weight pool = 8 (0x3 + 3x2 + 2x1), normalized to 5 points.

### 2.4 Access Control (5 points)

| ID | Metric | Criticality | Type | Source(s) | Pass Criteria |
|----|--------|-------------|------|-----------|---------------|
| SEC-4.1 | Sysadmin Role Minimal | **CRITICAL** | threshold | SQL | <= 5 |
| SEC-4.2 | BUILTIN\Administrators Not Sysadmin | **CRITICAL** | boolean | SQL | = true |
| SEC-4.3 | Cross-DB Ownership Chaining Off | Important | boolean | SQL | = false |
| SEC-4.4 | TRUSTWORTHY Off for User DBs | Important | threshold | SQL | <= 0 |
| SEC-4.5 | xp_cmdshell Disabled | **CRITICAL** | boolean | SQL | = false |
| SEC-4.6 | CLR Integration Disabled | Advisory | boolean | SQL | = true |

**Scoring**: Weight pool = 14 (3x3 + 2x2 + 1x1), normalized to 5 points.
If SEC-4.1 or SEC-4.2 or SEC-4.5 fails, subcategory capped at 3.0 points (60%).

## 3. Capacity (20 points)

### 3.1 Storage (5 points)

| ID | Metric | Criticality | Type | Source(s) | Pass Criteria |
|----|--------|-------------|------|-----------|---------------|
| CAP-1.1 | Data File Usage Below 85% | **CRITICAL** | threshold | SQL | <= 85 |
| CAP-1.2 | Autogrowth in Fixed MB (Not %) | Important | boolean | SQL | = true |
| CAP-1.3 | TempDB Properly Configured | Important | boolean | SQL | = true |
| CAP-1.4 | Log File Usage Under Control | Important | threshold | SQL | <= 80 |
| CAP-1.5 | Disk Space Adequate | **CRITICAL** | threshold | SQL, Monitoring, Worker | >= 20 |
| CAP-1.6 | Total Log Size | Advisory | boolean | SQL | Non-empty, non-dummy value |
| CAP-1.7 | Data File Growth Fixed | Important | boolean | SQL | = true |

**Scoring**: Weight pool = 15 (2x3 + 4x2 + 1x1), normalized to 5 points.
If CAP-1.1 or CAP-1.5 fails, subcategory capped at 3.0 points (60%).

### 3.2 Connections (5 points)

| ID | Metric | Criticality | Type | Source(s) | Pass Criteria |
|----|--------|-------------|------|-----------|---------------|
| CAP-2.1 | Connection Count Monitored | Important | threshold | SQL | <= 80 |
| CAP-2.2 | Connection Pooling in Use | Advisory | boolean | Manual | = true |
| CAP-2.3 | Max Worker Threads Configured | Advisory | boolean | SQL | = true |
| CAP-2.4 | Blocked Process Threshold Set | Advisory | threshold | SQL | <= 5 |

**Scoring**: Weight pool = 5 (0x3 + 1x2 + 3x1), normalized to 5 points.

### 3.3 Maintenance (6 points)

| ID | Metric | Criticality | Type | Source(s) | Pass Criteria |
|----|--------|-------------|------|-----------|---------------|
| CAP-3.1 | Index Fragmentation Managed | Important | threshold | SQL | <= 30 |
| CAP-3.2 | Statistics Up to Date | Important | boolean | SQL | = true |
| CAP-3.3 | DBCC CHECKDB Recent | **CRITICAL** | threshold | SQL | <= 168 |
| CAP-3.4 | Auto Statistics Async Updates | Advisory | boolean | SQL | = true |
| CAP-3.5 | Page Verify CHECKSUM | **CRITICAL** | enum | SQL | `CHECKSUM` |
| CAP-3.6 | Compatibility Level Current | Advisory | boolean | SQL | Non-empty, non-dummy value |

**Scoring**: Weight pool = 12 (2x3 + 2x2 + 2x1), normalized to 6 points.
If CAP-3.3 or CAP-3.5 fails, subcategory capped at 3.6 points (60%).

### 3.4 Planning (4 points)

| ID | Metric | Criticality | Type | Source(s) | Pass Criteria |
|----|--------|-------------|------|-----------|---------------|
| CAP-4.1 | Max Server Memory Configured | **CRITICAL** | boolean | SQL | = true |
| CAP-4.2 | MAXDOP Configured | Important | boolean | SQL | = true |
| CAP-4.3 | Cost Threshold for Parallelism Set | Advisory | threshold | SQL | >= 25 |
| CAP-4.4 | Log Reuse Wait Normal | Important | enum | SQL | `NOTHING`, `LOG_BACKUP` |

**Scoring**: Weight pool = 8 (1x3 + 2x2 + 1x1), normalized to 4 points.
If CAP-4.1 fails, subcategory capped at 2.4 points (60%).

## 4. Performance (20 points)

### 4.1 Caching (5 points)

| ID | Metric | Criticality | Type | Source(s) | Pass Criteria |
|----|--------|-------------|------|-----------|---------------|
| PERF-1.1 | Plan Cache Hit Ratio High | Important | threshold | SQL | >= 95 |
| PERF-1.2 | Page Life Expectancy High | **CRITICAL** | threshold | SQL | >= 300 |
| PERF-1.3 | Optimize for Ad Hoc Workloads | Advisory | boolean | SQL | = true |
| PERF-1.4 | Buffer Pool Extension Considered | Advisory | boolean | SQL, Manual | = true |
| PERF-1.5 | Intelligent Query Processing Enabled | Advisory | boolean | SQL | = true |
| PERF-1.6 | Disk Latency Acceptable | Important | threshold | SQL | <= 20 |

**Scoring**: Weight pool = 10 (1x3 + 2x2 + 3x1), normalized to 5 points.
If PERF-1.2 fails, subcategory capped at 3.0 points (60%).

### 4.2 Query Performance (7 points)

| ID | Metric | Criticality | Type | Source(s) | Pass Criteria |
|----|--------|-------------|------|-----------|---------------|
| PERF-2.1 | Query Store Enabled | Important | enum | SQL | `ON`, `READ_WRITE` |
| PERF-2.2 | Missing Indexes Reviewed | Important | threshold | SQL | <= 0 |
| PERF-2.3 | No Critical Wait Types Dominant | Important | boolean | SQL | = true |
| PERF-2.4 | No Chronic Long-Running Queries | Important | threshold | SQL | <= 60 |
| PERF-2.5 | Plan Regression Monitoring | Advisory | boolean | Manual | = true |
| PERF-2.6 | Database Parameterization | Advisory | enum | SQL | `SIMPLE`, `FORCED` |
| PERF-2.7 | Auto Create Statistics On | Important | boolean | SQL | = true |
| PERF-2.8 | Optimize for Ad Hoc Workloads | Important | boolean | SQL | = true |

**Scoring**: Weight pool = 14 (0x3 + 6x2 + 2x1), normalized to 7 points.

### 4.3 Locking (4 points)

| ID | Metric | Criticality | Type | Source(s) | Pass Criteria |
|----|--------|-------------|------|-----------|---------------|
| PERF-3.1 | No Chronic Blocking Chains | Important | threshold | SQL | <= 0 |
| PERF-3.2 | No Deadlocks (24h) | Important | threshold | SQL | <= 0 |
| PERF-3.3 | Row Versioning Isolation Considered | Advisory | boolean | SQL | = true |
| PERF-3.4 | Lock Pages in Memory (LPIM) | Advisory | boolean | Manual | = true |

**Scoring**: Weight pool = 6 (0x3 + 2x2 + 2x1), normalized to 4 points.

### 4.4 Replication (4 points)

| ID | Metric | Criticality | Type | Source(s) | Pass Criteria |
|----|--------|-------------|------|-----------|---------------|
| PERF-4.1 | AG Synchronization Lag | **CRITICAL** | threshold | SQL | <= 30 |
| PERF-4.2 | AG Redo Queue Size | Important | threshold | SQL | <= 60 |
| PERF-4.3 | AG Automatic Failover Configured | Important | boolean | SQL | = true |
| PERF-4.4 | Transactional Replication Latency | Important | threshold | SQL | <= 30 |

**Scoring**: Weight pool = 9 (1x3 + 3x2 + 0x1), normalized to 4 points.
If PERF-4.1 fails, subcategory capped at 2.4 points (60%).

## 5. Future-Proofing (20 points)

### 5.1 Version Currency (7 points)

| ID | Metric | Criticality | Type | Source(s) | Pass Criteria |
|----|--------|-------------|------|-----------|---------------|
| FUT-1.1 | Current SQL Server Version | **CRITICAL** | threshold | SQL | >= 16 |
| FUT-1.2 | Latest Cumulative Update Applied | **CRITICAL** | boolean | SQL | = true |
| FUT-1.3 | No Desupport Risk | Important | boolean | Manual | = true |
| FUT-1.4 | Patch Level Documented | Advisory | boolean | Manual | = true |
| FUT-1.6 | Patch Level Current | Important | boolean | SQL | Non-empty, non-dummy value |

> **Gate**: FUT-1.1 (Current SQL Server Version) — if this critical metric fails, the entire pillar is zeroed.

**Scoring**: Weight pool = 11 (2x3 + 2x2 + 1x1), normalized to 7 points.
If FUT-1.1 or FUT-1.2 fails, subcategory capped at 4.2 points (60%).

### 5.2 Configuration (3 points)

| ID | Metric | Criticality | Type | Source(s) | Pass Criteria |
|----|--------|-------------|------|-----------|---------------|
| FUT-2.1 | HA Technology Configured | Important | boolean | SQL | = true |
| FUT-2.2 | Instant File Initialization Enabled | Advisory | boolean | SQL, Manual | = true |
| FUT-2.3 | DAC Enabled | Advisory | boolean | SQL | = true |

**Scoring**: Weight pool = 4 (0x3 + 1x2 + 2x1), normalized to 3 points.

### 5.3 Upgrade Planning (6 points)

| ID | Metric | Criticality | Type | Source(s) | Pass Criteria |
|----|--------|-------------|------|-----------|---------------|
| FUT-3.1 | Upgrade Plan Exists | Important | boolean | Manual | = true |
| FUT-3.2 | No Deprecated Features in Use | Important | threshold | SQL | <= 0 |
| FUT-3.3 | Surface Area Minimized | Advisory | boolean | SQL | = true |
| FUT-3.4 | DEA Assessment Run | Advisory | boolean | Manual | = true |
| FUT-3.5 | Linked Servers Minimized | Advisory | threshold | SQL | <= 3 |

**Scoring**: Weight pool = 7 (0x3 + 2x2 + 3x1), normalized to 6 points.

### 5.4 Health Foundation (4 points)

| ID | Metric | Criticality | Type | Source(s) | Pass Criteria |
|----|--------|-------------|------|-----------|---------------|
| FUT-4.1 | Extended Events Monitoring Active | Advisory | boolean | SQL | = true |
| FUT-4.2 | Database Alerting Configured | **CRITICAL** | boolean | SQL, Manual | = true |
| FUT-4.3 | Query Store Retention Adequate | Advisory | threshold | SQL | >= 30 |
| FUT-4.4 | Database Documentation Current | Advisory | boolean | Manual | = true |

**Scoring**: Weight pool = 6 (1x3 + 0x2 + 3x1), normalized to 4 points.
If FUT-4.2 fails, subcategory capped at 2.4 points (60%).

---

## Appendix A: Metrics by Source

### SQL / Healthcheck Scripts (85 metrics)

These metrics are collected via direct database queries.

| ID | Metric | Pillar | Criticality |
|----|--------|--------|-------------|
| BAK-1.1 | Recovery Model FULL | Backup & Recovery | **CRITICAL** |
| BAK-1.2 | Log Backup Frequency | Backup & Recovery | **CRITICAL** |
| BAK-1.3 | No Log Backup Failures (24h) | Backup & Recovery | Important |
| BAK-1.4 | Log File Not Growing Uncontrolled | Backup & Recovery | Important |
| BAK-1.5 | VLF Count Under Control | Backup & Recovery | Advisory |
| BAK-2.2 | Last Full Backup Age | Backup & Recovery | Important |
| BAK-2.3 | Differential Backup Configured | Backup & Recovery | Advisory |
| BAK-3.1 | Backup Compression Enabled | Backup & Recovery | Important |
| BAK-3.2 | Backup Encryption | Backup & Recovery | Advisory |
| BAK-3.4 | Backup History Maintained | Backup & Recovery | Important |
| BAK-4.4 | AG Backup Preference Set | Backup & Recovery | Advisory |
| BAK-4.5 | AG Secondary Healthy | Backup & Recovery | **CRITICAL** |
| SEC-1.1 | Windows Auth Preferred | Security | Important |
| SEC-1.2 | SA Login Disabled | Security | **CRITICAL** |
| SEC-1.3 | Login Auditing Enabled | Security | Important |
| SEC-1.4 | Password Policy Enforced | Security | Important |
| SEC-1.5 | No Orphaned SQL Logins | Security | Advisory |
| SEC-2.1 | TDE Enabled | Security | Important |
| SEC-2.2 | Connections Encrypted (TLS) | Security | **CRITICAL** |
| SEC-2.3 | Always Encrypted Considered | Security | Advisory |
| SEC-3.1 | SQL Server Audit Enabled | Security | Important |
| SEC-3.2 | DDL Changes Audited | Security | Important |
| SEC-3.3 | Privileged Actions Audited | Security | Important |
| SEC-3.5 | C2/Common Criteria Not Blocking | Security | Advisory |
| SEC-4.1 | Sysadmin Role Minimal | Security | **CRITICAL** |
| SEC-4.2 | BUILTIN\Administrators Not Sysadmin | Security | **CRITICAL** |
| SEC-4.3 | Cross-DB Ownership Chaining Off | Security | Important |
| SEC-4.4 | TRUSTWORTHY Off for User DBs | Security | Important |
| SEC-4.5 | xp_cmdshell Disabled | Security | **CRITICAL** |
| CAP-1.1 | Data File Usage Below 85% | Capacity | **CRITICAL** |
| CAP-1.2 | Autogrowth in Fixed MB (Not %) | Capacity | Important |
| CAP-1.3 | TempDB Properly Configured | Capacity | Important |
| CAP-1.4 | Log File Usage Under Control | Capacity | Important |
| CAP-1.5 | Disk Space Adequate | Capacity | **CRITICAL** |
| CAP-2.1 | Connection Count Monitored | Capacity | Important |
| CAP-2.3 | Max Worker Threads Configured | Capacity | Advisory |
| CAP-2.4 | Blocked Process Threshold Set | Capacity | Advisory |
| CAP-3.1 | Index Fragmentation Managed | Capacity | Important |
| CAP-3.2 | Statistics Up to Date | Capacity | Important |
| CAP-3.3 | DBCC CHECKDB Recent | Capacity | **CRITICAL** |
| CAP-3.4 | Auto Statistics Async Updates | Capacity | Advisory |
| CAP-3.5 | Page Verify CHECKSUM | Capacity | **CRITICAL** |
| CAP-3.6 | Compatibility Level Current | Capacity | Advisory |
| CAP-4.1 | Max Server Memory Configured | Capacity | **CRITICAL** |
| CAP-4.2 | MAXDOP Configured | Capacity | Important |
| CAP-4.3 | Cost Threshold for Parallelism Set | Capacity | Advisory |
| CAP-4.4 | Log Reuse Wait Normal | Capacity | Important |
| PERF-1.1 | Plan Cache Hit Ratio High | Performance | Important |
| PERF-1.2 | Page Life Expectancy High | Performance | **CRITICAL** |
| PERF-1.3 | Optimize for Ad Hoc Workloads | Performance | Advisory |
| PERF-1.4 | Buffer Pool Extension Considered | Performance | Advisory |
| PERF-1.5 | Intelligent Query Processing Enabled | Performance | Advisory |
| PERF-2.1 | Query Store Enabled | Performance | Important |
| PERF-2.2 | Missing Indexes Reviewed | Performance | Important |
| PERF-2.3 | No Critical Wait Types Dominant | Performance | Important |
| PERF-2.4 | No Chronic Long-Running Queries | Performance | Important |
| PERF-2.6 | Database Parameterization | Performance | Advisory |
| PERF-2.7 | Auto Create Statistics On | Performance | Important |
| PERF-3.1 | No Chronic Blocking Chains | Performance | Important |
| PERF-3.2 | No Deadlocks (24h) | Performance | Important |
| PERF-3.3 | Row Versioning Isolation Considered | Performance | Advisory |
| PERF-4.1 | AG Synchronization Lag | Performance | **CRITICAL** |
| PERF-4.2 | AG Redo Queue Size | Performance | Important |
| PERF-4.3 | AG Automatic Failover Configured | Performance | Important |
| PERF-4.4 | Transactional Replication Latency | Performance | Important |
| FUT-1.1 | Current SQL Server Version | Future-Proofing | **CRITICAL** |
| FUT-1.2 | Latest Cumulative Update Applied | Future-Proofing | **CRITICAL** |
| FUT-2.1 | HA Technology Configured | Future-Proofing | Important |
| FUT-2.2 | Instant File Initialization Enabled | Future-Proofing | Advisory |
| FUT-2.3 | DAC Enabled | Future-Proofing | Advisory |
| FUT-3.2 | No Deprecated Features in Use | Future-Proofing | Important |
| FUT-3.3 | Surface Area Minimized | Future-Proofing | Advisory |
| FUT-3.5 | Linked Servers Minimized | Future-Proofing | Advisory |
| FUT-4.1 | Extended Events Monitoring Active | Future-Proofing | Advisory |
| FUT-4.2 | Database Alerting Configured | Future-Proofing | **CRITICAL** |
| FUT-4.3 | Query Store Retention Adequate | Future-Proofing | Advisory |
| BAK-1.6 | Simple Recovery Databases | Backup & Recovery | Advisory |
| CAP-1.6 | Total Log Size | Capacity | Advisory |
| BAK-2.5 | All Databases Backed Up | Backup & Recovery | **CRITICAL** |
| SEC-1.6 | Windows Authentication Only | Security | Important |
| SEC-4.6 | CLR Integration Disabled | Security | Advisory |
| CAP-1.7 | Data File Growth Fixed | Capacity | Important |
| PERF-2.8 | Optimize for Ad Hoc Workloads | Performance | Important |
| PERF-1.6 | Disk Latency Acceptable | Performance | Important |
| FUT-1.6 | Patch Level Current | Future-Proofing | Important |

### Monitoring (1 metrics)

These metrics are collected from monitoring systems (Zabbix, PMM, worker scripts).

| ID | Metric | Pillar | Criticality |
|----|--------|--------|-------------|
| CAP-1.5 | Disk Space Adequate | Capacity | **CRITICAL** |

### Manual Inputs (25 metrics)

These metrics require manual input from the operator.

| ID | Metric | Pillar | Criticality | Remediation |
|----|--------|--------|-------------|-------------|
| BAK-2.1 | Full Backup Schedule Defined | Backup & Recovery | **CRITICAL** | Configure SQL Server Agent job or Maintenance Plan for regular full backups |
| BAK-2.4 | Backup Verification (RESTORE VERIFYONLY) | Backup & Recovery | Advisory | Add RESTORE VERIFYONLY step to backup jobs or use Ola Hallengren backup solution |
| BAK-3.2 | Backup Encryption | Backup & Recovery | Advisory | Use WITH ENCRYPTION option in BACKUP DATABASE command or use TDE + backup to encrypted media |
| BAK-3.3 | Enterprise Backup Solution | Backup & Recovery | Advisory | Consider Ola Hallengren's Maintenance Solution (free) for enterprise-grade backup management |
| BAK-4.1 | RPO Target Defined | Backup & Recovery | **CRITICAL** | Define and document RPO target based on business requirements |
| BAK-4.2 | RTO Target Defined | Backup & Recovery | **CRITICAL** | Define and document RTO target based on business requirements |
| BAK-4.3 | Restore Tested (90d) | Backup & Recovery | Important | Schedule regular restore tests to a non-production environment at least quarterly |
| BAK-5.1 | Retention Policy Met | Backup & Recovery | Important | Configure backup retention in your backup solution to meet compliance requirements |
| BAK-5.2 | Offsite Backup Copy Exists | Backup & Recovery | Important | Configure backup copy jobs to Azure Blob, S3, or secondary site |
| BAK-5.3 | Backup Storage Monitored | Backup & Recovery | Advisory | Configure disk space monitoring on backup volumes with alerting |
| SEC-2.2 | Connections Encrypted (TLS) | Security | **CRITICAL** | Enable Force Encryption in SQL Server Configuration Manager; configure valid SSL certificate |
| SEC-2.4 | Database Master Key Protected | Security | Important | Backup master key: BACKUP MASTER KEY TO FILE = '...' ENCRYPTION BY PASSWORD = '...'; |
| SEC-2.5 | TLS 1.2+ Required | Security | **CRITICAL** | Disable TLS 1.0/1.1 via Windows registry settings; enable TLS 1.2 minimum |
| SEC-3.4 | Audit Destination Protected | Security | Advisory | Store audit files on dedicated volume with permissions restricted to SQL Server service account |
| CAP-2.2 | Connection Pooling in Use | Capacity | Advisory | Ensure application framework connection pooling is enabled and correctly sized |
| PERF-1.4 | Buffer Pool Extension Considered | Performance | Advisory | Consider BPE on NVMe SSD if physical RAM cannot be increased |
| PERF-2.5 | Plan Regression Monitoring | Performance | Advisory | Review Query Store Regressed Queries; use sp_query_store_force_plan for critical plan stabilization |
| PERF-3.4 | Lock Pages in Memory (LPIM) | Performance | Advisory | Enable LPIM Windows privilege for SQL Server service account on OLTP servers with high memory pressu |
| FUT-1.3 | No Desupport Risk | Future-Proofing | Important | Review Microsoft SQL Server support lifecycle page; plan upgrade timeline |
| FUT-1.4 | Patch Level Documented | Future-Proofing | Advisory | Maintain patch history in CMDB or change management tool |
| FUT-2.2 | Instant File Initialization Enabled | Future-Proofing | Advisory | Grant 'Perform Volume Maintenance Tasks' to SQL Server service account; restart SQL Server |
| FUT-3.1 | Upgrade Plan Exists | Future-Proofing | Important | Plan upgrade using Microsoft Upgrade Advisor or Database Experimentation Assistant (DEA) |
| FUT-3.4 | DEA Assessment Run | Future-Proofing | Advisory | Download Microsoft DEA from GitHub and run workload comparison analysis before upgrade |
| FUT-4.2 | Database Alerting Configured | Future-Proofing | **CRITICAL** | Configure SQL Server Agent alerts for severity 19-25 errors and I/O error codes 823, 824, 825 |
| FUT-4.4 | Database Documentation Current | Future-Proofing | Advisory | Maintain up-to-date architecture diagrams, runbooks, and change log |

## Appendix B: Gate Metrics

| ID | Metric | Criticality | Gate Scope | Effect |
|----|--------|-------------|------------|--------|
| BAK-1.1 | Recovery Model FULL | **CRITICAL** | pillar | Zeros entire pillar score |
| FUT-1.1 | Current SQL Server Version | **CRITICAL** | pillar | Zeros entire pillar score |
