export type UserRole = 'USER' | 'STAFF' | 'ADMIN';

export interface UserProfile {
  id: number;
  uid: string;
  email: string;
  name: string;
  phone?: string | null;
  role: UserRole;
  departmentId?: number | null;
  departmentName?: string | null;
  avatarUrl?: string | null;
}

export interface Department {
  id: number;
  name: string;
  code: string;
  description: string;
  responsibilities: string;
  leadEmail?: string | null;
  isActive: boolean;
}

export interface ComplaintCategory {
  id: number;
  name: string;
  description: string;
  defaultDepartmentId?: number | null;
  isSystem: boolean;
  isActive: boolean;
}

export interface SlaConfig {
  id: number;
  priority: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  responseHours: number;
  resolutionHours: number;
  autoEscalate: boolean;
}

export interface ComplaintSummary {
  id: number;
  trackingCode: string;
  userId: number;
  title: string;
  description: string;
  originalLanguage: string;
  categoryName: string;
  priority: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  status: string;
  departmentId: number | null;
  departmentName?: string | null;
  assignedStaffId: number | null;
  location?: string | null;
  aiSummary?: string | null;
  sentiment?: string | null;
  sentimentScore?: number | null;
  isVoiceSubmitted: boolean;
  slaResponseDueAt?: string | null;
  slaResolutionDueAt?: string | null;
  isEscalated: boolean;
  resolvedAt?: string | null;
  closedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  complainantName?: string | null;
  complainantEmail?: string | null;
}

export interface NotificationItem {
  id: number;
  userId: number;
  complaintId: number | null;
  type: string;
  title: string;
  body: string;
  isRead: boolean;
  createdAt: string;
}

export interface IntakePreviewResponse {
  analysis: {
    isDemoMode: boolean;
    modelUsed: string;
    understanding: {
      coreProblem: string;
      detectedLanguage: string;
      summary: string;
      sentiment: string;
      sentimentScore: number;
      extractedDetails: {
        affectedArea: string;
        peopleAffectedEstimate: string;
        safetyRiskDetected: boolean;
        financialImpactDetected: boolean;
        keyEntities: string[];
      };
      followUpQuestions: string[];
    };
    classification: {
      categoryName: string;
      confidenceScore: number;
      reasoning: string;
    };
    priority: {
      level: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
      reasoning: string;
    };
    assignment: {
      departmentId: number | null;
      departmentName: string;
      staffMemberId: number | null;
      staffMemberName: string | null;
      reasoning: string;
    };
    duplicateCandidateIds: number[];
  };
  duplicateComplaints: Array<{
    id: number;
    trackingCode: string;
    title: string;
    categoryName: string;
    location: string | null;
    status: string;
  }>;
}
