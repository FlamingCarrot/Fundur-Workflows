import { DEFAULT_WORKFLOW_ID, getForm, getWorkflow, type WorkflowRef } from "@/lib/workflow";
import type { Brief, Project } from "./types";

const DAY = 86_400_000;

/** An empty brief with every field the workflow's brief form defines. */
export function emptyBrief(ref: WorkflowRef): Brief {
  return Object.fromEntries((getForm(ref, "brief")?.fields ?? []).map((f) => [f.key, ""]));
}

const WORKFLOW_VERSION = getWorkflow(DEFAULT_WORKFLOW_ID).version;

function daysAgo(now: number, days: number, hours = 0) {
  return new Date(now - days * DAY - hours * 3_600_000).toISOString();
}

/** Demo studio data. Stands in for the database until projects persist to Neon. */
export function makeSeedProjects(now = Date.now()): Project[] {
  return [
    {
      id: "sanlam-hq",
      name: "Sanlam Cape Town HQ",
      client: "Sanlam Financial Services",
      swatch: "clay",
      workflowId: DEFAULT_WORKFLOW_ID,
      workflowVersion: WORKFLOW_VERSION,
      status: "active",
      waitingOn: "me",
      startDate: daysAgo(now, 5),
      currentPhase: "discovery",
      completedPhases: [],
      checks: { "disc-01": true, "disc-02": true },
      brief: {
        clientName: "Sanlam Financial Services",
        headcount: "140",
        departments:
          "Executive suites (12), Wealth management (45), Open collaboration zone (60), Boardrooms (3)",
        adjacencies: "Wealth management beside client lounge; executives away from the collaboration zone",
        targetBudget: "R 4,800,000",
        spaceRequirements: "2,200 m² across two floors with acoustic zoning and high-density power",
        notes:
          "Warm neutral finishes, acoustic felt wall panelling and indigenous Cape flora as biophilic accents.",
      },
      briefAiFields: ["adjacencies"],
      documents: [
        { id: "d1", name: "Client discovery notes.docx", sizeBytes: 1_400_000, phaseKey: "discovery", uploadedAt: daysAgo(now, 0, 3), clientVisible: false },
        { id: "d2", name: "Floor plate level 4.dwg", sizeBytes: 24_800_000, phaseKey: "discovery", uploadedAt: daysAgo(now, 1), clientVisible: false },
        { id: "d3", name: "Acoustic guidelines v1.pdf", sizeBytes: 3_200_000, phaseKey: "discovery", uploadedAt: daysAgo(now, 2), clientVisible: true },
        { id: "d4", name: "Site visit photos.zip", sizeBytes: 48_100_000, phaseKey: "discovery", uploadedAt: daysAgo(now, 4), clientVisible: false },
      ],
      tasks: [],
      aiSpendZar: 0.22,
      lastActivity: daysAgo(now, 0, 1),
    },
    {
      id: "meridian-boardrooms",
      name: "Meridian Capital Boardrooms",
      client: "Meridian Capital",
      swatch: "slate",
      workflowId: DEFAULT_WORKFLOW_ID,
      workflowVersion: WORKFLOW_VERSION,
      status: "active",
      waitingOn: "me",
      startDate: daysAgo(now, 16),
      currentPhase: "space_planning",
      completedPhases: ["discovery"],
      checks: { "disc-01": true, "disc-02": true, "disc-03": true, "disc-04": true, "sp-01": true },
      brief: {
        clientName: "Meridian Capital",
        headcount: "36",
        departments: "Boardrooms (4), Investor lounge, Partner offices (8)",
        adjacencies: "Investor lounge at reception; boardrooms grouped on the harbour side",
        targetBudget: "R 2,100,000",
        spaceRequirements: "640 m², one floor",
        notes: "Dark timber, brass detailing, VC-ready rooms.",
      },
      briefAiFields: [],
      documents: [
        { id: "m1", name: "Approved brief.pdf", sizeBytes: 920_000, phaseKey: "discovery", uploadedAt: daysAgo(now, 9), clientVisible: true },
        { id: "m2", name: "Level 12 floor plate.dxf", sizeBytes: 6_400_000, phaseKey: "space_planning", uploadedAt: daysAgo(now, 3), clientVisible: false },
      ],
      tasks: [],
      aiSpendZar: 1.84,
      lastActivity: daysAgo(now, 0, 5),
    },
    {
      id: "harbour-vine",
      name: "Harbour & Vine, Level 6",
      client: "Harbour & Vine Attorneys",
      swatch: "sage",
      workflowId: DEFAULT_WORKFLOW_ID,
      workflowVersion: WORKFLOW_VERSION,
      status: "active",
      waitingOn: "client",
      startDate: daysAgo(now, 30),
      currentPhase: "concept",
      completedPhases: ["discovery", "space_planning"],
      checks: {
        "disc-01": true, "disc-02": true, "disc-03": true, "disc-04": true,
        "sp-01": true, "sp-02": true, "sp-03": true, "cpt-01": true,
      },
      brief: {
        clientName: "Harbour & Vine Attorneys",
        headcount: "58",
        departments: "Litigation (22), Corporate (18), Support (12), Partners (6)",
        adjacencies: "Partners near the client meeting suite",
        targetBudget: "R 3,250,000",
        spaceRequirements: "1,150 m²",
        notes: "Quiet, library-like character. Client meeting suite is the showpiece.",
      },
      briefAiFields: [],
      documents: [
        { id: "h1", name: "Chosen layout option B.pdf", sizeBytes: 2_700_000, phaseKey: "space_planning", uploadedAt: daysAgo(now, 11), clientVisible: true },
        { id: "h2", name: "Mood board, library direction.png", sizeBytes: 8_900_000, phaseKey: "concept", uploadedAt: daysAgo(now, 2), clientVisible: true },
      ],
      tasks: [],
      aiSpendZar: 3.1,
      lastActivity: daysAgo(now, 1, 2),
    },
    {
      id: "kloof-studio",
      name: "Kloof Street Creative Studio",
      client: "Fold & Co.",
      swatch: "ochre",
      workflowId: DEFAULT_WORKFLOW_ID,
      workflowVersion: WORKFLOW_VERSION,
      status: "active",
      waitingOn: "me",
      startDate: daysAgo(now, 58),
      currentPhase: "sourcing",
      completedPhases: ["discovery", "space_planning", "concept", "documentation"],
      checks: {
        "disc-01": true, "disc-02": true, "disc-03": true, "disc-04": true,
        "sp-01": true, "sp-02": true, "sp-03": true, "cpt-01": true, "cpt-02": true,
        "doc-01": true, "doc-02": true, "src-01": true,
      },
      brief: {
        clientName: "Fold & Co.",
        headcount: "24",
        departments: "Studio floor, Edit suites (3), Kitchen and social",
        adjacencies: "Edit suites away from the kitchen",
        targetBudget: "R 1,350,000",
        spaceRequirements: "480 m² warehouse conversion",
        notes: "Raw concrete, ochre accents, lots of pin-up wall.",
      },
      briefAiFields: [],
      documents: [
        { id: "k1", name: "FF&E schedule rev C.xlsx", sizeBytes: 410_000, phaseKey: "documentation", uploadedAt: daysAgo(now, 6), clientVisible: true },
        { id: "k2", name: "RFQ responses.pdf", sizeBytes: 1_900_000, phaseKey: "sourcing", uploadedAt: daysAgo(now, 1), clientVisible: false },
      ],
      tasks: [],
      aiSpendZar: 6.42,
      lastActivity: daysAgo(now, 2),
    },
    {
      id: "atlantic-clinic",
      name: "Atlantic Seaboard Clinic",
      client: "Seaboard Health",
      swatch: "blush",
      workflowId: DEFAULT_WORKFLOW_ID,
      workflowVersion: WORKFLOW_VERSION,
      status: "on_hold",
      waitingOn: "client",
      startDate: daysAgo(now, 20),
      currentPhase: "discovery",
      completedPhases: [],
      checks: { "disc-01": true },
      brief: { ...emptyBrief(DEFAULT_WORKFLOW_ID), clientName: "Seaboard Health" },
      briefAiFields: [],
      documents: [],
      tasks: [],
      aiSpendZar: 0,
      lastActivity: daysAgo(now, 12),
    },
  ];
}
