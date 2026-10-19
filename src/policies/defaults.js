'use strict';

/**
 * Default policy values for dev and production environments.
 *
 * These define the threshold expectations per environment type.
 * They are used as fallback values when no explicit policy is configured.
 */

const DEFAULT_METRICS = {
  backup: [
    { name: 'rpo_minutes', dev: '1440', prod: '5' },
    { name: 'rto_minutes', dev: '480', prod: '60' },
    { name: 'backup_retention_days', dev: '7', prod: '30' },
    { name: 'backup_encryption', dev: 'false', prod: 'true' },
  ],
  security: [
    { name: 'ssl_required', dev: 'false', prod: 'true' },
    { name: 'max_superusers', dev: '3', prod: '1' },
    { name: 'external_audit_required', dev: 'false', prod: 'true' },
    { name: 'encryption_at_rest', dev: 'false', prod: 'true' },
  ],
  capacity: [
    { name: 'max_connection_pct', dev: '80', prod: '60' },
    { name: 'max_db_size_gb', dev: '500', prod: '1000' },
    { name: 'max_idle_connection_pct', dev: '80', prod: '50' },
    { name: 'connection_pooler_required', dev: 'false', prod: 'true' },
  ],
  performance: [
    { name: 'min_cache_hit_ratio', dev: '90', prod: '99' },
    { name: 'max_long_query_seconds', dev: '300', prod: '30' },
    { name: 'ha_required', dev: 'false', prod: 'true' },
  ],
  futureproof: [
    { name: 'max_versions_behind', dev: '3', prod: '1' },
    { name: 'monitoring_required', dev: 'false', prod: 'true' },
    { name: 'documentation_required', dev: 'false', prod: 'true' },
  ],
};

/**
 * Azure-specific policy metrics.
 * Platform settings that are not queryable from SQL — require manual or API input.
 */
const AZURE_POLICY_METRICS = {
  backup: [
    { name: 'azure_backup_retention_days', azureDev: '7', azureProd: '35' },
    { name: 'azure_geo_redundant_backup', azureDev: 'false', azureProd: 'true' },
  ],
  security: [
    { name: 'azure_private_endpoint', azureDev: 'false', azureProd: 'true' },
    { name: 'azure_aad_auth_enabled', azureDev: 'false', azureProd: 'true' },
  ],
  capacity: [
    { name: 'azure_storage_tier', azureDev: 'premium-ssd', azureProd: 'premium-ssd-v2' },
    { name: 'azure_provisioned_iops', azureDev: '', azureProd: '' },
    { name: 'azure_compute_tier', azureDev: '', azureProd: '' },
  ],
  performance: [
    { name: 'azure_ha_mode', azureDev: 'none', azureProd: 'zone-redundant' },
    { name: 'azure_read_replica_count', azureDev: '0', azureProd: '1' },
  ],
  futureproof: [
    { name: 'azure_maintenance_window', azureDev: 'false', azureProd: 'true' },
  ],
};

module.exports = { DEFAULT_METRICS, AZURE_POLICY_METRICS };
