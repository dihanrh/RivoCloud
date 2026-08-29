import { describe, expect, it } from 'vitest';
import { loginSchema, registerSchema } from './validation';

describe('loginSchema', () => {
  it('accepts a valid email/password pair', () => {
    expect(loginSchema.safeParse({ email: 'a@b.com', password: 'password123' }).success).toBe(true);
  });

  it('rejects an invalid email', () => {
    expect(loginSchema.safeParse({ email: 'not-an-email', password: 'password123' }).success).toBe(false);
  });
});

describe('registerSchema', () => {
  it('accepts a valid registration payload', () => {
    expect(
      registerSchema.safeParse({ name: 'Ada', email: 'ada@example.com', password: 'password123' }).success,
    ).toBe(true);
  });

  it('rejects a password shorter than 8 characters', () => {
    expect(
      registerSchema.safeParse({ name: 'Ada', email: 'ada@example.com', password: 'short' }).success,
    ).toBe(false);
  });

  it('rejects an empty name', () => {
    expect(
      registerSchema.safeParse({ name: '', email: 'ada@example.com', password: 'password123' }).success,
    ).toBe(false);
  });
});
