import supabase from '../config/supabase.js'

/**
 * Authentication Middleware
 *
 * Verifies JWT token from Supabase and attaches user info to request
 *
 * Flow:
 * 1. Extract token from Authorization header
 * 2. Verify token with Supabase Auth
 * 3. Fetch user profile from database (includes role)
 * 4. Attach user data to req.user and req.profile
 * 5. Allow request to proceed to route handler
 */
export const authenticate = async (req, res, next) => {
  try {
    // 1. Get token from header
    const authHeader = req.headers.authorization

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        error: 'No token provided. Please login.'
      })
    }

    const token = authHeader.substring(7) // Remove 'Bearer ' prefix

    // 2. Verify token with Supabase Auth
    const { data: { user }, error: authError } = await supabase.auth.getUser(token)

    if (authError || !user) {
      return res.status(401).json({
        success: false,
        error: 'Invalid or expired token. Please login again.'
      })
    }

    // 3. Fetch user profile (includes role: customer/therapist/admin)
    const { data: profile, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .single()

    if (error || !profile) {
      return res.status(401).json({
        success: false,
        error: 'User profile not found.'
      })
    }

    // 4. Attach to request object (accessible in route handlers)
    req.user = {
      id: user.id,
      email: user.email
    }
    req.profile = profile

    // 5. Proceed to next middleware/route handler
    next()

  } catch (error) {
    console.error('Auth middleware error:', error)
    res.status(500).json({
      success: false,
      error: 'Authentication failed.'
    })
  }
}

/**
 * Role-based Access Control Middleware
 * 
 * Usage: requireRole('admin') or requireRole('therapist', 'admin')
 * 
 * Checks if authenticated user has one of the required roles
 */
export const requireRole = (...allowedRoles) => {
  return (req, res, next) => {
    // Must run after authenticate middleware
    if (!req.profile) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required.'
      })
    }

    // Check if user's role is in allowed roles
    if (!allowedRoles.includes(req.profile.role)) {
      return res.status(403).json({
        success: false,
        error: `Access denied. Required role: ${allowedRoles.join(' or ')}`
      })
    }

    next()
  }
}