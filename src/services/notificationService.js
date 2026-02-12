// src/services/notificationService.js
import { sendEmail } from './emailService.js'
import * as templates from '../templates/emailTemplates.js'

/**
 * Send booking confirmation emails to customer and therapist
 */
export async function sendBookingConfirmation(booking) {
  const results = { customer: false, therapist: false }

  if (booking.customer_email) {
    results.customer = await sendEmail({
      to: booking.customer_email,
      subject: `Booking Confirmed: ${booking.service_name}`,
      html: templates.bookingConfirmation(booking, 'customer'),
    })
  }

  if (booking.therapist_email) {
    results.therapist = await sendEmail({
      to: booking.therapist_email,
      subject: `New Booking: ${booking.service_name}`,
      html: templates.bookingConfirmation(booking, 'therapist'),
    })
  }

  console.log('[NOTIFICATION] Confirmation emails sent:', results)
  return results
}

/**
 * Send 24-hour reminder emails to customer and therapist
 */
export async function sendBookingReminder(booking) {
  const results = { customer: false, therapist: false }

  if (booking.customer_email) {
    results.customer = await sendEmail({
      to: booking.customer_email,
      subject: `Reminder: ${booking.service_name} Tomorrow`,
      html: templates.bookingReminder(booking, 'customer'),
    })
  }

  if (booking.therapist_email) {
    results.therapist = await sendEmail({
      to: booking.therapist_email,
      subject: `Reminder: Appointment Tomorrow`,
      html: templates.bookingReminder(booking, 'therapist'),
    })
  }

  console.log('[NOTIFICATION] Reminder emails sent:', results)
  return results
}

/**
 * Send cancellation emails to customer and therapist
 */
export async function sendBookingCancellation(booking, cancelledBy = 'customer') {
  const results = { customer: false, therapist: false }

  if (booking.customer_email) {
    results.customer = await sendEmail({
      to: booking.customer_email,
      subject: `Booking Cancelled: ${booking.service_name}`,
      html: templates.bookingCancellation(booking, 'customer', cancelledBy),
    })
  }

  if (booking.therapist_email) {
    results.therapist = await sendEmail({
      to: booking.therapist_email,
      subject: `Booking Cancelled: ${booking.service_name}`,
      html: templates.bookingCancellation(booking, 'therapist', cancelledBy),
    })
  }

  console.log('[NOTIFICATION] Cancellation emails sent:', results)
  return results
}