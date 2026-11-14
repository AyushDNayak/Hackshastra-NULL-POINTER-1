import crypto from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { eq } from 'drizzle-orm';
import { adminAuth } from '../lib/firebase-admin.ts';
import { db } from '../db/index.ts';
import { users } from '../db/schema.ts';

export type UserRole = 'USER' | 'STAFF' | 'ADMIN';

export interface AuthenticatedUser {
  id: number;
  uid: string;
  email: string;
  name: string;
  phone: string | null;
  role: UserRole;
  departmentId: number | null;
  avatarUrl: string | null;
  isActive: boolean;
}

export interface AuthRequest extends Request {
  dbUser?: AuthenticatedUser;
}

const SESSION_SECRET =
  process.env.SESSION_SECRET ||
  crypto.createHash('sha256').update(process.env.SQL_PASSWORD || 'resolvecore-session-key-v1').digest('hex');

interface SessionPayload {
  uid: string;
  userId: number;
  email: string;
  exp: number;
}

export function signSessionToken(payload: Omit<SessionPayload, 'exp'>): string {
  const fullPayload: SessionPayload = {
    ...payload,
    exp: Date.now() + 1000 * 60 * 60 * 24 * 7, // 7 days
  };
  const data = Buffer.from(JSON.stringify(fullPayload)).toString('base64url');
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(data).digest('base64url');
  return `rc_${data}.${sig}`;
}

export function verifySessionToken(token: string): SessionPayload | null {
  if (!token.startsWith('rc_')) return null;
  const raw = token.slice(3);
  const parts = raw.split('.');
  if (parts.length !== 2) return null;
  const [data, sig] = parts;
  const expectedSig = crypto.createHmac('sha256', SESSION_SECRET).update(data).digest('base64url');
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }
  try {
    const decoded = JSON.parse(Buffer.from(data, 'base64url').toString('utf8')) as SessionPayload;
    if (!decoded.exp || decoded.exp < Date.now()) return null;
    return decoded;
  } catch {
    return null;
  }
}

export async function getOrCreateFirebaseUser(
  uid: string,
  email: string,
  name?: string,
  avatarUrl?: string | null
): Promise<AuthenticatedUser> {
  try {
    const existingByEmail = await db.select().from(users).where(eq(users.email, email)).limit(1);
    if (existingByEmail.length > 0 && existingByEmail[0].uid !== uid) {
      const updated = await db
        .update(users)
        .set({
          uid,
          name: name || existingByEmail[0].name,
          avatarUrl: avatarUrl || existingByEmail[0].avatarUrl,
          updatedAt: new Date(),
        })
        .where(eq(users.id, existingByEmail[0].id))
        .returning();
      return toAuthenticatedUser(updated[0]);
    }

    const result = await db
      .insert(users)
      .values({
        uid,
        email,
        name: name || email.split('@')[0],
        role: 'USER',
        avatarUrl: avatarUrl || null,
      })
      .onConflictDoUpdate({
        target: users.uid,
        set: {
          email,
          updatedAt: new Date(),
        },
      })
      .returning();

    return toAuthenticatedUser(result[0]);
  } catch (error) {
    console.error('Database user upsert failed:', error);
    throw new Error('Failed to synchronize user account.', { cause: error });
  }
}

function toAuthenticatedUser(row: typeof users.$inferSelect): AuthenticatedUser {
  return {
    id: row.id,
    uid: row.uid,
    email: row.email,
    name: row.name,
    phone: row.phone,
    role: (row.role as UserRole) || 'USER',
    departmentId: row.departmentId,
    avatarUrl: row.avatarUrl,
    isActive: row.isActive,
  };
}

export async function authenticateTokenString(token: string): Promise<AuthenticatedUser | null> {
  if (!token) return null;

  // 1. Check server-signed session token
  if (token.startsWith('rc_')) {
    const payload = verifySessionToken(token);
    if (!payload) return null;
    const rows = await db.select().from(users).where(eq(users.id, payload.userId)).limit(1);
    if (rows.length === 0 || !rows[0].isActive) return null;
    return toAuthenticatedUser(rows[0]);
  }

  // 2. Verify Firebase ID token
  const decoded = await adminAuth.verifyIdToken(token);
  const email = decoded.email || `${decoded.uid}@firebase.local`;
  const dbUser = await getOrCreateFirebaseUser(
    decoded.uid,
    email,
    decoded.name || decoded.email?.split('@')[0],
    decoded.picture || null
  );
  if (!dbUser.isActive) return null;
  return dbUser;
}

export const requireAuth = async (req: AuthRequest, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized: Missing authentication token' });
  }

  const token = authHeader.split('Bearer ')[1];
  try {
    const user = await authenticateTokenString(token);
    if (!user) {
      return res.status(401).json({ error: 'Unauthorized: Invalid or expired session' });
    }
    req.dbUser = user;
    next();
  } catch (error) {
    console.error('Auth verification error:', error);
    return res.status(401).json({ error: 'Unauthorized: Authentication failed' });
  }
};

export const requireRole = (allowedRoles: UserRole[]) => {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.dbUser) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    if (!allowedRoles.includes(req.dbUser.role)) {
      return res.status(403).json({ error: 'Forbidden: Insufficient permissions for this action' });
    }
    next();
  };
};
