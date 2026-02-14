// src/templates/emailTemplates.js

/**
 * Escape HTML special characters to prevent XSS in email templates
 */
function escapeHtml(value) {
  if (value == null) return ''
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * Format date for display (e.g., "Monday, January 15, 2025")
 */
function formatDate(dateString) {
  if (!dateString || typeof dateString !== 'string') return 'Unknown date'
  const date = new Date(dateString + 'T00:00:00'); // Avoid timezone shift
  if (isNaN(date.getTime())) return 'Invalid date'
  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

/**
 * Format time for display (e.g., "10:00 AM")
 */
function formatTime(timeString) {
  if (!timeString || typeof timeString !== 'string') return 'Unknown time'
  const [hours, minutes] = timeString.split(':');
  const hour = parseInt(hours, 10);
  if (isNaN(hour) || hour < 0 || hour > 23) return 'Invalid time'
  const ampm = hour >= 12 ? 'PM' : 'AM';
  const hour12 = hour % 12 || 12;
  return `${hour12}:${minutes} ${ampm}`;
}

/**
 * Format price (e.g., "$85.00")
 */
function formatPrice(price) {
  return `$${parseFloat(price).toFixed(2)}`;
}

/**
 * Base email wrapper with consistent styling
 */
function baseTemplate(content, previewText = '') {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Serenity Spa</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f3f4f6; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;">
  <!-- Preview text (hidden) -->
  <div style="display: none; max-height: 0; overflow: hidden;">
    ${previewText}
  </div>
  
  <!-- Email container -->
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #f3f4f6;">
    <tr>
      <td align="center" style="padding: 40px 20px;">
        <!-- Content card -->
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width: 600px; background-color: #ffffff; border-radius: 12px; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);">
          
          <!-- Header -->
          <tr>
            <td style="background-color: #9333ea; padding: 30px 40px; border-radius: 12px 12px 0 0; text-align: center;">
              <h1 style="margin: 0; color: #ffffff; font-size: 28px; font-weight: 600;">
                ✨ Serenity Spa
              </h1>
            </td>
          </tr>
          
          <!-- Body -->
          <tr>
            <td style="padding: 40px;">
              ${content}
            </td>
          </tr>
          
          <!-- Footer -->
          <tr>
            <td style="padding: 20px 40px 30px; text-align: center; border-top: 1px solid #e5e7eb;">
              <p style="margin: 0; color: #6b7280; font-size: 14px;">
                Thank you for choosing Serenity Spa
              </p>
              <p style="margin: 10px 0 0; color: #9ca3af; font-size: 12px;">
                Questions? Reply to this email or call us at ${process.env.SUPPORT_PHONE || '(555) 123-4567'}
              </p>
            </td>
          </tr>
          
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();
}

/**
 * Booking detail row (reusable)
 */
function detailRow(label, value) {
  return `
    <tr>
      <td style="padding: 8px 0; color: #6b7280; font-size: 14px; width: 120px;">${label}</td>
      <td style="padding: 8px 0; color: #1f2937; font-size: 14px; font-weight: 500;">${escapeHtml(value)}</td>
    </tr>
  `;
}

// ============================================
// BOOKING CONFIRMATION EMAIL
// ============================================
function bookingConfirmation(booking, recipientType = 'customer') {
  const isCustomer = recipientType === 'customer';
  const greeting = isCustomer
    ? `Hi ${escapeHtml(booking.customer_name) || 'there'},`
    : `Hi ${escapeHtml(booking.therapist_name) || 'there'},`;

  const intro = isCustomer
    ? 'Great news! Your booking has been confirmed.'
    : 'You have a new confirmed booking.';

  const content = `
    <h2 style="margin: 0 0 10px; color: #1f2937; font-size: 22px;">
      ${isCustomer ? 'Booking Confirmed! 🎉' : 'New Booking Alert'}
    </h2>
    <p style="margin: 0 0 25px; color: #4b5563; font-size: 16px; line-height: 1.6;">
      ${greeting}<br>${intro}
    </p>
    
    <!-- Booking details card -->
    <div style="background-color: #faf5ff; border: 1px solid #e9d5ff; border-radius: 8px; padding: 20px; margin-bottom: 25px;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
        ${detailRow('Service', booking.service_name)}
        ${detailRow('Date', formatDate(booking.booking_date))}
        ${detailRow('Time', `${formatTime(booking.start_time)} - ${formatTime(booking.end_time)}`)}
        ${detailRow('Duration', `${booking.service_duration} minutes`)}
        ${isCustomer ? detailRow('Therapist', booking.therapist_name || 'Assigned') : detailRow('Customer', booking.customer_name)}
        ${detailRow('Price', formatPrice(booking.service_price))}
      </table>
    </div>
    
    ${isCustomer ? `
    <p style="margin: 0; color: #4b5563; font-size: 14px; line-height: 1.6;">
      Please arrive 10 minutes before your appointment. If you need to cancel or reschedule, 
      you can do so from your dashboard.
    </p>
    ` : `
    <p style="margin: 0; color: #4b5563; font-size: 14px; line-height: 1.6;">
      Please ensure you're available at the scheduled time. Contact the customer if you have any questions.
    </p>
    `}
  `;

  return baseTemplate(content, `Your booking for ${booking.service_name} is confirmed`);
}

// ============================================
// 24-HOUR REMINDER EMAIL
// ============================================
function bookingReminder(booking, recipientType = 'customer') {
  const isCustomer = recipientType === 'customer';
  const greeting = isCustomer
    ? `Hi ${escapeHtml(booking.customer_name) || 'there'},`
    : `Hi ${escapeHtml(booking.therapist_name) || 'there'},`;

  const content = `
    <h2 style="margin: 0 0 10px; color: #1f2937; font-size: 22px;">
      Appointment Tomorrow ⏰
    </h2>
    <p style="margin: 0 0 25px; color: #4b5563; font-size: 16px; line-height: 1.6;">
      ${greeting}<br>This is a friendly reminder about your upcoming appointment.
    </p>
    
    <!-- Booking details card -->
    <div style="background-color: #fefce8; border: 1px solid #fde047; border-radius: 8px; padding: 20px; margin-bottom: 25px;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
        ${detailRow('Service', booking.service_name)}
        ${detailRow('Date', formatDate(booking.booking_date))}
        ${detailRow('Time', `${formatTime(booking.start_time)} - ${formatTime(booking.end_time)}`)}
        ${isCustomer ? detailRow('Therapist', booking.therapist_name || 'Assigned') : detailRow('Customer', booking.customer_name)}
      </table>
    </div>
    
    ${isCustomer ? `
    <p style="margin: 0; color: #4b5563; font-size: 14px; line-height: 1.6;">
      <strong>Remember:</strong> Please arrive 10 minutes early. If you can no longer make it, 
      please cancel from your dashboard as soon as possible.
    </p>
    ` : `
    <p style="margin: 0; color: #4b5563; font-size: 14px; line-height: 1.6;">
      Please be prepared for this appointment tomorrow.
    </p>
    `}
  `;

  return baseTemplate(content, `Reminder: ${booking.service_name} appointment tomorrow`);
}

// ============================================
// CANCELLATION EMAIL
// ============================================
function bookingCancellation(booking, recipientType = 'customer', cancelledBy = 'customer') {
  const isCustomer = recipientType === 'customer';
  const greeting = isCustomer
    ? `Hi ${escapeHtml(booking.customer_name) || 'there'},`
    : `Hi ${escapeHtml(booking.therapist_name) || 'there'},`;

  const cancelMessage = cancelledBy === 'admin'
    ? 'This booking was cancelled by the spa administration.'
    : isCustomer
      ? 'Your booking has been cancelled as requested.'
      : 'The customer has cancelled this booking.';

  const content = `
    <h2 style="margin: 0 0 10px; color: #dc2626; font-size: 22px;">
      Booking Cancelled
    </h2>
    <p style="margin: 0 0 25px; color: #4b5563; font-size: 16px; line-height: 1.6;">
      ${greeting}<br>${cancelMessage}
    </p>
    
    <!-- Booking details card -->
    <div style="background-color: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 20px; margin-bottom: 25px;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
        ${detailRow('Service', booking.service_name)}
        ${detailRow('Date', formatDate(booking.booking_date))}
        ${detailRow('Time', `${formatTime(booking.start_time)} - ${formatTime(booking.end_time)}`)}
        ${isCustomer ? detailRow('Therapist', booking.therapist_name || 'N/A') : detailRow('Customer', booking.customer_name)}
        ${detailRow('Price', formatPrice(booking.service_price))}
      </table>
    </div>
    
    ${isCustomer ? `
    <p style="margin: 0; color: #4b5563; font-size: 14px; line-height: 1.6;">
      We're sorry to see this booking cancelled. If you'd like to book another appointment, 
      visit your dashboard to browse available times.
    </p>
    ` : `
    <p style="margin: 0; color: #4b5563; font-size: 14px; line-height: 1.6;">
      This time slot has been freed up and is now available for other bookings.
    </p>
    `}
  `;

  return baseTemplate(content, `Booking cancelled: ${booking.service_name}`);
}

export {
  bookingConfirmation,
  bookingReminder,
  bookingCancellation,
  formatDate,
  formatTime,
  formatPrice,
};