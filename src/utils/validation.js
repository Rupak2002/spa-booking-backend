/**
 * Validation Utility Functions
 *
 * Input validation helpers for API endpoints
 */

/**
 * Validate UUID format (v4)
 *
 * Example: isValidUUID("123e4567-e89b-12d3-a456-426614174000") → true
 */
export function isValidUUID(str) {
  if (typeof str !== 'string') return false
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
  return uuidRegex.test(str)
}

/**
 * Validate date format (YYYY-MM-DD)
 *
 * Example: isValidDateFormat("2026-01-31") → true
 */
export function isValidDateFormat(str) {
  if (typeof str !== 'string') return false
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/
  if (!dateRegex.test(str)) return false

  // Verify it's a valid date
  const date = new Date(str)
  return !isNaN(date.getTime())
}

/**
 * Safely parse integer with bounds checking
 *
 * Example: parseIntSafe("10", 5, 0, 100) → 10
 * Example: parseIntSafe("invalid", 5) → 5
 * Example: parseIntSafe("200", 5, 0, 100) → 100
 */
export function parseIntSafe(value, defaultVal, min = 0, max = Infinity) {
  const parsed = parseInt(value, 10)
  if (isNaN(parsed)) return defaultVal
  return Math.max(min, Math.min(max, parsed))
}
