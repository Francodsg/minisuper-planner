import { describe, it, expect } from 'vitest';
import { validateBackup, buildBackup } from './backup';

describe('respaldo', () => {
  it('genera y valida un respaldo', () => {
    const b = buildBackup({ settings: null, departments: [], categories: [], products: [], lists: [], items: [], purchases: [] });
    expect(validateBackup(JSON.parse(JSON.stringify(b))).ok).toBe(true);
  });
  it('rechaza archivos ajenos', () => {
    expect(validateBackup({ foo: 1 }).ok).toBe(false);
    expect(validateBackup({ app: 'minisuper-planner', version: 1 }).error).toMatch(/departments/);
  });
});
