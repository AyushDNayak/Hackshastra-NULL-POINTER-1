import { and, desc, eq, inArray, lt, ne, sql } from 'drizzle-orm';
import { db } from '../db/index.ts';
import {
  aiAnalysisResults,
  auditLogs,
  complaintAssignments,
  complaintCategories,
  complaintStatusHistory,
  complaints,
  departments,
  notifications,
  slaConfigurations,
  staffMembers,
  users,
} from '../db/schema.ts';
import { broadcastComplaintEvent, broadcastToUser } from '../lib/wsServer.ts';
import type { DepartmentOption } from './aiAgents.ts';

export async function getDepartmentsWithStaffLoad(): Promise<DepartmentOption[]> {
  const deptRows = await db.select().from(departments).where(eq(departments.isActive, true));
  const staffRows = await db
    .select({
      staffId: staffMembers.id,
      departmentId: staffMembers.departmentId,
      title: staffMembers.title,
      specialization: staffMembers.specialization,
      maxActiveLoad: staffMembers.maxActiveLoad,
      isAvailable: staffMembers.isAvailable,
      name: users.name,
    })
    .from(staffMembers)
    .innerJoin(users, eq(staffMembers.userId, users.id));

  const activeCounts = await db
    .select({
      staffId: complaints.assignedStaffId,
      total: sql<number>`count(*)::int`,
    })
    .from(complaints)
    .where(inArray(complaints.status, ['SUBMITTED', 'AI_TRIAGED', 'ASSIGNED', 'ACCEPTED', 'IN_PROGRESS', 'AWAITING_INFO', 'ESCALATED', 'REOPENED']))
    .groupBy(complaints.assignedStaffId);

  const countMap = new Map<number, number>();
  for (const row of activeCounts) {
    if (row.staffId !== null) countMap.set(row.staffId, Number(row.total));
  }

  return deptRows.map((d) => ({
    id: d.id,
    name: d.name,
    code: d.code,
    responsibilities: d.responsibilities,
    staff: staffRows
      .filter((s) => s.departmentId === d.id)
      .map((s) => ({
        staffId: s.staffId,
        name: s.name,
        title: s.title,
        specialization: s.specialization,
        activeCount: countMap.get(s.staffId) ?? 0,
        maxActiveLoad: s.maxActiveLoad,
        isAvailable: s.isAvailable,
      })),
  }));
}

export async function generateTrackingCode(): Promise<string> {
  const year = new Date().getFullYear();
  const [{ maxId }] = await db
    .select({ maxId: sql<number>`coalesce(max(${complaints.id}), 0)::int` })
    .from(complaints);
  const nextSeq = String(Number(maxId) + 1).padStart(4, '0');
  const randomSuffix = Math.floor(10 + Math.random() * 89);
  return `CMP-${year}-${nextSeq}-${randomSuffix}`;
}

export async function createNotification(params: {
  userId: number;
  complaintId?: number | null;
  type: string;
  title: string;
  body: string;
}) {
  const [inserted] = await db
    .insert(notifications)
    .values({
      userId: params.userId,
      complaintId: params.complaintId ?? null,
      type: params.type,
      title: params.title,
      body: params.body,
      isRead: false,
    })
    .returning();

  broadcastToUser(params.userId, 'notification:new', inserted);
  return inserted;
}

export async function notifyDepartmentStaff(params: {
  departmentId: number;
  complaintId: number;
  type: string;
  title: string;
  body: string;
}) {
  const deptUsers = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.departmentId, params.departmentId), eq(users.role, 'STAFF'), eq(users.isActive, true)));

  for (const u of deptUsers) {
    await createNotification({
      userId: u.id,
      complaintId: params.complaintId,
      type: params.type,
      title: params.title,
      body: params.body,
    });
  }
}

export async function notifyAdmins(params: {
  complaintId: number;
  type: string;
  title: string;
  body: string;
}) {
  const adminUsers = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.role, 'ADMIN'), eq(users.isActive, true)));

  for (const admin of adminUsers) {
    await createNotification({
      userId: admin.id,
      complaintId: params.complaintId,
      type: params.type,
      title: params.title,
      body: params.body,
    });
  }
}

export async function writeAuditLog(params: {
  actorUserId?: number | null;
  actorEmail: string;
  actorRole: string;
  action: string;
  entityType: string;
  entityId: string | number;
  details?: Record<string, unknown>;
}) {
  await db.insert(auditLogs).values({
    actorUserId: params.actorUserId ?? null,
    actorEmail: params.actorEmail,
    actorRole: params.actorRole,
    action: params.action,
    entityType: params.entityType,
    entityId: String(params.entityId),
    details: params.details ?? {},
  });
}

export async function checkSlaEscalations(): Promise<number> {
  const now = new Date();
  const overdueRows = await db
    .select()
    .from(complaints)
    .where(
      and(
        eq(complaints.isEscalated, false),
        inArray(complaints.status, ['SUBMITTED', 'AI_TRIAGED', 'ASSIGNED', 'ACCEPTED', 'IN_PROGRESS', 'AWAITING_INFO', 'REOPENED']),
        lt(complaints.slaResolutionDueAt, now)
      )
    );

  if (overdueRows.length === 0) return 0;

  const slaRules = await db.select().from(slaConfigurations);
  const autoEscalateMap = new Map(slaRules.map((r) => [r.priority, r.autoEscalate]));

  let escalatedCount = 0;
  for (const item of overdueRows) {
    const shouldAutoEscalate = autoEscalateMap.get(item.priority) ?? true;
    if (!shouldAutoEscalate) continue;

    await db
      .update(complaints)
      .set({
        isEscalated: true,
        escalatedAt: now,
        status: item.status === 'SUBMITTED' || item.status === 'ASSIGNED' ? 'ESCALATED' : item.status,
        updatedAt: now,
      })
      .where(eq(complaints.id, item.id));

    await db.insert(complaintStatusHistory).values({
      complaintId: item.id,
      fromStatus: item.status,
      toStatus: 'ESCALATED',
      actorLabel: 'Agent 6: SLA Watchdog',
      note: `Automatic SLA breach escalation triggered after passing resolution deadline (${item.slaResolutionDueAt?.toISOString()}).`,
    });

    await notifyAdmins({
      complaintId: item.id,
      type: 'ESCALATION',
      title: `SLA Breach Escalation: ${item.trackingCode}`,
      body: `Complaint "${item.title}" (${item.priority}) exceeded its SLA resolution deadline and has been escalated.`,
    });

    if (item.departmentId) {
      await notifyDepartmentStaff({
        departmentId: item.departmentId,
        complaintId: item.id,
        type: 'ESCALATION',
        title: `Overdue SLA Alert: ${item.trackingCode}`,
        body: `"${item.title}" has exceeded SLA resolution window and requires immediate supervisor action.`,
      });
    }

    await writeAuditLog({
      actorEmail: 'sla-watchdog@resolvecore.ai',
      actorRole: 'SYSTEM',
      action: 'SLA_ESCALATED',
      entityType: 'complaint',
      entityId: item.id,
      details: { trackingCode: item.trackingCode, priority: item.priority },
    });

    broadcastComplaintEvent(item.userId, item.departmentId, 'complaint:updated', {
      complaintId: item.id,
      status: 'ESCALATED',
      isEscalated: true,
    });

    escalatedCount++;
  }

  return escalatedCount;
}

export async function getSlaDeadlinesForPriority(priority: string) {
  const rows = await db
    .select()
    .from(slaConfigurations)
    .where(eq(slaConfigurations.priority, priority))
    .limit(1);
  const rule = rows[0] || { responseHours: 24, resolutionHours: 72 };
  const now = Date.now();
  return {
    slaResponseDueAt: new Date(now + rule.responseHours * 3600 * 1000),
    slaResolutionDueAt: new Date(now + rule.resolutionHours * 3600 * 1000),
  };
}

export async function getRecentOpenComplaintsForDedup(excludeUserId?: number) {
  return db
    .select({
      id: complaints.id,
      trackingCode: complaints.trackingCode,
      title: complaints.title,
      categoryName: complaints.categoryName,
      location: complaints.location,
      status: complaints.status,
    })
    .from(complaints)
    .where(
      and(
        ne(complaints.status, 'CLOSED'),
        excludeUserId ? ne(complaints.userId, -1) : ne(complaints.id, -1)
      )
    )
    .orderBy(desc(complaints.createdAt))
    .limit(20);
}

export async function recordAgentAnalysisPipeline(params: {
  complaintId: number;
  analysis: Awaited<ReturnType<typeof import('./aiAgents.ts').analyzeComplaintIntake>>;
}) {
  const { complaintId, analysis } = params;
  const rowsToInsert = [
    {
      complaintId,
      agentName: 'UnderstandingAgent',
      modelUsed: analysis.modelUsed,
      isDemoMode: analysis.isDemoMode,
      detectedLanguage: analysis.understanding.detectedLanguage,
      extractedDetails: analysis.understanding.extractedDetails,
      followUpQuestions: analysis.understanding.followUpQuestions,
      duplicateCandidateIds: analysis.duplicateCandidateIds,
      confidenceScore: analysis.classification.confidenceScore,
    },
    {
      complaintId,
      agentName: 'ClassificationAgent',
      modelUsed: analysis.modelUsed,
      isDemoMode: analysis.isDemoMode,
      recommendedCategory: analysis.classification.categoryName,
      assignmentReasoning: analysis.classification.reasoning,
      confidenceScore: analysis.classification.confidenceScore,
    },
    {
      complaintId,
      agentName: 'PriorityAgent',
      modelUsed: analysis.modelUsed,
      isDemoMode: analysis.isDemoMode,
      recommendedPriority: analysis.priority.level,
      priorityReasoning: analysis.priority.reasoning,
      needsHumanIntervention: analysis.priority.level === 'CRITICAL',
    },
    {
      complaintId,
      agentName: 'AssignmentAgent',
      modelUsed: analysis.modelUsed,
      isDemoMode: analysis.isDemoMode,
      recommendedDepartment: analysis.assignment.departmentName,
      assignmentReasoning: analysis.assignment.reasoning,
    },
  ];

  await db.insert(aiAnalysisResults).values(rowsToInsert);
}
