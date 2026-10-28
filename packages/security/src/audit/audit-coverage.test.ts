import { Controller, Delete, Get, Patch, Post, Put } from '@nestjs/common';
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

@Audit('x.created', { resourceType: 'x' })
@Controller()
class ClassLevelAudit {
  @Post()
  create() {}
}

@Controller()
class MethodNoAudit {
  @NoAudit()
  @Post()
  create() {}
}

@Controller()
class AllMethods {
  @Put()
  put() {}

  @Patch()
  patch() {}

  @Delete()
  remove() {}
}

describe('findUnauditedMutations', () => {
  it('does not accept a class-level @Audit', () => {
    expect(findUnauditedMutations([ClassLevelAudit])).toEqual(['ClassLevelAudit.create']);
  });

  it('accepts a method-level @NoAudit', () => {
    expect(findUnauditedMutations([MethodNoAudit])).toEqual([]);
  });

  it('detects PUT, PATCH and DELETE handlers', () => {
    expect(findUnauditedMutations([AllMethods])).toEqual(['AllMethods.put', 'AllMethods.patch', 'AllMethods.remove']);
  });

  it('flags an undecorated mutation and ignores GET', () => {
    expect(findUnauditedMutations([Fixture])).toEqual(['Fixture.create']);
  });

  it('accepts @NoAudit on the class and @Audit on the handler', () => {
    expect(findUnauditedMutations([ClassLevel, Covered])).toEqual([]);
  });
});
