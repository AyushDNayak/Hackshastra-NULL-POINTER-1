import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  FileText,
  Info,
  Paperclip,
  Trash2,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { apiFetch } from '../lib/api';
import type { ComplaintCategory, Department, IntakePreviewResponse } from '../types';
import { VoiceRecorder } from './VoiceRecorder';

interface SubmitComplaintViewProps {
  onSubmitted: (complaintId: number) => void;
  onCancel: () => void;
}

interface UploadedFile {
  fileName: string;
  mimeType: string;
  fileSize: number;
  dataUrl: string;
}

export function SubmitComplaintView({ onSubmitted, onCancel }: SubmitComplaintViewProps) {
  const { user, token } = useAuth();
  const [categories, setCategories] = useState<ComplaintCategory[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [preferredCategory, setPreferredCategory] = useState('');
  const [location, setLocation] = useState('');
  const [contactPhone, setContactPhone] = useState(user?.phone || '');
  const [contactEmail, setContactEmail] = useState(user?.email || '');
  const [isVoiceSubmitted, setIsVoiceSubmitted] = useState(false);
  const [voiceTranscript, setVoiceTranscript] = useState('');
  const [files, setFiles] = useState<UploadedFile[]>([]);

  const [analyzing, setAnalyzing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [preview, setPreview] = useState<IntakePreviewResponse | null>(null);
  const [correctedCategory, setCorrectedCategory] = useState('');
  const [correctedPriority, setCorrectedPriority] = useState<'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'>('MEDIUM');
  const [correctedDepartmentId, setCorrectedDepartmentId] = useState<number | ''>('');
  const [followUpSupplement, setFollowUpSupplement] = useState('');

  useEffect(() => {
    apiFetch<{ categories: ComplaintCategory[]; departments: Department[] }>('/api/meta')
      .then((data) => {
        setCategories(data.categories || []);
        setDepartments(data.departments || []);
      })
      .catch(() => {});
  }, []);

  const handleVoiceTranscript = (transcript: string) => {
    setIsVoiceSubmitted(true);
    setVoiceTranscript((prev) => (prev ? `${prev} ${transcript}` : transcript));
    setDescription((prev) => (prev ? `${prev}\n${transcript}` : transcript));
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(e.target.files || []);
    if (selected.length === 0) return;

    const remainingSlots = Math.max(0, 5 - files.length);
    const toProcess = selected.slice(0, remainingSlots);
    const loaded: UploadedFile[] = [];

    for (const file of toProcess) {
      if (file.size > 2.5 * 1024 * 1024) {
        setError(`"${file.name}" exceeds the 2.5MB upload limit.`);
        continue;
      }
      const dataUrl = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(String(reader.result || ''));
        reader.readAsDataURL(file);
      });
      loaded.push({
        fileName: file.name,
        mimeType: file.type || 'application/octet-stream',
        fileSize: file.size,
        dataUrl,
      });
    }

    setFiles((prev) => [...prev, ...loaded]);
    e.target.value = '';
  };

  const handleAnalyzePreview = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setAnalyzing(true);
    try {
      const res = await apiFetch<IntakePreviewResponse>('/api/complaints/analyze-preview', {
        method: 'POST',
        token,
        body: JSON.stringify({
          title,
          description,
          location,
          preferredCategory: preferredCategory || null,
          attachments: files,
        }),
      });
      setPreview(res);
      setCorrectedCategory(res.analysis.classification.categoryName);
      setCorrectedPriority(res.analysis.priority.level);
      setCorrectedDepartmentId(res.analysis.assignment.departmentId || '');
    } catch (err: any) {
      setError(err?.message || 'Unable to analyze complaint.');
    } finally {
      setAnalyzing(false);
    }
  };

  const handleConfirmSubmit = async () => {
    if (!preview) return;
    setError(null);
    setSubmitting(true);
    try {
      const finalDescription = followUpSupplement.trim()
        ? `${description.trim()}\n\nAdditional Details: ${followUpSupplement.trim()}`
        : description.trim();

      const res = await apiFetch<{ complaint: { id: number } }>('/api/complaints', {
        method: 'POST',
        token,
        body: JSON.stringify({
          title,
          description: finalDescription,
          location,
          contactPhone,
          contactEmail,
          preferredCategory: preferredCategory || null,
          correctedCategoryName: correctedCategory,
          correctedPriority,
          correctedDepartmentId: correctedDepartmentId || null,
          isVoiceSubmitted,
          voiceTranscript,
          attachments: files,
          precomputedAnalysis: preview.analysis,
        }),
      });
      onSubmitted(res.complaint.id);
    } catch (err: any) {
      setError(err?.message || 'Failed to finalize complaint submission.');
    } finally {
      setSubmitting(false);
    }
  };

  if (preview) {
    const { analysis, duplicateComplaints } = preview;
    return (
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <button
              type="button"
              onClick={() => setPreview(null)}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 hover:text-[#0F172A] mb-2"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              Edit Complaint Draft
            </button>
            <h1 className="font-display text-2xl font-bold text-[#0F172A]">
              AI Triage & Routing Verification
            </h1>
            <p className="text-sm text-slate-600 mt-1">
              Review the extracted AI analysis below and adjust any classification before submitting.
            </p>
          </div>
        </div>

        {analysis.isDemoMode && (
          <div className="p-4 rounded-xl border border-[#FDE68A] bg-[#FFFBEB] flex items-start gap-3">
            <Info className="w-4 h-4 text-[#D97706] shrink-0 mt-0.5" />
            <div className="text-xs text-[#92400E]">
              <span className="font-semibold">Demo AI Mode Active:</span> GEMINI_API_KEY is not configured on the server, so deterministic rule-based classification is shown below.
            </div>
          </div>
        )}

        {duplicateComplaints.length > 0 && (
          <div className="p-4 rounded-xl border border-[#FECACA] bg-[#FEF2F2] space-y-2">
            <div className="flex items-center gap-2 text-xs font-semibold text-[#DC2626]">
              <AlertTriangle className="w-4 h-4" />
              Potential Duplicate Incidents Detected
            </div>
            <p className="text-xs text-slate-700">
              Our AI detected active complaints that closely match your report. You may still proceed if this is a distinct occurrence:
            </p>
            <ul className="space-y-1 text-xs text-slate-700">
              {duplicateComplaints.map((d) => (
                <li key={d.id} className="font-mono">
                  {d.trackingCode} · {d.title} ({d.status})
                </li>
              ))}
            </ul>
          </div>
        )}

        {error && (
          <div className="p-3 rounded-lg bg-[#FEF2F2] border border-[#FECACA] text-xs font-medium text-[#DC2626]">
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="p-6 rounded-xl border border-slate-200 bg-white space-y-4">
            <div className="text-xs font-semibold text-[#2563EB]">
              Agent 1 · Understanding & Sentiment
            </div>
            <div>
              <div className="text-xs text-slate-500">AI-Generated Summary</div>
              <p className="mt-1 text-sm text-[#0F172A] leading-relaxed">
                {analysis.understanding.summary}
              </p>
            </div>
            <div className="grid grid-cols-2 gap-4 pt-3 border-t border-slate-100 text-xs">
              <div>
                <div className="text-slate-500">Detected Language</div>
                <div className="mt-0.5 font-semibold text-[#0F172A]">
                  {analysis.understanding.detectedLanguage}
                </div>
              </div>
              <div>
                <div className="text-slate-500">Sentiment & Urgency Index</div>
                <div className="mt-0.5 font-semibold text-[#0F172A] tabular-nums">
                  {analysis.understanding.sentiment} ({analysis.understanding.sentimentScore}/100)
                </div>
              </div>
            </div>
            <div className="pt-3 border-t border-slate-100 text-xs space-y-1">
              <div className="text-slate-500">Extracted Operational Context</div>
              <div className="text-[#0F172A]">
                Zone: {analysis.understanding.extractedDetails.affectedArea} · Impact: {analysis.understanding.extractedDetails.peopleAffectedEstimate}
              </div>
            </div>
          </div>

          <div className="p-6 rounded-xl border border-slate-200 bg-white space-y-4">
            <div className="text-xs font-semibold text-[#2563EB]">
              Agents 2–4 · Editable Routing Decision
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Category (AI Confidence: {analysis.classification.confidenceScore}%)
              </label>
              <select
                value={correctedCategory}
                onChange={(e) => setCorrectedCategory(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
              >
                {categories.map((c) => (
                  <option key={c.id} value={c.name}>
                    {c.name}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-[11px] text-slate-500">{analysis.classification.reasoning}</p>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Assigned Priority
              </label>
              <select
                value={correctedPriority}
                onChange={(e) => setCorrectedPriority(e.target.value as any)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
              >
                <option value="CRITICAL">Critical (Immediate Escalation)</option>
                <option value="HIGH">High</option>
                <option value="MEDIUM">Medium</option>
                <option value="LOW">Low</option>
              </select>
              <p className="mt-1 text-[11px] text-slate-500">{analysis.priority.reasoning}</p>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Assigned Department
              </label>
              <select
                value={correctedDepartmentId}
                onChange={(e) => setCorrectedDepartmentId(e.target.value ? Number(e.target.value) : '')}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
              >
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-[11px] text-slate-500">
                {analysis.assignment.reasoning}
                {analysis.assignment.staffMemberName
                  ? ` · Recommended Specialist: ${analysis.assignment.staffMemberName}`
                  : ''}
              </p>
            </div>
          </div>
        </div>

        {analysis.understanding.followUpQuestions.length > 0 && (
          <div className="p-6 rounded-xl border border-slate-200 bg-white space-y-3">
            <div className="text-xs font-semibold text-[#0F172A]">
              Agent 1 Clarifying Questions (Optional Additional Context)
            </div>
            <ul className="list-disc pl-5 text-xs text-slate-600 space-y-1">
              {analysis.understanding.followUpQuestions.map((q, idx) => (
                <li key={idx}>{q}</li>
              ))}
            </ul>
            <textarea
              rows={2}
              value={followUpSupplement}
              onChange={(e) => setFollowUpSupplement(e.target.value)}
              placeholder="Add any clarifying details here to help the department resolve faster..."
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
            />
          </div>
        )}

        <div className="flex items-center justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={() => setPreview(null)}
            className="px-4 py-2.5 rounded-lg border border-slate-300 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            Back to Edit
          </button>
          <button
            type="button"
            disabled={submitting}
            onClick={handleConfirmSubmit}
            className="inline-flex items-center gap-2 px-6 py-2.5 rounded-lg bg-[#16A34A] hover:bg-[#15803D] text-white text-xs font-semibold transition-colors disabled:opacity-50"
          >
            <CheckCircle2 className="w-4 h-4" />
            {submitting ? 'Submitting & Dispatching...' : 'Confirm & Submit Complaint'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-[#0F172A]">Submit New Complaint</h1>
          <p className="text-sm text-slate-600 mt-1">
            Describe your issue in text or voice in any language. Our AI pipeline will categorize, score urgency, and assign it automatically.
          </p>
        </div>
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 rounded-lg border border-slate-300 text-xs font-semibold text-slate-700 hover:bg-slate-50 whitespace-nowrap"
        >
          Cancel
        </button>
      </div>

      {error && (
        <div className="p-3 rounded-lg bg-[#FEF2F2] border border-[#FECACA] text-xs font-medium text-[#DC2626]">
          {error}
        </div>
      )}

      <form onSubmit={handleAnalyzePreview} className="p-6 rounded-xl border border-slate-200 bg-white space-y-5">
        <div>
          <label className="block text-xs font-semibold text-[#0F172A] mb-1.5">
            Complaint Title *
          </label>
          <input
            type="text"
            required
            minLength={4}
            maxLength={200}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g., Sparking utility pole transformer on Oak Avenue"
            className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-[#0F172A] mb-1.5">
            Detailed Description (Any Language — Type or Dictate via Voice) *
          </label>
          <VoiceRecorder token={token} onTranscriptReady={handleVoiceTranscript} />
          <textarea
            required
            minLength={10}
            rows={5}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Describe what happened, when it started, how many people or systems are impacted, and any immediate safety risks..."
            className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-[#0F172A] mb-1.5">
              Category (Optional — AI Auto-Detects)
            </label>
            <select
              value={preferredCategory}
              onChange={(e) => setPreferredCategory(e.target.value)}
              className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
            >
              <option value="">Let AI determine automatically</option>
              {categories.map((c) => (
                <option key={c.id} value={c.name}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-[#0F172A] mb-1.5">
              Location / Facility / Zone (Optional)
            </label>
            <input
              type="text"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="e.g., Block 4, 210 Oak Ave or Portal Checkout"
              className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-[#0F172A] mb-1.5">
              Contact Email
            </label>
            <input
              type="email"
              value={contactEmail}
              onChange={(e) => setContactEmail(e.target.value)}
              placeholder="citizen@example.com"
              className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-[#0F172A] mb-1.5">
              Contact Phone (Optional)
            </label>
            <input
              type="tel"
              value={contactPhone}
              onChange={(e) => setContactPhone(e.target.value)}
              placeholder="+1 (555) 019-2834"
              className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold text-[#0F172A] mb-1.5">
            Supporting Images or Documents (Max 5 files, 2.5MB each)
          </label>
          <label className="flex items-center justify-center gap-2 px-4 py-4 rounded-lg border border-dashed border-slate-300 bg-slate-50 hover:bg-slate-100 cursor-pointer transition-colors text-xs font-medium text-slate-700">
            <Paperclip className="w-4 h-4 text-[#2563EB]" />
            <span>Attach photos, invoices, or diagnostic PDFs</span>
            <input
              type="file"
              multiple
              accept="image/*,.pdf,.txt,.csv,.doc,.docx"
              onChange={handleFileChange}
              className="hidden"
            />
          </label>

          {files.length > 0 && (
            <div className="mt-3 space-y-2">
              {files.map((f, idx) => (
                <div
                  key={`${f.fileName}-${idx}`}
                  className="flex items-center justify-between px-3 py-2 rounded-lg border border-slate-200 bg-slate-50 text-xs"
                >
                  <div className="flex items-center gap-2 truncate">
                    <FileText className="w-4 h-4 text-slate-500 shrink-0" />
                    <span className="font-medium text-[#0F172A] truncate">{f.fileName}</span>
                    <span className="text-slate-500 tabular-nums">
                      ({Math.round(f.fileSize / 1024)} KB)
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setFiles((prev) => prev.filter((_, i) => i !== idx))}
                    className="p-1 text-slate-500 hover:text-[#DC2626]"
                    aria-label={`Remove ${f.fileName}`}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-3 pt-2 border-t border-slate-100">
          <button
            type="submit"
            disabled={analyzing}
            className="inline-flex items-center gap-2 px-6 py-2.5 rounded-lg bg-[#2563EB] hover:bg-[#1D4ED8] text-white text-sm font-semibold transition-colors disabled:opacity-50"
          >
            {analyzing ? 'Running AI Triage Agents...' : 'Analyze with AI & Preview Routing'}
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </form>
    </div>
  );
}
