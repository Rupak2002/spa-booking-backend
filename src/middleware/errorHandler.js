/**
 * Global Error Handler Middleware
 * 
 * Catches all errors thrown in route handlers and formats response
 * This prevents Express from exposing stack traces to clients
 */
export const errorHandler = (err, req, res, next) => {
  console.error('Error:', err)

  // Default error
  let statusCode = err.statusCode || 500
  let message = err.message || 'Internal server error'

  // Supabase-specific errors
  if (err.code) {
    switch (err.code) {
      case '23505': // Unique violation
        statusCode = 409
        message = 'Resource already exists'
        break
      case '23503': // Foreign key violation
        statusCode = 400
        message = 'Referenced resource not found'
        break
      case '23502': // Not null violation
        statusCode = 400
        message = 'Required field missing'
        break
    }
  }

  res.status(statusCode).json({
    success: false,
    error: message,
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  })
}