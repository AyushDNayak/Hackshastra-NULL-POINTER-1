import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';

const MODEL_TEXT = 'gemini-4-hydrogen';
const MODEL_TRANSCRIBE = 'gemini-3.5-transcribe';
const MODEL_TTS = 'gemini-3.8-flash-lite-tts';

function getGeminiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY' || apiKey.trim().length < 10) {
    return null;
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

export function isAiConfigured(): boolean {
  return getGeminiClient() !== null;
}

export interface DepartmentOption {
  id: number;
  name: string;
  code: string;
  responsibilities: string;
  staff: Array<{
    staffId: number;
    name: string;
    title: string;
    specialization: string;
    activeCount: number;
    maxActiveLoad: number;
    isAvailable: boolean;
  }>;
}

export interface CategoryOption {
  id: number;
  name: string;
  description: string;
}

export interface ExistingComplaintSnippet {
  id: number;
  trackingCode: string;
  title: string;
  categoryName: string;
  location: string | null;
  status: string;
}

export interface IntakeAnalysisResult {
  isDemoMode: boolean;
  modelUsed: string;
  understanding: {
    coreProblem: string;
    detectedLanguage: string;
    summary: string;
    sentiment: 'ANGRY' | 'FRUSTRATED' | 'URGENT' | 'NEUTRAL' | 'CONSTRUCTIVE';
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
}

export interface ResolutionAssistantResult {
  isDemoMode: boolean;
  modelUsed: string;
  suggestedSolutions: string[];
  recommendedProcedure: string;
  responseDraft: string;
  needsHumanIntervention: boolean;
  humanInterventionReason: string;
  matchedArticleIds: number[];
}

export interface ResolutionSummaryResult {
  isDemoMode: boolean;
  modelUsed: string;
  closureSummary: string;
  feedbackPrompt: string;
}

export interface AiInsightsResult {
  isDemoMode: boolean;
  modelUsed: string;
  recurringPatterns: string[];
  predictedTrends: string[];
  operationalRecommendations: string[];
  sentimentSummary: string;
}

export async function analyzeComplaintIntake(params: {
  title: string;
  description: string;
  location?: string | null;
  preferredCategory?: string | null;
  categories: CategoryOption[];
  departments: DepartmentOption[];
  recentComplaints: ExistingComplaintSnippet[];
  imageAttachments?: Array<{ mimeType: string; base64Data: string }>;
}): Promise<IntakeAnalysisResult> {
  const ai = getGeminiClient();

  if (!ai) {
    return buildDemoIntakeAnalysis(params);
  }

  try {
    const categoryNames = params.categories.map((c) => `${c.name} (${c.description})`).join('\n- ');
    const departmentContext = params.departments
      .map((d) => {
        const staffList = d.staff
          .map(
            (s) =>
              `staffId=${s.staffId} (${s.name}, ${s.title}, load=${s.activeCount}/${s.maxActiveLoad}, available=${s.isAvailable}, spec="${s.specialization}")`
          )
          .join('; ');
        return `deptId=${d.id} | ${d.name} [${d.code}]: ${d.responsibilities}. Staff: [${staffList || 'None'}]`;
      })
      .join('\n');

    const recentContext =
      params.recentComplaints.length > 0
        ? params.recentComplaints
            .map((c) => `id=${c.id} (${c.trackingCode}) | "${c.title}" | ${c.categoryName} | loc=${c.location || 'N/A'} | ${c.status}`)
            .join('\n')
        : 'No existing open complaints.';

    const promptText = `You are a coordinated 4-agent complaint intelligence pipeline (Agent 1: Understanding, Agent 2: Classification, Agent 3: Priority Assessment, Agent 4: Department Assignment).

Analyze this incoming complaint (which may be written in ANY language — detect the language and always produce summaries/reasoning in clear English):
Title: ${params.title}
Description: ${params.description}
Location provided: ${params.location || 'Not specified'}
User-selected category hint: ${params.preferredCategory || 'None (auto-detect)'}

Available Categories (choose exact categoryName from this list):
- ${categoryNames}

Available Departments and Staff Workload:
${departmentContext}

Recent Open Complaints (for duplicate detection — only return IDs that describe the exact same incident/outage/issue):
${recentContext}

Rules:
- Priority levels: CRITICAL (life/safety threat, major outage affecting many, sparks/fire/gas/flood, severe financial breach), HIGH (urgent disruption, significant impact, time-sensitive), MEDIUM (standard service fault), LOW (minor inquiry/cosmetic issue).
- Choose the best matching departmentId and an available staffMemberId with reasonable workload (lowest activeCount/maxActiveLoad ratio) when available.
- Generate 0 to 3 concise followUpQuestions ONLY if essential operational details (such as exact location, meter/account ID, or hazard proximity) are missing.`;

    const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [];
    if (params.imageAttachments && params.imageAttachments.length > 0) {
      for (const img of params.imageAttachments.slice(0, 2)) {
        if (img.mimeType.startsWith('image/') && img.base64Data) {
          parts.push({
            inlineData: {
              mimeType: img.mimeType,
              data: img.base64Data,
            },
          });
        }
      }
    }
    parts.push({ text: promptText });

    const response = await ai.models.generateContent({
      model: MODEL_TEXT,
      contents: { parts },
      config: {
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            coreProblem: { type: Type.STRING },
            detectedLanguage: { type: Type.STRING },
            summary: { type: Type.STRING },
            sentiment: {
              type: Type.STRING,
              description: 'One of: ANGRY, FRUSTRATED, URGENT, NEUTRAL, CONSTRUCTIVE',
            },
            sentimentScore: {
              type: Type.INTEGER,
              description: 'Distress/urgency score 0 to 100',
            },
            affectedArea: { type: Type.STRING },
            peopleAffectedEstimate: { type: Type.STRING },
            safetyRiskDetected: { type: Type.BOOLEAN },
            financialImpactDetected: { type: Type.BOOLEAN },
            keyEntities: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
            },
            followUpQuestions: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
            },
            categoryName: { type: Type.STRING },
            confidenceScore: { type: Type.INTEGER },
            classificationReasoning: { type: Type.STRING },
            priorityLevel: {
              type: Type.STRING,
              description: 'One of: CRITICAL, HIGH, MEDIUM, LOW',
            },
            priorityReasoning: { type: Type.STRING },
            departmentId: { type: Type.INTEGER },
            staffMemberId: { type: Type.INTEGER },
            assignmentReasoning: { type: Type.STRING },
            duplicateCandidateIds: {
              type: Type.ARRAY,
              items: { type: Type.INTEGER },
            },
          },
        },
      },
    });

    const parsed = JSON.parse((response.text || '{}').trim());

    const matchedCat =
      params.categories.find((c) => c.name.toLowerCase() === String(parsed.categoryName || '').toLowerCase()) ||
      params.categories.find((c) => c.name === 'Other') ||
      params.categories[0];

    const matchedDept =
      params.departments.find((d) => d.id === Number(parsed.departmentId)) || params.departments[0];

    const matchedStaff =
      matchedDept?.staff.find((s) => s.staffId === Number(parsed.staffMemberId)) ||
      matchedDept?.staff.find((s) => s.isAvailable) ||
      matchedDept?.staff[0] ||
      null;

    const rawSentiment = String(parsed.sentiment || 'NEUTRAL').toUpperCase();
    const sentiment = (['ANGRY', 'FRUSTRATED', 'URGENT', 'NEUTRAL', 'CONSTRUCTIVE'].includes(rawSentiment)
      ? rawSentiment
      : 'NEUTRAL') as IntakeAnalysisResult['understanding']['sentiment'];

    const rawPriority = String(parsed.priorityLevel || 'MEDIUM').toUpperCase();
    const priority = (['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'].includes(rawPriority)
      ? rawPriority
      : 'MEDIUM') as IntakeAnalysisResult['priority']['level'];

    const validDupIds = Array.isArray(parsed.duplicateCandidateIds)
      ? parsed.duplicateCandidateIds
          .map(Number)
          .filter((id: number) => params.recentComplaints.some((c) => c.id === id))
      : [];

    return {
      isDemoMode: false,
      modelUsed: MODEL_TEXT,
      understanding: {
        coreProblem: parsed.coreProblem || params.title,
        detectedLanguage: parsed.detectedLanguage || 'English',
        summary: parsed.summary || params.description.slice(0, 180),
        sentiment,
        sentimentScore: Math.min(100, Math.max(0, Number(parsed.sentimentScore ?? 55))),
        extractedDetails: {
          affectedArea: parsed.affectedArea || params.location || 'Unspecified',
          peopleAffectedEstimate: parsed.peopleAffectedEstimate || 'Unknown',
          safetyRiskDetected: Boolean(parsed.safetyRiskDetected),
          financialImpactDetected: Boolean(parsed.financialImpactDetected),
          keyEntities: Array.isArray(parsed.keyEntities) ? parsed.keyEntities.slice(0, 6) : [],
        },
        followUpQuestions: Array.isArray(parsed.followUpQuestions)
          ? parsed.followUpQuestions.slice(0, 3)
          : [],
      },
      classification: {
        categoryName: matchedCat?.name || 'Other',
        confidenceScore: Math.min(100, Math.max(40, Number(parsed.confidenceScore ?? 92))),
        reasoning: parsed.classificationReasoning || 'Matched against active complaint taxonomy.',
      },
      priority: {
        level: priority,
        reasoning: parsed.priorityReasoning || 'Evaluated operational urgency and safety exposure.',
      },
      assignment: {
        departmentId: matchedDept?.id ?? null,
        departmentName: matchedDept?.name || 'Customer Experience & Triage',
        staffMemberId: matchedStaff?.staffId ?? null,
        staffMemberName: matchedStaff?.name ?? null,
        reasoning: parsed.assignmentReasoning || 'Routed based on department responsibility and staff capacity.',
      },
      duplicateCandidateIds: validDupIds,
    };
  } catch (error) {
    console.error('Gemini intake analysis error, falling back to clearly labelled demo mode:', error);
    return buildDemoIntakeAnalysis(params);
  }
}

export async function runResolutionAssistantAgent(params: {
  trackingCode: string;
  title: string;
  description: string;
  categoryName: string;
  priority: string;
  departmentName: string;
  complainantName: string;
  messages: Array<{ senderRole: string; message: string; isInternalNote: boolean }>;
  knowledgeBase: Array<{ id: number; title: string; categoryName: string; summary: string; steps: string[] }>;
}): Promise<ResolutionAssistantResult> {
  const ai = getGeminiClient();
  const relevantKb = params.knowledgeBase.filter(
    (k) => k.categoryName.toLowerCase() === params.categoryName.toLowerCase()
  );
  const kbPool = relevantKb.length > 0 ? relevantKb : params.knowledgeBase.slice(0, 3);

  if (!ai) {
    const firstKb = kbPool[0];
    return {
      isDemoMode: true,
      modelUsed: 'demo-heuristic-fallback',
      suggestedSolutions: firstKb
        ? firstKb.steps
        : [
            'Verify field diagnostics or account records linked to the report.',
            'Document corrective action with timestamped evidence before resolving.',
          ],
      recommendedProcedure: firstKb
        ? `${firstKb.title}: ${firstKb.summary}`
        : 'Follow standard departmental triage and verification checklist.',
      responseDraft: `Hello ${params.complainantName}, thank you for reporting "${params.title}" (${params.trackingCode}). Our ${params.departmentName} team has reviewed your case at ${params.priority} priority and is actively executing remediation steps. We will share verified confirmation shortly.`,
      needsHumanIntervention: params.priority === 'CRITICAL' || params.priority === 'HIGH',
      humanInterventionReason:
        params.priority === 'CRITICAL'
          ? 'Critical severity requires direct supervisor verification and field safety sign-off.'
          : 'Staff review required before approving final resolution.',
      matchedArticleIds: kbPool.map((k) => k.id),
    };
  }

  try {
    const kbText = kbPool
      .map((k) => `ID=${k.id} | ${k.title}: ${k.summary} | Steps: ${k.steps.join(' -> ')}`)
      .join('\n');
    const historyText = params.messages
      .slice(-6)
      .map((m) => `[${m.senderRole}${m.isInternalNote ? ' INTERNAL' : ''}]: ${m.message}`)
      .join('\n');

    const response = await ai.models.generateContent({
      model: MODEL_TEXT,
      contents: `You are Agent 5 (Resolution Assistant Agent). Recommend practical resolution actions and a polite, accurate draft response for department staff. Remember: your output is advisory only; staff must review and approve all actions.

Complaint: ${params.trackingCode} — ${params.title}
Category: ${params.categoryName} | Priority: ${params.priority} | Department: ${params.departmentName}
Complainant: ${params.complainantName}
Description: ${params.description}

Conversation History:
${historyText || 'None yet.'}

Knowledge Base SOPs:
${kbText || 'No SOPs loaded.'}`,
      config: {
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            suggestedSolutions: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
            },
            recommendedProcedure: { type: Type.STRING },
            responseDraft: { type: Type.STRING },
            needsHumanIntervention: { type: Type.BOOLEAN },
            humanInterventionReason: { type: Type.STRING },
            matchedArticleIds: {
              type: Type.ARRAY,
              items: { type: Type.INTEGER },
            },
          },
        },
      },
    });

    const parsed = JSON.parse((response.text || '{}').trim());
    return {
      isDemoMode: false,
      modelUsed: MODEL_TEXT,
      suggestedSolutions: Array.isArray(parsed.suggestedSolutions) ? parsed.suggestedSolutions : [],
      recommendedProcedure: parsed.recommendedProcedure || 'Follow departmental verification SOP.',
      responseDraft: parsed.responseDraft || '',
      needsHumanIntervention: Boolean(parsed.needsHumanIntervention),
      humanInterventionReason:
        parsed.humanInterventionReason || 'Staff approval required prior to execution.',
      matchedArticleIds: Array.isArray(parsed.matchedArticleIds)
        ? parsed.matchedArticleIds.map(Number).filter((id: number) => kbPool.some((k) => k.id === id))
        : kbPool.map((k) => k.id),
    };
  } catch (error) {
    console.error('Resolution assistant Gemini error:', error);
    return {
      isDemoMode: true,
      modelUsed: 'demo-heuristic-fallback',
      suggestedSolutions: kbPool[0]?.steps || ['Inspect reported issue and attach verification evidence.'],
      recommendedProcedure: kbPool[0]?.summary || 'Standard department resolution workflow.',
      responseDraft: `Hello ${params.complainantName}, our ${params.departmentName} team is investigating ${params.trackingCode} and will update you shortly.`,
      needsHumanIntervention: true,
      humanInterventionReason: 'Advisor fallback active; staff must verify manually.',
      matchedArticleIds: kbPool.map((k) => k.id),
    };
  }
}

export async function runResolutionSummaryAgent(params: {
  trackingCode: string;
  title: string;
  description: string;
  departmentName: string;
  resolutionNotes: string;
  resolvedAtIso: string;
}): Promise<ResolutionSummaryResult> {
  const ai = getGeminiClient();
  if (!ai) {
    return {
      isDemoMode: true,
      modelUsed: 'demo-heuristic-fallback',
      closureSummary: `Resolution Report for ${params.trackingCode}: Reported issue ("${params.title}") was handled by ${params.departmentName}. Action taken: ${params.resolutionNotes}. Recorded on ${params.resolvedAtIso}. Authorized closure confirmation is required before marking permanently closed.`,
      feedbackPrompt: 'Please rate your resolution experience and confirm whether the issue is fully resolved.',
    };
  }

  try {
    const response = await ai.models.generateContent({
      model: MODEL_TEXT,
      contents: `You are Agent 7 (Resolution Summary Agent). Generate a clear, factual closure summary report for a resolved complaint. Do NOT invent actions not described in the resolution notes.

Tracking ID: ${params.trackingCode}
Original Issue Title: ${params.title}
Original Description: ${params.description}
Responsible Department: ${params.departmentName}
Verified Staff Resolution Notes: ${params.resolutionNotes}
Resolution Timestamp: ${params.resolvedAtIso}`,
      config: {
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            closureSummary: { type: Type.STRING },
            feedbackPrompt: { type: Type.STRING },
          },
        },
      },
    });
    const parsed = JSON.parse((response.text || '{}').trim());
    return {
      isDemoMode: false,
      modelUsed: MODEL_TEXT,
      closureSummary: parsed.closureSummary || params.resolutionNotes,
      feedbackPrompt:
        parsed.feedbackPrompt || 'Please rate your satisfaction with our resolution speed and communication.',
    };
  } catch (error) {
    console.error('Resolution summary Gemini error:', error);
    return {
      isDemoMode: true,
      modelUsed: 'demo-heuristic-fallback',
      closureSummary: `${params.trackingCode} handled by ${params.departmentName}: ${params.resolutionNotes}`,
      feedbackPrompt: 'Please share feedback on your resolution experience.',
    };
  }
}

export async function transcribeVoiceComplaint(params: {
  audioBase64: string;
  mimeType: string;
}): Promise<{ transcript: string; isDemoMode: boolean; modelUsed: string }> {
  const ai = getGeminiClient();
  if (!ai) {
    return {
      transcript: '',
      isDemoMode: true,
      modelUsed: 'demo-unavailable',
    };
  }

  const response = await ai.models.generateContent({
    model: MODEL_TRANSCRIBE,
    contents: {
      parts: [
        {
          inlineData: {
            mimeType: params.mimeType,
            data: params.audioBase64,
          },
        },
        {
          text: 'Transcribe this spoken complaint accurately in its original language. Return only the clean transcript text.',
        },
      ],
    },
  });

  return {
    transcript: (response.text || '').trim(),
    isDemoMode: false,
    modelUsed: MODEL_TRANSCRIBE,
  };
}

export async function synthesizeSpeechSummary(text: string): Promise<{
  audioBase64: string | null;
  mimeType: string;
  isDemoMode: boolean;
}> {
  const ai = getGeminiClient();
  if (!ai) {
    return { audioBase64: null, mimeType: 'audio/wav', isDemoMode: true };
  }

  const response = await ai.models.generateContent({
    model: MODEL_TTS,
    contents: [
      {
        role: 'user',
        parts: [
          {
            text,
            speechMetadata: {
              style: 'Clear, calm, authoritative enterprise service briefing',
            },
          },
        ],
      },
    ],
    config: {
      responseModalities: ['AUDIO'],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName: 'Kore' },
        },
      },
    },
  });

  const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data ?? null;
  return {
    audioBase64: base64Audio,
    mimeType: 'audio/wav',
    isDemoMode: false,
  };
}

export async function generateAiInsightsReport(params: {
  totalComplaints: number;
  categoryCounts: Array<{ name: string; count: number }>;
  priorityCounts: Array<{ priority: string; count: number }>;
  sentimentCounts: Array<{ sentiment: string; count: number }>;
  departmentMetrics: Array<{ name: string; total: number; resolved: number; escalated: number }>;
  recentTitles: string[];
}): Promise<AiInsightsResult> {
  if (params.totalComplaints === 0) {
    return {
      isDemoMode: !isAiConfigured(),
      modelUsed: isAiConfigured() ? MODEL_TEXT : 'demo-heuristic-fallback',
      recurringPatterns: ['No recorded complaint clusters yet. Submit complaints to generate live AI pattern detection.'],
      predictedTrends: ['Insufficient historical volume to forecast category spikes.'],
      operationalRecommendations: ['Ensure all department staff availability statuses are up to date before intake begins.'],
      sentimentSummary: 'Awaiting initial complainant submissions.',
    };
  }

  const ai = getGeminiClient();
  if (!ai) {
    return {
      isDemoMode: true,
      modelUsed: 'demo-heuristic-fallback',
      recurringPatterns: params.categoryCounts.slice(0, 3).map((c) => `${c.name}: ${c.count} recorded report(s)`),
      predictedTrends: [
        'Demo Mode Projection: High-volume categories are likely to generate repeat follow-ups without proactive status updates.',
      ],
      operationalRecommendations: [
        'Configure GEMINI_API_KEY in Secrets to enable live predictive operational modeling.',
      ],
      sentimentSummary: `Analyzed ${params.totalComplaints} recorded complaints across ${params.departmentMetrics.length} departments.`,
    };
  }

  try {
    const response = await ai.models.generateContent({
      model: MODEL_TEXT,
      contents: `You are an Enterprise Complaint Operations Analyst. Analyze ONLY the real recorded telemetry below and produce clearly separated AI insights and predictions.

Recorded Metrics:
Total Complaints: ${params.totalComplaints}
By Category: ${JSON.stringify(params.categoryCounts)}
By Priority: ${JSON.stringify(params.priorityCounts)}
By Sentiment: ${JSON.stringify(params.sentimentCounts)}
Department Performance: ${JSON.stringify(params.departmentMetrics)}
Recent Complaint Headlines: ${JSON.stringify(params.recentTitles.slice(0, 15))}`,
      config: {
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            recurringPatterns: { type: Type.ARRAY, items: { type: Type.STRING } },
            predictedTrends: { type: Type.ARRAY, items: { type: Type.STRING } },
            operationalRecommendations: { type: Type.ARRAY, items: { type: Type.STRING } },
            sentimentSummary: { type: Type.STRING },
          },
        },
      },
    });
    const parsed = JSON.parse((response.text || '{}').trim());
    return {
      isDemoMode: false,
      modelUsed: MODEL_TEXT,
      recurringPatterns: Array.isArray(parsed.recurringPatterns) ? parsed.recurringPatterns : [],
      predictedTrends: Array.isArray(parsed.predictedTrends) ? parsed.predictedTrends : [],
      operationalRecommendations: Array.isArray(parsed.operationalRecommendations)
        ? parsed.operationalRecommendations
        : [],
      sentimentSummary: parsed.sentimentSummary || 'Sentiment telemetry processed.',
    };
  } catch (error) {
    console.error('Insights generation error:', error);
    return {
      isDemoMode: true,
      modelUsed: 'demo-heuristic-fallback',
      recurringPatterns: params.categoryCounts.slice(0, 3).map((c) => `${c.name}: ${c.count} recorded incidents`),
      predictedTrends: ['Predictive trend engine temporarily in fallback mode.'],
      operationalRecommendations: ['Monitor escalated tickets for SLA compliance.'],
      sentimentSummary: 'Telemetry summarized from database counts.',
    };
  }
}

function buildDemoIntakeAnalysis(params: {
  title: string;
  description: string;
  location?: string | null;
  preferredCategory?: string | null;
  categories: CategoryOption[];
  departments: DepartmentOption[];
  recentComplaints: ExistingComplaintSnippet[];
}): IntakeAnalysisResult {
  const combined = `${params.title} ${params.description}`.toLowerCase();

  let catName = params.preferredCategory || 'Other';
  if (!params.preferredCategory) {
    if (/(power|electric|outage|transformer|spark|wire|blackout|voltage)/.test(combined)) catName = 'Electricity';
    else if (/(water|pipe|leak|burst|tap|drink|pressure)/.test(combined)) catName = 'Water Supply';
    else if (/(garbage|trash|sewage|drain|sanitation|smell|waste)/.test(combined)) catName = 'Sanitation';
    else if (/(road|pothole|bridge|sidewalk|street|building|light)/.test(combined)) catName = 'Infrastructure';
    else if (/(bus|train|transit|traffic|signal|metro)/.test(combined)) catName = 'Transportation';
    else if (/(login|app|website|portal|bug|error|crash|server)/.test(combined)) catName = 'Technical Issues';
    else if (/(bill|charge|refund|invoice|payment|money|fee)/.test(combined)) catName = 'Financial Issues';
    else if (/(fire|gas|danger|hazard|security|unsafe|threat|emergency)/.test(combined)) catName = 'Safety and Security';
    else if (/(rude|service|staff|support|wait)/.test(combined)) catName = 'Customer Service';
  }

  const matchedCat =
    params.categories.find((c) => c.name.toLowerCase() === catName.toLowerCase()) || params.categories[0];

  let priority: IntakeAnalysisResult['priority']['level'] = 'MEDIUM';
  let safetyRisk = false;
  if (/(fire|gas|spark|electrocution|collapse|flood|emergency|danger|hospital|critical)/.test(combined)) {
    priority = 'CRITICAL';
    safetyRisk = true;
  } else if (/(outage|burst|down|urgent|broken|unauthorized|locked out|many|entire)/.test(combined)) {
    priority = 'HIGH';
  } else if (/(minor|cosmetic|suggestion|question)/.test(combined)) {
    priority = 'LOW';
  }

  const deptCodeMap: Record<string, string> = {
    Electricity: 'ELEC',
    'Water Supply': 'WATER',
    Sanitation: 'WATER',
    Infrastructure: 'INFRA',
    Transportation: 'TRANS',
    'Technical Issues': 'TECH',
    'Financial Issues': 'FIN',
    'Safety and Security': 'SAFE',
    'Customer Service': 'CX',
    Other: 'CX',
  };

  const targetCode = deptCodeMap[matchedCat?.name || 'Other'] || 'CX';
  const matchedDept =
    params.departments.find((d) => d.code === targetCode) || params.departments[0];
  const matchedStaff =
    matchedDept?.staff
      .filter((s) => s.isAvailable)
      .sort((a, b) => a.activeCount - b.activeCount)[0] ||
    matchedDept?.staff[0] ||
    null;

  const followUps: string[] = [];
  if (!params.location) {
    followUps.push('Please specify the exact street address, building, or facility zone affected.');
  }
  if (combined.length < 40) {
    followUps.push('Can you share when the issue began and how many people or systems are affected?');
  }

  const sentiment: IntakeAnalysisResult['understanding']['sentiment'] =
    priority === 'CRITICAL'
      ? 'URGENT'
      : /(unacceptable|furious|worst|angry|terrible)/.test(combined)
      ? 'ANGRY'
      : /(still|again|frustrated|delay|waiting)/.test(combined)
      ? 'FRUSTRATED'
      : 'NEUTRAL';

  return {
    isDemoMode: true,
    modelUsed: 'demo-heuristic-fallback',
    understanding: {
      coreProblem: params.title,
      detectedLanguage: 'English (Demo Heuristic)',
      summary: `[Demo Mode] ${params.title}: ${params.description.slice(0, 140)}`,
      sentiment,
      sentimentScore: priority === 'CRITICAL' ? 92 : priority === 'HIGH' ? 76 : 48,
      extractedDetails: {
        affectedArea: params.location || 'Unspecified location',
        peopleAffectedEstimate: priority === 'CRITICAL' ? 'Multiple / Area-wide' : 'Localized',
        safetyRiskDetected: safetyRisk,
        financialImpactDetected: catName === 'Financial Issues',
        keyEntities: [catName, params.location || 'General Zone'].filter(Boolean),
      },
      followUpQuestions: followUps,
    },
    classification: {
      categoryName: matchedCat?.name || 'Other',
      confidenceScore: 78,
      reasoning: 'Demo Mode rule-based keyword classification (GEMINI_API_KEY not configured).',
    },
    priority: {
      level: priority,
      reasoning: `Demo Mode urgency scoring (${priority}) based on hazard and disruption keywords.`,
    },
    assignment: {
      departmentId: matchedDept?.id ?? null,
      departmentName: matchedDept?.name || 'Customer Experience & Triage',
      staffMemberId: matchedStaff?.staffId ?? null,
      staffMemberName: matchedStaff?.name ?? null,
      reasoning: 'Demo Mode routing to default department and lowest-load available specialist.',
    },
    duplicateCandidateIds: [],
  };
}
