import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  Clock,
  FileText,
  Lock,
  MessageSquare,
  Paperclip,
  RotateCcw,
  Send,
  ShieldAlert,
  Star,
  Volume2,
  XCircle,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { apiFetch } from '../lib/api';
import { formatDateTime, formatRelativeSla, priorityStyle, statusMeta } from '../lib/formatters';

interface ComplaintTrackingViewProps {
  complaintId: number;
  onBack: () => void;
}

export function ComplaintTrackingView({ complaintId, onBack }: ComplaintTrackingViewProps) {
  const { user, token, lastWsEvent } = useAuth();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState(false);

  // Messaging state
  const [messageText, setMessageText] = useState('');
  const [isInternalNote, setIsInternalNote] = useState(false);
  const [isAiDrafted, setIsAiDrafted] = useState(false);

  // Staff Resolution & Assistant state
  const [aiAssist, setAiAssist] = useState<any>(null);
  const [assistLoading, setAssistLoading] = useState(false);
  const [resolutionNotes, setResolutionNotes] = useState('');
  const [rejectReason, setRejectReason] = useState('');
  const [showRejectBox, setShowRejectBox] = useState(false);
  const [reopenReason, setReopenReason] = useState('');
  const [showReopenBox, setShowReopenBox] = useState(false);

  // Feedback state
  const [rating, setRating] = useState(5);
  const [speedScore, setSpeedScore] = useState(5);
  const [commScore, setCommScore] = useState(5);
  const [feedbackComment, setFeedbackComment] = useState('');

  // TTS audio playback state
  const [ttsPlaying, setTtsPlaying] = useState(false);

  const loadDetail = useCallback(async () => {
    if (!token) return;
    try {
      const res = await apiFetch(`/api/complaints/${complaintId}`, { token });
      setData(res);
      setError(null);
    } catch (err: any) {
      setError(err?.message || 'Failed to load complaint details.');
    } finally {
      setLoading(false);
    }
  }, [complaintId, token]);

  useEffect(() => {
    loadDetail();
  }, [loadDetail]);

  useEffect(() => {
    if (
      lastWsEvent &&
      (lastWsEvent.event === 'complaint:updated' || lastWsEvent.event === 'message:new') &&
      Number(lastWsEvent.payload?.complaintId) === complaintId
    ) {
      loadDetail();
    }
  }, [lastWsEvent, complaintId, loadDetail]);

  const handleSpeakSummary = async (text: string) => {
    if (!token || !text) return;
    setTtsPlaying(true);
    try {
      const res = await apiFetch<{ audioBase64: string | null; isDemoMode: boolean }>('/api/ai/tts', {
        method: 'POST',
        token,
        body: JSON.stringify({ text }),
      });
      if (res.audioBase64) {
        const audio = new Audio(`data:audio/wav;base64,${res.audioBase64}`);
        audio.onended = () => setTtsPlaying(false);
        await audio.play();
      } else if ('speechSynthesis' in window) {
        const utter = new SpeechSynthesisUtterance(text);
        utter.onend = () => setTtsPlaying(false);
        window.speechSynthesis.speak(utter);
      } else {
        setTtsPlaying(false);
      }
    } catch {
      setTtsPlaying(false);
    }
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!messageText.trim()) return;
    setActionBusy(true);
    try {
      await apiFetch(`/api/complaints/${complaintId}/messages`, {
        method: 'POST',
        token,
        body: JSON.stringify({
          message: messageText,
          isInternalNote,
          isAiDrafted,
        }),
      });
      setMessageText('');
      setIsAiDrafted(false);
      await loadDetail();
    } catch (err: any) {
      setError(err?.message || 'Failed to post message.');
    } finally {
      setActionBusy(false);
    }
  };

  const handleEvidenceUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || file.size > 2.5 * 1024 * 1024) {
      setError('File must be under 2.5MB.');
      return;
    }
    const dataUrl = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(String(reader.result || ''));
      reader.readAsDataURL(file);
    });
    setActionBusy(true);
    try {
      await apiFetch(`/api/complaints/${complaintId}/attachments`, {
        method: 'POST',
        token,
        body: JSON.stringify({
          fileName: file.name,
          mimeType: file.type || 'application/octet-stream',
          fileSize: file.size,
          dataUrl,
          attachmentKind: user?.role !== 'USER' ? 'RESOLUTION_EVIDENCE' : 'SUBMISSION',
        }),
      });
      await loadDetail();
    } catch (err: any) {
      setError(err?.message || 'Failed to upload file.');
    } finally {
      setActionBusy(false);
      e.target.value = '';
    }
  };

  const handleAssignmentDecision = async (decision: 'ACCEPTED' | 'REJECTED') => {
    setActionBusy(true);
    try {
      await apiFetch(`/api/complaints/${complaintId}/assignment-decision`, {
        method: 'POST',
        token,
        body: JSON.stringify({ decision, reason: rejectReason }),
      });
      setShowRejectBox(false);
      setRejectReason('');
      await loadDetail();
    } catch (err: any) {
      setError(err?.message || 'Failed to update assignment.');
    } finally {
      setActionBusy(false);
    }
  };

  const handleStatusChange = async (newStatus: string) => {
    setActionBusy(true);
    try {
      await apiFetch(`/api/complaints/${complaintId}/status`, {
        method: 'PATCH',
        token,
        body: JSON.stringify({ status: newStatus }),
      });
      await loadDetail();
    } catch (err: any) {
      setError(err?.message || 'Failed to update status.');
    } finally {
      setActionBusy(false);
    }
  };

  const handleRequestAiAssist = async () => {
    setAssistLoading(true);
    try {
      const res = await apiFetch(`/api/complaints/${complaintId}/ai-assist`, {
        method: 'POST',
        token,
      });
      setAiAssist(res);
    } catch (err: any) {
      setError(err?.message || 'Failed to invoke Resolution Assistant.');
    } finally {
      setAssistLoading(false);
    }
  };

  const handleResolveSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setActionBusy(true);
    try {
      await apiFetch(`/api/complaints/${complaintId}/resolve`, {
        method: 'POST',
        token,
        body: JSON.stringify({ resolutionNotes }),
      });
      setResolutionNotes('');
      await loadDetail();
    } catch (err: any) {
      setError(err?.message || 'Failed to submit resolution.');
    } finally {
      setActionBusy(false);
    }
  };

  const handleConfirmClose = async () => {
    setActionBusy(true);
    try {
      await apiFetch(`/api/complaints/${complaintId}/confirm-close`, {
        method: 'POST',
        token,
      });
      await loadDetail();
    } catch (err: any) {
      setError(err?.message || 'Failed to close complaint.');
    } finally {
      setActionBusy(false);
    }
  };

  const handleReopen = async () => {
    setActionBusy(true);
    try {
      await apiFetch(`/api/complaints/${complaintId}/reopen`, {
        method: 'POST',
        token,
        body: JSON.stringify({ reason: reopenReason }),
      });
      setShowReopenBox(false);
      setReopenReason('');
      await loadDetail();
    } catch (err: any) {
      setError(err?.message || 'Failed to reopen complaint.');
    } finally {
      setActionBusy(false);
    }
  };

  const handleFeedbackSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setActionBusy(true);
    try {
      await apiFetch(`/api/complaints/${complaintId}/feedback`, {
        method: 'POST',
        token,
        body: JSON.stringify({
          rating,
          resolutionSpeedScore: speedScore,
          communicationScore: commScore,
          comment: feedbackComment,
        }),
      });
      await loadDetail();
    } catch (err: any) {
      setError(err?.message || 'Failed to submit feedback.');
    } finally {
      setActionBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-8 w-48 bg-slate-200 rounded animate-pulse" />
        <div className="h-44 bg-white border border-slate-200 rounded-xl animate-pulse" />
      </div>
    );
  }

  if (!data?.complaint) {
    return (
      <div className="p-8 rounded-xl border border-slate-200 bg-white text-center space-y-3">
        <p className="text-sm font-medium text-[#DC2626]">{error || 'Complaint not found.'}</p>
        <button
          type="button"
          onClick={onBack}
          className="px-4 py-2 rounded-lg bg-[#0F172A] text-white text-xs font-semibold"
        >
          Return to List
        </button>
      </div>
    );
  }

  const { complaint, statusHistory, messages, attachments, aiAnalyses, assignments, feedback } = data;
  const pStyle = priorityStyle(complaint.priority);
  const sMeta = statusMeta(complaint.status);
  const isClosedOrResolved = complaint.status === 'RESOLVED' || complaint.status === 'CLOSED';
  const slaInfo = formatRelativeSla(complaint.slaResolutionDueAt, isClosedOrResolved);
  const isStaffOrAdmin = user?.role === 'STAFF' || user?.role === 'ADMIN';
  const latestAssignment = assignments?.[0];
  const canAcceptOrReject = isStaffOrAdmin && latestAssignment?.status === 'PENDING' && !isClosedOrResolved;

  const understandingLog = aiAnalyses?.find((a: any) => a.agentName === 'UnderstandingAgent');
  const priorityLog = aiAnalyses?.find((a: any) => a.agentName === 'PriorityAgent');
  const assignmentLog = aiAnalyses?.find((a: any) => a.agentName === 'AssignmentAgent');

  return (
    <div className="space-y-6">
      {/* Header Bar */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 hover:text-[#0F172A] mb-2"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Back to Complaints
          </button>
          <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
            <span className="font-mono font-semibold text-[#0F172A]">{complaint.trackingCode}</span>
            <span aria-hidden="true">·</span>
            <span>{complaint.categoryName}</span>
            <span aria-hidden="true">·</span>
            <span>Submitted {formatDateTime(complaint.createdAt)}</span>
            {complaint.isVoiceSubmitted && (
              <>
                <span aria-hidden="true">·</span>
                <span className="font-medium text-[#2563EB]">Voice Intake</span>
              </>
            )}
          </div>
          <h1 className="font-display text-2xl font-bold text-[#0F172A] mt-1">{complaint.title}</h1>
        </div>

        <div className="flex items-center gap-3">
          <div className={`px-3 py-1.5 rounded-lg border text-xs font-semibold ${pStyle.bg} ${pStyle.text}`}>
            Priority: {pStyle.label}
          </div>
          <div className={`px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-semibold ${sMeta.text}`}>
            Status: {sMeta.label}
          </div>
        </div>
      </div>

      {error && (
        <div className="p-3 rounded-lg bg-[#FEF2F2] border border-[#FECACA] text-xs font-medium text-[#DC2626]">
          {error}
        </div>
      )}

      {/* Key Operational Metadata Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 p-5 rounded-xl border border-slate-200 bg-white">
        <div>
          <div className="text-xs text-slate-500">Assigned Department</div>
          <div className="mt-1 text-sm font-semibold text-[#0F172A]">{complaint.departmentName}</div>
          {complaint.assignedStaffName && (
            <div className="text-xs text-slate-500 mt-0.5">{complaint.assignedStaffName}</div>
          )}
        </div>
        <div>
          <div className="text-xs text-slate-500">Response Target</div>
          <div className="mt-1 font-mono text-xs font-semibold text-[#0F172A] tabular-nums">
            {formatDateTime(complaint.slaResponseDueAt)}
          </div>
        </div>
        <div>
          <div className="text-xs text-slate-500">SLA Resolution Window</div>
          <div
            className={`mt-1 text-xs font-semibold tabular-nums ${
              slaInfo.tone === 'critical'
                ? 'text-[#DC2626]'
                : slaInfo.tone === 'warning'
                ? 'text-[#D97706]'
                : 'text-[#16A34A]'
            }`}
          >
            {slaInfo.label}
          </div>
        </div>
        <div>
          <div className="text-xs text-slate-500">Location & Language</div>
          <div className="mt-1 text-xs font-semibold text-[#0F172A]">
            {complaint.location || 'Not specified'} · {complaint.originalLanguage}
          </div>
        </div>
      </div>

      {/* Main 2-Column Content */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column: Description, AI Summary, Communication, Staff Tools */}
        <div className="lg:col-span-8 space-y-6">
          {/* Original Complaint & AI Briefing */}
          <div className="p-6 rounded-xl border border-slate-200 bg-white space-y-4">
            <div className="flex items-center justify-between gap-4">
              <h2 className="text-sm font-semibold text-[#0F172A]">Complaint Details & AI Summary</h2>
              {complaint.aiSummary && (
                <button
                  type="button"
                  disabled={ttsPlaying}
                  onClick={() => handleSpeakSummary(complaint.aiSummary)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 text-xs font-medium text-[#0F172A]"
                >
                  <Volume2 className="w-3.5 h-3.5 text-[#2563EB]" />
                  {ttsPlaying ? 'Playing Briefing...' : 'Listen to Summary'}
                </button>
              )}
            </div>

            {complaint.aiSummary && (
              <div className="p-4 rounded-lg bg-[#F8FAFC] border border-slate-200 text-sm text-[#0F172A]">
                <div className="text-xs font-semibold text-[#2563EB] mb-1">
                  AI Understanding Summary ({complaint.sentiment || 'NEUTRAL'})
                </div>
                <p className="leading-relaxed">{complaint.aiSummary}</p>
              </div>
            )}

            <div>
              <div className="text-xs font-medium text-slate-500 mb-1">Submitted Narrative</div>
              <p className="text-sm text-slate-700 whitespace-pre-wrap leading-relaxed">
                {complaint.description}
              </p>
            </div>

            {/* Staff/Admin AI Reasoning Insights */}
            {isStaffOrAdmin && (priorityLog || assignmentLog || understandingLog) && (
              <div className="pt-4 border-t border-slate-100 grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                {priorityLog && (
                  <div>
                    <span className="font-semibold text-[#0F172A]">Priority Agent Rationale: </span>
                    <span className="text-slate-600">{priorityLog.priorityReasoning}</span>
                  </div>
                )}
                {assignmentLog && (
                  <div>
                    <span className="font-semibold text-[#0F172A]">Routing Agent Rationale: </span>
                    <span className="text-slate-600">{assignmentLog.assignmentReasoning}</span>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Staff / Admin Assignment & Workflow Controls */}
          {isStaffOrAdmin && !isClosedOrResolved && (
            <div className="p-6 rounded-xl border border-slate-200 bg-white space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-sm font-semibold text-[#0F172A]">Department Operations & Resolution</h2>
                <button
                  type="button"
                  disabled={assistLoading}
                  onClick={handleRequestAiAssist}
                  className="px-4 py-2 rounded-lg bg-[#0F172A] hover:bg-[#1E293B] text-white text-xs font-semibold transition-colors disabled:opacity-50"
                >
                  {assistLoading ? 'Consulting Agent 5...' : 'Consult AI Resolution Assistant'}
                </button>
              </div>

              {canAcceptOrReject && (
                <div className="p-4 rounded-lg bg-[#EFF6FF] border border-[#BFDBFE] space-y-3">
                  <div className="text-xs font-semibold text-[#1E3A8A]">
                    Pending Assignment Review — Accept or Reject with Reason
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <button
                      type="button"
                      disabled={actionBusy}
                      onClick={() => handleAssignmentDecision('ACCEPTED')}
                      className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#16A34A] hover:bg-[#15803D] text-white text-xs font-semibold"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      Accept Assignment
                    </button>
                    <button
                      type="button"
                      disabled={actionBusy}
                      onClick={() => setShowRejectBox((v) => !v)}
                      className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border border-[#FECACA] bg-white text-[#DC2626] text-xs font-semibold hover:bg-[#FEF2F2]"
                    >
                      <XCircle className="w-3.5 h-3.5" />
                      Reject Assignment
                    </button>
                  </div>
                  {showRejectBox && (
                    <div className="flex gap-2 pt-2">
                      <input
                        type="text"
                        value={rejectReason}
                        onChange={(e) => setRejectReason(e.target.value)}
                        placeholder="Reason for rejecting (e.g., outside department jurisdiction)..."
                        className="grow px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg"
                      />
                      <button
                        type="button"
                        disabled={actionBusy || rejectReason.trim().length < 5}
                        onClick={() => handleAssignmentDecision('REJECTED')}
                        className="px-4 py-2 rounded-lg bg-[#DC2626] text-white text-xs font-semibold disabled:opacity-50"
                      >
                        Submit Rejection
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* Quick Status Progression */}
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-medium text-slate-500 mr-1">Update Stage:</span>
                {[
                  { id: 'IN_PROGRESS', label: 'In Progress' },
                  { id: 'AWAITING_INFO', label: 'Request Info' },
                  { id: 'ESCALATED', label: 'Escalate' },
                ].map((btn) => (
                  <button
                    key={btn.id}
                    type="button"
                    disabled={actionBusy || complaint.status === btn.id}
                    onClick={() => handleStatusChange(btn.id)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                      complaint.status === btn.id
                        ? 'bg-[#2563EB] text-white border-[#2563EB]'
                        : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                    }`}
                  >
                    {btn.label}
                  </button>
                ))}
              </div>

              {/* Agent 5 Advisory Output */}
              {aiAssist && (
                <div className="p-4 rounded-lg border border-slate-200 bg-[#F8FAFC] space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-[#2563EB]">
                      Agent 5 · Advisory Resolution Playbook {aiAssist.assistant.isDemoMode ? '(Demo Mode)' : ''}
                    </span>
                    {aiAssist.assistant.needsHumanIntervention && (
                      <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#D97706]">
                        <ShieldAlert className="w-3.5 h-3.5" />
                        Human Verification Required
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-700">{aiAssist.assistant.recommendedProcedure}</p>
                  <ul className="list-decimal pl-5 text-xs text-slate-700 space-y-1">
                    {aiAssist.assistant.suggestedSolutions.map((s: string, i: number) => (
                      <li key={i}>{s}</li>
                    ))}
                  </ul>
                  {aiAssist.matchedArticles?.length > 0 && (
                    <div className="text-[11px] text-slate-500">
                      Matched Knowledge Base SOPs:{' '}
                      {aiAssist.matchedArticles.map((a: any) => a.title).join(' · ')}
                    </div>
                  )}
                  {aiAssist.assistant.responseDraft && (
                    <div className="pt-2 border-t border-slate-200 space-y-2">
                      <div className="text-xs font-semibold text-[#0F172A]">AI Draft Response (Review Before Sending)</div>
                      <p className="text-xs text-slate-700 italic">{aiAssist.assistant.responseDraft}</p>
                      <button
                        type="button"
                        onClick={() => {
                          setMessageText(aiAssist.assistant.responseDraft);
                          setIsInternalNote(false);
                          setIsAiDrafted(true);
                        }}
                        className="px-3 py-1.5 rounded-lg bg-[#2563EB] text-white text-xs font-semibold"
                      >
                        Load Draft into Reply Box
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* Submit Final Verified Resolution */}
              <form onSubmit={handleResolveSubmit} className="pt-4 border-t border-slate-200 space-y-3">
                <label className="block text-xs font-semibold text-[#0F172A]">
                  Submit Verified Resolution Action (Generates Agent 7 Closure Report)
                </label>
                <textarea
                  required
                  minLength={10}
                  rows={3}
                  value={resolutionNotes}
                  onChange={(e) => setResolutionNotes(e.target.value)}
                  placeholder="Describe the verified repair, refund, or corrective action implemented by your team..."
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
                />
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <label className="inline-flex items-center gap-1.5 text-xs font-medium text-[#2563EB] cursor-pointer hover:underline">
                    <Paperclip className="w-3.5 h-3.5" />
                    Upload Resolution Evidence
                    <input type="file" onChange={handleEvidenceUpload} className="hidden" />
                  </label>
                  <button
                    type="submit"
                    disabled={actionBusy}
                    className="px-5 py-2 rounded-lg bg-[#16A34A] hover:bg-[#15803D] text-white text-xs font-semibold disabled:opacity-50"
                  >
                    Mark Resolved & Generate Summary
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* Resolution Summary & Closure / Feedback Section */}
          {isClosedOrResolved && (
            <div className="p-6 rounded-xl border border-[#BBF7D0] bg-[#F0FDF4] space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-sm font-semibold text-[#16A34A]">
                  <CheckCircle2 className="w-4 h-4" />
                  {complaint.status === 'CLOSED' ? 'Complaint Verified & Closed' : 'Resolved — Pending Final Closure Confirmation'}
                </div>
                <div className="flex items-center gap-2">
                  {complaint.status === 'RESOLVED' && (
                    <button
                      type="button"
                      disabled={actionBusy}
                      onClick={handleConfirmClose}
                      className="px-4 py-1.5 rounded-lg bg-[#0F172A] text-white text-xs font-semibold hover:bg-[#1E293B]"
                    >
                      Confirm Final Closure
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setShowReopenBox((v) => !v)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    Reopen Case
                  </button>
                </div>
              </div>

              {complaint.closureSummary && (
                <div className="p-4 rounded-lg bg-white border border-slate-200 text-sm text-[#0F172A]">
                  <div className="text-xs font-semibold text-slate-500 mb-1">Agent 7 · Final Closure Briefing</div>
                  <p className="leading-relaxed">{complaint.closureSummary}</p>
                </div>
              )}

              {showReopenBox && (
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={reopenReason}
                    onChange={(e) => setReopenReason(e.target.value)}
                    placeholder="Explain why the issue persists or requires further review..."
                    className="grow px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg"
                  />
                  <button
                    type="button"
                    disabled={actionBusy || reopenReason.trim().length < 5}
                    onClick={handleReopen}
                    className="px-4 py-2 rounded-lg bg-[#DC2626] text-white text-xs font-semibold disabled:opacity-50"
                  >
                    Confirm Reopen
                  </button>
                </div>
              )}

              {/* Citizen Feedback Rating */}
              {user?.id === complaint.userId && (
                <div className="pt-3 border-t border-[#BBF7D0]">
                  {feedback ? (
                    <div className="text-xs text-[#0F172A]">
                      <span className="font-semibold">Your Rating: {feedback.rating}/5</span>
                      {feedback.comment && <span className="text-slate-600"> — "{feedback.comment}"</span>}
                    </div>
                  ) : (
                    <form onSubmit={handleFeedbackSubmit} className="space-y-3">
                      <div className="text-xs font-semibold text-[#0F172A]">
                        Rate Your Resolution Experience
                      </div>
                      <div className="flex flex-wrap items-center gap-6 text-xs">
                        <div className="flex items-center gap-1">
                          <span className="text-slate-600 mr-1">Overall:</span>
                          {[1, 2, 3, 4, 5].map((n) => (
                            <button
                              key={n}
                              type="button"
                              onClick={() => setRating(n)}
                              className="p-0.5"
                              aria-label={`Rate ${n} stars`}
                            >
                              <Star
                                className={`w-4 h-4 ${
                                  n <= rating ? 'text-[#D97706] fill-[#D97706]' : 'text-slate-300'
                                }`}
                              />
                            </button>
                          ))}
                        </div>
                        <label className="flex items-center gap-2 text-slate-600">
                          Speed:
                          <select
                            value={speedScore}
                            onChange={(e) => setSpeedScore(Number(e.target.value))}
                            className="border border-slate-300 rounded px-2 py-1 bg-white"
                          >
                            {[5, 4, 3, 2, 1].map((v) => (
                              <option key={v} value={v}>
                                {v}/5
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="flex items-center gap-2 text-slate-600">
                          Communication:
                          <select
                            value={commScore}
                            onChange={(e) => setCommScore(Number(e.target.value))}
                            className="border border-slate-300 rounded px-2 py-1 bg-white"
                          >
                            {[5, 4, 3, 2, 1].map((v) => (
                              <option key={v} value={v}>
                                {v}/5
                              </option>
                            ))}
                          </select>
                        </label>
                      </div>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={feedbackComment}
                          onChange={(e) => setFeedbackComment(e.target.value)}
                          placeholder="Optional comment about the resolution..."
                          className="grow px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg"
                        />
                        <button
                          type="submit"
                          disabled={actionBusy}
                          className="px-4 py-2 rounded-lg bg-[#16A34A] text-white text-xs font-semibold"
                        >
                          Submit Rating
                        </button>
                      </div>
                    </form>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Communication & Messages Thread */}
          <div className="p-6 rounded-xl border border-slate-200 bg-white space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-semibold text-[#0F172A]">
                <MessageSquare className="w-4 h-4 text-[#2563EB]" />
                Communication Thread
              </div>
              <label className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 cursor-pointer hover:text-[#0F172A]">
                <Paperclip className="w-3.5 h-3.5" />
                Attach File
                <input type="file" onChange={handleEvidenceUpload} className="hidden" />
              </label>
            </div>

            <div className="space-y-3 max-h-96 overflow-y-auto pr-1">
              {messages?.length === 0 ? (
                <p className="text-xs text-slate-500 py-4 text-center">
                  No messages yet. Use the box below to send an update or request clarification.
                </p>
              ) : (
                messages.map((m: any) => (
                  <div
                    key={m.id}
                    className={`p-3.5 rounded-lg border text-sm ${
                      m.isInternalNote
                        ? 'bg-[#FFFBEB] border-[#FDE68A]'
                        : m.senderUserId === user?.id
                        ? 'bg-[#EFF6FF] border-[#BFDBFE]'
                        : 'bg-slate-50 border-slate-200'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 text-xs mb-1">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-[#0F172A]">{m.senderName}</span>
                        <span className="text-slate-500">· {m.senderRole}</span>
                        {m.isInternalNote && (
                          <span className="inline-flex items-center gap-1 font-semibold text-[#D97706]">
                            <Lock className="w-3 h-3" />
                            Internal Note
                          </span>
                        )}
                      </div>
                      <span className="text-slate-500 tabular-nums">{formatDateTime(m.createdAt)}</span>
                    </div>
                    <p className="text-slate-800 whitespace-pre-wrap">{m.message}</p>
                  </div>
                ))
              )}
            </div>

            <form onSubmit={handleSendMessage} className="space-y-2 pt-2 border-t border-slate-100">
              {isStaffOrAdmin && (
                <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isInternalNote}
                    onChange={(e) => setIsInternalNote(e.target.checked)}
                    className="rounded border-slate-300"
                  />
                  Post as internal department note (hidden from complainant)
                </label>
              )}
              <div className="flex gap-2">
                <input
                  type="text"
                  value={messageText}
                  onChange={(e) => setMessageText(e.target.value)}
                  placeholder={isInternalNote ? 'Write internal staff note...' : 'Write a message...'}
                  className="grow px-3.5 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
                />
                <button
                  type="submit"
                  disabled={actionBusy || !messageText.trim()}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#2563EB] hover:bg-[#1D4ED8] text-white text-xs font-semibold disabled:opacity-50"
                >
                  <Send className="w-3.5 h-3.5" />
                  Send
                </button>
              </div>
            </form>
          </div>
        </div>

        {/* Right Column: Status Timeline & Attachments */}
        <div className="lg:col-span-4 space-y-6">
          <div className="p-6 rounded-xl border border-slate-200 bg-white space-y-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-[#0F172A]">
              <Clock className="w-4 h-4 text-[#2563EB]" />
              Audit & Status Timeline
            </div>
            <div className="space-y-4">
              {statusHistory?.map((h: any) => (
                <div key={h.id} className="pb-3 border-b border-slate-100 last:border-b-0 last:pb-0">
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="font-semibold text-[#0F172A]">{statusMeta(h.toStatus).label}</span>
                    <span className="text-slate-500 tabular-nums">{formatDateTime(h.createdAt)}</span>
                  </div>
                  <div className="text-xs text-slate-600 mt-1">{h.note}</div>
                  <div className="text-[11px] text-slate-400 mt-0.5">Actor: {h.actorLabel}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="p-6 rounded-xl border border-slate-200 bg-white space-y-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-[#0F172A]">
              <FileText className="w-4 h-4 text-[#2563EB]" />
              Attachments & Evidence ({attachments?.length || 0})
            </div>
            {attachments?.length === 0 ? (
              <p className="text-xs text-slate-500">No files uploaded.</p>
            ) : (
              <div className="space-y-3">
                {attachments.map((att: any) => (
                  <div key={att.id} className="p-3 rounded-lg border border-slate-200 bg-slate-50 space-y-2">
                    {att.mimeType?.startsWith('image/') && (
                      <img
                        src={att.dataUrl}
                        alt={att.fileName}
                        className="w-full h-32 object-cover rounded border border-slate-200"
                      />
                    )}
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <div className="truncate">
                        <div className="font-medium text-[#0F172A] truncate">{att.fileName}</div>
                        <div className="text-[11px] text-slate-500">
                          {att.attachmentKind === 'RESOLUTION_EVIDENCE' ? 'Resolution Proof' : 'Submission'}
                        </div>
                      </div>
                      <a
                        href={att.dataUrl}
                        download={att.fileName}
                        className="text-xs font-semibold text-[#2563EB] hover:underline shrink-0"
                      >
                        Download
                      </a>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {complaint.isEscalated && (
            <div className="p-4 rounded-xl border border-[#FECACA] bg-[#FEF2F2] flex items-start gap-2.5 text-xs text-[#DC2626]">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <div>
                <div className="font-semibold">Escalated Ticket</div>
                <div className="mt-0.5 text-slate-700">
                  Flagged for priority executive oversight due to Critical severity or SLA breach.
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
