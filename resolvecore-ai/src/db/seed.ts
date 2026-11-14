import bcrypt from 'bcryptjs';
import { count, eq } from 'drizzle-orm';
import { db } from './index.ts';
import {
  complaintCategories,
  departments,
  knowledgeBaseArticles,
  slaConfigurations,
  staffMembers,
  users,
} from './schema.ts';

let seedPromise: Promise<void> | null = null;

export async function ensureReferenceDataSeeded(): Promise<void> {
  if (!seedPromise) {
    seedPromise = runSeed().catch((err) => {
      seedPromise = null;
      console.error('Reference data seed failed:', err);
    });
  }
  return seedPromise;
}

async function runSeed(): Promise<void> {
  const existingDepts = await db.select({ value: count() }).from(departments);
  if (Number(existingDepts[0]?.value ?? 0) > 0) {
    return;
  }

  // 1. Seed Departments
  const deptDefs = [
    {
      name: 'Technical & Digital Systems',
      code: 'TECH',
      description: 'Resolves portal outages, authentication failures, software bugs, and API errors.',
      responsibilities: 'Technical Issues, portal glitches, mobile app crashes, payment gateway errors, data sync bugs',
      leadEmail: 'tech-lead@resolvecore.ai',
    },
    {
      name: 'Public Works & Infrastructure',
      code: 'INFRA',
      description: 'Maintains roads, bridges, streetlights, drainage, sidewalks, and structural facilities.',
      responsibilities: 'Infrastructure, potholes, damaged sidewalks, collapsed drainage, structural hazards, signage',
      leadEmail: 'infra-lead@resolvecore.ai',
    },
    {
      name: 'Electrical Grid & Power',
      code: 'ELEC',
      description: 'Handles power outages, transformer faults, downed lines, voltage fluctuations, and grid restoration.',
      responsibilities: 'Electricity, blackouts, sparking wires, transformer explosions, street grid outages, smart meter faults',
      leadEmail: 'elec-lead@resolvecore.ai',
    },
    {
      name: 'Water & Sanitation Services',
      code: 'WATER',
      description: 'Manages water mains, contamination alerts, sewage leaks, waste collection, and sanitation hygiene.',
      responsibilities: 'Water Supply, Sanitation, burst pipes, low water pressure, discolored water, garbage overflow, sewage',
      leadEmail: 'water-lead@resolvecore.ai',
    },
    {
      name: 'Transit & Mobility Operations',
      code: 'TRANS',
      description: 'Oversees public buses, rail delays, traffic signals, commuter safety, and transit schedules.',
      responsibilities: 'Transportation, bus delays, signal malfunctions, station accessibility, fleet breakdowns',
      leadEmail: 'transit-lead@resolvecore.ai',
    },
    {
      name: 'Financial & Billing Operations',
      code: 'FIN',
      description: 'Investigates duplicate charges, invoice disputes, refund delays, and billing discrepancies.',
      responsibilities: 'Financial Issues, overbilling, unauthorized charges, refund processing, fee waivers',
      leadEmail: 'finance-lead@resolvecore.ai',
    },
    {
      name: 'Safety & Security Response',
      code: 'SAFE',
      description: 'Handles emergency physical hazards, security breaches, perimeter lighting, and urgent threat reports.',
      responsibilities: 'Safety and Security, fire hazards, gas leaks, security camera failures, unauthorized access',
      leadEmail: 'safety-lead@resolvecore.ai',
    },
    {
      name: 'Customer Experience & Triage',
      code: 'CX',
      description: 'Handles service quality feedback, staff conduct reports, escalations, and general inquiries.',
      responsibilities: 'Customer Service, Other, communication delays, service attitude, general multi-department inquiries',
      leadEmail: 'cx-lead@resolvecore.ai',
    },
  ];

  const insertedDepts = await db.insert(departments).values(deptDefs).onConflictDoNothing().returning();
  const allDepts = insertedDepts.length > 0 ? insertedDepts : await db.select().from(departments);
  const deptByCode = new Map(allDepts.map((d) => [d.code, d]));

  // 2. Seed Complaint Categories
  const categoryDefs = [
    { name: 'Technical Issues', description: 'Software bugs, portal outages, login failures, and digital errors.', code: 'TECH' },
    { name: 'Infrastructure', description: 'Roads, bridges, sidewalks, buildings, and public facilities.', code: 'INFRA' },
    { name: 'Electricity', description: 'Power outages, downed cables, voltage drops, and meter faults.', code: 'ELEC' },
    { name: 'Water Supply', description: 'Pipe leaks, water pressure loss, contamination, and supply shutoffs.', code: 'WATER' },
    { name: 'Transportation', description: 'Public transit delays, traffic signals, and route disruptions.', code: 'TRANS' },
    { name: 'Sanitation', description: 'Waste pickup delays, sewage overflow, and environmental hygiene.', code: 'WATER' },
    { name: 'Customer Service', description: 'Service delivery quality, responsiveness, and representative conduct.', code: 'CX' },
    { name: 'Financial Issues', description: 'Billing errors, double charges, refunds, and account credits.', code: 'FIN' },
    { name: 'Safety and Security', description: 'Physical hazards, fire/gas risks, access control, and urgent safety.', code: 'SAFE' },
    { name: 'Other', description: 'General requests or cross-functional complaints.', code: 'CX' },
  ];

  for (const cat of categoryDefs) {
    await db
      .insert(complaintCategories)
      .values({
        name: cat.name,
        description: cat.description,
        defaultDepartmentId: deptByCode.get(cat.code)?.id ?? null,
        isSystem: true,
        isActive: true,
      })
      .onConflictDoNothing();
  }

  // 3. Seed SLA Configurations
  const slaDefs = [
    { priority: 'CRITICAL', responseHours: 1, resolutionHours: 6, autoEscalate: true },
    { priority: 'HIGH', responseHours: 4, resolutionHours: 24, autoEscalate: true },
    { priority: 'MEDIUM', responseHours: 24, resolutionHours: 72, autoEscalate: true },
    { priority: 'LOW', responseHours: 72, resolutionHours: 168, autoEscalate: false },
  ];
  for (const sla of slaDefs) {
    await db.insert(slaConfigurations).values(sla).onConflictDoNothing();
  }

  // 4. Seed Operational Accounts (Admin + Department Staff + Standard Complainant for RBAC testing)
  const defaultPassHash = await bcrypt.hash('ResolveCore2026!', 10);

  const accountSeeds = [
    {
      uid: 'seed_admin_01',
      email: 'admin@resolvecore.ai',
      name: 'Elena Vance (System Admin)',
      role: 'ADMIN',
      deptCode: null,
      title: 'Chief Operations Administrator',
      specialization: 'Enterprise Governance & AI Oversight',
    },
    {
      uid: 'seed_staff_elec',
      email: 'staff.electric@resolvecore.ai',
      name: 'Marcus Chen',
      role: 'STAFF',
      deptCode: 'ELEC',
      title: 'Senior Grid Response Engineer',
      specialization: 'Substation faults, transformer triage, emergency power restoration',
    },
    {
      uid: 'seed_staff_water',
      email: 'staff.water@resolvecore.ai',
      name: 'Priya Nair',
      role: 'STAFF',
      deptCode: 'WATER',
      title: 'Water & Sanitation Lead',
      specialization: 'Mainline bursts, pressure telemetry, sanitation dispatch',
    },
    {
      uid: 'seed_staff_infra',
      email: 'staff.infra@resolvecore.ai',
      name: 'David Okafor',
      role: 'STAFF',
      deptCode: 'INFRA',
      title: 'Civil Infrastructure Specialist',
      specialization: 'Roadway repair, drainage clearance, structural inspections',
    },
    {
      uid: 'seed_staff_tech',
      email: 'staff.tech@resolvecore.ai',
      name: 'Sophia Lindqvist',
      role: 'STAFF',
      deptCode: 'TECH',
      title: 'Principal Reliability Engineer',
      specialization: 'Authentication systems, payment APIs, portal diagnostics',
    },
    {
      uid: 'seed_staff_fin',
      email: 'staff.finance@resolvecore.ai',
      name: 'Arthur Pendelton',
      role: 'STAFF',
      deptCode: 'FIN',
      title: 'Billing & Reconciliation Officer',
      specialization: 'Duplicate charge reversals, invoice audits, SLA refunds',
    },
    {
      uid: 'seed_staff_safe',
      email: 'staff.safety@resolvecore.ai',
      name: 'Lt. Hannah Reyes',
      role: 'STAFF',
      deptCode: 'SAFE',
      title: 'Public Safety Duty Officer',
      specialization: 'Emergency hazard containment, perimeter security, gas/fire coordination',
    },
    {
      uid: 'seed_staff_trans',
      email: 'staff.transit@resolvecore.ai',
      name: 'Kenji Takahashi',
      role: 'STAFF',
      deptCode: 'TRANS',
      title: 'Transit Network Coordinator',
      specialization: 'Signal timing, fleet dispatch, commuter corridor recovery',
    },
    {
      uid: 'seed_staff_cx',
      email: 'staff.cx@resolvecore.ai',
      name: 'Maya Al-Mansoor',
      role: 'STAFF',
      deptCode: 'CX',
      title: 'Senior Resolution Specialist',
      specialization: 'Complex citizen escalations, service recovery, quality assurance',
    },
    {
      uid: 'seed_user_01',
      email: 'citizen@resolvecore.ai',
      name: 'Jordan Mercer',
      role: 'USER',
      deptCode: null,
      title: null,
      specialization: null,
    },
  ];

  for (const acc of accountSeeds) {
    const deptId = acc.deptCode ? deptByCode.get(acc.deptCode)?.id ?? null : null;
    const inserted = await db
      .insert(users)
      .values({
        uid: acc.uid,
        email: acc.email,
        name: acc.name,
        passwordHash: defaultPassHash,
        role: acc.role,
        departmentId: deptId,
        isActive: true,
      })
      .onConflictDoNothing()
      .returning();

    const userRow =
      inserted[0] ?? (await db.select().from(users).where(eq(users.email, acc.email)).limit(1))[0];

    if (userRow && acc.role === 'STAFF' && deptId && acc.title && acc.specialization) {
      await db
        .insert(staffMembers)
        .values({
          userId: userRow.id,
          departmentId: deptId,
          title: acc.title,
          specialization: acc.specialization,
          maxActiveLoad: 12,
          isAvailable: true,
        })
        .onConflictDoNothing();
    }
  }

  // 5. Seed Knowledge Base Articles for Agent 5 (Resolution Assistant)
  const kbDefs = [
    {
      title: 'SOP-ELEC-01: Localized Power Outage & Sparking Transformer Protocol',
      categoryName: 'Electricity',
      deptCode: 'ELEC',
      summary: 'Immediate isolation, safety perimeter establishment, and feeder rerouting for localized outages or arcing hardware.',
      steps: [
        'Confirm substation telemetry and isolate the affected feeder line remotely if arcing or smoke is reported.',
        'Dispatch a certified line crew with thermal imaging equipment and establish a 15-meter safety cordon.',
        'Notify affected complainants with estimated restoration window and safety warning to stay clear of downed lines.',
        'Verify voltage stability across adjacent blocks before restoring grid load and capturing photo evidence.',
      ],
      tags: ['power', 'outage', 'blackout', 'transformer', 'spark', 'electricity', 'voltage'],
    },
    {
      title: 'SOP-WATER-02: Burst Water Main & Pressure Drop Containment',
      categoryName: 'Water Supply',
      deptCode: 'WATER',
      summary: 'Valve isolation, turbidity testing, and emergency repair dispatch for ruptured water mains.',
      steps: [
        'Locate nearest upstream isolation valve on GIS utility map and dispatch valve-shutoff crew.',
        'Issue boil-water or low-pressure advisory to impacted zone if pressure drops below 20 PSI.',
        'Excavate, clamp or replace damaged pipe segment, and flush hydrant lines.',
        'Conduct chlorine residual and turbidity test before lifting advisory and closing work order.',
      ],
      tags: ['water', 'leak', 'pipe', 'burst', 'pressure', 'contamination', 'sewage'],
    },
    {
      title: 'SOP-INFRA-03: Roadway Hazard, Pothole & Drainage Collapse Repair',
      categoryName: 'Infrastructure',
      deptCode: 'INFRA',
      summary: 'Emergency cone placement, temporary steel plating, and permanent asphalt/drainage restoration.',
      steps: [
        'Classify hazard severity based on lane position, depth (>10cm), and pedestrian/cyclist exposure.',
        'Deploy reflective barricades or temporary steel plates within 4 hours for high-risk arterial routes.',
        'Schedule hot-mix asphalt crew or storm-drain jetting unit and upload before/after site photographs.',
      ],
      tags: ['road', 'pothole', 'bridge', 'drainage', 'sidewalk', 'streetlight', 'flooding'],
    },
    {
      title: 'SOP-TECH-04: Portal Authentication & Payment Gateway Error Recovery',
      categoryName: 'Technical Issues',
      deptCode: 'TECH',
      summary: 'Diagnostic playbook for session timeouts, 502 gateway errors, and failed portal submissions.',
      steps: [
        'Check API gateway logs and correlation timestamps against recent deployment releases.',
        'Verify token verification middleware and third-party webhook availability.',
        'Provide affected user with temporary reference workaround and confirm fix across browsers.',
      ],
      tags: ['login', 'error', 'portal', 'crash', 'bug', 'app', 'website', 'api'],
    },
    {
      title: 'SOP-FIN-05: Duplicate Billing & Automated Refund Reconciliation',
      categoryName: 'Financial Issues',
      deptCode: 'FIN',
      summary: 'Audit ledger entries, reverse duplicate authorizations, and issue formal credit confirmation.',
      steps: [
        'Cross-check payment processor settlement IDs against customer invoice ledger.',
        'Initiate immediate void/refund for duplicate transaction references and generate credit memo.',
        'Send itemized receipt and expected bank settlement timeline (3–5 business days) to complainant.',
      ],
      tags: ['billing', 'charge', 'refund', 'invoice', 'payment', 'overcharge', 'money'],
    },
    {
      title: 'SOP-SAFE-06: Urgent Safety Hazard & Perimeter Incident Escalation',
      categoryName: 'Safety and Security',
      deptCode: 'SAFE',
      summary: 'Immediate escalation protocol for gas odors, exposed wiring, structural collapse, or security threats.',
      steps: [
        'Immediately escalate to on-duty Safety Officer and alert emergency municipal/facility dispatch.',
        'Instruct complainant to evacuate immediate hazard zone if gas, fire, or live electrical risk exists.',
        'Log incident handoff timestamp and verify on-site containment before downgrading priority.',
      ],
      tags: ['safety', 'security', 'fire', 'gas', 'danger', 'hazard', 'threat', 'emergency'],
    },
  ];

  for (const kb of kbDefs) {
    await db.insert(knowledgeBaseArticles).values({
      title: kb.title,
      categoryName: kb.categoryName,
      departmentId: deptByCode.get(kb.deptCode)?.id ?? null,
      summary: kb.summary,
      steps: kb.steps,
      tags: kb.tags,
    });
  }
}
