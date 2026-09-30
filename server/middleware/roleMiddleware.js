export const authorize = (...allowedRoles) => {
  return (req, res, next) => {
    const role = String(req.user?.role || '').trim().toLowerCase();
    if (req.user && allowedRoles.includes(role)) return next();
    return res.status(403).json({ message: 'Access denied: insufficient permissions.' });
  };
};
