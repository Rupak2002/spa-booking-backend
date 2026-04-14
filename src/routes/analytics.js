import express from 'express'
import { getDashboardAnalytics } from '../controllers/analyticsController.js'
import { authenticate, requireRole } from '../middleware/auth.js'

const router = express.Router()

// All analytics routes require admin authentication
router.use(authenticate)
router.use(requireRole('admin'))

// Dashboard analytics endpoint
router.get('/dashboard', getDashboardAnalytics)

export default router
