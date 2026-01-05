function requireAuth(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'unauthenticated' });
  }
  next();
}

module.exports = { requireAuth };
