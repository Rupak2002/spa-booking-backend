import cron from 'node-cron'
import { cleanupExpiredReservations } from './cleanupExpiredReservations.js'

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
  const intervalSeconds = parseInt(process.env.CLEANUP_JOB_INTERVAL_SECONDS) || 30

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
    timezone: "America/New_York" // Adjust to your timezone
  })

  // Run immediately on start (optional)
  console.log('🚀 Running initial cleanup...')
  cleanupExpiredReservations().then(count => {
    if (count > 0) {
      console.log(`✨ Initial cleanup: ${count} expired reservation(s) removed\n`)
    } else {
      console.log('✨ Initial cleanup: No expired reservations\n')
    }
  })

  return job
}

/**
 * Stop cleanup job (for graceful shutdown)
 */
export function stopCleanupJob(job) {
  if (job) {
    job.stop()
    console.log('⏸️  Cleanup job stopped')
  }
}