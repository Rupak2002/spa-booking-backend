import supabase from '../config/supabase.js'
import { addMinutes, getTimeDuration } from '../utils/dateTime.js'
import { isValidUUID, isValidDateFormat, parseIntSafe } from '../utils/validation.js'
import { errorResponse } from '../utils/response.js'

/**
 * Create a PENDING reservation (5-minute hold)
 * 
 * Business Logic:
 * 1. Verify time slot exists and is available
 * 2. Verify slot can accommodate service duration
 * 3. Fetch service details (for snapshot)
 * 4. Create PENDING booking with expiry time
 * 5. Mark time slot as temporarily unavailable
 * 
 * This is an atomic operation - if anything fails, nothing changes
 */
export const createReservation = async (req, res) => {
  try {
    const { service_id, therapist_id, time_slot_id, notes } = req.body
    const customer_id = req.profile.id

    // Validation
    if (!service_id || !therapist_id || !time_slot_id) {
      return errorResponse(res, 400, 'Missing required fields: service_id, therapist_id, time_slot_id')
    }

    // Validate UUID formats
    if (!isValidUUID(service_id) || !isValidUUID(therapist_id) || !isValidUUID(time_slot_id)) {
      return errorResponse(res, 400, 'Invalid UUID format for service_id, therapist_id, or time_slot_id')
    }

    // 1. Fetch time slot and service in parallel
    const [slotResult, serviceResult] = await Promise.all([
      supabase
        .from('time_slots')
        .select('*')
        .eq('id', time_slot_id)
        .eq('therapist_id', therapist_id)
        .eq('is_available', true)
        .single(),
      supabase
        .from('services')
        .select('id, name, price, duration')
        .eq('id', service_id)
        .eq('is_active', true)
        .single()
    ])

    const { data: timeSlot, error: slotError } = slotResult
    const { data: service, error: serviceError } = serviceResult

    if (slotError || !timeSlot) {
      return errorResponse(res, 400, 'Time slot not available or does not exist')
    }

    if (serviceError || !service) {
      return errorResponse(res, 400, 'Service not found or inactive')
    }

    // 2. Calculate reservation expiry (5 minutes from now in production)
    const timeoutMinutes = parseIntSafe(process.env.RESERVATION_TIMEOUT_MINUTES, 5, 1, 60)
    const expiresAt = addMinutes(timeoutMinutes)

    // 4. Create PENDING booking (snapshot service details)
    const { data: booking, error: bookingError } = await supabase
      .from('bookings')
      .insert({
        customer_id,
        service_id,
        therapist_id,
        time_slot_id,
        booking_date: timeSlot.slot_date,
        start_time: timeSlot.start_time,
        end_time: timeSlot.end_time,
        service_name: service.name,
        service_price: service.price,
        service_duration: service.duration,
        status: 'pending',
        reservation_expires_at: expiresAt,
        payment_status: 'pending',
        payment_amount: service.price,
        notes: notes || null
      })
      .select()
      .single()

    if (bookingError) {
      console.error('Booking creation error:', bookingError)
      return res.status(500).json({
        success: false,
        error: 'Failed to create reservation'
      })
    }

    // 5. Mark time slot as temporarily unavailable
    const { error: updateError } = await supabase
      .from('time_slots')
      .update({ is_available: false })
      .eq('id', time_slot_id)

    if (updateError) {
      // Rollback: delete the booking we just created
      await supabase.from('bookings').delete().eq('id', booking.id)
      
      return res.status(500).json({
        success: false,
        error: 'Failed to reserve time slot'
      })
    }

    // Success! Return booking with expiry info
    res.status(201).json({
      success: true,
      data: {
        booking,
        expires_at: expiresAt,
        expires_in_seconds: timeoutMinutes * 60
      },
      message: `Reservation created. Complete booking within ${timeoutMinutes} minutes.`
    })

  } catch (error) {
    console.error('Create reservation error:', error)
    res.status(500).json({
      success: false,
      error: 'Failed to create reservation'
    })
  }
}

/**
 * Confirm a PENDING reservation (after payment)
 * 
 * This will be used in Phase 2 when we add payment integration
 * For now, customers can confirm immediately (simulated payment)
 */
export const confirmReservation = async (req, res) => {
  try {
    const { id } = req.params
    const customer_id = req.profile.id

    // 1. Fetch the booking
    const { data: booking, error: fetchError } = await supabase
      .from('bookings')
      .select('*')
      .eq('id', id)
      .eq('customer_id', customer_id)
      .single()

    if (fetchError || !booking) {
      return res.status(404).json({
        success: false,
        error: 'Booking not found'
      })
    }

    // 2. Verify booking is still pending
    if (booking.status !== 'pending') {
      return res.status(400).json({
        success: false,
        error: `Cannot confirm booking with status: ${booking.status}`
      })
    }

    // 3. Check if reservation has expired
    if (new Date(booking.reservation_expires_at) < new Date()) {
      return res.status(400).json({
        success: false,
        error: 'Reservation has expired. Please create a new booking.'
      })
    }

    // 4. Update booking status to confirmed
    const { data: confirmedBooking, error: updateError } = await supabase
      .from('bookings')
      .update({
        status: 'confirmed',
        payment_status: 'paid', // Simulated for now
        reservation_expires_at: null // No longer needs expiry
      })
      .eq('id', id)
      .select()
      .single()

    if (updateError) {
      return res.status(500).json({
        success: false,
        error: 'Failed to confirm booking'
      })
    }

    res.json({
      success: true,
      data: confirmedBooking,
      message: 'Booking confirmed successfully!'
    })

  } catch (error) {
    console.error('Confirm reservation error:', error)
    res.status(500).json({
      success: false,
      error: 'Failed to confirm reservation'
    })
  }
}

/**
 * Get customer's booking history
 * Includes upcoming, past, and cancelled bookings
 */
export const getMyBookings = async (req, res) => {
  try {
    const customer_id = req.profile.id

    const { data: bookings, error } = await supabase
      .from('bookings')
      .select(`
        *,
        therapist:therapists!bookings_therapist_id_fkey(
          id,
          specialization,
          user:profiles!therapists_user_id_fkey(
            full_name,
            email
          )
        )
      `)
      .eq('customer_id', customer_id)
      .order('booking_date', { ascending: false })
      .order('start_time', { ascending: false })

    if (error) {
      console.error('Fetch bookings error:', error)
      return res.status(500).json({
        success: false,
        error: 'Failed to fetch bookings'
      })
    }

    // Group bookings by status in a single pass
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const grouped = bookings.reduce((acc, b) => {
      const bookingDate = new Date(b.booking_date)
      if (b.status === 'cancelled') acc.cancelled.push(b)
      else if (b.status === 'pending') acc.pending.push(b)
      else if (b.status === 'confirmed' && bookingDate >= today) acc.upcoming.push(b)
      else if (['completed', 'confirmed'].includes(b.status)) acc.past.push(b)
      return acc
    }, { upcoming: [], pending: [], past: [], cancelled: [] })

    res.json({
      success: true,
      data: {
        all: bookings,
        grouped
      }
    })

  } catch (error) {
    console.error('Get my bookings error:', error)
    res.status(500).json({
      success: false,
      error: 'Failed to fetch bookings'
    })
  }
}

/**
 * Get available time slots for a service
 * Filters slots that can accommodate the service duration
 */
export const getAvailableSlots = async (req, res) => {
  try {
    const { service_id, start_date, end_date } = req.query

    if (!service_id || !start_date) {
      return errorResponse(res, 400, 'Missing required parameters: service_id, start_date')
    }

    // Validate UUID format
    if (!isValidUUID(service_id)) {
      return errorResponse(res, 400, 'Invalid UUID format for service_id')
    }

    // Validate date formats
    if (!isValidDateFormat(start_date)) {
      return errorResponse(res, 400, 'Invalid date format for start_date (expected YYYY-MM-DD)')
    }

    if (end_date && !isValidDateFormat(end_date)) {
      return errorResponse(res, 400, 'Invalid date format for end_date (expected YYYY-MM-DD)')
    }

    // Fetch service to get duration
    const { data: service } = await supabase
      .from('services')
      .select('duration')
      .eq('id', service_id)
      .single()

    if (!service) {
      return res.status(404).json({
        success: false,
        error: 'Service not found'
      })
    }

    // Build query for available slots
    let query = supabase
      .from('time_slots')
      .select(`
        *,
        therapist:therapists!time_slots_therapist_id_fkey(
          id,
          specialization,
          user:profiles!therapists_user_id_fkey(
            full_name
          )
        )
      `)
      .eq('is_available', true)
      .gte('slot_date', start_date)

    if (end_date) {
      query = query.lte('slot_date', end_date)
    }

    const { data: slots, error } = await query.order('slot_date').order('start_time')

    if (error) {
      console.error('Fetch slots error:', error)
      return res.status(500).json({
        success: false,
        error: 'Failed to fetch time slots'
      })
    }

    // Filter slots that can accommodate service duration
    const validSlots = slots.filter(slot => {
      const slotDuration = getTimeDuration(slot.start_time, slot.end_time)
      return slotDuration >= service.duration
    })

    res.json({
      success: true,
      data: validSlots
    })

  } catch (error) {
    console.error('Get available slots error:', error)
    res.status(500).json({
      success: false,
      error: 'Failed to fetch available slots'
    })
  }
}

/**
 * Cancel a booking (PENDING or CONFIRMED)
 *
 * Business Logic:
 * 1. Verify booking exists and belongs to this customer
 * 2. Verify booking is in a cancellable state (pending or confirmed)
 * 3. Enforce cancellation policy (configurable hours before appointment)
 * 4. Update booking status to cancelled
 * 5. Free the time slot back to available
 *
 * This is an atomic operation - if the slot update fails, the booking
 * status is rolled back (same pattern as createReservation)
 */
export const cancelReservation = async (req, res) => {
  try {
    const { id } = req.params
    const customer_id = req.profile.id

    // 1. Fetch the booking — ownership check via customer_id
    const { data: booking, error: fetchError } = await supabase
      .from('bookings')
      .select('*')
      .eq('id', id)
      .eq('customer_id', customer_id)
      .single()

    if (fetchError || !booking) {
      return res.status(404).json({
        success: false,
        error: 'Booking not found'
      })
    }

    // 2. Guard: only pending or confirmed bookings can be cancelled
    if (!['pending', 'confirmed'].includes(booking.status)) {
      return res.status(400).json({
        success: false,
        error: `Cannot cancel booking with status: ${booking.status}`
      })
    }

    // 3. Cancellation policy: check minimum hours before appointment
    const minCancelHours = parseIntSafe(process.env.MIN_CANCEL_HOURS, 0, 0, 168)
    if (minCancelHours > 0 && booking.status === 'confirmed') {
      const appointmentTime = new Date(`${booking.booking_date}T${booking.start_time}`)
      const hoursUntilAppointment = (appointmentTime - new Date()) / (1000 * 60 * 60)

      if (hoursUntilAppointment < minCancelHours) {
        return res.status(400).json({
          success: false,
          error: `Cancellations must be made at least ${minCancelHours} hours before the appointment`
        })
      }
    }

    // 4. Update booking status to cancelled
    const { data: cancelledBooking, error: updateError } = await supabase
      .from('bookings')
      .update({
        status: 'cancelled',
        reservation_expires_at: null
      })
      .eq('id', id)
      .select()
      .single()

    if (updateError) {
      return res.status(500).json({
        success: false,
        error: 'Failed to cancel booking'
      })
    }

    // 5. Free the time slot back to available
    const { error: slotError } = await supabase
      .from('time_slots')
      .update({ is_available: true })
      .eq('id', booking.time_slot_id)

    if (slotError) {
      // Rollback: restore booking to its previous state (both fields)
      const { error: rollbackError } = await supabase
        .from('bookings')
        .update({
          status: booking.status,
          reservation_expires_at: booking.reservation_expires_at
        })
        .eq('id', id)

      if (rollbackError) {
        console.error('Rollback failed for booking:', id, rollbackError)
      }

      return res.status(500).json({
        success: false,
        error: 'Failed to release time slot'
      })
    }

    res.json({
      success: true,
      data: cancelledBooking,
      message: 'Booking cancelled successfully. The time slot has been released.'
    })

  } catch (error) {
    console.error('Cancel reservation error:', error)
    res.status(500).json({
      success: false,
      error: 'Failed to cancel booking'
    })
  }
}

// Add these three functions to your bookingController.js (Document 7 version)
// Place them at the bottom of the file, after cancelReservation

/**
 * Get all bookings (Admin only)
 * 
 * Query params (all optional):
 * - status: filter by booking status
 * - therapist_id: filter by therapist
 * - customer_id: filter by customer  
 * - start_date: filter bookings from this date onwards
 * - end_date: filter bookings up to this date
 */
export const getAllBookings = async (req, res) => {
  try {
    const { status, therapist_id, customer_id, start_date, end_date } = req.query

    // Validate UUIDs if provided
    if (therapist_id && !isValidUUID(therapist_id)) {
      return errorResponse(res, 400, 'Invalid UUID format for therapist_id')
    }
    if (customer_id && !isValidUUID(customer_id)) {
      return errorResponse(res, 400, 'Invalid UUID format for customer_id')
    }

    // Validate date formats if provided
    if (start_date && !isValidDateFormat(start_date)) {
      return errorResponse(res, 400, 'Invalid date format for start_date (expected YYYY-MM-DD)')
    }
    if (end_date && !isValidDateFormat(end_date)) {
      return errorResponse(res, 400, 'Invalid date format for end_date (expected YYYY-MM-DD)')
    }

    // Build query
    let query = supabase
      .from('bookings')
      .select(`
        *,
        customer:profiles!bookings_customer_id_fkey(
          id,
          full_name,
          email,
          phone
        ),
        therapist:therapists!bookings_therapist_id_fkey(
          id,
          specialization,
          user:profiles!therapists_user_id_fkey(
            full_name,
            email
          )
        )
      `)

    // Apply filters
    if (status) query = query.eq('status', status)
    if (therapist_id) query = query.eq('therapist_id', therapist_id)
    if (customer_id) query = query.eq('customer_id', customer_id)
    if (start_date) query = query.gte('booking_date', start_date)
    if (end_date) query = query.lte('booking_date', end_date)

    // Execute query with ordering
    const { data: bookings, error } = await query
      .order('booking_date', { ascending: false })
      .order('start_time', { ascending: false })

    if (error) {
      console.error('Fetch all bookings error:', error)
      return errorResponse(res, 500, 'Failed to fetch bookings')
    }

    // Calculate stats in a single pass
    const stats = bookings.reduce((acc, b) => {
      acc.total++
      acc.by_status[b.status] = (acc.by_status[b.status] || 0) + 1
      if (['confirmed', 'completed'].includes(b.status)) {
        acc.total_revenue += parseFloat(b.service_price)
      }
      return acc
    }, {
      total: 0,
      by_status: { pending: 0, confirmed: 0, completed: 0, cancelled: 0 },
      total_revenue: 0
    })

    res.json({
      success: true,
      data: { bookings, stats }
    })

  } catch (error) {
    console.error('Get all bookings error:', error)
    errorResponse(res, 500, 'Failed to fetch bookings')
  }
}

/**
 * Admin cancel any booking (override)
 * 
 * Same logic as cancelReservation but without ownership check
 * Admin can cancel any booking regardless of customer
 */
export const adminCancelBooking = async (req, res) => {
  try {
    const { id } = req.params

    // Validate UUID
    if (!isValidUUID(id)) {
      return errorResponse(res, 400, 'Invalid UUID format for booking ID')
    }

    // 1. Fetch the booking (no ownership check - admin can cancel any)
    const { data: booking, error: fetchError } = await supabase
      .from('bookings')
      .select('*')
      .eq('id', id)
      .single()

    if (fetchError || !booking) {
      return errorResponse(res, 404, 'Booking not found')
    }

    // 2. Guard: only pending or confirmed bookings can be cancelled
    if (!['pending', 'confirmed'].includes(booking.status)) {
      return errorResponse(res, 400, `Cannot cancel booking with status: ${booking.status}`)
    }

    // 3. Update booking status to cancelled
    const { data: cancelledBooking, error: updateError } = await supabase
      .from('bookings')
      .update({
        status: 'cancelled',
        reservation_expires_at: null
      })
      .eq('id', id)
      .select(`
        *,
        customer:profiles!bookings_customer_id_fkey(
          id,
          full_name,
          email
        ),
        therapist:therapists!bookings_therapist_id_fkey(
          id,
          specialization,
          user:profiles!therapists_user_id_fkey(
            full_name,
            email
          )
        )
      `)
      .single()

    if (updateError) {
      console.error('Admin cancel update error:', updateError)
      return errorResponse(res, 500, 'Failed to cancel booking')
    }

    // 4. Free the time slot back to available
    const { error: slotError } = await supabase
      .from('time_slots')
      .update({ is_available: true })
      .eq('id', booking.time_slot_id)

    if (slotError) {
      // Rollback: restore booking to its previous state
      const { error: rollbackError } = await supabase
        .from('bookings')
        .update({
          status: booking.status,
          reservation_expires_at: booking.reservation_expires_at
        })
        .eq('id', id)

      if (rollbackError) {
        console.error('Rollback failed for booking:', id, rollbackError)
      }

      return errorResponse(res, 500, 'Failed to release time slot')
    }

    res.json({
      success: true,
      data: cancelledBooking,
      message: `Booking cancelled by admin. Customer ${cancelledBooking.customer.full_name} has been notified.`
    })

  } catch (error) {
    console.error('Admin cancel booking error:', error)
    errorResponse(res, 500, 'Failed to cancel booking')
  }
}

/**
 * Admin reschedule any booking (override)
 * 
 * Business Logic:
 * 1. Fetch the booking (no ownership check - admin can reschedule any)
 * 2. Verify booking is in a reschedulable state (pending or confirmed)
 * 3. Verify new time slot exists, is available, and matches service requirements
 * 4. Atomic swap: update booking, free old slot, reserve new slot
 * 5. Rollback on failure
 */
export const adminRescheduleBooking = async (req, res) => {
  try {
    const { id } = req.params
    const { new_time_slot_id } = req.body

    // Validate UUIDs
    if (!isValidUUID(id)) {
      return errorResponse(res, 400, 'Invalid UUID format for booking ID')
    }

    if (!new_time_slot_id) {
      return errorResponse(res, 400, 'Missing required field: new_time_slot_id')
    }

    if (!isValidUUID(new_time_slot_id)) {
      return errorResponse(res, 400, 'Invalid UUID format for new_time_slot_id')
    }

    // 1. Fetch the booking
    const { data: booking, error: fetchError } = await supabase
      .from('bookings')
      .select('*')
      .eq('id', id)
      .single()

    if (fetchError || !booking) {
      return errorResponse(res, 404, 'Booking not found')
    }

    // 2. Guard: only pending or confirmed bookings can be rescheduled
    if (!['pending', 'confirmed'].includes(booking.status)) {
      return errorResponse(res, 400, `Cannot reschedule booking with status: ${booking.status}`)
    }

    // 3. Fetch and verify new time slot
    const { data: newSlot, error: slotError } = await supabase
      .from('time_slots')
      .select('*')
      .eq('id', new_time_slot_id)
      .eq('therapist_id', booking.therapist_id) // Must be same therapist
      .eq('is_available', true)
      .single()

    if (slotError || !newSlot) {
      return errorResponse(res, 400, 'New time slot not available or does not exist')
    }

    // Verify slot can accommodate service duration using utility function
    const slotDuration = getTimeDuration(newSlot.start_time, newSlot.end_time)
    
    if (slotDuration < booking.service_duration) {
      return errorResponse(res, 400, 'New time slot is too short for this service')
    }

    // 4. Atomic swap: Update booking first
    const { data: rescheduledBooking, error: updateError } = await supabase
      .from('bookings')
      .update({
        time_slot_id: new_time_slot_id,
        booking_date: newSlot.slot_date,
        start_time: newSlot.start_time,
        end_time: newSlot.end_time
      })
      .eq('id', id)
      .select(`
        *,
        customer:profiles!bookings_customer_id_fkey(
          id,
          full_name,
          email
        ),
        therapist:therapists!bookings_therapist_id_fkey(
          id,
          specialization,
          user:profiles!therapists_user_id_fkey(
            full_name,
            email
          )
        )
      `)
      .single()

    if (updateError) {
      console.error('Reschedule update error:', updateError)
      return errorResponse(res, 500, 'Failed to reschedule booking')
    }

    // 5. Free old time slot
    const { error: freeOldSlotError } = await supabase
      .from('time_slots')
      .update({ is_available: true })
      .eq('id', booking.time_slot_id)

    if (freeOldSlotError) {
      // Rollback: restore booking to old slot
      const { error: rollbackError } = await supabase
        .from('bookings')
        .update({
          time_slot_id: booking.time_slot_id,
          booking_date: booking.booking_date,
          start_time: booking.start_time,
          end_time: booking.end_time
        })
        .eq('id', id)

      if (rollbackError) {
        console.error('Rollback failed for booking:', id, rollbackError)
      }

      return errorResponse(res, 500, 'Failed to free old time slot')
    }

    // 6. Reserve new time slot
    const { error: reserveNewSlotError } = await supabase
      .from('time_slots')
      .update({ is_available: false })
      .eq('id', new_time_slot_id)

    if (reserveNewSlotError) {
      // Rollback: restore booking + re-reserve old slot
      await supabase
        .from('bookings')
        .update({
          time_slot_id: booking.time_slot_id,
          booking_date: booking.booking_date,
          start_time: booking.start_time,
          end_time: booking.end_time
        })
        .eq('id', id)

      await supabase
        .from('time_slots')
        .update({ is_available: false })
        .eq('id', booking.time_slot_id)

      return errorResponse(res, 500, 'Failed to reserve new time slot')
    }

    res.json({
      success: true,
      data: rescheduledBooking,
      message: `Booking rescheduled successfully. Customer ${rescheduledBooking.customer.full_name} has been notified.`
    })

  } catch (error) {
    console.error('Admin reschedule booking error:', error)
    errorResponse(res, 500, 'Failed to reschedule booking')
  }
}