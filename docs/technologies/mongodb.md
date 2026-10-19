# MongoDB Scoring Reference

> Auto-generated from catalog v1.2.1. Do not edit manually — modify the JSON catalog and re-run `npm run generate-docs`.

## Overview

| Property | Value |
|----------|-------|
| Technology | MongoDB |
| Catalog Version | 1.2.1 |
| Total Metrics | 110 |
| Critical | 23 (weight: 3x) |
| Important | 51 (weight: 2x) |
| Advisory | 36 (weight: 1x) |
| Max Score | 100 points (5 pillars x 20 points) |

## Scoring Summary

| Pillar | Subcategory | Points | Metrics | Critical |
|--------|-------------|--------|---------|----------|
| **Backup & Recovery** (20pts) | Oplog & Continuity | 5 | 7 | 3 |
|  | Scheduled Backups | 4 | 4 | 2 |
|  | Backup Tools | 4 | 4 | 0 |
|  | Recovery Readiness | 4 | 4 | 2 |
|  | Retention Compliance | 3 | 3 | 0 |
| **Security** (20pts) | Authentication | 5 | 6 | 3 |
|  | Encryption | 5 | 5 | 2 |
|  | Audit & Logging | 5 | 5 | 0 |
|  | Access Control | 5 | 5 | 3 |
| **Capacity** (20pts) | Storage | 5 | 8 | 1 |
|  | Connections | 5 | 4 | 0 |
|  | Maintenance | 6 | 5 | 0 |
|  | Planning | 4 | 4 | 0 |
| **Performance** (20pts) | Caching | 5 | 5 | 0 |
|  | Query Performance | 7 | 14 | 0 |
|  | Locking | 4 | 4 | 1 |
|  | Replication | 4 | 4 | 2 |
| **Future-Proofing** (20pts) | Version Currency | 7 | 5 | 2 |
|  | Configuration | 3 | 3 | 1 |
|  | Upgrade Planning | 6 | 6 | 0 |
|  | Health Foundation | 4 | 5 | 1 |

## 1. Backup & Recovery (20 points)

### 1.1 Oplog & Continuity (5 points)

| ID | Metric | Criticality | Type | Source(s) | Pass Criteria |
|----|--------|-------------|------|-----------|---------------|
| BAK-1.1 | Oplog Window Sufficient | **CRITICAL** | threshold | SQL | >= 24 |
| BAK-1.2 | Oplog Size Configured | Important | boolean | SQL | = true |
| BAK-1.3 | Oplog Continuity | **CRITICAL** | boolean | SQL | = true |
| BAK-1.4 | PITR via Oplog Feasible | Important | boolean | Manual | = true |
| BAK-1.5 | Oplog Retention (Atlas) | Important | threshold | Manual | >= 24 |
| BAK-1.5b | Replica Set Members | Important | threshold | SQL | >= 3 |
| BAK-1.6 | Journaling Enabled | **CRITICAL** | boolean | SQL | = true |

**Scoring**: Weight pool = 17 (3x3 + 4x2 + 0x1), normalized to 5 points.
If BAK-1.1 or BAK-1.3 or BAK-1.6 fails, subcategory capped at 3.0 points (60%).

### 1.2 Scheduled Backups (4 points)

| ID | Metric | Criticality | Type | Source(s) | Pass Criteria |
|----|--------|-------------|------|-----------|---------------|
| BAK-2.1 | Backup Schedule Defined | **CRITICAL** | enum | Manual | `daily`, `hourly`, `continuous`, `atlas` |
| BAK-2.2 | Last Backup Age | Important | threshold | Manual, Worker | <= 24 |
| BAK-2.3 | Atlas Backup Active | **CRITICAL** | boolean | Manual | = true |
| BAK-2.4 | Backup Verification | Advisory | boolean | Manual | = true |

**Scoring**: Weight pool = 9 (2x3 + 1x2 + 1x1), normalized to 4 points.
If BAK-2.1 or BAK-2.3 fails, subcategory capped at 2.4 points (60%).

### 1.3 Backup Tools (4 points)

| ID | Metric | Criticality | Type | Source(s) | Pass Criteria |
|----|--------|-------------|------|-----------|---------------|
| BAK-3.1 | Percona Backup for MongoDB | Important | boolean | Manual | = true |
| BAK-3.2 | PITR Capability Enabled | Important | boolean | Manual | = true |
| BAK-3.3 | Backup Encryption | Advisory | boolean | Manual | = true |
| BAK-3.4 | mongodump with --oplog | Important | boolean | Manual | = true |

**Scoring**: Weight pool = 7 (0x3 + 3x2 + 1x1), normalized to 4 points.

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
| BAK-5.2 | Oplog Retention Adequate | Important | boolean | Manual | = true |
| BAK-5.3 | Offsite / Cloud Backup Copy | Advisory | boolean | Manual | = true |

**Scoring**: Weight pool = 5 (0x3 + 2x2 + 1x1), normalized to 3 points.

## 2. Security (20 points)

### 2.1 Authentication (5 points)

| ID | Metric | Criticality | Type | Source(s) | Pass Criteria |
|----|--------|-------------|------|-----------|---------------|
| SEC-1.1 | Authentication Enabled | **CRITICAL** | enum | SQL | `enabled` |
| SEC-1.2 | SCRAM-SHA-256 Mechanism | **CRITICAL** | boolean | SQL | = true |
| SEC-1.3 | Localhost Exception Disabled | **CRITICAL** | boolean | SQL | = true |
| SEC-1.4 | x.509 or LDAP Auth (Optional) | Advisory | boolean | Manual | = true |
| SEC-1.5 | Low Failed Logins (24h) | Important | threshold | SQL, Worker | <= 10 |
| SEC-1.5b | Strong Auth Mechanisms | Important | boolean | SQL | Non-empty, non-dummy value |

**Scoring**: Weight pool = 14 (3x3 + 2x2 + 1x1), normalized to 5 points.
If SEC-1.1 or SEC-1.2 or SEC-1.3 fails, subcategory capped at 3.0 points (60%).

### 2.2 Encryption (5 points)

| ID | Metric | Criticality | Type | Source(s) | Pass Criteria |
|----|--------|-------------|------|-----------|---------------|
| SEC-2.1 | TLS Enabled | **CRITICAL** | enum | SQL | `requireTLS`, `preferTLS` |
| SEC-2.2 | TLS 1.2+ Required | **CRITICAL** | enum | SQL | `TLS1_2`, `TLS1_3` |
| SEC-2.3 | WiredTiger Encryption at Rest | Important | boolean | SQL, Manual | = true |
| SEC-2.4 | KMIP Key Management | Advisory | boolean | Manual | = true |
| SEC-2.5 | TLS Certificate Valid | Important | threshold | Manual | >= 30 |

**Scoring**: Weight pool = 11 (2x3 + 2x2 + 1x1), normalized to 5 points.
If SEC-2.1 or SEC-2.2 fails, subcategory capped at 3.0 points (60%).

### 2.3 Audit & Logging (5 points)

| ID | Metric | Criticality | Type | Source(s) | Pass Criteria |
|----|--------|-------------|------|-----------|---------------|
| SEC-3.1 | Audit Log Enabled | Important | boolean | SQL | = true |
| SEC-3.2 | Audit Filter Configured | Important | boolean | SQL | = true |
| SEC-3.3 | Authorization Success Audited | Advisory | boolean | SQL | = true |
| SEC-3.4 | Log Verbosity Adequate | Important | threshold | SQL | >= 0 AND <= 2 |
| SEC-3.5 | Log Retention (90d) | Advisory | threshold | Manual | >= 90 |

**Scoring**: Weight pool = 8 (0x3 + 3x2 + 2x1), normalized to 5 points.

### 2.4 Access Control (5 points)

| ID | Metric | Criticality | Type | Source(s) | Pass Criteria |
|----|--------|-------------|------|-----------|---------------|
| SEC-4.1 | RBAC Configured | **CRITICAL** | boolean | SQL | = true |
| SEC-4.2 | Limited Root Users | Important | threshold | SQL | <= 3 |
| SEC-4.3 | Custom Roles Reviewed | Advisory | boolean | Manual | = true |
| SEC-4.4 | Network Binding Restricted | **CRITICAL** | boolean | SQL | = true |
| SEC-4.5 | IP Allowlist Configured (Atlas) | **CRITICAL** | boolean | Manual | = true |

**Scoring**: Weight pool = 12 (3x3 + 1x2 + 1x1), normalized to 5 points.
If SEC-4.1 or SEC-4.4 or SEC-4.5 fails, subcategory capped at 3.0 points (60%).

## 3. Capacity (20 points)

### 3.1 Storage (5 points)

| ID | Metric | Criticality | Type | Source(s) | Pass Criteria |
|----|--------|-------------|------|-----------|---------------|
| CAP-1.1 | WiredTiger Cache Usage | Important | threshold | SQL | <= 90 |
| CAP-1.2 | Storage Utilization | Important | threshold | SQL | <= 80 |
| CAP-1.3 | Compression Ratio | Advisory | threshold | SQL | >= 1.5 |
| CAP-1.4 | Index Size Ratio | Advisory | threshold | SQL | <= 50 |
| CAP-1.5 | WiredTiger Storage Engine | **CRITICAL** | enum | SQL | `wiredTiger` |
| CAP-1.5b | Total Data Size | Advisory | boolean | SQL | Non-empty, non-dummy value |
| CAP-1.6 | Collection Count | Advisory | boolean | SQL | Non-empty, non-dummy value |
| CAP-1.7 | Index Size Tracked | Advisory | boolean | SQL | Non-empty, non-dummy value |

**Scoring**: Weight pool = 12 (1x3 + 2x2 + 5x1), normalized to 5 points.
If CAP-1.5 fails, subcategory capped at 3.0 points (60%).

### 3.2 Connections (5 points)

| ID | Metric | Criticality | Type | Source(s) | Pass Criteria |
|----|--------|-------------|------|-----------|---------------|
| CAP-2.1 | Connection Utilization | Important | threshold | SQL | <= 80 |
| CAP-2.2 | maxIncomingConnections Configured | Important | boolean | SQL | = true |
| CAP-2.3 | Connection Pooling in Use | Important | boolean | Manual | = true |
| CAP-2.4 | Connections Available | Important | threshold | SQL | >= 100 |

**Scoring**: Weight pool = 8 (0x3 + 4x2 + 0x1), normalized to 5 points.

### 3.3 Maintenance (6 points)

| ID | Metric | Criticality | Type | Source(s) | Pass Criteria |
|----|--------|-------------|------|-----------|---------------|
| CAP-3.1 | WiredTiger Eviction Rate | Important | threshold | SQL | <= 5 |
| CAP-3.2 | No Fragmentation Alert | Advisory | threshold | SQL | <= 50 |
| CAP-3.3 | No Unused Indexes | Advisory | threshold | SQL | <= 0 |
| CAP-3.4 | TTL Indexes Active | Important | boolean | SQL | = true |
| CAP-3.5 | Dirty Cache Below Threshold | Important | threshold | SQL | <= 20 |

**Scoring**: Weight pool = 8 (0x3 + 3x2 + 2x1), normalized to 6 points.

### 3.4 Planning (4 points)

| ID | Metric | Criticality | Type | Source(s) | Pass Criteria |
|----|--------|-------------|------|-----------|---------------|
| CAP-4.1 | Oplog Window for Planning | Important | threshold | SQL | >= 48 |
| CAP-4.2 | Shard Balancer Active | Important | boolean | SQL | = true |
| CAP-4.3 | Chunk Distribution Balanced | Advisory | boolean | SQL | = true |
| CAP-4.4 | Storage Growth Monitored | Advisory | boolean | Manual | = true |

**Scoring**: Weight pool = 6 (0x3 + 2x2 + 2x1), normalized to 4 points.

## 4. Performance (20 points)

### 4.1 Caching (5 points)

| ID | Metric | Criticality | Type | Source(s) | Pass Criteria |
|----|--------|-------------|------|-----------|---------------|
| PERF-1.1 | Cache Hit Ratio | Important | threshold | SQL | >= 95 |
| PERF-1.2 | No Application Thread Eviction | Important | threshold | SQL | <= 0 |
| PERF-1.3 | Cache Size Configured | Advisory | boolean | SQL | = true |
| PERF-1.4 | Read Tickets Available | Important | threshold | SQL | >= 10 |
| PERF-1.5 | Write Tickets Available | Important | threshold | SQL | >= 10 |

**Scoring**: Weight pool = 9 (0x3 + 4x2 + 1x1), normalized to 5 points.

### 4.2 Query Performance (7 points)

| ID | Metric | Criticality | Type | Source(s) | Pass Criteria |
|----|--------|-------------|------|-----------|---------------|
| PERF-2.1 | Slow Queries Profiled | Important | boolean | SQL | = true |
| PERF-2.2 | Slow Query Count (1h) | Important | threshold | SQL | <= 50 |
| PERF-2.3 | No Collection Scans | Important | threshold | SQL | <= 0 |
| PERF-2.4 | Index Hit Ratio | Important | threshold | SQL | >= 95 |
| PERF-2.5 | Query Targeting Efficient | Important | threshold | SQL | <= 10 |
| PERF-2.6 | Profiler Level Appropriate | Advisory | enum | SQL | `0`, `1` |
| PERF-2.7 | Query Plan Cache Populated | Advisory | boolean | SQL | = true |
| PERF-2.6b | Insert Throughput | Advisory | boolean | SQL | Non-empty, non-dummy value |
| PERF-2.7b | Query Throughput | Advisory | boolean | SQL | Non-empty, non-dummy value |
| PERF-2.8 | Update Throughput | Advisory | boolean | SQL | Non-empty, non-dummy value |
| PERF-2.9 | Delete Throughput | Advisory | boolean | SQL | Non-empty, non-dummy value |
| PERF-2.10 | Write Throughput | Advisory | boolean | SQL | Non-empty, non-dummy value |
| PERF-2.11 | Read Throughput | Advisory | boolean | SQL | Non-empty, non-dummy value |
| PERF-2.12 | Profiling Level | Advisory | threshold | SQL | >= 1 |

**Scoring**: Weight pool = 19 (0x3 + 5x2 + 9x1), normalized to 7 points.

### 4.3 Locking (4 points)

| ID | Metric | Criticality | Type | Source(s) | Pass Criteria |
|----|--------|-------------|------|-----------|---------------|
| PERF-3.1 | Global Lock Queue Empty | **CRITICAL** | threshold | SQL | <= 5 |
| PERF-3.2 | No Long-Running Operations | Important | threshold | SQL | <= 0 |
| PERF-3.3 | No Ticket Wait Queue | Important | threshold | SQL | <= 0 |
| PERF-3.4 | Network Latency Acceptable | Advisory | threshold | Manual | <= 10 |

**Scoring**: Weight pool = 8 (1x3 + 2x2 + 1x1), normalized to 4 points.
If PERF-3.1 fails, subcategory capped at 2.4 points (60%).

### 4.4 Replication (4 points)

| ID | Metric | Criticality | Type | Source(s) | Pass Criteria |
|----|--------|-------------|------|-----------|---------------|
| PERF-4.1 | Replication Lag Acceptable | **CRITICAL** | threshold | SQL | <= 30 |
| PERF-4.2 | Oplog Window vs Lag | Important | boolean | SQL | = true |
| PERF-4.3 | Stable Primary (No Recent Elections) | Important | threshold | SQL | <= 0 |
| PERF-4.4 | All Replica Set Members Healthy | **CRITICAL** | boolean | SQL | = true |

**Scoring**: Weight pool = 10 (2x3 + 2x2 + 0x1), normalized to 4 points.
If PERF-4.1 or PERF-4.4 fails, subcategory capped at 2.4 points (60%).

## 5. Future-Proofing (20 points)

### 5.1 Version Currency (7 points)

| ID | Metric | Criticality | Type | Source(s) | Pass Criteria |
|----|--------|-------------|------|-----------|---------------|
| FP-1.1 | MongoDB Version Current | **CRITICAL** | boolean | SQL | Non-empty, non-dummy value |
| FP-1.2 | Latest Patch Applied | Important | boolean | SQL | = true |
| FP-1.3 | Feature Compatibility Version Current | Important | boolean | SQL | = true |
| FP-1.4 | Not End-of-Life | **CRITICAL** | enum | SQL | `supported` |
| FP-1.5 | Driver Compatibility | Important | boolean | Manual | = true |

> **Gate**: FP-1.4 (Not End-of-Life) — if this critical metric fails, the entire pillar is zeroed.

**Scoring**: Weight pool = 12 (2x3 + 3x2 + 0x1), normalized to 7 points.
If FP-1.1 or FP-1.4 fails, subcategory capped at 4.2 points (60%).

### 5.2 Configuration (3 points)

| ID | Metric | Criticality | Type | Source(s) | Pass Criteria |
|----|--------|-------------|------|-----------|---------------|
| FP-2.1 | Replica Set Configured | **CRITICAL** | boolean | SQL | = true |
| FP-2.2 | Odd Number of Voting Members | Important | boolean | SQL | = true |
| FP-2.3 | mongos Instances Healthy | Important | boolean | SQL | = true |

> **Gate**: FP-2.1 (Replica Set Configured) — if this critical metric fails, the entire pillar is zeroed.

**Scoring**: Weight pool = 7 (1x3 + 2x2 + 0x1), normalized to 3 points.
If FP-2.1 fails, subcategory capped at 1.8 points (60%).

### 5.3 Upgrade Planning (6 points)

| ID | Metric | Criticality | Type | Source(s) | Pass Criteria |
|----|--------|-------------|------|-----------|---------------|
| FP-3.1 | Upgrade Plan Documented | Advisory | boolean | Manual | = true |
| FP-3.2 | No Deprecated Operators | Important | boolean | Manual | = true |
| FP-3.3 | Schema Validation Configured | Advisory | boolean | SQL | = true |
| FP-3.4 | Change Streams for Event-Driven | Advisory | boolean | Manual | = true |
| FP-3.5 | Atlas Migration Readiness | Advisory | boolean | Manual | = true |
| FP-3.6 | DNS Seedlist Connection String | Advisory | boolean | Manual | = true |

**Scoring**: Weight pool = 7 (0x3 + 1x2 + 5x1), normalized to 6 points.

### 5.4 Health Foundation (4 points)

| ID | Metric | Criticality | Type | Source(s) | Pass Criteria |
|----|--------|-------------|------|-----------|---------------|
| FP-4.1 | Monitoring Connected | **CRITICAL** | boolean | Manual | = true |
| FP-4.2 | Alerting Configured | Important | boolean | Manual | = true |
| FP-4.3 | Profiler Level Safe for Production | Important | enum | SQL | `0`, `1` |
| FP-4.4 | Ops Manager / Cloud Manager Agent | Advisory | boolean | Manual | = true |
| FUT-4.4 | Schema Validation Used | Advisory | boolean | SQL | = true |

**Scoring**: Weight pool = 9 (1x3 + 2x2 + 2x1), normalized to 4 points.
If FP-4.1 fails, subcategory capped at 2.4 points (60%).

---

## Appendix A: Metrics by Source

### SQL / Healthcheck Scripts (75 metrics)

These metrics are collected via direct database queries.

| ID | Metric | Pillar | Criticality |
|----|--------|--------|-------------|
| BAK-1.1 | Oplog Window Sufficient | Backup & Recovery | **CRITICAL** |
| BAK-1.2 | Oplog Size Configured | Backup & Recovery | Important |
| BAK-1.3 | Oplog Continuity | Backup & Recovery | **CRITICAL** |
| SEC-1.1 | Authentication Enabled | Security | **CRITICAL** |
| SEC-1.2 | SCRAM-SHA-256 Mechanism | Security | **CRITICAL** |
| SEC-1.3 | Localhost Exception Disabled | Security | **CRITICAL** |
| SEC-1.5 | Low Failed Logins (24h) | Security | Important |
| SEC-2.1 | TLS Enabled | Security | **CRITICAL** |
| SEC-2.2 | TLS 1.2+ Required | Security | **CRITICAL** |
| SEC-2.3 | WiredTiger Encryption at Rest | Security | Important |
| SEC-3.1 | Audit Log Enabled | Security | Important |
| SEC-3.2 | Audit Filter Configured | Security | Important |
| SEC-3.3 | Authorization Success Audited | Security | Advisory |
| SEC-3.4 | Log Verbosity Adequate | Security | Important |
| SEC-4.1 | RBAC Configured | Security | **CRITICAL** |
| SEC-4.2 | Limited Root Users | Security | Important |
| SEC-4.4 | Network Binding Restricted | Security | **CRITICAL** |
| CAP-1.1 | WiredTiger Cache Usage | Capacity | Important |
| CAP-1.2 | Storage Utilization | Capacity | Important |
| CAP-1.3 | Compression Ratio | Capacity | Advisory |
| CAP-1.4 | Index Size Ratio | Capacity | Advisory |
| CAP-1.5 | WiredTiger Storage Engine | Capacity | **CRITICAL** |
| CAP-2.1 | Connection Utilization | Capacity | Important |
| CAP-2.2 | maxIncomingConnections Configured | Capacity | Important |
| CAP-2.4 | Connections Available | Capacity | Important |
| CAP-3.1 | WiredTiger Eviction Rate | Capacity | Important |
| CAP-3.2 | No Fragmentation Alert | Capacity | Advisory |
| CAP-3.3 | No Unused Indexes | Capacity | Advisory |
| CAP-3.4 | TTL Indexes Active | Capacity | Important |
| CAP-3.5 | Dirty Cache Below Threshold | Capacity | Important |
| CAP-4.1 | Oplog Window for Planning | Capacity | Important |
| CAP-4.2 | Shard Balancer Active | Capacity | Important |
| CAP-4.3 | Chunk Distribution Balanced | Capacity | Advisory |
| PERF-1.1 | Cache Hit Ratio | Performance | Important |
| PERF-1.2 | No Application Thread Eviction | Performance | Important |
| PERF-1.3 | Cache Size Configured | Performance | Advisory |
| PERF-1.4 | Read Tickets Available | Performance | Important |
| PERF-1.5 | Write Tickets Available | Performance | Important |
| PERF-2.1 | Slow Queries Profiled | Performance | Important |
| PERF-2.2 | Slow Query Count (1h) | Performance | Important |
| PERF-2.3 | No Collection Scans | Performance | Important |
| PERF-2.4 | Index Hit Ratio | Performance | Important |
| PERF-2.5 | Query Targeting Efficient | Performance | Important |
| PERF-2.6 | Profiler Level Appropriate | Performance | Advisory |
| PERF-2.7 | Query Plan Cache Populated | Performance | Advisory |
| PERF-3.1 | Global Lock Queue Empty | Performance | **CRITICAL** |
| PERF-3.2 | No Long-Running Operations | Performance | Important |
| PERF-3.3 | No Ticket Wait Queue | Performance | Important |
| PERF-4.1 | Replication Lag Acceptable | Performance | **CRITICAL** |
| PERF-4.2 | Oplog Window vs Lag | Performance | Important |
| PERF-4.3 | Stable Primary (No Recent Elections) | Performance | Important |
| PERF-4.4 | All Replica Set Members Healthy | Performance | **CRITICAL** |
| FP-1.1 | MongoDB Version Current | Future-Proofing | **CRITICAL** |
| FP-1.2 | Latest Patch Applied | Future-Proofing | Important |
| FP-1.3 | Feature Compatibility Version Current | Future-Proofing | Important |
| FP-1.4 | Not End-of-Life | Future-Proofing | **CRITICAL** |
| FP-2.1 | Replica Set Configured | Future-Proofing | **CRITICAL** |
| FP-2.2 | Odd Number of Voting Members | Future-Proofing | Important |
| FP-2.3 | mongos Instances Healthy | Future-Proofing | Important |
| FP-3.3 | Schema Validation Configured | Future-Proofing | Advisory |
| FP-4.3 | Profiler Level Safe for Production | Future-Proofing | Important |
| BAK-1.5b | Replica Set Members | Backup & Recovery | Important |
| SEC-1.5b | Strong Auth Mechanisms | Security | Important |
| CAP-1.5b | Total Data Size | Capacity | Advisory |
| CAP-1.6 | Collection Count | Capacity | Advisory |
| CAP-1.7 | Index Size Tracked | Capacity | Advisory |
| PERF-2.6b | Insert Throughput | Performance | Advisory |
| PERF-2.7b | Query Throughput | Performance | Advisory |
| PERF-2.8 | Update Throughput | Performance | Advisory |
| PERF-2.9 | Delete Throughput | Performance | Advisory |
| BAK-1.6 | Journaling Enabled | Backup & Recovery | **CRITICAL** |
| PERF-2.10 | Write Throughput | Performance | Advisory |
| PERF-2.11 | Read Throughput | Performance | Advisory |
| PERF-2.12 | Profiling Level | Performance | Advisory |
| FUT-4.4 | Schema Validation Used | Future-Proofing | Advisory |

### Monitoring (2 metrics)

These metrics are collected from monitoring systems (Zabbix, PMM, worker scripts).

| ID | Metric | Pillar | Criticality |
|----|--------|--------|-------------|
| BAK-2.2 | Last Backup Age | Backup & Recovery | Important |
| SEC-1.5 | Low Failed Logins (24h) | Security | Important |

### Manual Inputs (36 metrics)

These metrics require manual input from the operator.

| ID | Metric | Pillar | Criticality | Remediation |
|----|--------|--------|-------------|-------------|
| BAK-1.4 | PITR via Oplog Feasible | Backup & Recovery | Important | Ensure oplog window exceeds RPO target; document oplog-based PITR procedure |
| BAK-1.5 | Oplog Retention (Atlas) | Backup & Recovery | Important | Configure oplog retention hours in Atlas continuous backup settings |
| BAK-2.1 | Backup Schedule Defined | Backup & Recovery | **CRITICAL** | Implement and document a backup schedule (daily minimum); prefer PBM or Atlas for production |
| BAK-2.2 | Last Backup Age | Backup & Recovery | Important | Verify backup jobs are completing successfully; check PBM status or Atlas backup history |
| BAK-2.3 | Atlas Backup Active | Backup & Recovery | **CRITICAL** | Enable Cloud Backup in Atlas cluster settings; configure snapshot frequency and retention |
| BAK-2.4 | Backup Verification | Backup & Recovery | Advisory | Schedule periodic restore tests to validate backup integrity |
| BAK-3.1 | Percona Backup for MongoDB | Backup & Recovery | Important | Deploy Percona Backup for MongoDB for consistent physical backups with PITR support |
| BAK-3.2 | PITR Capability Enabled | Backup & Recovery | Important | Enable PITR in PBM (pitr.enabled: true in pbm config) or Atlas continuous backup |
| BAK-3.3 | Backup Encryption | Backup & Recovery | Advisory | Use PBM with encrypted storage or Atlas Cloud Backup (encrypted by default) |
| BAK-3.4 | mongodump with --oplog | Backup & Recovery | Important | Always use mongodump --oplog when backing up a replica set for consistency |
| BAK-4.1 | RPO Target Defined | Backup & Recovery | **CRITICAL** | Define and document RPO target based on business requirements |
| BAK-4.2 | RTO Target Defined | Backup & Recovery | **CRITICAL** | Define and document RTO target based on business requirements |
| BAK-4.3 | Restore Tested (90d) | Backup & Recovery | Important | Schedule regular restore tests (at least quarterly) |
| BAK-4.4 | DR Plan Documented | Backup & Recovery | Advisory | Document disaster recovery procedures including replica failover and data restore runbooks |
| BAK-5.1 | Retention Policy Met | Backup & Recovery | Important | Configure backup retention to meet compliance requirements (PBM retention policy or Atlas snapshot r |
| BAK-5.2 | Oplog Retention Adequate | Backup & Recovery | Important | Ensure oplog retention period exceeds the time between backups to allow PITR |
| BAK-5.3 | Offsite / Cloud Backup Copy | Backup & Recovery | Advisory | Configure PBM to store backups in S3/GCS/Azure Blob or use Atlas Cloud Backup with multi-region |
| SEC-1.4 | x.509 or LDAP Auth (Optional) | Security | Advisory | Configure x.509 certificate authentication or LDAP for service accounts |
| SEC-2.3 | WiredTiger Encryption at Rest | Security | Important | Enable WiredTiger encryption (Enterprise) with KMIP or use disk-level encryption (LUKS/AWS EBS) |
| SEC-2.4 | KMIP Key Management | Security | Advisory | Configure KMIP server in mongod.conf under security.kmip for external key management |
| SEC-2.5 | TLS Certificate Valid | Security | Important | Renew TLS certificate before expiration; configure certificate auto-rotation |
| SEC-3.5 | Log Retention (90d) | Security | Advisory | Configure log rotation and retention policy (logrotate or Atlas log export) to retain logs for compl |
| SEC-4.3 | Custom Roles Reviewed | Security | Advisory | Review custom roles with db.getRoles({showPrivileges: true}); remove unnecessary privileges |
| SEC-4.5 | IP Allowlist Configured (Atlas) | Security | **CRITICAL** | Configure Atlas IP access list to specific CIDR ranges; avoid 0.0.0.0/0 |
| CAP-2.3 | Connection Pooling in Use | Capacity | Important | Configure maxPoolSize/minPoolSize in the MongoDB driver connection string |
| CAP-4.4 | Storage Growth Monitored | Capacity | Advisory | Implement storage monitoring with Ops Manager, Atlas, or Prometheus mongodb_exporter |
| PERF-3.4 | Network Latency Acceptable | Performance | Advisory | Co-locate application and MongoDB in same region/AZ; use read preferences appropriately |
| FP-1.5 | Driver Compatibility | Future-Proofing | Important | Check driver compatibility matrix at https://www.mongodb.com/docs/drivers/; upgrade drivers before s |
| FP-3.1 | Upgrade Plan Documented | Future-Proofing | Advisory | Document upgrade path following MongoDB upgrade guide; plan FCV bump separately from binary upgrade |
| FP-3.2 | No Deprecated Operators | Future-Proofing | Important | Review MongoDB release notes for deprecated operators; update queries to use current equivalents |
| FP-3.4 | Change Streams for Event-Driven | Future-Proofing | Advisory | Migrate from direct oplog tailing to Change Streams API for better abstraction and resilience |
| FP-3.5 | Atlas Migration Readiness | Future-Proofing | Advisory | Run MongoDB Atlas Assessment Tool (MAAT) to evaluate migration feasibility and effort |
| FP-3.6 | DNS Seedlist Connection String | Future-Proofing | Advisory | Update connection strings to use mongodb+srv:// format to avoid hardcoded host lists |
| FP-4.1 | Monitoring Connected | Future-Proofing | **CRITICAL** | Deploy Prometheus mongodb_exporter, Ops Manager agent, or enable Atlas monitoring integration |
| FP-4.2 | Alerting Configured | Future-Proofing | Important | Configure alerts in Atlas, Ops Manager, or Prometheus Alertmanager for key MongoDB metrics |
| FP-4.4 | Ops Manager / Cloud Manager Agent | Future-Proofing | Advisory | Deploy Ops Manager or Cloud Manager agent for automated backup, monitoring, and deployment managemen |

## Appendix B: Gate Metrics

| ID | Metric | Criticality | Gate Scope | Effect |
|----|--------|-------------|------------|--------|
| FP-1.4 | Not End-of-Life | **CRITICAL** | pillar | Zeros entire pillar score |
| FP-2.1 | Replica Set Configured | **CRITICAL** | pillar | Zeros entire pillar score |

## Appendix C: Conditional Metrics

### Deployment-Profile-Specific

| ID | Metric | Profiles |
|----|--------|----------|
| BAK-1.5 | Oplog Retention (Atlas) | atlas |
| BAK-2.3 | Atlas Backup Active | atlas |
| BAK-3.1 | Percona Backup for MongoDB | self-managed |
| BAK-3.4 | mongodump with --oplog | self-managed |
| SEC-4.5 | IP Allowlist Configured (Atlas) | atlas |
| CAP-4.2 | Shard Balancer Active | sharded |
| CAP-4.3 | Chunk Distribution Balanced | sharded |
| PERF-2.5 | Query Targeting Efficient | sharded |
| FP-2.3 | mongos Instances Healthy | sharded |
| FP-3.5 | Atlas Migration Readiness | self-managed |
| FP-4.4 | Ops Manager / Cloud Manager Agent | self-managed |
