// EDD Section 6.6 — exact table definitions. Duplicated (not imported) into
// apps/scheduler/src/clickhouse/schema.ts per this plan's Design Decision 4.
export const REQUEST_LOGS_TABLE = `
CREATE TABLE IF NOT EXISTS request_logs (
  timestamp       DateTime64(3, 'UTC'),
  zone_id         String,
  org_id          String,
  datacenter      String,
  method          LowCardinality(String),
  path            String,
  status_code     UInt16,
  cache_status    LowCardinality(String),
  bytes_sent      UInt64,
  duration_ms     UInt32,
  country         FixedString(2),
  client_ip_hash  String
)
ENGINE = MergeTree()
PARTITION BY toYYYYMM(timestamp)
ORDER BY (zone_id, timestamp)
TTL toDateTime(timestamp) + INTERVAL 90 DAY
`;

export const BANDWIDTH_HOURLY_TABLE = `
CREATE TABLE IF NOT EXISTS bandwidth_hourly (
  hour            DateTime,
  zone_id         String,
  org_id          String,
  bytes_sent      UInt64,
  requests        UInt64,
  cache_hits      UInt64,
  cache_misses    UInt64
)
ENGINE = SummingMergeTree()
ORDER BY (zone_id, hour)
`;

export const REQUESTS_BY_COUNTRY_DAILY_TABLE = `
CREATE TABLE IF NOT EXISTS requests_by_country_daily (
  date            Date,
  zone_id         String,
  country         FixedString(2),
  requests        UInt64,
  bytes_sent      UInt64
)
ENGINE = SummingMergeTree()
ORDER BY (zone_id, date, country)
`;

export const SCHEMA_STATEMENTS = [REQUEST_LOGS_TABLE, BANDWIDTH_HOURLY_TABLE, REQUESTS_BY_COUNTRY_DAILY_TABLE];
