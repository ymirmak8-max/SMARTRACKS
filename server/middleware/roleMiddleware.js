// Usage: router.get('/admin-only', verifyToken, authorize('admin'), handler)
export const authorize = (...allowedRoles) => {
  return (req, res, next) => {
    const role = String(req.user?.role || '').trim().toLowerCase();
    if (req.user && (role === 'admin' || allowedRoles.includes(role))) {
      return next();
    }
    return res.status(403).json({
      message: allowedRoles.length === 1 && allowedRoles[0] === 'admin'
        ? 'Only an administrator can do this. Sign out, then sign in with the admin account.'
        : 'Access denied: insufficient permissions.',
    });
  };
};