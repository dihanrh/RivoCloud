import { Controller, Get, Post } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { Audit, NoAudit } from './audit.decorator.js';
import { findUnauditedMutations } from './audit-coverage.js';

@Controller()
class Fixture {
  @Post()
  create() {}

  @Get()
  list() {}
}

@NoAudit()
@Controller()
class ClassLevel {
  @Post()
  create() {}
}

@Controller()
class Covered {
  @Audit('x.created', { resourceType: 'x' })
  @Post()
  create() {}
}

describe('findUnauditedMutations', () => {
  it('flags an undecorated mutation and ignores GET', () => {
    expect(findUnauditedMutations([Fixture])).toEqual(['Fixture.create']);
  });

  it('accepts @NoAudit on the class and @Audit on the handler', () => {
    expect(findUnauditedMutations([ClassLevel, Covered])).toEqual([]);
  });
});
