import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getNestedValue, interpolate, interpolateHeaders } from './interpolate';

describe('getNestedValue', () => {
  describe('basic access', () => {
    it('returns top-level value', () => {
      expect(getNestedValue({ name: 'John' }, 'name')).toBe('John');
    });

    it('returns nested value', () => {
      expect(getNestedValue({ user: { email: 'test@example.com' } }, 'user.email')).toBe('test@example.com');
    });

    it('returns deeply nested value', () => {
      const obj = { a: { b: { c: { d: 'deep' } } } };
      expect(getNestedValue(obj, 'a.b.c.d')).toBe('deep');
    });

    it('returns array elements', () => {
      expect(getNestedValue({ items: ['a', 'b', 'c'] }, 'items.1')).toBe('b');
    });

    it('returns nested objects', () => {
      const nested = { id: 123 };
      expect(getNestedValue({ user: nested }, 'user')).toEqual(nested);
    });
  });

  describe('edge cases', () => {
    it('returns undefined for non-existent path', () => {
      expect(getNestedValue({ name: 'John' }, 'email')).toBeUndefined();
    });

    it('returns undefined for non-existent nested path', () => {
      expect(getNestedValue({ user: { name: 'John' } }, 'user.email')).toBeUndefined();
    });

    it('returns undefined for null object', () => {
      expect(getNestedValue(null, 'name')).toBeUndefined();
    });

    it('returns undefined for undefined object', () => {
      expect(getNestedValue(undefined, 'name')).toBeUndefined();
    });

    it('returns undefined for non-object', () => {
      expect(getNestedValue('string' as unknown, 'length')).toBeUndefined();
    });

    it('returns undefined when traversing through null', () => {
      expect(getNestedValue({ user: null }, 'user.name')).toBeUndefined();
    });

    it('returns undefined when traversing through primitive', () => {
      expect(getNestedValue({ user: 'John' }, 'user.name')).toBeUndefined();
    });

    it('handles empty path', () => {
      expect(getNestedValue({ '': 'empty' }, '')).toBe('empty');
    });
  });

  describe('value types', () => {
    it('returns number values', () => {
      expect(getNestedValue({ count: 42 }, 'count')).toBe(42);
    });

    it('returns boolean values', () => {
      expect(getNestedValue({ active: true }, 'active')).toBe(true);
      expect(getNestedValue({ active: false }, 'active')).toBe(false);
    });

    it('returns null values', () => {
      expect(getNestedValue({ value: null }, 'value')).toBeNull();
    });

    it('returns zero', () => {
      expect(getNestedValue({ value: 0 }, 'value')).toBe(0);
    });

    it('returns empty string', () => {
      expect(getNestedValue({ value: '' }, 'value')).toBe('');
    });

    it('returns empty array', () => {
      expect(getNestedValue({ items: [] }, 'items')).toEqual([]);
    });
  });
});

describe('interpolate', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  describe('basic interpolation', () => {
    it('replaces single placeholder', () => {
      expect(interpolate('Hello {{name}}', { name: 'John' })).toBe('Hello John');
    });

    it('replaces multiple placeholders', () => {
      expect(interpolate('{{greeting}} {{name}}!', { greeting: 'Hello', name: 'World' })).toBe('Hello World!');
    });

    it('replaces nested placeholders', () => {
      expect(interpolate('Email: {{user.email}}', { user: { email: 'test@example.com' } })).toBe('Email: test@example.com');
    });

    it('handles whitespace in placeholders', () => {
      expect(interpolate('Hello {{ name }}', { name: 'John' })).toBe('Hello John');
      expect(interpolate('Hello {{  name  }}', { name: 'John' })).toBe('Hello John');
    });

    it('returns string unchanged if no placeholders', () => {
      expect(interpolate('No placeholders here', {})).toBe('No placeholders here');
    });
  });

  describe('type conversion', () => {
    it('converts numbers to strings', () => {
      expect(interpolate('Count: {{count}}', { count: 42 })).toBe('Count: 42');
    });

    it('converts booleans to strings', () => {
      expect(interpolate('Active: {{active}}', { active: true })).toBe('Active: true');
      expect(interpolate('Active: {{active}}', { active: false })).toBe('Active: false');
    });

    it('converts objects to JSON', () => {
      const user = { name: 'John', age: 30 };
      expect(interpolate('User: {{user}}', { user })).toBe('User: {"name":"John","age":30}');
    });

    it('converts arrays to JSON', () => {
      expect(interpolate('Items: {{items}}', { items: [1, 2, 3] })).toBe('Items: [1,2,3]');
    });

    it('handles zero', () => {
      expect(interpolate('Value: {{value}}', { value: 0 })).toBe('Value: 0');
    });

    it('handles empty string', () => {
      expect(interpolate('Value: {{value}}', { value: '' })).toBe('Value: ');
    });
  });

  describe('missing values', () => {
    it('keeps placeholder for undefined value', () => {
      expect(interpolate('Hello {{name}}', {})).toBe('Hello {{name}}');
      expect(warnSpy).toHaveBeenCalledWith('Interpolation: No value found for {{name}}');
    });

    it('keeps placeholder for null value', () => {
      expect(interpolate('Hello {{name}}', { name: null })).toBe('Hello {{name}}');
    });

    it('keeps placeholder for non-existent nested path', () => {
      expect(interpolate('Email: {{user.email}}', { user: {} })).toBe('Email: {{user.email}}');
    });
  });

  describe('JSON body templates', () => {
    it('interpolates JSON body template', () => {
      const template = '{"name": "{{name}}", "email": "{{email}}"}';
      const context = { name: 'John', email: 'john@example.com' };
      expect(interpolate(template, context)).toBe('{"name": "John", "email": "john@example.com"}');
    });

    it('handles complex nested JSON', () => {
      const template = '{"user": {"id": "{{user.id}}", "profile": {"name": "{{user.name}}"}}}';
      const context = { user: { id: '123', name: 'John' } };
      expect(interpolate(template, context)).toBe('{"user": {"id": "123", "profile": {"name": "John"}}}');
    });
  });

  describe('edge cases', () => {
    it('handles empty template', () => {
      expect(interpolate('', { name: 'John' })).toBe('');
    });

    it('handles malformed placeholders', () => {
      expect(interpolate('Hello {{name', { name: 'John' })).toBe('Hello {{name');
      expect(interpolate('Hello name}}', { name: 'John' })).toBe('Hello name}}');
    });

    it('handles escaped-looking braces', () => {
      expect(interpolate('Hello \\{{name}}', { name: 'John' })).toBe('Hello \\John');
    });

    it('handles multiple same placeholders', () => {
      expect(interpolate('{{x}} + {{x}} = {{sum}}', { x: 2, sum: 4 })).toBe('2 + 2 = 4');
    });
  });
});

describe('interpolateHeaders', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('interpolates header values', () => {
    const headers = {
      'Authorization': 'Bearer {{settings.apiKey}}',
      'X-User-Id': '{{user.id}}',
    };
    const context = {
      settings: { apiKey: 'secret123' },
      user: { id: 'user-456' },
    };
    expect(interpolateHeaders(headers, context)).toEqual({
      'Authorization': 'Bearer secret123',
      'X-User-Id': 'user-456',
    });
  });

  it('preserves static headers', () => {
    const headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };
    expect(interpolateHeaders(headers, {})).toEqual(headers);
  });

  it('returns empty object for undefined headers', () => {
    expect(interpolateHeaders(undefined, {})).toEqual({});
  });

  it('handles mixed static and dynamic headers', () => {
    const headers = {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer {{token}}',
    };
    expect(interpolateHeaders(headers, { token: 'abc' })).toEqual({
      'Content-Type': 'application/json',
      'Authorization': 'Bearer abc',
    });
  });
});











