import supabase from '../config/supabase.js'

/**
 * Background Job: Cleanup Expired Reservations
 * 
 * Runs periodically to:
 * 1. Find PENDING bookings that have expired
 * 2. Delete expired bookings
 * 3. Free up the associated time slots
 * 
 * This prevents time slots from being locked indefinitely
 * when customers abandon the booking process
 */

/**
 * Main cleanup function
 * Returns count of cleaned up bookings
 */
export async function cleanupExpiredReservations() {
  try {
    const now = new Date().toISOString()

    // Step 1: Find expired PENDING bookings
    const { data: expiredBookings, error: fetchError } = await supabase
      .from('bookings')
      .select('id, time_slot_id, service_name, booking_date')
      .eq('status', 'pending')
      .lt('reservation_expires_at', now) // expired (less than now)
      .not('reservation_expires_at', 'is', null) // has expiry time

    if (fetchError) {
      console.error('Error fetching expired bookings:', fetchError)
      return 0
    }

    if (!expiredBookings || expiredBookings.length === 0) {
      // No expired bookings to clean up
      return 0
    }

    console.log(`🧹 Found ${expiredBookings.length} expired reservation(s) to clean up`)

    // Step 2: Get all time slot IDs to free
    const timeSlotIds = expiredBookings.map(b => b.time_slot_id).filter(Boolean)

    // Step 3: Delete expired bookings by ID (avoids race condition with re-querying)
    const expiredIds = expiredBookings.map(b => b.id)
    const { error: deleteError } = await supabase
      .from('bookings')
      .delete()
      .in('id', expiredIds)

    if (deleteError) {
      console.error('Error deleting expired bookings:', deleteError)
      return 0
    }

    // Step 4: Free up time slots (mark as available again)
    if (timeSlotIds.length > 0) {
      const { error: updateError } = await supabase
        .from('time_slots')
        .update({ is_available: true })
        .in('id', timeSlotIds)

      if (updateError) {
        console.error('Error freeing time slots:', updateError)
        // Bookings already deleted, so don't return 0
      } else {
        console.log(`✅ Freed ${timeSlotIds.length} time slot(s)`)
      }
    }

    // Log details for debugging
    expiredBookings.forEach(booking => {
      console.log(`   - Booking ID: ${booking.id.substring(0, 8)}... (${booking.service_name} on ${booking.booking_date})`)
    })

    return expiredBookings.length
  } catch (error) {
    console.error('Cleanup job error:', error)
    return 0
  }
}

/**
 * Manual cleanup trigger (for testing)
 * Can be called via API endpoint
 */
export async function manualCleanup() {
  console.log('\n🔧 Manual cleanup triggered...')
  const count = await cleanupExpiredReservations()
  console.log(`🔧 Manual cleanup complete: ${count} booking(s) cleaned\n`)
  return count
}