import { describe, it, expect } from 'vitest';
import { matchesQuery, normalize, dedupeKey, similarity } from './search';
import { parseMoneyInput, formatMXN } from './money';

describe('búsqueda', () => {
  it('ignora mayúsculas y acentos', () => {
    expect(normalize('  Jabón   ÁCIDO ')).toBe('jabon acido');
    expect(matchesQuery('jabon', ['Jabón de tocador'])).toBe(true);
    expect(matchesQuery('DETERG lim', ['Detergente', 'Limpieza del hogar'])).toBe(true);
    expect(matchesQuery('cloro', ['Detergente'])).toBe(false);
  });
  it('clave de duplicados distingue presentaciones', () => {
    expect(dedupeKey('Aceite', 'Nutrioli', '1 L')).not.toBe(dedupeKey('Aceite', 'Nutrioli', '500 ml'));
    expect(dedupeKey('Aceíte ', 'nutrioli', '1 l')).toBe(dedupeKey('aceite', 'Nutrioli', '1 L'));
  });
  it('similitud', () => {
    expect(similarity('Detergente en polvo', 'Detergente polvo')).toBeGreaterThan(0.7);
    expect(similarity('Cloro', 'Galletas')).toBeLessThan(0.3);
  });
});

describe('dinero', () => {
  it('parsea captura', () => {
    expect(parseMoneyInput('$1,234.50')).toBe('1234.5');
    expect(parseMoneyInput('')).toBeNull();
    expect(parseMoneyInput('-3')).toBeNull();
    expect(parseMoneyInput('abc')).toBeNull();
  });
  it('formatea MXN', () => {
    expect(formatMXN('1234.5').replace(/ /g, ' ')).toMatch(/\$1,234\.50/);
    expect(formatMXN(null)).toBe('—');
  });
});
