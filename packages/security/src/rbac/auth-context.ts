// The request.auth shape the shared guards and interceptors read. Each
// service's auth guard populates it (JWT or API key).
export interface SecurityAuthContext {
  type: 'jwt' | 'api_key';
  userId: string | null;
  orgId: string | null;
  role: string | null;
  apiKeyId?: string;
  permissions?: string[];
}
