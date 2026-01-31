import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import bookingRoutes from './routes/bookings.js'
import { errorHandler } from './middleware/errorHandler.js'
import { startCleanupJob, stopCleanupJob } from './jobs/scheduler.js'

dotenv.config()

const app = express()

// Middleware
app.use(cors())
app.use(express.json())

// Routes
app.get('/api/health', (req, res) => {
  res.json({
    status: 'OK',
    message: 'Spa Booking API is running!',
    timestamp: new Date().toISOString()
  })
})

// Booking routes
app.use('/api/bookings', bookingRoutes)

// Global error handler (must be last)
app.use(errorHandler)

// Start server
const PORT = process.env.PORT || 3000

const server = app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`)
})

// ⭐ NEW: Start background cleanup job
const cleanupJob = startCleanupJob()

// ⭐ NEW: Graceful shutdown
process.on('SIGTERM', () => {
  console.log('\n👋 SIGTERM signal received: closing HTTP server')
  stopCleanupJob(cleanupJob)
  server.close(() => {
    console.log('✅ HTTP server closed')
    process.exit(0)
  })
})

process.on('SIGINT', () => {
  console.log('\n👋 SIGINT signal received: closing HTTP server')
  stopCleanupJob(cleanupJob)
  server.close(() => {
    console.log('✅ HTTP server closed')
    process.exit(0)
  })
})