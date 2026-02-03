import express from 'express'
import {
  createReservation,
  confirmReservation,
  cancelReservation,
  getMyBookings,
  getAvailableSlots,
  getAllBookings,
  adminCancelBooking,
  adminRescheduleBooking
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
router.post('/:id/cancel', requireRole('customer'), cancelReservation)
router.get('/my-bookings', requireRole('customer'), getMyBookings)
// Admin routes
router.get('/admin/all', requireRole('admin'), getAllBookings)
router.post('/admin/:id/cancel', requireRole('admin'), adminCancelBooking)
router.post('/admin/:id/reschedule', requireRole('admin'), adminRescheduleBooking)

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