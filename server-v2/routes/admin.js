// Super-admin only routes — all require role: 'super_admin'
const router          = require('express').Router();
const { v4: uuidv4 } = require('uuid');
const db              = require('../db');
const { hashPassword }= require('../auth');

// GET /api/super/companies
router.get('/companies', (req, res) => {
  res.json(db.companies.getAll());
});

// POST /api/super/companies   body: { name }
router.post('/companies', (req, res) => {
  const { name } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'name required' });
  const result = db.companies.create(name.trim());
  res.status(201).json({ id: result.lastInsertRowid, name: name.trim() });
});

// DELETE /api/super/companies/:id
router.delete('/companies/:id', (req, res) => {
  db.companies.delete(req.params.id);
  res.json({ ok: true });
});

// POST /api/super/companies/:id/admins   body: { email, password, name? }
router.post('/companies/:id/admins', async (req, res) => {
  const company = db.companies.getById(req.params.id);
  if (!company) return res.status(404).json({ error: 'Company not found' });

  const { email, password, name } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'email and password required' });

  const hash   = await hashPassword(password);
  try {
    const result = db.users.create(company.id, email.trim().toLowerCase(), hash, 'company_admin', name || null);
    res.status(201).json({ id: result.lastInsertRowid, email, role: 'company_admin', companyId: company.id });
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(409).json({ error: 'Email already exists' });
    throw e;
  }
});

// GET /api/super/stats
router.get('/stats', (req, res) => {
  const companies = db.companies.getAll();
  res.json({ companies: companies.length });
});

module.exports = router;
