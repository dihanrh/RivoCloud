export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface UserProfile {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  emailVerified: boolean;
}

export interface Organization {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
  updatedAt: string;
}

export interface Zone {
  id: string;
  orgId: string;
  projectId: string | null;
  name: string;
  slug: string;
  originUrl: string;
  originProtocol: string;
  cacheTtl: number;
  browserTtl: number;
  enabled: boolean;
  // The edge rejects requests without a valid expires/sig pair. The secret
  // itself is never sent to the browser; hasSigningSecret only says one exists.
  signedUrlsRequired: boolean;
  hasSigningSecret: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ZoneDomain {
  id: string;
  zoneId: string;
  domain: string;
  sslStatus: 'pending_dns' | 'pending_ssl' | 'active' | 'error';
  sslError: string | null;
  certExpiresAt: string | null;
  isPrimary: boolean;
  verifiedAt: string | null;
  createdAt: string;
  cnameTarget: string;
}

export interface Bucket {
  id: string;
  orgId: string;
  projectId: string | null;
  name: string;
  region: string;
  versioningEnabled: boolean;
  public: boolean;
  lifecycleRules: unknown;
  createdAt: string;
}

export interface StorageObject {
  id: string;
  bucketId: string;
  key: string;
  versionId: string;
  isLatest: boolean;
  size: string | null;
  contentType: string;
  etag: string | null;
  storagePath: string;
  metadata: unknown;
  status: 'pending' | 'ready' | 'deleted';
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SignedUrl {
  url: string;
  expiresAt: string;
}

export interface AnalyticsOverview {
  bytesSent: number;
  requests: number;
  hitRatio: number;
}

// Time-series `bucket` values are UTC epoch milliseconds (unambiguous for
// `new Date(bucket)`), not naive "YYYY-MM-DD HH:MM:SS" strings.
export interface AnalyticsBandwidth {
  series: { bucket: number; bytesSent: number; requests: number }[];
}

export interface AnalyticsRequests {
  series: { bucket: number; requests: number }[];
}

export interface AnalyticsCache {
  hitRatio: number;
  breakdown: { cacheStatus: string; requests: number }[];
}

export interface AnalyticsGeography {
  countries: { country: string; requests: number; bytesSent: number }[];
}

export interface AnalyticsLatency {
  series: { bucket: number; p50: number; p95: number; p99: number }[];
}

export interface AnalyticsStatusCodes {
  breakdown: { statusCode: number; requests: number }[];
}

export interface AnalyticsTopPaths {
  paths: { path: string; requests: number; bytesSent: number }[];
}

export interface AnalyticsQueryParams {
  zoneId?: string;
  from?: string;
  to?: string;
  granularity?: 'hour' | 'day' | 'week';
}

export type OrgRole = 'owner' | 'admin' | 'developer' | 'viewer';

export type ApiKeyScope =
  | 'zone:read'
  | 'zone:write'
  | 'zone:delete'
  | 'cache:invalidate'
  | 'storage:read'
  | 'storage:write'
  | 'storage:delete'
  | 'analytics:read'
  | 'billing:read';

export interface OrgMember {
  userId: string;
  role: OrgRole;
  joinedAt: string | null;
  user: { id: string; email: string; name: string };
}

export interface ApiKey {
  id: string;
  name: string;
  keyPrefix: string;
  permissions: string[];
  lastUsedAt: string | null;
  expiresAt: string | null;
}

export interface CreatedApiKey {
  id: string;
  name: string;
  keyPrefix: string;
  permissions: string[];
  rawKey: string;
}

export interface AuditLogEntry {
  id: string;
  action: string;
  resourceType: string | null;
  resourceId: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  metadata: unknown;
  createdAt: string;
  user: { id: string; email: string; name: string } | null;
  apiKey: { id: string; name: string; keyPrefix: string } | null;
}

export interface AuditLogPage {
  items: AuditLogEntry[];
  nextCursor: string | null;
}
