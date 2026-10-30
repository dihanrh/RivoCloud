import { z } from 'zod';

/* ------------------------------------------------------------------ */
/* Auth. Mirrors apps/identity-service/src/auth/dto/*.ts so the form   */
/* catches what the API would reject.                                  */
/* ------------------------------------------------------------------ */

/** RegisterDto / ResetPasswordDto: @MinLength(8). */
export const PASSWORD_MIN_LENGTH = 8;

const emailField = z.string().trim().min(1, 'Enter your email address').email('Enter a valid email address');
const newPasswordField = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Use at least ${PASSWORD_MIN_LENGTH} characters`);

export const loginSchema = z.object({
  email: emailField,
  password: z.string().min(1, 'Enter your password'),
});
export type LoginInput = z.infer<typeof loginSchema>;

/** The body POSTed to /api/auth/register. */
export const registerSchema = z.object({
  name: z.string().trim().min(1, 'Enter your name'),
  email: emailField,
  password: newPasswordField,
});
export type RegisterInput = z.infer<typeof registerSchema>;

/** The sign-up form: the API body plus confirmation and the terms checkbox. */
export const registerFormSchema = registerSchema
  .extend({
    confirmPassword: z.string().min(1, 'Confirm your password'),
    acceptTerms: z.boolean().refine((value) => value, 'Accept the Terms and Privacy Policy to continue'),
  })
  .refine((data) => data.confirmPassword === '' || data.password === data.confirmPassword, {
    path: ['confirmPassword'],
    message: 'Passwords do not match',
  });
export type RegisterFormInput = z.infer<typeof registerFormSchema>;

export const forgotPasswordSchema = z.object({ email: emailField });
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

export const resetPasswordFormSchema = z
  .object({
    newPassword: newPasswordField,
    confirmPassword: z.string().min(1, 'Confirm your new password'),
  })
  .refine((data) => data.confirmPassword === '' || data.newPassword === data.confirmPassword, {
    path: ['confirmPassword'],
    message: 'Passwords do not match',
  });
export type ResetPasswordFormInput = z.infer<typeof resetPasswordFormSchema>;

/** Flatten zod issues to the first message per top-level field. */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const result: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? '_form');
    if (!(key in result)) result[key] = issue.message;
  }
  return result;
}

export const createOrgSchema = z.object({
  name: z.string().min(1, 'Account name is required'),
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
  signedUrlsRequired: z.boolean().optional(),
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
