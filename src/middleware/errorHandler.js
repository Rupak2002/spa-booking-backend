/**
 * Global Error Handler Middleware
 *
 * Catches all errors thrown in route handlers
 * Must be registered last in middleware chain
 */
export const errorHandler = (err, req, res, next) => {
  console.error('Error:', err.message)
  console.error('Stack:', err.stack)

  const statusCode = err.statusCode || 500
  const message = err.message || 'Internal Server Error'

  res.status(statusCode).json({
    success: false,
    error: message,
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  })
}
