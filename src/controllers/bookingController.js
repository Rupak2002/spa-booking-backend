import supabase from '../config/supabase.js'
import { addMinutes } from '../utils/dateTime.js'

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
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: service_id, therapist_id, time_slot_id'
      })
    }

    // 1. Fetch and verify time slot
    const { data: timeSlot, error: slotError } = await supabase
      .from('time_slots')
      .select('*')
      .eq('id', time_slot_id)
      .eq('therapist_id', therapist_id)
      .eq('is_available', true)
      .single()

    if (slotError || !timeSlot) {
      return res.status(400).json({
        success: false,
        error: 'Time slot not available or does not exist'
      })
    }

    // 2. Fetch service details (for snapshot)
    const { data: service, error: serviceError } = await supabase
      .from('services')
      .select('id, name, price, duration')
      .eq('id', service_id)
      .eq('is_active', true)
      .single()

    if (serviceError || !service) {
      return res.status(400).json({
        success: false,
        error: 'Service not found or inactive'
      })
    }

    // 3. Calculate reservation expiry (5 minutes from now in production)
    const timeoutMinutes = parseInt(process.env.RESERVATION_TIMEOUT_MINUTES) || 5
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

    // Group bookings by status for easier frontend consumption
    const grouped = {
      upcoming: bookings.filter(b => 
        b.status === 'confirmed' && new Date(b.booking_date) >= new Date()
      ),
      pending: bookings.filter(b => b.status === 'pending'),
      past: bookings.filter(b => 
        ['completed', 'confirmed'].includes(b.status) && 
        new Date(b.booking_date) < new Date()
      ),
      cancelled: bookings.filter(b => b.status === 'cancelled')
    }

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
      return res.status(400).json({
        success: false,
        error: 'Missing required parameters: service_id, start_date'
      })
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
    // (This could be done in SQL but keeping it simple for now)
    const validSlots = slots.filter(slot => {
      const [startHour, startMin] = slot.start_time.split(':').map(Number)
      const [endHour, endMin] = slot.end_time.split(':').map(Number)
      const slotDuration = (endHour * 60 + endMin) - (startHour * 60 + startMin)
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