import { relations } from 'drizzle-orm';
import {
  boolean,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';

export const departments = pgTable('departments', {
  id: serial('id').primaryKey(),
  name: text('name').notNull().unique(),
  code: text('code').notNull().unique(),
  description: text('description').notNull(),
  responsibilities: text('responsibilities').notNull(),
  leadEmail: text('lead_email'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  uid: text('uid').notNull().unique(),
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  phone: text('phone'),
  passwordHash: text('password_hash'),
  role: text('role').notNull().default('USER'), // 'USER' | 'STAFF' | 'ADMIN'
  departmentId: integer('department_id').references(() => departments.id),
  avatarUrl: text('avatar_url'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const staffMembers = pgTable('staff_members', {
  id: serial('id').primaryKey(),
  userId: integer('user_id')
    .references(() => users.id)
    .notNull()
    .unique(),
  departmentId: integer('department_id')
    .references(() => departments.id)
    .notNull(),
  title: text('title').notNull(),
  specialization: text('specialization').notNull(),
  maxActiveLoad: integer('max_active_load').notNull().default(10),
  isAvailable: boolean('is_available').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const complaintCategories = pgTable('complaint_categories', {
  id: serial('id').primaryKey(),
  name: text('name').notNull().unique(),
  description: text('description').notNull(),
  defaultDepartmentId: integer('default_department_id').references(() => departments.id),
  isSystem: boolean('is_system').notNull().default(true),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const slaConfigurations = pgTable('sla_configurations', {
  id: serial('id').primaryKey(),
  priority: text('priority').notNull().unique(), // 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'
  responseHours: integer('response_hours').notNull(),
  resolutionHours: integer('resolution_hours').notNull(),
  autoEscalate: boolean('auto_escalate').notNull().default(true),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const complaints = pgTable('complaints', {
  id: serial('id').primaryKey(),
  trackingCode: text('tracking_code').notNull().unique(),
  userId: integer('user_id')
    .references(() => users.id)
    .notNull(),
  title: text('title').notNull(),
  description: text('description').notNull(),
  originalLanguage: text('original_language').notNull().default('English'),
  categoryId: integer('category_id').references(() => complaintCategories.id),
  categoryName: text('category_name').notNull(),
  priority: text('priority').notNull().default('MEDIUM'), // 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'
  status: text('status').notNull().default('SUBMITTED'),
  departmentId: integer('department_id').references(() => departments.id),
  assignedStaffId: integer('assigned_staff_id').references(() => staffMembers.id),
  location: text('location'),
  contactPhone: text('contact_phone'),
  contactEmail: text('contact_email'),
  aiSummary: text('ai_summary'),
  sentiment: text('sentiment').default('NEUTRAL'),
  sentimentScore: integer('sentiment_score').default(50),
  duplicateOfId: integer('duplicate_of_id'),
  isVoiceSubmitted: boolean('is_voice_submitted').notNull().default(false),
  voiceTranscript: text('voice_transcript'),
  slaResponseDueAt: timestamp('sla_response_due_at'),
  slaResolutionDueAt: timestamp('sla_resolution_due_at'),
  isEscalated: boolean('is_escalated').notNull().default(false),
  escalatedAt: timestamp('escalated_at'),
  resolvedAt: timestamp('resolved_at'),
  closedAt: timestamp('closed_at'),
  resolutionNotes: text('resolution_notes'),
  closureSummary: text('closure_summary'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const complaintAssignments = pgTable('complaint_assignments', {
  id: serial('id').primaryKey(),
  complaintId: integer('complaint_id')
    .references(() => complaints.id)
    .notNull(),
  departmentId: integer('department_id')
    .references(() => departments.id)
    .notNull(),
  staffMemberId: integer('staff_member_id').references(() => staffMembers.id),
  assignedBy: text('assigned_by').notNull(), // 'AI_AGENT' | 'ADMIN' | 'AUTO_ESCALATION'
  status: text('status').notNull().default('PENDING'), // 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'REASSIGNED'
  decisionReason: text('decision_reason'),
  respondedAt: timestamp('responded_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const complaintStatusHistory = pgTable('complaint_status_history', {
  id: serial('id').primaryKey(),
  complaintId: integer('complaint_id')
    .references(() => complaints.id)
    .notNull(),
  fromStatus: text('from_status'),
  toStatus: text('to_status').notNull(),
  changedByUserId: integer('changed_by_user_id').references(() => users.id),
  actorLabel: text('actor_label').notNull(),
  note: text('note').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const complaintMessages = pgTable('complaint_messages', {
  id: serial('id').primaryKey(),
  complaintId: integer('complaint_id')
    .references(() => complaints.id)
    .notNull(),
  senderUserId: integer('sender_user_id')
    .references(() => users.id)
    .notNull(),
  senderRole: text('sender_role').notNull(),
  senderName: text('sender_name').notNull(),
  message: text('message').notNull(),
  isInternalNote: boolean('is_internal_note').notNull().default(false),
  isAiDrafted: boolean('is_ai_drafted').notNull().default(false),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const attachments = pgTable('attachments', {
  id: serial('id').primaryKey(),
  complaintId: integer('complaint_id')
    .references(() => complaints.id)
    .notNull(),
  uploadedByUserId: integer('uploaded_by_user_id')
    .references(() => users.id)
    .notNull(),
  fileName: text('file_name').notNull(),
  mimeType: text('mime_type').notNull(),
  fileSize: integer('file_size').notNull(),
  dataUrl: text('data_url').notNull(),
  attachmentKind: text('attachment_kind').notNull().default('SUBMISSION'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const aiAnalysisResults = pgTable('ai_analysis_results', {
  id: serial('id').primaryKey(),
  complaintId: integer('complaint_id')
    .references(() => complaints.id)
    .notNull(),
  agentName: text('agent_name').notNull(),
  modelUsed: text('model_used').notNull(),
  isDemoMode: boolean('is_demo_mode').notNull().default(false),
  detectedLanguage: text('detected_language'),
  extractedDetails: jsonb('extracted_details'),
  followUpQuestions: jsonb('follow_up_questions'),
  recommendedCategory: text('recommended_category'),
  recommendedPriority: text('recommended_priority'),
  priorityReasoning: text('priority_reasoning'),
  recommendedDepartment: text('recommended_department'),
  assignmentReasoning: text('assignment_reasoning'),
  suggestedSolutions: jsonb('suggested_solutions'),
  responseDraft: text('response_draft'),
  needsHumanIntervention: boolean('needs_human_intervention').notNull().default(false),
  duplicateCandidateIds: jsonb('duplicate_candidate_ids'),
  confidenceScore: integer('confidence_score').default(90),
  overriddenByAdmin: boolean('overridden_by_admin').notNull().default(false),
  overrideReason: text('override_reason'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const notifications = pgTable('notifications', {
  id: serial('id').primaryKey(),
  userId: integer('user_id')
    .references(() => users.id)
    .notNull(),
  complaintId: integer('complaint_id').references(() => complaints.id),
  type: text('type').notNull(),
  title: text('title').notNull(),
  body: text('body').notNull(),
  isRead: boolean('is_read').notNull().default(false),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const feedbackRatings = pgTable('feedback_ratings', {
  id: serial('id').primaryKey(),
  complaintId: integer('complaint_id')
    .references(() => complaints.id)
    .notNull()
    .unique(),
  userId: integer('user_id')
    .references(() => users.id)
    .notNull(),
  rating: integer('rating').notNull(),
  comment: text('comment'),
  resolutionSpeedScore: integer('resolution_speed_score'),
  communicationScore: integer('communication_score'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const auditLogs = pgTable('audit_logs', {
  id: serial('id').primaryKey(),
  actorUserId: integer('actor_user_id').references(() => users.id),
  actorEmail: text('actor_email').notNull(),
  actorRole: text('actor_role').notNull(),
  action: text('action').notNull(),
  entityType: text('entity_type').notNull(),
  entityId: text('entity_id').notNull(),
  details: jsonb('details'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const knowledgeBaseArticles = pgTable('knowledge_base_articles', {
  id: serial('id').primaryKey(),
  title: text('title').notNull(),
  categoryName: text('category_name').notNull(),
  departmentId: integer('department_id').references(() => departments.id),
  summary: text('summary').notNull(),
  steps: jsonb('steps').$type<string[]>().notNull(),
  tags: jsonb('tags').$type<string[]>().notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// Drizzle Relations
export const departmentsRelations = relations(departments, ({ many }) => ({
  users: many(users),
  staffMembers: many(staffMembers),
  complaints: many(complaints),
  categories: many(complaintCategories),
  knowledgeBaseArticles: many(knowledgeBaseArticles),
}));

export const usersRelations = relations(users, ({ one, many }) => ({
  department: one(departments, {
    fields: [users.departmentId],
    references: [departments.id],
  }),
  staffProfile: one(staffMembers, {
    fields: [users.id],
    references: [staffMembers.userId],
  }),
  complaints: many(complaints),
  notifications: many(notifications),
  feedbackRatings: many(feedbackRatings),
}));

export const staffMembersRelations = relations(staffMembers, ({ one, many }) => ({
  user: one(users, {
    fields: [staffMembers.userId],
    references: [users.id],
  }),
  department: one(departments, {
    fields: [staffMembers.departmentId],
    references: [departments.id],
  }),
  assignments: many(complaintAssignments),
  complaints: many(complaints),
}));

export const complaintsRelations = relations(complaints, ({ one, many }) => ({
  complainant: one(users, {
    fields: [complaints.userId],
    references: [users.id],
  }),
  department: one(departments, {
    fields: [complaints.departmentId],
    references: [departments.id],
  }),
  category: one(complaintCategories, {
    fields: [complaints.categoryId],
    references: [complaintCategories.id],
  }),
  assignedStaff: one(staffMembers, {
    fields: [complaints.assignedStaffId],
    references: [staffMembers.id],
  }),
  assignments: many(complaintAssignments),
  statusHistory: many(complaintStatusHistory),
  messages: many(complaintMessages),
  attachments: many(attachments),
  aiAnalyses: many(aiAnalysisResults),
  notifications: many(notifications),
  feedback: one(feedbackRatings, {
    fields: [complaints.id],
    references: [feedbackRatings.complaintId],
  }),
}));

export const complaintAssignmentsRelations = relations(complaintAssignments, ({ one }) => ({
  complaint: one(complaints, {
    fields: [complaintAssignments.complaintId],
    references: [complaints.id],
  }),
  department: one(departments, {
    fields: [complaintAssignments.departmentId],
    references: [departments.id],
  }),
  staffMember: one(staffMembers, {
    fields: [complaintAssignments.staffMemberId],
    references: [staffMembers.id],
  }),
}));

export const complaintMessagesRelations = relations(complaintMessages, ({ one }) => ({
  complaint: one(complaints, {
    fields: [complaintMessages.complaintId],
    references: [complaints.id],
  }),
  sender: one(users, {
    fields: [complaintMessages.senderUserId],
    references: [users.id],
  }),
}));

export const aiAnalysisResultsRelations = relations(aiAnalysisResults, ({ one }) => ({
  complaint: one(complaints, {
    fields: [aiAnalysisResults.complaintId],
    references: [complaints.id],
  }),
}));

export const notificationsRelations = relations(notifications, ({ one }) => ({
  user: one(users, {
    fields: [notifications.userId],
    references: [users.id],
  }),
  complaint: one(complaints, {
    fields: [notifications.complaintId],
    references: [complaints.id],
  }),
}));
