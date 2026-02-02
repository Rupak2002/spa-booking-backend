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