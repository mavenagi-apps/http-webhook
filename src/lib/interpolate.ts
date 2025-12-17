/**
 * Template interpolation engine
 * 
 * Replaces {{variable.path}} with values from context object.
 * Supports nested paths like {{user.email}} or {{parameters.fieldName}}
 */

/**
 * Get a nested value from an object using dot notation
 * @example getNestedValue({user: {email: "test@example.com"}}, "user.email") => "test@example.com"
 */
export function getNestedValue(obj: unknown, path: string): unknown {
  if (!obj || typeof obj !== 'object') {
    return undefined;
  }
  
  const parts = path.split('.');
  let current: unknown = obj;
  
  for (const part of parts) {
    if (current === null || current === undefined) {
      return undefined;
    }
    if (typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }
  
  return current;
}

/**
 * Interpolate a template string with values from context
 * @param template - Template string with {{variable}} placeholders
 * @param context - Object containing values to interpolate
 * @returns Interpolated string
 * 
 * @example
 * interpolate("Hello {{user.name}}", {user: {name: "John"}}) => "Hello John"
 */
export function interpolate(template: string, context: Record<string, unknown>): string {
  return template.replace(/\{\{([^}]+)\}\}/g, (match, path) => {
    const trimmedPath = path.trim();
    const value = getNestedValue(context, trimmedPath);
    
    if (value === undefined || value === null) {
      // Keep original placeholder if value not found
      console.warn(`Interpolation: No value found for {{${trimmedPath}}}`);
      return match;
    }
    
    // Convert objects/arrays to JSON string
    if (typeof value === 'object') {
      return JSON.stringify(value);
    }
    
    return String(value);
  });
}

/**
 * Interpolate all string values in a headers object
 */
export function interpolateHeaders(
  headers: Record<string, string> | undefined,
  context: Record<string, unknown>
): Record<string, string> {
  if (!headers) {
    return {};
  }
  
  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [key, interpolate(value, context)])
  );
}

