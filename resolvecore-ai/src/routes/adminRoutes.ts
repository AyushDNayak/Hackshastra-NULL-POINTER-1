import express from 'express';
import { desc, eq, sql } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { ensureReferenceDataSeeded } from '../db/seed.ts';
import {
  aiAnalysisResults,
  auditLogs,
  complaintAssignments,
  complaintCategories,
  complaintStatusHistory,
  complaints,
  departments,
  feedbackRatings,
  knowledgeBaseArticles,
  slaConfigurations,
  staffMembers,
  users,
} from '../db/schema.ts';
import { requireAuth, requireRole, type AuthRequest } from '../middleware/auth.ts';
import { generateAiInsightsReport } from '../services/aiAgents.ts';
import {
  checkSlaEscalations,
  createNotification,
  getSlaDeadlinesForPriority,
  notifyDepartmentStaff,
  writeAuditLog,
} from '../services/workflowService.ts';
import { broadcastComplaintEvent } from '../lib/wsServer.ts';

const router = express.Router();

router.use(requireAuth);

// Admin overview analytics (real PostgreSQL aggregations)
router.get('/analytics', requireRole(['ADMIN', 'STAFF']), async (_req, res) => {
  try {
    await ensureReferenceDataSeeded();
    await checkSlaEscalations();

    const [allComplaints, allDepts, allRatings] = await Promise.all([
      db.select().from(complaints).orderBy(desc(complaints.createdAt)),
      db.select().from(departments),
      db.select().from(feedbackRatings),
    ]);

    const total = allComplaints.length;
    const resolved = allComplaints.filter((c) => c.status === 'RESOLVED' || c.status === 'CLOSED').length;
    const pending = allComplaints.filter((c) =>
      ['SUBMITTED', 'AI_TRIAGED', 'ASSIGNED', 'AWAITING_INFO', 'REOPENED'].includes(c.status)
    ).length;
    const inProgress = allComplaints.filter((c) => c.status === 'ACCEPTED' || c.status === 'IN_PROGRESS').length;
    const critical = allComplaints.filter((c) => c.priority === 'CRITICAL').length;
    const escalated = allComplaints.filter((c) => c.isEscalated).length;

    const resolvedWithDuration = allComplaints.filter((c) => c.resolvedAt && c.createdAt);
    const avgResolutionHours =
      resolvedWithDuration.length > 0
        ? Number(
            (
              resolvedWithDuration.reduce((sum, c) => {
                const diff = (new Date(c.resolvedAt!).getTime() - new Date(c.createdAt).getTime()) / 3600000;
                return sum + Math.max(0.1, diff);
              }, 0) / resolvedWithDuration.length
            ).toFixed(1)
          )
        : 0;

    const slaCompliantCount = allComplaints.filter((c) => {
      if (c.isEscalated) return false;
      if (c.resolvedAt && c.slaResolutionDueAt) {
        return new Date(c.resolvedAt).getTime() <= new Date(c.slaResolutionDueAt).getTime();
      }
      return !c.slaResolutionDueAt || new Date(c.slaResolutionDueAt).getTime() >= Date.now();
    }).length;
    const slaComplianceRate = total > 0 ? Math.round((slaCompliantCount / total) * 100) : 100;

    const avgRating =
      allRatings.length > 0
        ? Number((allRatings.reduce((s, r) => s + r.rating, 0) / allRatings.length).toFixed(2))
        : 0;

    // Distributions
    const categoryMap = new Map<string, number>();
    const priorityMap = new Map<string, number>([
      ['CRITICAL', 0],
      ['HIGH', 0],
      ['MEDIUM', 0],
      ['LOW', 0],
    ]);
    const sentimentMap = new Map<string, number>();
    const dailyMap = new Map<string, { date: string; submitted: number; resolved: number }>();

    for (const c of allComplaints) {
      categoryMap.set(c.categoryName, (categoryMap.get(c.categoryName) ?? 0) + 1);
      priorityMap.set(c.priority, (priorityMap.get(c.priority) ?? 0) + 1);
      const sent = c.sentiment || 'NEUTRAL';
      sentimentMap.set(sent, (sentimentMap.get(sent) ?? 0) + 1);

      const day = new Date(c.createdAt).toISOString().slice(0, 10);
      if (!dailyMap.has(day)) dailyMap.set(day, { date: day, submitted: 0, resolved: 0 });
      dailyMap.get(day)!.submitted += 1;
      if (c.resolvedAt) {
        const resDay = new Date(c.resolvedAt).toISOString().slice(0, 10);
        if (!dailyMap.has(resDay)) dailyMap.set(resDay, { date: resDay, submitted: 0, resolved: 0 });
        dailyMap.get(resDay)!.resolved += 1;
      }
    }

    const departmentPerformance = allDepts.map((d) => {
      const deptItems = allComplaints.filter((c) => c.departmentId === d.id);
      const deptResolved = deptItems.filter((c) => c.status === 'RESOLVED' || c.status === 'CLOSED').length;
      const deptEscalated = deptItems.filter((c) => c.isEscalated).length;
      return {
        id: d.id,
        name: d.name,
        code: d.code,
        total: deptItems.length,
        resolved: deptResolved,
        escalated: deptEscalated,
        resolutionRate: deptItems.length > 0 ? Math.round((deptResolved / deptItems.length) * 100) : 0,
      };
    });

    res.json({
      kpis: {
        total,
        resolved,
        pending,
        inProgress,
        critical,
        escalated,
        avgResolutionHours,
        slaComplianceRate,
        avgRating,
        totalRatings: allRatings.length,
      },
      categoryDistribution: Array.from(categoryMap.entries()).map(([name, count]) => ({ name, count })),
      priorityDistribution: Array.from(priorityMap.entries()).map(([priority, count]) => ({ priority, count })),
      sentimentDistribution: Array.from(sentimentMap.entries()).map(([sentiment, count]) => ({ sentiment, count })),
      trends: Array.from(dailyMap.values()).sort((a, b) => a.date.localeCompare(b.date)),
      departmentPerformance,
    });
  } catch (error) {
    console.error('Admin analytics failed:', error);
    res.status(500).json({ error: 'Failed to generate analytics.' });
  }
});

// AI Insights page endpoint (clearly separates recorded metrics from AI predictions)
router.get('/ai-insights', requireRole(['ADMIN', 'STAFF']), async (_req, res) => {
  try {
    await ensureReferenceDataSeeded();
    const [allComplaints, allDepts, recentAiLogs] = await Promise.all([
      db.select().from(complaints).orderBy(desc(complaints.createdAt)),
      db.select().from(departments),
      db.select().from(aiAnalysisResults).orderBy(desc(aiAnalysisResults.createdAt)).limit(30),
    ]);

    const categoryMap = new Map<string, number>();
    const priorityMap = new Map<string, number>();
    const sentimentMap = new Map<string, number>();

    for (const c of allComplaints) {
      categoryMap.set(c.categoryName, (categoryMap.get(c.categoryName) ?? 0) + 1);
      priorityMap.set(c.priority, (priorityMap.get(c.priority) ?? 0) + 1);
      const sent = c.sentiment || 'NEUTRAL';
      sentimentMap.set(sent, (sentimentMap.get(sent) ?? 0) + 1);
    }

    const departmentMetrics = allDepts.map((d) => {
      const items = allComplaints.filter((c) => c.departmentId === d.id);
      return {
        name: d.name,
        total: items.length,
        resolved: items.filter((c) => c.status === 'RESOLVED' || c.status === 'CLOSED').length,
        escalated: items.filter((c) => c.isEscalated).length,
      };
    });

    const insights = await generateAiInsightsReport({
      totalComplaints: allComplaints.length,
      categoryCounts: Array.from(categoryMap.entries()).map(([name, count]) => ({ name, count })),
      priorityCounts: Array.from(priorityMap.entries()).map(([priority, count]) => ({ priority, count })),
      sentimentCounts: Array.from(sentimentMap.entries()).map(([sentiment, count]) => ({ sentiment, count })),
      departmentMetrics,
      recentTitles: allComplaints.slice(0, 15).map((c) => c.title),
    });

    const overrideCount = recentAiLogs.filter((l) => l.overriddenByAdmin).length;

    res.json({
      recordedFacts: {
        totalComplaints: allComplaints.length,
        topCategories: Array.from(categoryMap.entries())
          .map(([name, count]) => ({ name, count }))
          .sort((a, b) => b.count - a.count),
        sentimentBreakdown: Array.from(sentimentMap.entries()).map(([sentiment, count]) => ({
          sentiment,
          count,
        })),
        departmentMetrics,
        aiDecisionsLogged: recentAiLogs.length,
        adminOverrides: overrideCount,
      },
      aiPredictions: insights,
    });
  } catch (error) {
    console.error('AI Insights failed:', error);
    res.status(500).json({ error: 'Failed to generate AI insights.' });
  }
});

// Admin override AI classification, priority, or department assignment
router.post('/complaints/:id/override', requireRole(['ADMIN']), async (req: AuthRequest, res) => {
  try {
    const admin = req.dbUser!;
    const complaintId = Number(req.params.id);
    const { categoryName, priority, departmentId, staffMemberId, overrideReason } = req.body ?? {};
    const reason = String(overrideReason || '').trim();
    if (reason.length < 4) {
      return res.status(400).json({ error: 'Please specify an override reason for the audit log.' });
    }

    const [existing] = await db.select().from(complaints).where(eq(complaints.id, complaintId)).limit(1);
    if (!existing) return res.status(404).json({ error: 'Complaint not found.' });

    const newPriority = priority || existing.priority;
    const newCategory = categoryName || existing.categoryName;
    const newDeptId = departmentId ? Number(departmentId) : existing.departmentId;
    const newStaffId = staffMemberId !== undefined ? (staffMemberId ? Number(staffMemberId) : null) : existing.assignedStaffId;
    const deadlines = priority && priority !== existing.priority ? await getSlaDeadlinesForPriority(newPriority) : null;

    await db
      .update(complaints)
      .set({
        categoryName: newCategory,
        priority: newPriority,
        departmentId: newDeptId,
        assignedStaffId: newStaffId,
        status: existing.status === 'ESCALATED' && newDeptId ? 'ASSIGNED' : existing.status,
        slaResponseDueAt: deadlines ? deadlines.slaResponseDueAt : existing.slaResponseDueAt,
        slaResolutionDueAt: deadlines ? deadlines.slaResolutionDueAt : existing.slaResolutionDueAt,
        updatedAt: new Date(),
      })
      .where(eq(complaints.id, complaintId));

    // Mark latest AI records as overridden
    await db
      .update(aiAnalysisResults)
      .set({ overriddenByAdmin: true, overrideReason: reason })
      .where(eq(aiAnalysisResults.complaintId, complaintId));

    if (newDeptId && newDeptId !== existing.departmentId) {
      await db.insert(complaintAssignments).values({
        complaintId,
        departmentId: newDeptId,
        staffMemberId: newStaffId,
        assignedBy: 'ADMIN',
        status: 'PENDING',
        decisionReason: reason,
      });

      await notifyDepartmentStaff({
        departmentId: newDeptId,
        complaintId,
        type: 'ASSIGNED',
        title: `Admin Reassigned: ${existing.trackingCode}`,
        body: `"${existing.title}" was reassigned to your department by ${admin.name}.`,
      });
    }

    await db.insert(complaintStatusHistory).values({
      complaintId,
      fromStatus: existing.status,
      toStatus: existing.status === 'ESCALATED' && newDeptId ? 'ASSIGNED' : existing.status,
      changedByUserId: admin.id,
      actorLabel: `${admin.name} (Admin Override)`,
      note: `Admin override applied (${newCategory} / ${newPriority}): ${reason}`,
    });

    await createNotification({
      userId: existing.userId,
      complaintId,
      type: 'STATUS_CHANGE',
      title: `Complaint Routing Updated: ${existing.trackingCode}`,
      body: `An administrator reviewed and updated your complaint routing (${newPriority} priority).`,
    });

    await writeAuditLog({
      actorUserId: admin.id,
      actorEmail: admin.email,
      actorRole: admin.role,
      action: 'ADMIN_OVERRIDE',
      entityType: 'complaint',
      entityId: complaintId,
      details: { categoryName: newCategory, priority: newPriority, departmentId: newDeptId, reason },
    });

    broadcastComplaintEvent(existing.userId, newDeptId, 'complaint:updated', { complaintId });
    res.json({ ok: true });
  } catch (error) {
    console.error('Admin override failed:', error);
    res.status(500).json({ error: 'Failed to override complaint routing.' });
  }
});

// Manage users & roles
router.get('/users', requireRole(['ADMIN']), async (_req, res) => {
  try {
    const rows = await db
      .select({
        id: users.id,
        uid: users.uid,
        email: users.email,
        name: users.name,
        phone: users.phone,
        role: users.role,
        departmentId: users.departmentId,
        departmentName: departments.name,
        isActive: users.isActive,
        createdAt: users.createdAt,
      })
      .from(users)
      .leftJoin(departments, eq(users.departmentId, departments.id))
      .orderBy(desc(users.createdAt));
    res.json({ users: rows });
  } catch (error) {
    console.error('List users failed:', error);
    res.status(500).json({ error: 'Failed to load users.' });
  }
});

router.patch('/users/:id', requireRole(['ADMIN']), async (req: AuthRequest, res) => {
  try {
    const admin = req.dbUser!;
    const targetId = Number(req.params.id);
    const { role, departmentId, isActive } = req.body ?? {};

    const [target] = await db.select().from(users).where(eq(users.id, targetId)).limit(1);
    if (!target) return res.status(404).json({ error: 'User not found.' });

    const nextRole = role && ['USER', 'STAFF', 'ADMIN'].includes(role) ? role : target.role;
    const nextDeptId =
      nextRole === 'STAFF'
        ? departmentId !== undefined
          ? Number(departmentId) || null
          : target.departmentId
        : null;
    const nextActive = typeof isActive === 'boolean' ? isActive : target.isActive;

    await db
      .update(users)
      .set({
        role: nextRole,
        departmentId: nextDeptId,
        isActive: nextActive,
        updatedAt: new Date(),
      })
      .where(eq(users.id, targetId));

    if (nextRole === 'STAFF' && nextDeptId) {
      await db
        .insert(staffMembers)
        .values({
          userId: targetId,
          departmentId: nextDeptId,
          title: 'Department Resolution Specialist',
          specialization: 'General Department Triage',
          maxActiveLoad: 10,
          isAvailable: true,
        })
        .onConflictDoUpdate({
          target: staffMembers.userId,
          set: { departmentId: nextDeptId },
        });
    }

    await writeAuditLog({
      actorUserId: admin.id,
      actorEmail: admin.email,
      actorRole: admin.role,
      action: 'USER_ROLE_UPDATED',
      entityType: 'user',
      entityId: targetId,
      details: { role: nextRole, departmentId: nextDeptId, isActive: nextActive },
    });

    res.json({ ok: true });
  } catch (error) {
    console.error('Update user failed:', error);
    res.status(500).json({ error: 'Failed to update user.' });
  }
});

// Create new department
router.post('/departments', requireRole(['ADMIN']), async (req: AuthRequest, res) => {
  try {
    const admin = req.dbUser!;
    const { name, code, description, responsibilities, leadEmail } = req.body ?? {};
    if (!name || !code || !responsibilities) {
      return res.status(400).json({ error: 'Department name, code, and responsibilities are required.' });
    }
    const [created] = await db
      .insert(departments)
      .values({
        name: String(name).trim(),
        code: String(code).trim().toUpperCase().slice(0, 12),
        description: String(description || responsibilities).trim(),
        responsibilities: String(responsibilities).trim(),
        leadEmail: leadEmail ? String(leadEmail).trim() : null,
      })
      .returning();

    await writeAuditLog({
      actorUserId: admin.id,
      actorEmail: admin.email,
      actorRole: admin.role,
      action: 'DEPARTMENT_CREATED',
      entityType: 'department',
      entityId: created.id,
      details: { name: created.name, code: created.code },
    });

    res.status(201).json({ department: created });
  } catch (error) {
    console.error('Create department failed:', error);
    res.status(500).json({ error: 'Failed to create department (name or code may already exist).' });
  }
});

// Create new complaint category
router.post('/categories', requireRole(['ADMIN']), async (req: AuthRequest, res) => {
  try {
    const admin = req.dbUser!;
    const { name, description, defaultDepartmentId } = req.body ?? {};
    if (!name || !description) {
      return res.status(400).json({ error: 'Category name and description are required.' });
    }
    const [created] = await db
      .insert(complaintCategories)
      .values({
        name: String(name).trim(),
        description: String(description).trim(),
        defaultDepartmentId: defaultDepartmentId ? Number(defaultDepartmentId) : null,
        isSystem: false,
        isActive: true,
      })
      .returning();

    await writeAuditLog({
      actorUserId: admin.id,
      actorEmail: admin.email,
      actorRole: admin.role,
      action: 'CATEGORY_CREATED',
      entityType: 'category',
      entityId: created.id,
      details: { name: created.name },
    });

    res.status(201).json({ category: created });
  } catch (error) {
    console.error('Create category failed:', error);
    res.status(500).json({ error: 'Failed to create category.' });
  }
});

// Update SLA configuration
router.patch('/sla/:priority', requireRole(['ADMIN']), async (req: AuthRequest, res) => {
  try {
    const admin = req.dbUser!;
    const priority = String(req.params.priority).toUpperCase();
    const { responseHours, resolutionHours, autoEscalate } = req.body ?? {};

    await db
      .update(slaConfigurations)
      .set({
        responseHours: Math.max(1, Number(responseHours || 4)),
        resolutionHours: Math.max(1, Number(resolutionHours || 24)),
        autoEscalate: Boolean(autoEscalate),
        updatedAt: new Date(),
      })
      .where(eq(slaConfigurations.priority, priority));

    await writeAuditLog({
      actorUserId: admin.id,
      actorEmail: admin.email,
      actorRole: admin.role,
      action: 'SLA_UPDATED',
      entityType: 'sla_configuration',
      entityId: priority,
      details: { responseHours, resolutionHours, autoEscalate },
    });

    res.json({ ok: true });
  } catch (error) {
    console.error('SLA update failed:', error);
    res.status(500).json({ error: 'Failed to update SLA configuration.' });
  }
});

// Manual SLA watchdog trigger
router.post('/run-sla-check', requireRole(['ADMIN']), async (_req, res) => {
  try {
    const escalatedCount = await checkSlaEscalations();
    res.json({ escalatedCount });
  } catch (error) {
    console.error('SLA check failed:', error);
    res.status(500).json({ error: 'SLA watchdog execution failed.' });
  }
});

// Audit logs & AI decision monitor
router.get('/audit-logs', requireRole(['ADMIN']), async (_req, res) => {
  try {
    const [logs, aiLogs] = await Promise.all([
      db.select().from(auditLogs).orderBy(desc(auditLogs.createdAt)).limit(100),
      db
        .select({
          id: aiAnalysisResults.id,
          complaintId: aiAnalysisResults.complaintId,
          trackingCode: complaints.trackingCode,
          agentName: aiAnalysisResults.agentName,
          modelUsed: aiAnalysisResults.modelUsed,
          isDemoMode: aiAnalysisResults.isDemoMode,
          recommendedCategory: aiAnalysisResults.recommendedCategory,
          recommendedPriority: aiAnalysisResults.recommendedPriority,
          recommendedDepartment: aiAnalysisResults.recommendedDepartment,
          confidenceScore: aiAnalysisResults.confidenceScore,
          overriddenByAdmin: aiAnalysisResults.overriddenByAdmin,
          overrideReason: aiAnalysisResults.overrideReason,
          createdAt: aiAnalysisResults.createdAt,
        })
        .from(aiAnalysisResults)
        .leftJoin(complaints, eq(aiAnalysisResults.complaintId, complaints.id))
        .orderBy(desc(aiAnalysisResults.createdAt))
        .limit(80),
    ]);
    res.json({ auditLogs: logs, aiDecisions: aiLogs });
  } catch (error) {
    console.error('Audit logs fetch failed:', error);
    res.status(500).json({ error: 'Failed to fetch audit logs.' });
  }
});

// Knowledge Base list & create
router.get('/knowledge-base', requireRole(['ADMIN', 'STAFF']), async (_req, res) => {
  try {
    const articles = await db
      .select()
      .from(knowledgeBaseArticles)
      .orderBy(desc(knowledgeBaseArticles.createdAt));
    res.json({ articles });
  } catch (error) {
    console.error('KB fetch failed:', error);
    res.status(500).json({ error: 'Failed to load knowledge base.' });
  }
});

// Downloadable CSV report
router.get('/export-report', requireRole(['ADMIN', 'STAFF']), async (req: AuthRequest, res) => {
  try {
    const user = req.dbUser!;
    const rows = await db
      .select({
        trackingCode: complaints.trackingCode,
        title: complaints.title,
        category: complaints.categoryName,
        priority: complaints.priority,
        status: complaints.status,
        department: departments.name,
        sentiment: complaints.sentiment,
        isEscalated: complaints.isEscalated,
        createdAt: complaints.createdAt,
        resolvedAt: complaints.resolvedAt,
      })
      .from(complaints)
      .leftJoin(departments, eq(complaints.departmentId, departments.id))
      .where(user.role === 'STAFF' && user.departmentId ? eq(complaints.departmentId, user.departmentId) : undefined)
      .orderBy(desc(complaints.createdAt));

    const header = [
      'Tracking ID',
      'Title',
      'Category',
      'Priority',
      'Status',
      'Department',
      'Sentiment',
      'Escalated',
      'Submitted At',
      'Resolved At',
    ];
    const escapeCsv = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const csvLines = [
      header.join(','),
      ...rows.map((r) =>
        [
          r.trackingCode,
          r.title,
          r.category,
          r.priority,
          r.status,
          r.department || 'Unassigned',
          r.sentiment || '',
          r.isEscalated ? 'Yes' : 'No',
          r.createdAt?.toISOString() || '',
          r.resolvedAt?.toISOString() || '',
        ]
          .map(escapeCsv)
          .join(',')
      ),
    ];

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="resolvecore-complaints-report.csv"');
    res.send(csvLines.join('\n'));
  } catch (error) {
    console.error('CSV export failed:', error);
    res.status(500).json({ error: 'Failed to export report.' });
  }
});

export default router;
