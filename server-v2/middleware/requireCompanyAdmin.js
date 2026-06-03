function requireCompanyAdmin(req, res, next) {
  if (req.user?.role !== 'company_admin') {
    return res.status(403).json({ error: 'Company admin access required' });
  }
  next();
}

module.exports = requireCompanyAdmin;
