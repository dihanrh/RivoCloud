import { SetMetadata } from '@nestjs/common';

export const AUDIT_KEY = 'audit';
export const NO_AUDIT_KEY = 'noAudit';

export interface AuditOptions {
  resourceType: string;
  /** Route param holding the resource id. */
  idParam?: string;
  /** Dot path into the handler return value holding the resource id. */
  idPath?: string;
  /** Dot path into the handler return value holding the org id. */
  orgIdPath?: string;
  /** Record the entry with no org, even if the request carries one. */
  detachOrg?: boolean;
  /** Request body keys copied into metadata. Bodies are never copied wholesale. */
  bodyFields?: string[];
}

export interface AuditEntry {
  orgId: string | null;
  userId: string | null;
  apiKeyId: string | null;
  action: string;
  resourceType: string;
  resourceId: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  requestId: string | null;
  metadata: Record<string, unknown>;
}

export interface AuditMetadata {
  action: string;
  options: AuditOptions;
}

export const Audit = (action: string, options: AuditOptions) =>
  SetMetadata(AUDIT_KEY, { action, options } satisfies AuditMetadata);

export const NoAudit = () => SetMetadata(NO_AUDIT_KEY, true);
