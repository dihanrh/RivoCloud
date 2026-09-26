import { describe, expect, it, vi } from 'vitest';
import { Logger } from '@nestjs/common';
import type { ClickHouseClient } from '@clickhouse/client';
import { SchemaService } from './schema.service.js';
import { SCHEMA_STATEMENTS } from './schema.js';

describe('SchemaService', () => {
  it('applies every schema statement in order', async () => {
    const logSpy = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    const command = vi.fn().mockResolvedValue(undefined);
    await new SchemaService({ command } as unknown as ClickHouseClient).onModuleInit();
    expect(command.mock.calls.map(([arg]) => arg.query)).toEqual(SCHEMA_STATEMENTS);
    logSpy.mockRestore();
  });

  it('logs which statement failed and why, then still fails the boot', async () => {
    const errorSpy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const command = vi.fn().mockRejectedValue(new Error('connect ECONNREFUSED 127.0.0.1:8123'));

    await expect(new SchemaService({ command } as unknown as ClickHouseClient).onModuleInit()).rejects.toThrow(
      'ECONNREFUSED',
    );
    expect(command).toHaveBeenCalledOnce();
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringMatching(/CREATE TABLE IF NOT EXISTS request_logs.*ECONNREFUSED/),
      expect.any(String),
    );
    errorSpy.mockRestore();
  });
});
