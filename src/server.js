import express from 'express'
import cors from 'cors'
import rateLimit from 'express-rate-limit'
import helmet from 'helmet'
import dotenv from 'dotenv'
import bookingRoutes from './routes/bookings.js'
import { errorHandler } from './middleware/errorHandler.js'
import { startAllJobs, stopAllJobs } from './jobs/scheduler.js'

dotenv.config()

const app = express()

// CORS configuration
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map(origin => origin.trim())
  : ['http://localhost:3000', 'http://localhost:5173']

const corsOptions = {
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, Postman, etc.)
    if (!origin) return callback(null, true)
    if (allowedOrigins.includes(origin)) {
      callback(null, true)
    } else {
      callback(new Error('Not allowed by CORS'))
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}

// Rate limiting configuration
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  message: { success: false, error: 'Too many requests, please try again later' },
  standardHeaders: true,
  legacyHeaders: false
})

// Middleware
app.use(helmet())
app.use(cors(corsOptions))
app.use(express.json())

// Health check — before rate limiter so monitoring tools never get 429
app.get('/api/health', (req, res) => {
  res.json({
    status: 'OK',
    message: 'Spa Booking API is running!',
    timestamp: new Date().toISOString()
  })
})

app.use(generalLimiter)

// Booking routes
app.use('/api/bookings', bookingRoutes)

// Global error handler (must be last)
app.use(errorHandler)

// Start server
const PORT = process.env.PORT || 3000

const server = app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`)
})

// Start all background jobs (cleanup + reminders)
const jobs = startAllJobs()

// Graceful shutdown
function shutdown(signal) {
  console.log(`\n👋 ${signal} signal received: closing HTTP server`)
  stopAllJobs(jobs)
  server.close(() => {
    console.log('✅ HTTP server closed')
    process.exit(0)
  })
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))
