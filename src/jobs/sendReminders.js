// src/jobs/sendReminders.js
import supabase from '../config/supabase.js'
import { sendBookingReminder } from '../services/notificationService.js'

/**
 * Send reminder emails for all confirmed bookings happening tomorrow
 */
export async function sendDailyReminders() {
  console.log('[REMINDER JOB] Starting daily reminder check...')

  // Calculate tomorrow's date in YYYY-MM-DD format
  const tomorrow = new Date()
  tomorrow.setDate(tomorrow.getDate() + 1)
  const tomorrowStr = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`

  try {
    // Fetch all confirmed bookings for tomorrow with customer/therapist details
    const { data: bookings, error } = await supabase
      .from('bookings')
      .select(`
        *,
        customer:profiles!bookings_customer_id_fkey(email, full_name),
        therapist:therapists!bookings_therapist_id_fkey(
          user_id,
          profile:profiles!therapists_user_id_fkey(email, full_name)
        )
      `)
      .eq('status', 'confirmed')
      .eq('booking_date', tomorrowStr)

    if (error) {
      console.error('[REMINDER JOB] Query error:', error)
      return { success: false, error: error.message }
    }

    if (!bookings || bookings.length === 0) {
      console.log('[REMINDER JOB] No bookings for tomorrow')
      return { success: true, sent: 0 }
    }

    console.log(`[REMINDER JOB] Found ${bookings.length} bookings for tomorrow`)

    // Send reminders for each booking
    let sentCount = 0
    for (const booking of bookings) {
      try {
        const flatBooking = {
          ...booking,
          customer_email: booking.customer?.email,
          customer_name: booking.customer?.full_name,
          therapist_email: booking.therapist?.profile?.email,
          therapist_name: booking.therapist?.profile?.full_name,
        }

        const result = await sendBookingReminder(flatBooking)
        if (result.customer || result.therapist) {
          sentCount++
        }

        // Small delay between emails to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 100))
      } catch (bookingErr) {
        console.error(`[REMINDER JOB] Failed to send reminder for booking ${booking.id}:`, bookingErr.message)
      }
    }

    console.log(`[REMINDER JOB] Completed. Sent reminders for ${sentCount} bookings`)
    return { success: true, sent: sentCount }

  } catch (err) {
    console.error('[REMINDER JOB] Unexpected error:', err)
    return { success: false, error: err.message }
  }
}