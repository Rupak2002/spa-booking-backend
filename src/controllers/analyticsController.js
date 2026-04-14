import supabase from '../config/supabase.js'
import { errorResponse } from '../utils/response.js'
import { isValidDateFormat } from '../utils/validation.js'

/**
 * Get dashboard analytics for admin
 *
 * Query params:
 * - start_date (YYYY-MM-DD, default: 30 days ago)
 * - end_date (YYYY-MM-DD, default: today)
 */
export const getDashboardAnalytics = async (req, res) => {
  try {
    const { start_date, end_date } = req.query

    // Default date range: last 30 days
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const thirtyDaysAgo = new Date(today)
    thirtyDaysAgo.setDate(today.getDate() - 30)

    const startDate = start_date || thirtyDaysAgo.toISOString().split('T')[0]
    const endDate = end_date || today.toISOString().split('T')[0]

    // Validate date formats
    if (!isValidDateFormat(startDate)) {
      return errorResponse(res, 400, 'Invalid start_date format (expected YYYY-MM-DD)')
    }
    if (!isValidDateFormat(endDate)) {
      return errorResponse(res, 400, 'Invalid end_date format (expected YYYY-MM-DD)')
    }

    // Calculate previous period for comparison
    const start = new Date(startDate)
    const end = new Date(endDate)
    const rangeDays = Math.ceil((end - start) / (1000 * 60 * 60 * 24))
    const prevStart = new Date(start)
    prevStart.setDate(start.getDate() - rangeDays)
    const prevEnd = new Date(start)
    prevEnd.setDate(start.getDate() - 1)

    const prevStartDate = prevStart.toISOString().split('T')[0]
    const prevEndDate = prevEnd.toISOString().split('T')[0]

    // Fetch all bookings in current period
    const { data: currentBookings, error: currentError } = await supabase
      .from('bookings')
      .select(`
        *,
        customer:profiles!bookings_customer_id_fkey(id, full_name, created_at),
        therapist:therapists!bookings_therapist_id_fkey(
          id,
          profile:profiles!therapists_user_id_fkey(full_name)
        )
      `)
      .gte('booking_date', startDate)
      .lte('booking_date', endDate)

    if (currentError) {
      console.error('Fetch current bookings error:', currentError)
      return errorResponse(res, 500, 'Failed to fetch analytics data')
    }

    // Fetch previous period bookings for comparison
    const { data: previousBookings, error: previousError } = await supabase
      .from('bookings')
      .select('*')
      .gte('booking_date', prevStartDate)
      .lte('booking_date', prevEndDate)

    if (previousError) {
      console.error('Fetch previous bookings error:', previousError)
      return errorResponse(res, 500, 'Failed to fetch comparison data')
    }

    // Calculate summary metrics
    const confirmedOrCompleted = currentBookings.filter(b =>
      ['confirmed', 'completed'].includes(b.status)
    )

    const totalRevenue = confirmedOrCompleted.reduce((sum, b) =>
      sum + (parseFloat(b.service_price) || 0), 0
    )

    const totalBookings = currentBookings.length
    const completedBookings = currentBookings.filter(b => b.status === 'completed').length
    const cancelledBookings = currentBookings.filter(b => b.status === 'cancelled').length
    const cancellationRate = totalBookings > 0 ? (cancelledBookings / totalBookings) * 100 : 0

    // Count new customers (profiles created in date range)
    const { data: newCustomersData, error: customersError } = await supabase
      .from('profiles')
      .select('id')
      .eq('role', 'customer')
      .gte('created_at', `${startDate}T00:00:00Z`)
      .lte('created_at', `${endDate}T23:59:59Z`)

    if (customersError) {
      console.error('Fetch new customers error:', customersError)
    }

    const newCustomers = newCustomersData?.length || 0

    // Previous period comparison
    const prevConfirmedOrCompleted = previousBookings.filter(b =>
      ['confirmed', 'completed'].includes(b.status)
    )
    const prevTotalRevenue = prevConfirmedOrCompleted.reduce((sum, b) =>
      sum + (parseFloat(b.service_price) || 0), 0
    )
    const prevTotalBookings = previousBookings.length

    // Revenue by day
    const revenueByDay = {}
    confirmedOrCompleted.forEach(booking => {
      const date = booking.booking_date
      if (!revenueByDay[date]) {
        revenueByDay[date] = 0
      }
      revenueByDay[date] += parseFloat(booking.service_price) || 0
    })

    const revenueByDayArray = Object.keys(revenueByDay)
      .sort()
      .map(date => ({
        date,
        revenue: parseFloat(revenueByDay[date].toFixed(2))
      }))

    // Bookings by day (all statuses)
    const bookingsByDay = {}
    currentBookings.forEach(booking => {
      const date = booking.booking_date
      bookingsByDay[date] = (bookingsByDay[date] || 0) + 1
    })

    const bookingsByDayArray = Object.keys(bookingsByDay)
      .sort()
      .map(date => ({
        date,
        count: bookingsByDay[date]
      }))

    // Bookings by service
    const bookingsByService = {}
    confirmedOrCompleted.forEach(booking => {
      const service = booking.service_name
      if (!bookingsByService[service]) {
        bookingsByService[service] = { count: 0, revenue: 0 }
      }
      bookingsByService[service].count++
      bookingsByService[service].revenue += parseFloat(booking.service_price) || 0
    })

    const bookingsByServiceArray = Object.keys(bookingsByService)
      .map(service => ({
        service_name: service,
        count: bookingsByService[service].count,
        revenue: parseFloat(bookingsByService[service].revenue.toFixed(2))
      }))
      .sort((a, b) => b.count - a.count)

    // Bookings by therapist
    const bookingsByTherapist = {}
    confirmedOrCompleted.forEach(booking => {
      const therapist = booking.therapist?.profile?.full_name || 'Unknown'
      if (!bookingsByTherapist[therapist]) {
        bookingsByTherapist[therapist] = { count: 0, revenue: 0 }
      }
      bookingsByTherapist[therapist].count++
      bookingsByTherapist[therapist].revenue += parseFloat(booking.service_price) || 0
    })

    const bookingsByTherapistArray = Object.keys(bookingsByTherapist)
      .map(therapist => ({
        therapist_name: therapist,
        count: bookingsByTherapist[therapist].count,
        revenue: parseFloat(bookingsByTherapist[therapist].revenue.toFixed(2))
      }))
      .sort((a, b) => b.count - a.count)

    // Peak hours analysis (day of week + hour)
    const peakHours = {}
    confirmedOrCompleted.forEach(booking => {
      const bookingDateTime = new Date(`${booking.booking_date}T${booking.start_time}`)
      const day = bookingDateTime.getDay() // 0-6 (Sunday-Saturday)
      const hour = parseInt(booking.start_time.split(':')[0], 10) // Extract hour from HH:MM

      const key = `${day}-${hour}`
      peakHours[key] = (peakHours[key] || 0) + 1
    })

    const peakHoursArray = Object.keys(peakHours)
      .map(key => {
        const [day, hour] = key.split('-').map(Number)
        return { day, hour, count: peakHours[key] }
      })
      .sort((a, b) => b.count - a.count)

    res.json({
      success: true,
      data: {
        summary: {
          totalRevenue: parseFloat(totalRevenue.toFixed(2)),
          totalBookings,
          completedBookings,
          cancelledBookings,
          cancellationRate: parseFloat(cancellationRate.toFixed(2)),
          newCustomers,
          previousPeriod: {
            totalRevenue: parseFloat(prevTotalRevenue.toFixed(2)),
            totalBookings: prevTotalBookings
          }
        },
        revenueByDay: revenueByDayArray,
        bookingsByDay: bookingsByDayArray,
        bookingsByService: bookingsByServiceArray,
        bookingsByTherapist: bookingsByTherapistArray,
        peakHours: peakHoursArray
      }
    })

  } catch (error) {
    console.error('Dashboard analytics error:', error)
    return errorResponse(res, 500, 'Failed to generate analytics')
  }
}
