/**
 * routes/me.js — GET /api/me · identidad de la sesión SSO.
 * Shape esperado por el frontend: { id, email, full_name, role, permissions }
 */
import { Router } from 'express';

const router = Router();

router.get('/', (req, res) => {
  res.json({
    id: req.user.user_id,
    email: req.user.email,
    full_name: req.user.full_name,
    role: req.user.app_role,
    permissions: req.user.permissions || [],
  });
});

export default router;
