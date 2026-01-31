import express from 'express'
import {
  createReservation,
  confirmReservation,
  getMyBookings,
  getAvailableSlots
} from '../controllers/bookingController.js'
import { authenticate, requireRole } from '../middleware/auth.js'
import { manualCleanup } from '../jobs/cleanupExpiredReservations.js'

const router = express.Router()

// All booking routes require authentication
router.use(authenticate)

// Existing routes...
router.get('/available-slots', getAvailableSlots)
router.post('/reserve', requireRole('customer'), createReservation)
router.post('/:id/confirm', requireRole('customer'), confirmReservation)
router.get('/my-bookings', requireRole('customer'), getMyBookings)

// ⭐ NEW: Manual cleanup trigger (admin only, for testing)
router.post('/cleanup', requireRole('admin'), async (req, res) => {
  try {
    const count = await manualCleanup()
    res.json({
      success: true,
      message: `Cleanup completed: ${count} expired reservation(s) removed`
    })
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Cleanup failed'
    })
  }
})

export default router