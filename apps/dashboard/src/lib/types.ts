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
  createdAt: string;
  updatedAt: string;
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
