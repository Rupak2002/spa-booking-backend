// src/services/emailService.js
import sgMail from '@sendgrid/mail'

sgMail.setApiKey(process.env.SENDGRID_API_KEY)

const FROM_EMAIL = process.env.SENDGRID_FROM_EMAIL
const FROM_NAME = process.env.SENDGRID_FROM_NAME || 'Serenity Spa'

/**
 * Send an email using SendGrid
 */
export async function sendEmail({ to, subject, html, text }) {
  if (!process.env.SENDGRID_API_KEY) {
    console.log('[EMAIL] SendGrid not configured, skipping email to:', to)
    console.log('[EMAIL] Subject:', subject)
    return false
  }

  const msg = {
    to,
    from: {
      email: FROM_EMAIL,
      name: FROM_NAME,
    },
    subject,
    html,
    text: text || stripHtml(html),
  }

  try {
    await sgMail.send(msg)
    console.log(`[EMAIL] Sent successfully to ${to}: "${subject}"`)
    return true
  } catch (error) {
    console.error('[EMAIL] Failed to send:', error.response?.body || error.message)
    return false
  }
}

/**
 * Basic HTML to plain text conversion
 */
function stripHtml(html) {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .trim()
}