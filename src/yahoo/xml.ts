import { XMLParser, XMLValidator } from 'fast-xml-parser';
import type { Raw } from '../models.js';

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', parseTagValue: false, trimValues: true, processEntities: true });
export function xml(source: string): Raw {
  if (/<!DOCTYPE|<!ENTITY/i.test(source) || XMLValidator.validate(source) !== true) throw new Error('Yahoo returned invalid or unsafe XML');
  const result = obj(parser.parse(source));
  if (!result.fantasy_content) throw new Error('Yahoo response missing fantasy_content');
  return obj(result.fantasy_content);
}
export const obj = (value: unknown): Raw => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Raw : {};
export const list = (value: unknown): unknown[] => value === undefined || value === null || value === '' ? [] : Array.isArray(value) ? value : [value];
export function text(value: unknown): string | null {
  if (typeof value === 'string' && value.length) return value;
  if (typeof value === 'number') return String(value);
  return null;
}
export function number(value: unknown): number | null {
  const v = text(value); if (v === null || v.trim() === '') return null;
  const n = Number(v); return Number.isFinite(n) ? n : null;
}
export function required(value: unknown, field: string): string {
  const v = text(value); if (!v) throw new Error(`Yahoo response missing ${field}`); return v;
}
export function container(parent: Raw, field: string): Raw {
  if (!(field in parent)) throw new Error(`Yahoo response missing ${field} container`);
  return obj(parent[field]);
}
export function collection(parent: Raw, name: string, item: string): Raw[] {
  const c = container(parent, name);
  const values = list(c[item]).map(obj);
  const count = number(c['@_count']);
  if (count !== null && count !== values.length) throw new Error(`Yahoo ${name} count mismatch`);
  return values;
}
