/**
 * Date and Time Utility Functions
 * 
 * Handles time calculations for booking reservations
 */

/**
 * Add minutes to current date and return ISO string
 * Used for setting reservation expiry times
 * 
 * Example: addMinutes(5) → "2026-01-31T14:40:00.000Z"
 */
export function addMinutes(minutes) {
  const date = new Date()
  date.setMinutes(date.getMinutes() + minutes)
  return date.toISOString()
}

/**
 * Check if a timestamp is in the past
 * Used to verify if reservation has expired
 * 
 * Example: isPast("2026-01-31T14:30:00Z") → true/false
 */
export function isPast(timestamp) {
  return new Date(timestamp) < new Date()
}

/**
 * Calculate duration between two time strings (HH:MM format)
 * Returns duration in minutes
 * 
 * Example: getTimeDuration("10:00", "11:30") → 90
 */
export function getTimeDuration(startTime, endTime) {
  const [startHour, startMin] = startTime.split(':').map(Number)
  const [endHour, endMin] = endTime.split(':').map(Number)
  
  const startMinutes = startHour * 60 + startMin
  const endMinutes = endHour * 60 + endMin
  
  return endMinutes - startMinutes
}

/**
 * Format date to YYYY-MM-DD (for database DATE columns)
 * 
 * Example: formatDate(new Date()) → "2026-01-31"
 */
export function formatDate(date) {
  return date.toISOString().split('T')[0]
}