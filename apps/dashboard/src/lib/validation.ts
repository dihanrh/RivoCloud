import { z } from 'zod';

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1, 'Password is required'),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const registerSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  email: z.string().email(),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const createOrgSchema = z.object({
  name: z.string().min(1, 'Organization name is required'),
});
export type CreateOrgInput = z.infer<typeof createOrgSchema>;

export const createZoneSchema = z.object({
  name: z.string().min(1).max(54),
  originUrl: z.string().url({ message: 'Enter a valid http(s) URL' }),
  cacheTtl: z.coerce.number().int().min(0).optional(),
  browserTtl: z.coerce.number().int().min(0).optional(),
});
export type CreateZoneInput = z.infer<typeof createZoneSchema>;

export const updateZoneSchema = createZoneSchema.partial().extend({
  enabled: z.boolean().optional(),
});
export type UpdateZoneInput = z.infer<typeof updateZoneSchema>;

const HOSTNAME_PATTERN = /^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/i;

export const createDomainSchema = z.object({
  domain: z.string().min(1).max(253).regex(HOSTNAME_PATTERN, 'Enter a valid hostname, e.g. cdn.your-company.com'),
});
export type CreateDomainInput = z.infer<typeof createDomainSchema>;

export const createBucketSchema = z.object({
  name: z.string().min(1).max(63),
  public: z.boolean().optional(),
});
export type CreateBucketInput = z.infer<typeof createBucketSchema>;
