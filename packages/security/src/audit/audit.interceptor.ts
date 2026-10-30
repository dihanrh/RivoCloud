import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { mergeMap, type Observable } from 'rxjs';
import type { SecurityAuthContext } from '../rbac/auth-context.js';
import { AuditWriter } from './audit-writer.js';
import { AUDIT_KEY, type AuditEntry, type AuditMetadata, type AuditOptions } from './audit.decorator.js';

interface AuditedRequest {
  auth?: SecurityAuthContext;
  params?: Record<string, unknown>;
  body?: Record<string, unknown>;
  ip?: string;
  headers?: Record<string, string | string[] | undefined>;
}

function readPath(value: unknown, path: string | undefined): string | null {
  if (!path) return null;
  let current: unknown = value;
  for (const part of path.split('.')) {
    if (current === null || typeof current !== 'object') return null;
    current = (current as Record<string, unknown>)[part];
  }
  return typeof current === 'string' ? current : null;
}

const str = (value: unknown): string | null => (typeof value === 'string' ? value : null);

// Only successful mutations are audited: the write happens after the handler
// resolves, and a failed write never fails the request.
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditInterceptor.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly writer: AuditWriter,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const meta = this.reflector.get<AuditMetadata | undefined>(AUDIT_KEY, context.getHandler());
    if (!meta) return next.handle();

    const request: AuditedRequest = context.switchToHttp().getRequest();
    return next.handle().pipe(
      mergeMap(async (body: unknown) => {
        try {
          await this.writer.write(this.buildEntry(meta, request, body));
        } catch (err) {
          this.logger.error(`Failed to write audit entry "${meta.action}": ${(err as Error).message}`);
        }
        return body;
      }),
    );
  }

  private buildEntry(meta: AuditMetadata, request: AuditedRequest, response: unknown): AuditEntry {
    const { options } = meta;
    const auth = request.auth;
    const params = request.params ?? {};
    const headers = request.headers ?? {};

    const orgId = options.detachOrg
      ? null
      : (str(params.orgId) ?? readPath(response, options.orgIdPath) ?? auth?.orgId ?? null);
    const resourceId =
      readPath(response, options.idPath) ?? (options.idParam ? str(params[options.idParam]) : null);

    return {
      orgId,
      userId: auth?.userId ?? null,
      apiKeyId: auth?.apiKeyId ?? null,
      action: meta.action,
      resourceType: options.resourceType,
      resourceId,
      ipAddress: request.ip ?? null,
      userAgent: str(headers['user-agent']),
      requestId: str(headers['x-request-id']),
      metadata: this.buildMetadata(options, params, request.body),
    };
  }

  private buildMetadata(
    options: AuditOptions,
    params: Record<string, unknown>,
    body: Record<string, unknown> | undefined,
  ): Record<string, unknown> {
    const metadata: Record<string, unknown> = { params };
    if (options.bodyFields) {
      const source = body ?? {};
      metadata.body = Object.fromEntries(
        options.bodyFields.filter((field) => field in source).map((field) => [field, source[field]]),
      );
    }
    return metadata;
  }
}
