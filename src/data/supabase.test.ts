import { describe, it, expect } from 'vitest';
import { normalizeSupabaseUrl } from './supabase';

describe('URL de Supabase', () => {
  it('tolera errores comunes al pegar el secreto', () => {
    expect(normalizeSupabaseUrl('xxxx.supabase.co')).toBe('https://xxxx.supabase.co');
    expect(normalizeSupabaseUrl('  https://xxxx.supabase.co/  ')).toBe('https://xxxx.supabase.co');
    expect(normalizeSupabaseUrl('https://xxxx.supabase.co/rest/v1/')).toBe('https://xxxx.supabase.co');
    expect(normalizeSupabaseUrl('"https://xxxx.supabase.co"')).toBe('https://xxxx.supabase.co');
  });
  it('rechaza valores inválidos', () => {
    expect(normalizeSupabaseUrl('')).toBeNull();
    expect(normalizeSupabaseUrl('mi clave')).toBeNull();
    expect(normalizeSupabaseUrl(undefined)).toBeNull();
  });
});
