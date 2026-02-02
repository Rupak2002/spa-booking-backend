/**
 * Response Utility Functions
 *
 * Standardized API response helpers
 */

/**
 * Send error response
 *
 * Example: errorResponse(res, 400, "Invalid input")
 */
export const errorResponse = (res, status, message) =>
  res.status(status).json({ success: false, error: message })

/**
 * Send success response
 *
 * Example: successResponse(res, { id: 1 }, "Created successfully", 201)
 */
export const successResponse = (res, data, message, status = 200) =>
  res.status(status).json({ success: true, data, ...(message && { message }) })
