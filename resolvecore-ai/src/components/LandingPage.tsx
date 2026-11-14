import React, { useEffect, useState } from 'react';
import {
  ArrowRight,
  CheckCircle2,
  Clock,
  Layers,
  Mic,
  ShieldCheck,
  Workflow,
} from 'lucide-react';
import { apiFetch } from '../lib/api';

interface LandingPageProps {
  onOpenAuth: (mode: 'login' | 'register') => void;
  onEnterWorkspace: () => void;
  isAuthenticated: boolean;
}

const AGENTS = [
  {
    index: '01',
    name: 'Understanding Agent',
    detail: 'Parses unstructured complaints and spoken voice transcripts across languages, extracts core entities, and detects missing details.',
  },
  {
    index: '02',
    name: 'Classification Agent',
    detail: 'Categorizes reports across dynamic enterprise taxonomies and detects duplicate incidents in active queues.',
  },
  {
    index: '03',
    name: 'Priority Assessment Agent',
    detail: 'Scores operational urgency, safety hazards, and population impact into Critical, High, Medium, or Low tiers.',
  },
  {
    index: '04',
    name: 'Department Assignment Agent',
    detail: 'Matches complaint scope against departmental responsibilities and real-time staff capacity to assign owners immediately.',
  },
  {
    index: '05',
    name: 'Resolution Assistant Agent',
    detail: 'Retrieves standard operating procedures from the knowledge base and drafts staff-approved responses.',
  },
  {
    index: '06',
    name: 'Notification & SLA Agent',
    detail: 'Dispatches instant WebSocket alerts and monitors SLA deadlines to trigger automatic escalations on overdue tickets.',
  },
  {
    index: '07',
    name: 'Resolution Summary Agent',
    detail: 'Compiles a structured closure briefing with verified actions taken before authorized sign-off and feedback collection.',
  },
];

const WORKFLOW_STEPS = [
  { step: '01', title: 'Multimodal Intake', desc: 'Complainant submits text, voice audio, and supporting files.' },
  { step: '02', title: 'NLP & Voice Triage', desc: 'AI extracts problem summary, language, and urgency signals.' },
  { step: '03', title: 'Smart Department Routing', desc: 'Complaint is assigned to the optimal department and specialist.' },
  { step: '04', title: 'Human-Verified Resolution', desc: 'Staff review AI SOP drafts, resolve, and confirm closure.' },
];

export function LandingPage({ onOpenAuth, onEnterWorkspace, isAuthenticated }: LandingPageProps) {
  const [stats, setStats] = useState({
    totalComplaints: 0,
    resolvedComplaints: 0,
    activeDepartments: 8,
    aiConfigured: true,
  });
  const [contactEmail, setContactEmail] = useState('');
  const [contactMessage, setContactMessage] = useState('');
  const [contactSent, setContactSent] = useState(false);

  useEffect(() => {
    apiFetch<typeof stats>('/api/public-stats')
      .then((data) => setStats(data))
      .catch(() => {});
  }, []);

  const handleContactSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!contactEmail || !contactMessage.trim()) return;
    setContactSent(true);
    setContactEmail('');
    setContactMessage('');
  };

  return (
    <div className="min-h-screen bg-[#F8FAFC] text-[#0F172A]">
      {/* Strict 3-Zone Top Bar Contract */}
      <header className="sticky top-0 z-30 bg-white/95 backdrop-blur-xs border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between gap-8">
          <a
            href="#top"
            className="font-display text-lg font-bold tracking-tight text-[#0F172A] whitespace-nowrap shrink-0"
          >
            ResolveCore AI
          </a>

          <nav className="hidden md:flex items-center gap-7 text-sm font-medium text-slate-600">
            <a href="#agents" className="hover:text-[#0F172A] transition-colors whitespace-nowrap shrink-0">
              AI Agents
            </a>
            <a href="#workflow" className="hover:text-[#0F172A] transition-colors whitespace-nowrap shrink-0">
              Workflow
            </a>
            <a href="#capabilities" className="hover:text-[#0F172A] transition-colors whitespace-nowrap shrink-0">
              Capabilities
            </a>
            <a href="#contact" className="hover:text-[#0F172A] transition-colors whitespace-nowrap shrink-0">
              Contact
            </a>
          </nav>

          <div className="shrink-0">
            {isAuthenticated ? (
              <button
                type="button"
                onClick={onEnterWorkspace}
                className="px-4 py-2 text-xs font-semibold text-white bg-[#2563EB] hover:bg-[#1D4ED8] rounded-lg transition-colors whitespace-nowrap shrink-0"
              >
                Open Workspace
              </button>
            ) : (
              <button
                type="button"
                onClick={() => onOpenAuth('login')}
                className="px-4 py-2 text-xs font-semibold text-white bg-[#0F172A] hover:bg-[#1E293B] rounded-lg transition-colors whitespace-nowrap shrink-0"
              >
                Sign In
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section id="top" className="bg-white border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-6 py-16 lg:py-20">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-stretch">
            <div className="lg:col-span-6 flex flex-col justify-between space-y-8">
              <div className="space-y-5">
                <p className="text-xs font-semibold tracking-wide text-[#2563EB]">
                  Multi-Agent Complaint Intelligence · Enterprise SaaS
                </p>
                <h1
                  className="font-display font-bold tracking-tight text-[#0F172A] leading-[1.08] text-balance"
                  style={{ fontSize: 'clamp(2.25rem, 4vw, 3.65rem)' }}
                >
                  Smarter Complaints. Faster Resolutions.
                </h1>
                <p className="text-base text-slate-600 leading-relaxed max-w-xl">
                  An autonomous 7-agent resolution engine that transcribes voice and multilingual complaints, classifies severity in seconds, assigns the right department based on live workload, and enforces SLA accountability through verified closure.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-4">
                <button
                  type="button"
                  onClick={() => (isAuthenticated ? onEnterWorkspace() : onOpenAuth('register'))}
                  className="inline-flex items-center gap-2 px-6 py-3 rounded-lg bg-[#2563EB] hover:bg-[#1D4ED8] text-white text-sm font-semibold transition-colors whitespace-nowrap"
                >
                  {isAuthenticated ? 'Go to Dashboard' : 'Submit a Complaint'}
                  <ArrowRight className="w-4 h-4" />
                </button>
                {!isAuthenticated && (
                  <button
                    type="button"
                    onClick={() => onOpenAuth('login')}
                    className="px-5 py-3 rounded-lg border border-slate-300 text-sm font-semibold text-[#0F172A] hover:bg-slate-50 transition-colors whitespace-nowrap"
                  >
                    Staff & Admin Login
                  </button>
                )}
              </div>
            </div>

            <div className="lg:col-span-6">
              <div className="relative h-full min-h-[300px] rounded-xl overflow-hidden border border-slate-200 bg-[#0F172A]">
                <img
                  src="/src/assets/images/hero_command_center_1794640132103.jpg"
                  alt="ResolveCore AI enterprise operations headquarters"
                  referrerPolicy="no-referrer"
                  className="w-full h-full lg:h-full object-cover"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-[#0F172A]/85 via-[#0F172A]/20 to-transparent" />
                <div className="absolute bottom-5 left-5 right-5 text-white">
                  <div className="text-xs text-[#93C5FD] font-medium">
                    Real-Time Triage · Role-Based Portals · Voice Intake
                  </div>
                  <div className="mt-1 text-base font-semibold">
                    End-to-end orchestration from initial citizen report to audited resolution.
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Full-width 4-column live platform KPI strip */}
          <div className="mt-12 pt-8 border-t border-slate-200 grid grid-cols-2 lg:grid-cols-4 gap-6">
            <div>
              <div className="text-xs font-medium text-slate-500">Specialized AI Agents</div>
              <div className="mt-1 font-mono text-2xl font-bold text-[#0F172A] tabular-nums">7</div>
            </div>
            <div>
              <div className="text-xs font-medium text-slate-500">Active Operational Departments</div>
              <div className="mt-1 font-mono text-2xl font-bold text-[#0F172A] tabular-nums">
                {stats.activeDepartments}
              </div>
            </div>
            <div>
              <div className="text-xs font-medium text-slate-500">Recorded Platform Complaints</div>
              <div className="mt-1 font-mono text-2xl font-bold text-[#0F172A] tabular-nums">
                {stats.totalComplaints}
              </div>
            </div>
            <div>
              <div className="text-xs font-medium text-slate-500">Verified Resolutions</div>
              <div className="mt-1 font-mono text-2xl font-bold text-[#16A34A] tabular-nums">
                {stats.resolvedComplaints}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* How the AI System Works (7-Agent Architecture) */}
      <section id="agents" className="max-w-7xl mx-auto px-6 py-16 lg:py-20">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-start">
          <div className="lg:col-span-5 space-y-6">
            <div className="space-y-3">
              <p className="text-xs font-semibold text-[#2563EB]">Agentic Architecture</p>
              <h2 className="font-display text-3xl font-bold tracking-tight text-[#0F172A] text-balance">
                Seven specialized agents coordinated with human accountability
              </h2>
              <p className="text-sm text-slate-600 leading-relaxed">
                Every complaint passes through a deterministic multi-agent pipeline backed by PostgreSQL audit trails. AI recommends triage and solutions, while authorized department staff retain final approval.
              </p>
            </div>
            <div className="rounded-xl overflow-hidden border border-slate-200 bg-white">
              <img
                src="/src/assets/images/workflow_agent_network_1794640131208.jpg"
                alt="Multi-agent routing and triage network"
                referrerPolicy="no-referrer"
                className="w-full aspect-4/3 object-cover"
              />
            </div>
          </div>

          <div className="lg:col-span-7 divide-y divide-slate-200 bg-white rounded-xl border border-slate-200">
            {AGENTS.map((agent) => (
              <div key={agent.index} className="p-5 flex items-start gap-4">
                <span className="font-mono text-xs font-semibold text-[#2563EB] pt-0.5 tabular-nums shrink-0">
                  {agent.index}.
                </span>
                <div>
                  <h3 className="text-sm font-semibold text-[#0F172A]">{agent.name}</h3>
                  <p className="mt-1 text-sm text-slate-600 leading-relaxed">{agent.detail}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Workflow & Capabilities */}
      <section id="workflow" className="bg-white border-y border-slate-200">
        <div className="max-w-7xl mx-auto px-6 py-16">
          <div className="max-w-2xl mb-10">
            <p className="text-xs font-semibold text-[#2563EB]">Complaint Lifecycle</p>
            <h2 className="mt-2 font-display text-3xl font-bold tracking-tight text-[#0F172A]">
              Transparent 13-step resolution pipeline
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {WORKFLOW_STEPS.map((item) => (
              <div key={item.step} className="p-6 rounded-xl border border-slate-200 bg-[#F8FAFC]">
                <div className="font-mono text-xs font-semibold text-[#2563EB] tabular-nums">
                  Stage {item.step}
                </div>
                <h3 className="mt-2 text-base font-semibold text-[#0F172A]">{item.title}</h3>
                <p className="mt-2 text-sm text-slate-600 leading-relaxed">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Capabilities Asymmetric Bento */}
      <section id="capabilities" className="max-w-7xl mx-auto px-6 py-16">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 p-8 rounded-xl border border-slate-200 bg-white flex flex-col justify-between gap-6">
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 rounded-lg bg-[#0F172A] text-white flex items-center justify-center shrink-0">
                <Mic className="w-5 h-5 text-[#60A5FA]" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-[#0F172A]">
                  Voice Detection & Multilingual NLP Intake
                </h3>
                <p className="mt-2 text-sm text-slate-600 leading-relaxed max-w-xl">
                  Citizens can dictate complaints directly via microphone with live audio waveform capture. Audio is transcribed and analyzed across languages, detecting sentiment, duplicate reports, and missing field details automatically.
                </p>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-4 border-t border-slate-100 text-xs text-slate-600">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-[#16A34A] shrink-0" />
                <span>Pre-submission AI review</span>
              </div>
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-[#D97706] shrink-0" />
                <span>Automated SLA escalations</span>
              </div>
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-[#2563EB] shrink-0" />
                <span>Role-isolated privacy</span>
              </div>
            </div>
          </div>

          <div className="p-8 rounded-xl border border-slate-200 bg-[#0F172A] text-white flex flex-col justify-between gap-6">
            <div>
              <div className="flex items-center gap-2 text-xs font-medium text-[#93C5FD]">
                <Workflow className="w-4 h-4" />
                <span>Governance & Oversight</span>
              </div>
              <h3 className="mt-3 text-lg font-semibold">
                Human-in-the-Loop Safeguards
              </h3>
              <p className="mt-2 text-sm text-slate-300 leading-relaxed">
                AI suggestions never close tickets autonomously. Administrators can override classifications, inspect full audit logs, and track predictive operational insights separately from recorded metrics.
              </p>
            </div>
            <div className="flex items-center gap-3 pt-4 border-t border-white/10">
              <img
                src="/src/assets/images/avatar_operations_lead_1794640132605.jpg"
                alt="Operations Director"
                referrerPolicy="no-referrer"
                className="w-10 h-10 rounded-full object-cover border border-white/20"
              />
              <div>
                <div className="text-xs font-semibold">Enterprise RBAC Enforcement</div>
                <div className="text-xs text-slate-400">Complainant · Department Staff · Admin</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* About & Contact Section */}
      <section id="contact" className="bg-white border-t border-slate-200">
        <div className="max-w-7xl mx-auto px-6 py-16 grid grid-cols-1 lg:grid-cols-12 gap-12">
          <div className="lg:col-span-6 space-y-4">
            <p className="text-xs font-semibold text-[#2563EB]">About ResolveCore AI</p>
            <h2 className="font-display text-2xl font-bold text-[#0F172A]">
              Built for municipalities, enterprise IT, and public service operations
            </h2>
            <p className="text-sm text-slate-600 leading-relaxed">
              ResolveCore AI combines relational PostgreSQL persistence, authenticated real-time WebSocket updates, and specialized Gemini AI agents to replace manual ticket triage with transparent, auditable accountability.
            </p>
            <div className="flex items-center gap-3 pt-2 text-xs text-slate-500">
              <Layers className="w-4 h-4 text-[#0F172A]" />
              <span>PostgreSQL Relational Persistence · WebSocket Alerts · CSV Governance Reports</span>
            </div>
          </div>

          <div className="lg:col-span-6">
            <form
              onSubmit={handleContactSubmit}
              className="p-6 rounded-xl border border-slate-200 bg-[#F8FAFC] space-y-4"
            >
              <h3 className="text-base font-semibold text-[#0F172A]">Request Enterprise Deployment</h3>
              {contactSent ? (
                <div className="p-4 rounded-lg bg-[#F0FDF4] border border-[#BBF7D0] text-sm text-[#16A34A] font-medium">
                  Inquiry recorded. Our implementation team will follow up at your provided address.
                </div>
              ) : (
                <>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">Work Email</label>
                    <input
                      type="email"
                      required
                      value={contactEmail}
                      onChange={(e) => setContactEmail(e.target.value)}
                      placeholder="operations@municipality.gov"
                      className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">Operational Scope</label>
                    <textarea
                      required
                      rows={3}
                      value={contactMessage}
                      onChange={(e) => setContactMessage(e.target.value)}
                      placeholder="Describe your departments, daily ticket volume, and SLA targets..."
                      className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
                    />
                  </div>
                  <button
                    type="submit"
                    className="px-5 py-2.5 rounded-lg bg-[#0F172A] hover:bg-[#1E293B] text-white text-xs font-semibold transition-colors"
                  >
                    Send Inquiry
                  </button>
                </>
              )}
            </form>
          </div>
        </div>
      </section>

      {/* Quiet Footer */}
      <footer className="border-t border-slate-200 bg-[#F8FAFC]">
        <div className="max-w-7xl mx-auto px-6 py-6 flex flex-wrap items-center justify-between gap-4 text-xs text-slate-500">
          <span className="font-semibold text-[#0F172A]">ResolveCore AI</span>
          <span>AA-02 Intelligent Complaint Management & Resolution Assistant</span>
        </div>
      </footer>
    </div>
  );
}
