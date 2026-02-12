// src/jobs/scheduler.js
import cron from 'node-cron'
import { cleanupExpiredReservations } from './cleanupExpiredReservations.js'
import { sendDailyReminders } from './sendReminders.js'
import { parseIntSafe } from '../utils/validation.js'

/**
 * Scheduler for Background Jobs
 *
 * Manages all scheduled tasks using node-cron
 */

/**
 * Start cleanup job
 * Runs every 30 seconds (configurable via env)
 */
export function startCleanupJob() {
  const intervalSeconds = parseIntSafe(process.env.CLEANUP_JOB_INTERVAL_SECONDS, 30, 10, 300)

  // Cron expression: "*/30 * * * * *" means "every 30 seconds"
  // Format: second minute hour day month weekday
  const cronExpression = `*/${intervalSeconds} * * * * *`

  console.log(`\n⏰ Starting cleanup job: runs every ${intervalSeconds} seconds`)
  console.log(`   Cron expression: ${cronExpression}\n`)

  // Schedule the job
  const job = cron.schedule(cronExpression, async () => {
    const count = await cleanupExpiredReservations()
    
    if (count > 0) {
      console.log(`✨ Cleanup completed: ${count} expired reservation(s) removed\n`)
    }
    // Silent if nothing to clean (reduces log noise)
  }, {
    scheduled: true,
    timezone: process.env.TIMEZONE || "UTC"
  })

  // Run immediately on start (optional)
  console.log('🚀 Running initial cleanup...')
  cleanupExpiredReservations()
    .then(count => {
      if (count > 0) {
        console.log(`✨ Initial cleanup: ${count} expired reservation(s) removed\n`)
      } else {
        console.log('✨ Initial cleanup: No expired reservations\n')
      }
    })
    .catch(error => {
      console.error('❌ Initial cleanup failed:', error.message)
    })

  return job
}

/**
 * Start reminder job
 * Runs daily at 9:00 AM (configurable via env)
 * Sends 24-hour reminder emails for tomorrow's bookings
 */
export function startReminderJob() {
  const reminderHour = parseIntSafe(process.env.REMINDER_HOUR, 9, 0, 23)
  
  // Cron expression: "0 9 * * *" means "at 9:00 AM every day"
  // Format: minute hour day month weekday
  const cronExpression = `0 ${reminderHour} * * *`

  console.log(`📧 Starting reminder job: runs daily at ${reminderHour}:00`)
  console.log(`   Cron expression: ${cronExpression}\n`)

  const job = cron.schedule(cronExpression, async () => {
    console.log('[REMINDER JOB] Starting daily reminder check...')
    try {
      const result = await sendDailyReminders()
      if (result.success) {
        console.log(`📧 Reminder job completed: ${result.sent} reminder(s) sent\n`)
      } else {
        console.error('📧 Reminder job failed:', result.error)
      }
    } catch (error) {
      console.error('📧 Reminder job error:', error.message)
    }
  }, {
    scheduled: true,
    timezone: process.env.TIMEZONE || "UTC"
  })

  return job
}

/**
 * Stop a scheduled job (for graceful shutdown)
 */
export function stopJob(job) {
  if (job) {
    job.stop()
    console.log('⏸️  Job stopped')
  }
}

/**
 * Start all scheduled jobs
 * Returns an object with all job references for graceful shutdown
 */
export function startAllJobs() {
  const cleanupJob = startCleanupJob()
  const reminderJob = startReminderJob()

  return { cleanupJob, reminderJob }
}

/**
 * Stop all scheduled jobs (for graceful shutdown)
 */
export function stopAllJobs(jobs) {
  if (jobs.cleanupJob) {
    jobs.cleanupJob.stop()
    console.log('⏸️  Cleanup job stopped')
  }
  if (jobs.reminderJob) {
    jobs.reminderJob.stop()
    console.log('⏸️  Reminder job stopped')
  }
}