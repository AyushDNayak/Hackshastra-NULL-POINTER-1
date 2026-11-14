import express from 'express';
import { and, desc, eq, ilike, inArray, or, sql } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { ensureReferenceDataSeeded } from '../db/seed.ts';
import {
  aiAnalysisResults,
  attachments,
  complaintAssignments,
  complaintCategories,
  complaintMessages,
  complaintStatusHistory,
  complaints,
  departments,
  feedbackRatings,
  knowledgeBaseArticles,
  notifications,
  slaConfigurations,
  staffMembers,
  users,
} from '../db/schema.ts';
import { requireAuth, requireRole, type AuthRequest } from '../middleware/auth.ts';
import {
  analyzeComplaintIntake,
  isAiConfigured,
  runResolutionAssistantAgent,
  runResolutionSummaryAgent,
  synthesizeSpeechSummary,
  transcribeVoiceComplaint,
} from '../services/aiAgents.ts';
import {
  checkSlaEscalations,
  createNotification,
  generateTrackingCode,
  getDepartmentsWithStaffLoad,
  getRecentOpenComplaintsForDedup,
  getSlaDeadlinesForPriority,
  notifyAdmins,
  notifyDepartmentStaff,
  recordAgentAnalysisPipeline,
  writeAuditLog,
} from '../services/workflowService.ts';
import { broadcastComplaintEvent } from '../lib/wsServer.ts';

const router = express.Router();

// Public metadata endpoint (categories, departments, AI status)
router.get('/meta', async (_req, res) => {
  try {
    await ensureReferenceDataSeeded();
    const [cats, depts, slas] = await Promise.all([
      db.select().from(complaintCategories).where(eq(complaintCategories.isActive, true)),
      db.select().from(departments).where(eq(departments.isActive, true)),
      db.select().from(slaConfigurations),
    ]);
    res.json({
      aiConfigured: isAiConfigured(),
      categories: cats,
      departments: depts,
      slaConfigurations: slas,
    });
  } catch (error) {
    console.error('Meta fetch failed:', error);
    res.status(500).json({ error: 'Failed to load system metadata.' });
  }
});

// Public aggregate platform statistics for landing page (no private complaint data exposed)
router.get('/public-stats', async (_req, res) => {
  try {
    await ensureReferenceDataSeeded();
    const [totalRow] = await db.select({ value: sql<number>`count(*)::int` }).from(complaints);
    const [resolvedRow] = await db
      .select({ value: sql<number>`count(*)::int` })
      .from(complaints)
      .where(inArray(complaints.status, ['RESOLVED', 'CLOSED']));
    const [deptRow] = await db.select({ value: sql<number>`count(*)::int` }).from(departments);
    res.json({
      totalComplaints: Number(totalRow?.value ?? 0),
      resolvedComplaints: Number(resolvedRow?.value ?? 0),
      activeDepartments: Number(deptRow?.value ?? 0),
      aiConfigured: isAiConfigured(),
    });
  } catch (error) {
    console.error('Public stats failed:', error);
    res.status(500).json({ error: 'Failed to fetch platform metrics.' });
  }
});

// Voice transcription endpoint (Gemini 3.5 Transcribe)
router.post('/ai/transcribe', requireAuth, async (req: AuthRequest, res) => {
  try {
    const { audioBase64, mimeType } = req.body ?? {};
    if (!audioBase64 || typeof audioBase64 !== 'string') {
      return res.status(400).json({ error: 'Audio payload is required.' });
    }
    if (audioBase64.length > 8 * 1024 * 1024) {
      return res.status(413).json({ error: 'Audio recording exceeds size limit.' });
    }
    const result = await transcribeVoiceComplaint({
      audioBase64,
      mimeType: String(mimeType || 'audio/webm'),
    });
    res.json(result);
  } catch (error) {
    console.error('Voice transcription failed:', error);
    res.status(500).json({ error: 'Voice transcription failed. Please type or try again.' });
  }
});

// Text-to-Speech briefing endpoint (Gemini 3.8 Flash Lite TTS)
router.post('/ai/tts', requireAuth, async (req: AuthRequest, res) => {
  try {
    const { text } = req.body ?? {};
    const clean = String(text || '').trim().slice(0, 1000);
    if (!clean) {
      return res.status(400).json({ error: 'Text is required for speech synthesis.' });
    }
    const result = await synthesizeSpeechSummary(clean);
    res.json(result);
  } catch (error) {
    console.error('TTS error:', error);
    res.status(500).json({ error: 'Failed to synthesize voice summary.' });
  }
});

// Pre-submission multi-agent AI analysis preview (lets user review & override before final confirm)
router.post('/complaints/analyze-preview', requireAuth, async (req: AuthRequest, res) => {
  try {
    await ensureReferenceDataSeeded();
    const { title, description, location, preferredCategory, attachments: rawAttachments } = req.body ?? {};
    if (!title || String(title).trim().length < 4) {
      return res.status(400).json({ error: 'Complaint title must be at least 4 characters.' });
    }
    if (!description || String(description).trim().length < 10) {
      return res.status(400).json({ error: 'Complaint description must be at least 10 characters.' });
    }

    const [categories, deptsWithStaff, recentComplaints] = await Promise.all([
      db.select().from(complaintCategories).where(eq(complaintCategories.isActive, true)),
      getDepartmentsWithStaffLoad(),
      getRecentOpenComplaintsForDedup(),
    ]);

    const imageAttachments = Array.isArray(rawAttachments)
      ? rawAttachments
          .filter((a: any) => typeof a?.dataUrl === 'string' && a?.mimeType?.startsWith('image/'))
          .slice(0, 2)
          .map((a: any) => ({
            mimeType: String(a.mimeType),
            base64Data: String(a.dataUrl).split(',')[1] || '',
          }))
      : [];

    const analysis = await analyzeComplaintIntake({
      title: String(title).trim(),
      description: String(description).trim(),
      location: location ? String(location).trim() : null,
      preferredCategory: preferredCategory ? String(preferredCategory).trim() : null,
      categories,
      departments: deptsWithStaff,
      recentComplaints,
      imageAttachments,
    });

    const duplicateComplaints = recentComplaints.filter((c) =>
      analysis.duplicateCandidateIds.includes(c.id)
    );

    res.json({
      analysis,
      duplicateComplaints,
    });
  } catch (error) {
    console.error('Analyze preview failed:', error);
    res.status(500).json({ error: 'AI analysis preview failed.' });
  }
});

// Final complaint submission (Step 1 - Step 6 of workflow)
router.post('/complaints', requireAuth, async (req: AuthRequest, res) => {
  try {
    await ensureReferenceDataSeeded();
    const user = req.dbUser!;
    const {
      title,
      description,
      location,
      contactPhone,
      contactEmail,
      preferredCategory,
      correctedCategoryName,
      correctedPriority,
      correctedDepartmentId,
      isVoiceSubmitted,
      voiceTranscript,
      attachments: rawAttachments,
      precomputedAnalysis,
    } = req.body ?? {};

    const cleanTitle = String(title || '').trim();
    const cleanDescription = String(description || '').trim();
    if (cleanTitle.length < 4 || cleanTitle.length > 200) {
      return res.status(400).json({ error: 'Title must be between 4 and 200 characters.' });
    }
    if (cleanDescription.length < 10 || cleanDescription.length > 8000) {
      return res.status(400).json({ error: 'Description must be between 10 and 8000 characters.' });
    }

    const [categories, deptsWithStaff, recentComplaints] = await Promise.all([
      db.select().from(complaintCategories).where(eq(complaintCategories.isActive, true)),
      getDepartmentsWithStaffLoad(),
      getRecentOpenComplaintsForDedup(),
    ]);

    const analysis =
      precomputedAnalysis && precomputedAnalysis.understanding && precomputedAnalysis.classification
        ? precomputedAnalysis
        : await analyzeComplaintIntake({
            title: cleanTitle,
            description: cleanDescription,
            location: location ? String(location).trim() : null,
            preferredCategory: preferredCategory ? String(preferredCategory).trim() : null,
            categories,
            departments: deptsWithStaff,
            recentComplaints,
          });

    const finalCategoryName = correctedCategoryName || analysis.classification.categoryName;
    const categoryRow =
      categories.find((c) => c.name.toLowerCase() === String(finalCategoryName).toLowerCase()) ||
      categories[0];

    const finalPriority = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'].includes(String(correctedPriority))
      ? String(correctedPriority)
      : analysis.priority.level;

    let finalDeptId: number | null = correctedDepartmentId
      ? Number(correctedDepartmentId)
      : analysis.assignment.departmentId;
    const matchedDept = deptsWithStaff.find((d) => d.id === finalDeptId) || deptsWithStaff[0];
    finalDeptId = matchedDept?.id ?? null;

    let assignedStaffId: number | null = null;
    if (matchedDept) {
      const preferredStaff =
        matchedDept.staff.find((s) => s.staffId === analysis.assignment.staffMemberId) ||
        matchedDept.staff
          .filter((s) => s.isAvailable)
          .sort((a, b) => a.activeCount - b.activeCount)[0] ||
        matchedDept.staff[0];
      assignedStaffId = preferredStaff?.staffId ?? null;
    }

    const trackingCode = await generateTrackingCode();
    const { slaResponseDueAt, slaResolutionDueAt } = await getSlaDeadlinesForPriority(finalPriority);
    const initialStatus = finalDeptId ? 'ASSIGNED' : 'AI_TRIAGED';
    const isCritical = finalPriority === 'CRITICAL';

    const [createdComplaint] = await db
      .insert(complaints)
      .values({
        trackingCode,
        userId: user.id,
        title: cleanTitle,
        description: cleanDescription,
        originalLanguage: analysis.understanding.detectedLanguage || 'English',
        categoryId: categoryRow?.id ?? null,
        categoryName: categoryRow?.name || finalCategoryName,
        priority: finalPriority,
        status: initialStatus,
        departmentId: finalDeptId,
        assignedStaffId,
        location: location ? String(location).trim().slice(0, 250) : null,
        contactPhone: contactPhone ? String(contactPhone).trim().slice(0, 40) : user.phone,
        contactEmail: contactEmail ? String(contactEmail).trim().slice(0, 120) : user.email,
        aiSummary: analysis.understanding.summary,
        sentiment: analysis.understanding.sentiment,
        sentimentScore: analysis.understanding.sentimentScore,
        duplicateOfId: analysis.duplicateCandidateIds?.[0] ?? null,
        isVoiceSubmitted: Boolean(isVoiceSubmitted),
        voiceTranscript: voiceTranscript ? String(voiceTranscript).slice(0, 5000) : null,
        slaResponseDueAt,
        slaResolutionDueAt,
        isEscalated: isCritical,
        escalatedAt: isCritical ? new Date() : null,
      })
      .returning();

    // Save attachments (capped safely)
    if (Array.isArray(rawAttachments) && rawAttachments.length > 0) {
      const validFiles = rawAttachments
        .filter(
          (f: any) =>
            typeof f?.fileName === 'string' &&
            typeof f?.dataUrl === 'string' &&
            f.dataUrl.length < 4 * 1024 * 1024
        )
        .slice(0, 5);

      if (validFiles.length > 0) {
        await db.insert(attachments).values(
          validFiles.map((f: any) => ({
            complaintId: createdComplaint.id,
            uploadedByUserId: user.id,
            fileName: String(f.fileName).slice(0, 140),
            mimeType: String(f.mimeType || 'application/octet-stream').slice(0, 100),
            fileSize: Number(f.fileSize || f.dataUrl.length),
            dataUrl: String(f.dataUrl),
            attachmentKind: 'SUBMISSION',
          }))
        );
      }
    }

    // Record multi-agent AI outputs
    await recordAgentAnalysisPipeline({ complaintId: createdComplaint.id, analysis });

    // Create assignment record
    if (finalDeptId) {
      await db.insert(complaintAssignments).values({
        complaintId: createdComplaint.id,
        departmentId: finalDeptId,
        staffMemberId: assignedStaffId,
        assignedBy: 'AI_AGENT',
        status: 'PENDING',
      });
    }

    // Record status history timeline
    await db.insert(complaintStatusHistory).values([
      {
        complaintId: createdComplaint.id,
        fromStatus: null,
        toStatus: 'SUBMITTED',
        changedByUserId: user.id,
        actorLabel: user.name,
        note: isVoiceSubmitted
          ? 'Complaint submitted via Voice Intake & transcribed.'
          : 'Complaint submitted via web portal.',
      },
      {
        complaintId: createdComplaint.id,
        fromStatus: 'SUBMITTED',
        toStatus: initialStatus,
        actorLabel: analysis.isDemoMode ? 'AI Pipeline (Demo Mode)' : 'AI Multi-Agent Pipeline',
        note: `Triaged as ${categoryRow?.name || finalCategoryName} (${finalPriority}) and routed to ${matchedDept?.name || 'Triage Queue'}.`,
      },
    ]);

    // Agent 6: Notifications
    await createNotification({
      userId: user.id,
      complaintId: createdComplaint.id,
      type: 'RECEIVED',
      title: `Complaint Received: ${trackingCode}`,
      body: `Your complaint "${cleanTitle}" has been classified as ${finalPriority} priority and assigned to ${matchedDept?.name || 'Operations'}.`,
    });

    if (finalDeptId) {
      await notifyDepartmentStaff({
        departmentId: finalDeptId,
        complaintId: createdComplaint.id,
        type: 'ASSIGNED',
        title: `New ${finalPriority} Assignment: ${trackingCode}`,
        body: `"${cleanTitle}" has been routed to your department for review.`,
      });
    }

    if (isCritical) {
      await notifyAdmins({
        complaintId: createdComplaint.id,
        type: 'ESCALATION',
        title: `Immediate Critical Escalation: ${trackingCode}`,
        body: `Critical complaint "${cleanTitle}" flagged for immediate oversight (${matchedDept?.name}).`,
      });
    }

    await writeAuditLog({
      actorUserId: user.id,
      actorEmail: user.email,
      actorRole: user.role,
      action: 'COMPLAINT_SUBMITTED',
      entityType: 'complaint',
      entityId: createdComplaint.id,
      details: {
        trackingCode,
        priority: finalPriority,
        category: categoryRow?.name,
        departmentId: finalDeptId,
        isDemoAi: analysis.isDemoMode,
      },
    });

    broadcastComplaintEvent(user.id, finalDeptId, 'complaint:updated', {
      complaintId: createdComplaint.id,
      trackingCode,
      status: initialStatus,
    });

    res.status(201).json({ complaint: createdComplaint });
  } catch (error) {
    console.error('Submit complaint failed:', error);
    res.status(500).json({ error: 'Failed to submit complaint.' });
  }
});

// List complaints scoped strictly by user role (with SLA watchdog check)
router.get('/complaints', requireAuth, async (req: AuthRequest, res) => {
  try {
    await ensureReferenceDataSeeded();
    await checkSlaEscalations();

    const user = req.dbUser!;
    const { status, priority, category, search, departmentId, overdueOnly } = req.query;

    const conditions = [];

    if (user.role === 'USER') {
      conditions.push(eq(complaints.userId, user.id));
    } else if (user.role === 'STAFF') {
      if (user.departmentId) {
        conditions.push(eq(complaints.departmentId, user.departmentId));
      } else {
        return res.json({ complaints: [] });
      }
    } else if (user.role === 'ADMIN' && departmentId) {
      conditions.push(eq(complaints.departmentId, Number(departmentId)));
    }

    if (status && status !== 'ALL') {
      conditions.push(eq(complaints.status, String(status)));
    }
    if (priority && priority !== 'ALL') {
      conditions.push(eq(complaints.priority, String(priority)));
    }
    if (category && category !== 'ALL') {
      conditions.push(eq(complaints.categoryName, String(category)));
    }
    if (overdueOnly === 'true') {
      conditions.push(eq(complaints.isEscalated, true));
    }
    if (search && String(search).trim()) {
      const q = `%${String(search).trim()}%`;
      conditions.push(
        or(
          ilike(complaints.trackingCode, q),
          ilike(complaints.title, q),
          ilike(complaints.description, q),
          ilike(complaints.location, q)
        )!
      );
    }

    const rows = await db
      .select({
        id: complaints.id,
        trackingCode: complaints.trackingCode,
        userId: complaints.userId,
        title: complaints.title,
        description: complaints.description,
        originalLanguage: complaints.originalLanguage,
        categoryName: complaints.categoryName,
        priority: complaints.priority,
        status: complaints.status,
        departmentId: complaints.departmentId,
        departmentName: departments.name,
        assignedStaffId: complaints.assignedStaffId,
        location: complaints.location,
        aiSummary: complaints.aiSummary,
        sentiment: complaints.sentiment,
        sentimentScore: complaints.sentimentScore,
        isVoiceSubmitted: complaints.isVoiceSubmitted,
        slaResponseDueAt: complaints.slaResponseDueAt,
        slaResolutionDueAt: complaints.slaResolutionDueAt,
        isEscalated: complaints.isEscalated,
        resolvedAt: complaints.resolvedAt,
        closedAt: complaints.closedAt,
        createdAt: complaints.createdAt,
        updatedAt: complaints.updatedAt,
        complainantName: users.name,
        complainantEmail: users.email,
      })
      .from(complaints)
      .leftJoin(departments, eq(complaints.departmentId, departments.id))
      .leftJoin(users, eq(complaints.userId, users.id))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(complaints.createdAt));

    res.json({ complaints: rows });
  } catch (error) {
    console.error('List complaints failed:', error);
    res.status(500).json({ error: 'Failed to retrieve complaints.' });
  }
});

// Get full complaint detail (privacy-enforced: USER only sees own; STAFF only sees dept; internal notes hidden from USER)
router.get('/complaints/:idOrCode', requireAuth, async (req: AuthRequest, res) => {
  try {
    await ensureReferenceDataSeeded();
    const user = req.dbUser!;
    const rawParam = String(req.params.idOrCode);
    const isNumeric = /^\d+$/.test(rawParam);

    const rows = await db
      .select()
      .from(complaints)
      .where(isNumeric ? eq(complaints.id, Number(rawParam)) : eq(complaints.trackingCode, rawParam))
      .limit(1);

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Complaint not found.' });
    }

    const complaint = rows[0];

    if (user.role === 'USER' && complaint.userId !== user.id) {
      return res.status(403).json({ error: 'Forbidden: You do not have access to this complaint.' });
    }
    if (user.role === 'STAFF' && complaint.departmentId !== user.departmentId) {
      return res.status(403).json({ error: 'Forbidden: This complaint belongs to another department.' });
    }

    const [
      deptRows,
      complainantRows,
      historyRows,
      messageRows,
      attachmentRows,
      aiRows,
      assignmentRows,
      feedbackRows,
    ] = await Promise.all([
      complaint.departmentId
        ? db.select().from(departments).where(eq(departments.id, complaint.departmentId)).limit(1)
        : Promise.resolve([]),
      db
        .select({ id: users.id, name: users.name, email: users.email, phone: users.phone })
        .from(users)
        .where(eq(users.id, complaint.userId))
        .limit(1),
      db
        .select()
        .from(complaintStatusHistory)
        .where(eq(complaintStatusHistory.complaintId, complaint.id))
        .orderBy(complaintStatusHistory.createdAt),
      db
        .select()
        .from(complaintMessages)
        .where(
          user.role === 'USER'
            ? and(eq(complaintMessages.complaintId, complaint.id), eq(complaintMessages.isInternalNote, false))
            : eq(complaintMessages.complaintId, complaint.id)
        )
        .orderBy(complaintMessages.createdAt),
      db.select().from(attachments).where(eq(attachments.complaintId, complaint.id)),
      db
        .select()
        .from(aiAnalysisResults)
        .where(eq(aiAnalysisResults.complaintId, complaint.id))
        .orderBy(desc(aiAnalysisResults.createdAt)),
      db
        .select()
        .from(complaintAssignments)
        .where(eq(complaintAssignments.complaintId, complaint.id))
        .orderBy(desc(complaintAssignments.createdAt)),
      db.select().from(feedbackRatings).where(eq(feedbackRatings.complaintId, complaint.id)).limit(1),
    ]);

    let assignedStaffName: string | null = null;
    if (complaint.assignedStaffId) {
      const staffRow = await db
        .select({ name: users.name, title: staffMembers.title })
        .from(staffMembers)
        .innerJoin(users, eq(staffMembers.userId, users.id))
        .where(eq(staffMembers.id, complaint.assignedStaffId))
        .limit(1);
      if (staffRow[0]) {
        assignedStaffName = `${staffRow[0].name} (${staffRow[0].title})`;
      }
    }

    res.json({
      complaint: {
        ...complaint,
        departmentName: deptRows[0]?.name ?? 'Unassigned',
        assignedStaffName,
        complainant: complainantRows[0] ?? null,
      },
      statusHistory: historyRows,
      messages: messageRows,
      attachments: attachmentRows,
      aiAnalyses: aiRows,
      assignments: assignmentRows,
      feedback: feedbackRows[0] ?? null,
    });
  } catch (error) {
    console.error('Get complaint detail failed:', error);
    res.status(500).json({ error: 'Failed to fetch complaint details.' });
  }
});

// Send message / reply / internal note
router.post('/complaints/:id/messages', requireAuth, async (req: AuthRequest, res) => {
  try {
    const user = req.dbUser!;
    const complaintId = Number(req.params.id);
    const { message, isInternalNote, isAiDrafted } = req.body ?? {};
    const cleanMsg = String(message || '').trim();
    if (!cleanMsg || cleanMsg.length > 4000) {
      return res.status(400).json({ error: 'Message cannot be empty or exceed 4000 characters.' });
    }

    const [complaint] = await db.select().from(complaints).where(eq(complaints.id, complaintId)).limit(1);
    if (!complaint) return res.status(404).json({ error: 'Complaint not found.' });

    if (user.role === 'USER' && complaint.userId !== user.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    if (user.role === 'STAFF' && complaint.departmentId !== user.departmentId) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const internalFlag = user.role !== 'USER' && Boolean(isInternalNote);

    const [created] = await db
      .insert(complaintMessages)
      .values({
        complaintId,
        senderUserId: user.id,
        senderRole: user.role,
        senderName: user.name,
        message: cleanMsg,
        isInternalNote: internalFlag,
        isAiDrafted: Boolean(isAiDrafted),
      })
      .returning();

    // If citizen replies while AWAITING_INFO, move back to IN_PROGRESS
    if (user.role === 'USER' && complaint.status === 'AWAITING_INFO') {
      await db
        .update(complaints)
        .set({ status: 'IN_PROGRESS', updatedAt: new Date() })
        .where(eq(complaints.id, complaintId));

      await db.insert(complaintStatusHistory).values({
        complaintId,
        fromStatus: 'AWAITING_INFO',
        toStatus: 'IN_PROGRESS',
        changedByUserId: user.id,
        actorLabel: user.name,
        note: 'Complainant provided requested information.',
      });
    }

    if (!internalFlag) {
      if (user.role === 'USER' && complaint.departmentId) {
        await notifyDepartmentStaff({
          departmentId: complaint.departmentId,
          complaintId,
          type: 'MESSAGE',
          title: `Complainant Reply: ${complaint.trackingCode}`,
          body: `${user.name}: ${cleanMsg.slice(0, 120)}`,
        });
      } else if (user.role !== 'USER') {
        await createNotification({
          userId: complaint.userId,
          complaintId,
          type: 'MESSAGE',
          title: `Department Update: ${complaint.trackingCode}`,
          body: `${user.name}: ${cleanMsg.slice(0, 120)}`,
        });
      }
    }

    broadcastComplaintEvent(complaint.userId, complaint.departmentId, 'message:new', {
      complaintId,
      message: created,
    });

    res.status(201).json({ message: created });
  } catch (error) {
    console.error('Send message failed:', error);
    res.status(500).json({ error: 'Failed to send message.' });
  }
});

// Upload additional attachment or resolution evidence
router.post('/complaints/:id/attachments', requireAuth, async (req: AuthRequest, res) => {
  try {
    const user = req.dbUser!;
    const complaintId = Number(req.params.id);
    const { fileName, mimeType, fileSize, dataUrl, attachmentKind } = req.body ?? {};
    if (!fileName || !dataUrl || typeof dataUrl !== 'string' || dataUrl.length > 4 * 1024 * 1024) {
      return res.status(400).json({ error: 'Valid file under 3MB is required.' });
    }

    const [complaint] = await db.select().from(complaints).where(eq(complaints.id, complaintId)).limit(1);
    if (!complaint) return res.status(404).json({ error: 'Complaint not found.' });

    if (user.role === 'USER' && complaint.userId !== user.id) return res.status(403).json({ error: 'Forbidden' });
    if (user.role === 'STAFF' && complaint.departmentId !== user.departmentId) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const kind =
      user.role !== 'USER' && attachmentKind === 'RESOLUTION_EVIDENCE'
        ? 'RESOLUTION_EVIDENCE'
        : 'SUBMISSION';

    const [created] = await db
      .insert(attachments)
      .values({
        complaintId,
        uploadedByUserId: user.id,
        fileName: String(fileName).slice(0, 140),
        mimeType: String(mimeType || 'application/octet-stream').slice(0, 100),
        fileSize: Number(fileSize || dataUrl.length),
        dataUrl,
        attachmentKind: kind,
      })
      .returning();

    res.status(201).json({ attachment: created });
  } catch (error) {
    console.error('Upload attachment failed:', error);
    res.status(500).json({ error: 'Failed to upload attachment.' });
  }
});

// Staff accepts or rejects assignment
router.post('/complaints/:id/assignment-decision', requireAuth, requireRole(['STAFF', 'ADMIN']), async (req: AuthRequest, res) => {
  try {
    const user = req.dbUser!;
    const complaintId = Number(req.params.id);
    const { decision, reason } = req.body ?? {};
    if (decision !== 'ACCEPTED' && decision !== 'REJECTED') {
      return res.status(400).json({ error: 'Decision must be ACCEPTED or REJECTED.' });
    }
    if (decision === 'REJECTED' && (!reason || String(reason).trim().length < 5)) {
      return res.status(400).json({ error: 'A clear reason is required when rejecting an assignment.' });
    }

    const [complaint] = await db.select().from(complaints).where(eq(complaints.id, complaintId)).limit(1);
    if (!complaint) return res.status(404).json({ error: 'Complaint not found.' });
    if (user.role === 'STAFF' && complaint.departmentId !== user.departmentId) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const latestAssign = await db
      .select()
      .from(complaintAssignments)
      .where(eq(complaintAssignments.complaintId, complaintId))
      .orderBy(desc(complaintAssignments.createdAt))
      .limit(1);

    if (latestAssign[0]) {
      await db
        .update(complaintAssignments)
        .set({
          status: decision,
          decisionReason: reason ? String(reason).trim() : null,
          respondedAt: new Date(),
        })
        .where(eq(complaintAssignments.id, latestAssign[0].id));
    }

    const newStatus = decision === 'ACCEPTED' ? 'ACCEPTED' : 'ESCALATED';
    await db
      .update(complaints)
      .set({
        status: newStatus,
        isEscalated: decision === 'REJECTED' ? true : complaint.isEscalated,
        escalatedAt: decision === 'REJECTED' ? new Date() : complaint.escalatedAt,
        updatedAt: new Date(),
      })
      .where(eq(complaints.id, complaintId));

    await db.insert(complaintStatusHistory).values({
      complaintId,
      fromStatus: complaint.status,
      toStatus: newStatus,
      changedByUserId: user.id,
      actorLabel: user.name,
      note:
        decision === 'ACCEPTED'
          ? `Assignment accepted by ${user.name}.`
          : `Assignment rejected by ${user.name}: ${reason}`,
    });

    if (decision === 'REJECTED') {
      await notifyAdmins({
        complaintId,
        type: 'ESCALATION',
        title: `Assignment Rejected: ${complaint.trackingCode}`,
        body: `${user.name} rejected assignment: "${reason}". Manual rerouting required.`,
      });
    } else {
      await createNotification({
        userId: complaint.userId,
        complaintId,
        type: 'STATUS_CHANGE',
        title: `Department Accepted Case: ${complaint.trackingCode}`,
        body: `Your complaint has been accepted by ${user.name} for active review.`,
      });
    }

    await writeAuditLog({
      actorUserId: user.id,
      actorEmail: user.email,
      actorRole: user.role,
      action: `ASSIGNMENT_${decision}`,
      entityType: 'complaint',
      entityId: complaintId,
      details: { reason: reason || null },
    });

    broadcastComplaintEvent(complaint.userId, complaint.departmentId, 'complaint:updated', {
      complaintId,
      status: newStatus,
    });

    res.json({ status: newStatus });
  } catch (error) {
    console.error('Assignment decision failed:', error);
    res.status(500).json({ error: 'Failed to record assignment decision.' });
  }
});

// Staff updates complaint status (IN_PROGRESS, AWAITING_INFO, ESCALATED)
router.patch('/complaints/:id/status', requireAuth, requireRole(['STAFF', 'ADMIN']), async (req: AuthRequest, res) => {
  try {
    const user = req.dbUser!;
    const complaintId = Number(req.params.id);
    const { status, note } = req.body ?? {};
    const allowed = ['ACCEPTED', 'IN_PROGRESS', 'AWAITING_INFO', 'ESCALATED'];
    if (!allowed.includes(String(status))) {
      return res.status(400).json({ error: 'Invalid status transition for this endpoint.' });
    }

    const [complaint] = await db.select().from(complaints).where(eq(complaints.id, complaintId)).limit(1);
    if (!complaint) return res.status(404).json({ error: 'Complaint not found.' });
    if (user.role === 'STAFF' && complaint.departmentId !== user.departmentId) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    await db
      .update(complaints)
      .set({
        status: String(status),
        isEscalated: status === 'ESCALATED' ? true : complaint.isEscalated,
        escalatedAt: status === 'ESCALATED' ? new Date() : complaint.escalatedAt,
        updatedAt: new Date(),
      })
      .where(eq(complaints.id, complaintId));

    await db.insert(complaintStatusHistory).values({
      complaintId,
      fromStatus: complaint.status,
      toStatus: String(status),
      changedByUserId: user.id,
      actorLabel: user.name,
      note: note ? String(note).trim() : `Status updated to ${status}.`,
    });

    await createNotification({
      userId: complaint.userId,
      complaintId,
      type: 'STATUS_CHANGE',
      title: `Status Updated: ${complaint.trackingCode}`,
      body: `Status changed from ${complaint.status} to ${status}.${note ? ` Note: ${note}` : ''}`,
    });

    await writeAuditLog({
      actorUserId: user.id,
      actorEmail: user.email,
      actorRole: user.role,
      action: 'STATUS_UPDATED',
      entityType: 'complaint',
      entityId: complaintId,
      details: { fromStatus: complaint.status, toStatus: status, note },
    });

    broadcastComplaintEvent(complaint.userId, complaint.departmentId, 'complaint:updated', {
      complaintId,
      status,
    });

    res.json({ status });
  } catch (error) {
    console.error('Status update failed:', error);
    res.status(500).json({ error: 'Failed to update complaint status.' });
  }
});

// Agent 5: Staff requests AI Resolution Assistant suggestions & response draft
router.post('/complaints/:id/ai-assist', requireAuth, requireRole(['STAFF', 'ADMIN']), async (req: AuthRequest, res) => {
  try {
    const user = req.dbUser!;
    const complaintId = Number(req.params.id);
    const [complaint] = await db.select().from(complaints).where(eq(complaints.id, complaintId)).limit(1);
    if (!complaint) return res.status(404).json({ error: 'Complaint not found.' });
    if (user.role === 'STAFF' && complaint.departmentId !== user.departmentId) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const [deptRows, complainantRows, messageRows, kbRows] = await Promise.all([
      complaint.departmentId
        ? db.select().from(departments).where(eq(departments.id, complaint.departmentId)).limit(1)
        : Promise.resolve([]),
      db.select({ name: users.name }).from(users).where(eq(users.id, complaint.userId)).limit(1),
      db.select().from(complaintMessages).where(eq(complaintMessages.complaintId, complaintId)),
      db.select().from(knowledgeBaseArticles),
    ]);

    const assistantResult = await runResolutionAssistantAgent({
      trackingCode: complaint.trackingCode,
      title: complaint.title,
      description: complaint.description,
      categoryName: complaint.categoryName,
      priority: complaint.priority,
      departmentName: deptRows[0]?.name || 'Assigned Department',
      complainantName: complainantRows[0]?.name || 'Complainant',
      messages: messageRows.map((m) => ({
        senderRole: m.senderRole,
        message: m.message,
        isInternalNote: m.isInternalNote,
      })),
      knowledgeBase: kbRows.map((k) => ({
        id: k.id,
        title: k.title,
        categoryName: k.categoryName,
        summary: k.summary,
        steps: k.steps,
      })),
    });

    await db.insert(aiAnalysisResults).values({
      complaintId,
      agentName: 'ResolutionAssistantAgent',
      modelUsed: assistantResult.modelUsed,
      isDemoMode: assistantResult.isDemoMode,
      suggestedSolutions: assistantResult.suggestedSolutions,
      responseDraft: assistantResult.responseDraft,
      needsHumanIntervention: assistantResult.needsHumanIntervention,
      assignmentReasoning: assistantResult.humanInterventionReason,
    });

    const matchedArticles = kbRows.filter((k) => assistantResult.matchedArticleIds.includes(k.id));

    res.json({
      assistant: assistantResult,
      matchedArticles,
    });
  } catch (error) {
    console.error('AI assist failed:', error);
    res.status(500).json({ error: 'Resolution Assistant failed.' });
  }
});

// Step 10 & 11: Staff submits verified resolution details -> triggers Agent 7 Summary (does NOT auto-close!)
router.post('/complaints/:id/resolve', requireAuth, requireRole(['STAFF', 'ADMIN']), async (req: AuthRequest, res) => {
  try {
    const user = req.dbUser!;
    const complaintId = Number(req.params.id);
    const { resolutionNotes } = req.body ?? {};
    const cleanNotes = String(resolutionNotes || '').trim();
    if (cleanNotes.length < 10) {
      return res.status(400).json({ error: 'Please provide verified resolution details (at least 10 characters).' });
    }

    const [complaint] = await db.select().from(complaints).where(eq(complaints.id, complaintId)).limit(1);
    if (!complaint) return res.status(404).json({ error: 'Complaint not found.' });
    if (user.role === 'STAFF' && complaint.departmentId !== user.departmentId) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const deptRows = complaint.departmentId
      ? await db.select().from(departments).where(eq(departments.id, complaint.departmentId)).limit(1)
      : [];
    const resolvedAt = new Date();

    const summaryResult = await runResolutionSummaryAgent({
      trackingCode: complaint.trackingCode,
      title: complaint.title,
      description: complaint.description,
      departmentName: deptRows[0]?.name || 'Operations Department',
      resolutionNotes: cleanNotes,
      resolvedAtIso: resolvedAt.toISOString(),
    });

    await db
      .update(complaints)
      .set({
        status: 'RESOLVED',
        resolvedAt,
        resolutionNotes: cleanNotes,
        closureSummary: summaryResult.closureSummary,
        updatedAt: resolvedAt,
      })
      .where(eq(complaints.id, complaintId));

    await db.insert(aiAnalysisResults).values({
      complaintId,
      agentName: 'SummaryAgent',
      modelUsed: summaryResult.modelUsed,
      isDemoMode: summaryResult.isDemoMode,
      responseDraft: summaryResult.closureSummary,
    });

    await db.insert(complaintStatusHistory).values({
      complaintId,
      fromStatus: complaint.status,
      toStatus: 'RESOLVED',
      changedByUserId: user.id,
      actorLabel: user.name,
      note: `Resolved by ${user.name}. Closure report generated (awaiting authorized closure confirmation or citizen feedback).`,
    });

    await createNotification({
      userId: complaint.userId,
      complaintId,
      type: 'RESOLVED',
      title: `Complaint Resolved: ${complaint.trackingCode}`,
      body: `Your complaint "${complaint.title}" has been marked Resolved. Review the closure summary and share your rating.`,
    });

    await writeAuditLog({
      actorUserId: user.id,
      actorEmail: user.email,
      actorRole: user.role,
      action: 'COMPLAINT_RESOLVED',
      entityType: 'complaint',
      entityId: complaintId,
      details: { trackingCode: complaint.trackingCode, summaryDemoMode: summaryResult.isDemoMode },
    });

    broadcastComplaintEvent(complaint.userId, complaint.departmentId, 'complaint:updated', {
      complaintId,
      status: 'RESOLVED',
    });

    res.json({ status: 'RESOLVED', closureSummary: summaryResult.closureSummary });
  } catch (error) {
    console.error('Resolve complaint failed:', error);
    res.status(500).json({ error: 'Failed to resolve complaint.' });
  }
});

// Step 13: Authorized closure confirmation (cannot be closed purely by AI summary)
router.post('/complaints/:id/confirm-close', requireAuth, async (req: AuthRequest, res) => {
  try {
    const user = req.dbUser!;
    const complaintId = Number(req.params.id);
    const [complaint] = await db.select().from(complaints).where(eq(complaints.id, complaintId)).limit(1);
    if (!complaint) return res.status(404).json({ error: 'Complaint not found.' });

    const isAuthorized =
      user.role === 'ADMIN' ||
      (user.role === 'STAFF' && complaint.departmentId === user.departmentId) ||
      (user.role === 'USER' && complaint.userId === user.id);

    if (!isAuthorized) return res.status(403).json({ error: 'Forbidden' });
    if (complaint.status !== 'RESOLVED') {
      return res.status(400).json({ error: 'Complaint must be in RESOLVED state before final closure.' });
    }

    const closedAt = new Date();
    await db
      .update(complaints)
      .set({ status: 'CLOSED', closedAt, updatedAt: closedAt })
      .where(eq(complaints.id, complaintId));

    await db.insert(complaintStatusHistory).values({
      complaintId,
      fromStatus: 'RESOLVED',
      toStatus: 'CLOSED',
      changedByUserId: user.id,
      actorLabel: user.name,
      note: `Authorized final closure confirmed by ${user.name} (${user.role}).`,
    });

    await writeAuditLog({
      actorUserId: user.id,
      actorEmail: user.email,
      actorRole: user.role,
      action: 'RESOLUTION_CONFIRMED',
      entityType: 'complaint',
      entityId: complaintId,
      details: { trackingCode: complaint.trackingCode },
    });

    broadcastComplaintEvent(complaint.userId, complaint.departmentId, 'complaint:updated', {
      complaintId,
      status: 'CLOSED',
    });

    res.json({ status: 'CLOSED' });
  } catch (error) {
    console.error('Confirm close failed:', error);
    res.status(500).json({ error: 'Failed to confirm closure.' });
  }
});

// Reopen eligible resolved/closed complaint (Complainant or Admin)
router.post('/complaints/:id/reopen', requireAuth, async (req: AuthRequest, res) => {
  try {
    const user = req.dbUser!;
    const complaintId = Number(req.params.id);
    const { reason } = req.body ?? {};
    const cleanReason = String(reason || '').trim();
    if (cleanReason.length < 5) {
      return res.status(400).json({ error: 'Please explain why the complaint needs to be reopened.' });
    }

    const [complaint] = await db.select().from(complaints).where(eq(complaints.id, complaintId)).limit(1);
    if (!complaint) return res.status(404).json({ error: 'Complaint not found.' });
    if (user.role === 'USER' && complaint.userId !== user.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    if (complaint.status !== 'RESOLVED' && complaint.status !== 'CLOSED') {
      return res.status(400).json({ error: 'Only resolved or closed complaints can be reopened.' });
    }

    await db
      .update(complaints)
      .set({ status: 'REOPENED', updatedAt: new Date() })
      .where(eq(complaints.id, complaintId));

    await db.insert(complaintStatusHistory).values({
      complaintId,
      fromStatus: complaint.status,
      toStatus: 'REOPENED',
      changedByUserId: user.id,
      actorLabel: user.name,
      note: `Complaint reopened: ${cleanReason}`,
    });

    if (complaint.departmentId) {
      await notifyDepartmentStaff({
        departmentId: complaint.departmentId,
        complaintId,
        type: 'STATUS_CHANGE',
        title: `Complaint Reopened: ${complaint.trackingCode}`,
        body: `${user.name} reopened "${complaint.title}": ${cleanReason}`,
      });
    }

    await writeAuditLog({
      actorUserId: user.id,
      actorEmail: user.email,
      actorRole: user.role,
      action: 'COMPLAINT_REOPENED',
      entityType: 'complaint',
      entityId: complaintId,
      details: { reason: cleanReason },
    });

    broadcastComplaintEvent(complaint.userId, complaint.departmentId, 'complaint:updated', {
      complaintId,
      status: 'REOPENED',
    });

    res.json({ status: 'REOPENED' });
  } catch (error) {
    console.error('Reopen failed:', error);
    res.status(500).json({ error: 'Failed to reopen complaint.' });
  }
});

// Submit satisfaction feedback & rating
router.post('/complaints/:id/feedback', requireAuth, async (req: AuthRequest, res) => {
  try {
    const user = req.dbUser!;
    const complaintId = Number(req.params.id);
    const { rating, comment, resolutionSpeedScore, communicationScore } = req.body ?? {};
    const numericRating = Number(rating);
    if (!Number.isInteger(numericRating) || numericRating < 1 || numericRating > 5) {
      return res.status(400).json({ error: 'Rating must be an integer between 1 and 5.' });
    }

    const [complaint] = await db.select().from(complaints).where(eq(complaints.id, complaintId)).limit(1);
    if (!complaint) return res.status(404).json({ error: 'Complaint not found.' });
    if (complaint.userId !== user.id) {
      return res.status(403).json({ error: 'Only the complainant can rate the resolution.' });
    }
    if (complaint.status !== 'RESOLVED' && complaint.status !== 'CLOSED') {
      return res.status(400).json({ error: 'Feedback can only be submitted after resolution.' });
    }

    const [saved] = await db
      .insert(feedbackRatings)
      .values({
        complaintId,
        userId: user.id,
        rating: numericRating,
        comment: comment ? String(comment).trim().slice(0, 1000) : null,
        resolutionSpeedScore: resolutionSpeedScore ? Number(resolutionSpeedScore) : numericRating,
        communicationScore: communicationScore ? Number(communicationScore) : numericRating,
      })
      .onConflictDoUpdate({
        target: feedbackRatings.complaintId,
        set: {
          rating: numericRating,
          comment: comment ? String(comment).trim().slice(0, 1000) : null,
        },
      })
      .returning();

    res.status(201).json({ feedback: saved });
  } catch (error) {
    console.error('Feedback error:', error);
    res.status(500).json({ error: 'Failed to submit feedback.' });
  }
});

// Notifications endpoints
router.get('/notifications', requireAuth, async (req: AuthRequest, res) => {
  try {
    const user = req.dbUser!;
    const rows = await db
      .select()
      .from(notifications)
      .where(eq(notifications.userId, user.id))
      .orderBy(desc(notifications.createdAt))
      .limit(50);
    res.json({ notifications: rows });
  } catch (error) {
    console.error('Fetch notifications failed:', error);
    res.status(500).json({ error: 'Failed to fetch notifications.' });
  }
});

router.patch('/notifications/:id/read', requireAuth, async (req: AuthRequest, res) => {
  try {
    const user = req.dbUser!;
    const notifId = Number(req.params.id);
    await db
      .update(notifications)
      .set({ isRead: true })
      .where(and(eq(notifications.id, notifId), eq(notifications.userId, user.id)));
    res.json({ ok: true });
  } catch (error) {
    console.error('Mark notification read failed:', error);
    res.status(500).json({ error: 'Failed to update notification.' });
  }
});

router.post('/notifications/read-all', requireAuth, async (req: AuthRequest, res) => {
  try {
    const user = req.dbUser!;
    await db.update(notifications).set({ isRead: true }).where(eq(notifications.userId, user.id));
    res.json({ ok: true });
  } catch (error) {
    console.error('Read all notifications failed:', error);
    res.status(500).json({ error: 'Failed to mark notifications read.' });
  }
});

// Department staff list for department dashboard workload widget
router.get('/department/workload', requireAuth, requireRole(['STAFF', 'ADMIN']), async (req: AuthRequest, res) => {
  try {
    const user = req.dbUser!;
    const depts = await getDepartmentsWithStaffLoad();
    if (user.role === 'STAFF') {
      const own = depts.find((d) => d.id === user.departmentId);
      return res.json({ departments: own ? [own] : [] });
    }
    res.json({ departments: depts });
  } catch (error) {
    console.error('Department workload failed:', error);
    res.status(500).json({ error: 'Failed to load department workload.' });
  }
});

export default router;
