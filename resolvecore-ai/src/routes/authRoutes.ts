import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import express from 'express';
import { eq } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { ensureReferenceDataSeeded } from '../db/seed.ts';
import { departments, users } from '../db/schema.ts';
import {
  requireAuth,
  signSessionToken,
  type AuthRequest,
} from '../middleware/auth.ts';
import { writeAuditLog } from '../services/workflowService.ts';

const router = express.Router();

router.post('/register', async (req, res) => {
  try {
    await ensureReferenceDataSeeded();
    const { name, email, password, phone } = req.body ?? {};
    const cleanName = String(name || '').trim();
    const cleanEmail = String(email || '').trim().toLowerCase();
    const cleanPassword = String(password || '');

    if (cleanName.length < 2 || cleanName.length > 100) {
      return res.status(400).json({ error: 'Name must be between 2 and 100 characters.' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      return res.status(400).json({ error: 'Please provide a valid email address.' });
    }
    if (cleanPassword.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters long.' });
    }

    const existing = await db.select().from(users).where(eq(users.email, cleanEmail)).limit(1);
    if (existing.length > 0) {
      return res.status(409).json({ error: 'An account with this email already exists.' });
    }

    const passwordHash = await bcrypt.hash(cleanPassword, 10);
    const uid = `local_${crypto.randomUUID()}`;

    const [created] = await db
      .insert(users)
      .values({
        uid,
        email: cleanEmail,
        name: cleanName,
        phone: phone ? String(phone).trim().slice(0, 30) : null,
        passwordHash,
        role: 'USER',
        isActive: true,
      })
      .returning();

    await writeAuditLog({
      actorUserId: created.id,
      actorEmail: created.email,
      actorRole: created.role,
      action: 'USER_REGISTERED',
      entityType: 'user',
      entityId: created.id,
    });

    const token = signSessionToken({
      uid: created.uid,
      userId: created.id,
      email: created.email,
    });

    res.status(201).json({
      token,
      user: {
        id: created.id,
        uid: created.uid,
        email: created.email,
        name: created.name,
        phone: created.phone,
        role: created.role,
        departmentId: created.departmentId,
        avatarUrl: created.avatarUrl,
      },
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Failed to register user account.' });
  }
});

router.post('/login', async (req, res) => {
  try {
    await ensureReferenceDataSeeded();
    const { email, password } = req.body ?? {};
    const cleanEmail = String(email || '').trim().toLowerCase();
    const cleanPassword = String(password || '');

    if (!cleanEmail || !cleanPassword) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }

    const rows = await db.select().from(users).where(eq(users.email, cleanEmail)).limit(1);
    const userRow = rows[0];
    if (!userRow || !userRow.passwordHash) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    if (!userRow.isActive) {
      return res.status(403).json({ error: 'Account is deactivated. Contact an administrator.' });
    }

    const valid = await bcrypt.compare(cleanPassword, userRow.passwordHash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    let departmentName: string | null = null;
    if (userRow.departmentId) {
      const dept = await db
        .select({ name: departments.name })
        .from(departments)
        .where(eq(departments.id, userRow.departmentId))
        .limit(1);
      departmentName = dept[0]?.name ?? null;
    }

    const token = signSessionToken({
      uid: userRow.uid,
      userId: userRow.id,
      email: userRow.email,
    });

    await writeAuditLog({
      actorUserId: userRow.id,
      actorEmail: userRow.email,
      actorRole: userRow.role,
      action: 'USER_LOGIN',
      entityType: 'user',
      entityId: userRow.id,
    });

    res.json({
      token,
      user: {
        id: userRow.id,
        uid: userRow.uid,
        email: userRow.email,
        name: userRow.name,
        phone: userRow.phone,
        role: userRow.role,
        departmentId: userRow.departmentId,
        departmentName,
        avatarUrl: userRow.avatarUrl,
      },
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Authentication failed.' });
  }
});

router.get('/me', requireAuth, async (req: AuthRequest, res) => {
  try {
    await ensureReferenceDataSeeded();
    const user = req.dbUser!;
    let departmentName: string | null = null;
    if (user.departmentId) {
      const dept = await db
        .select({ name: departments.name })
        .from(departments)
        .where(eq(departments.id, user.departmentId))
        .limit(1);
      departmentName = dept[0]?.name ?? null;
    }
    res.json({
      user: {
        ...user,
        departmentName,
      },
    });
  } catch (error) {
    console.error('Fetch current user failed:', error);
    res.status(500).json({ error: 'Failed to load profile.' });
  }
});

export default router;
