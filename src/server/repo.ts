import "server-only";
import { confirmedFlow, flowArmed, reconfirmFlow } from "./device";
import { usesCloud } from "./scope";
import { MODE } from "./supabase";
import * as cloud from "./store/cloud";
import * as local from "./store/local";

/*
 * The app's data: the signed-in account's in PacedMind Cloud (store/cloud.ts), or without an account this
 * computer's own (store/local.ts, the free One device plan). Both answer every call the same way, so the rest
 * of the app never asks which one it has; each call goes to the one in use at that moment (scope.ts).
 */

export {
  CODEX_ENV, DEFAULT_SETTINGS, cleanDeviceName, cleanDoneWhen, codexEnvProblem, edgeSignature, repoOf,
  type LaunchRequestFilter, type LaunchRequestInput, type ReportInput, type SessionFilter, type TaskFilter, type TaskInput, type TaskPatch,
} from "./store/shared";

type Store = typeof cloud;

// This computer's store must answer everything the account's does, with the same types.
const stores: { cloud: Store; local: Store } = { cloud, local };

/** A store function that runs on whichever store is in use when it's called. */
function via<K extends keyof Store>(name: K): Store[K] {
  const call = async (...args: unknown[]) => {
    const store = (await usesCloud()) ? stores.cloud : stores.local;
    return (store[name] as (...a: unknown[]) => Promise<unknown>)(...args);
  };
  return call as unknown as Store[K];
}

/* ---------- areas and projects ---------- */
export const listAreas = via("listAreas");
export const areaPicture = via("areaPicture");
export const createArea = via("createArea");
export const updateArea = via("updateArea");
export const deleteArea = via("deleteArea");
export const listProjects = via("listProjects");
export const getProject = via("getProject");
export const createProject = via("createProject");
export const updateProject = via("updateProject");
export const deleteProject = via("deleteProject");
export const setProjectRepo = via("setProjectRepo");
export const mergeProject = via("mergeProject");

/* ---------- tasks ---------- */
export const listTasks = via("listTasks");
export const getTask = via("getTask");
export const taskStatuses = via("taskStatuses");
export const createTask = via("createTask");
export const updateTask = via("updateTask");
export const deleteTask = via("deleteTask");
export const addSubtask = via("addSubtask");
export const setSubtaskDone = via("setSubtaskDone");
export const deleteSubtask = via("deleteSubtask");

/* ---------- calendar events ---------- */
export const listEvents = via("listEvents");
export const createEvent = via("createEvent");
export const getEvent = via("getEvent");
export const updateEvent = via("updateEvent");
export const deleteEvent = via("deleteEvent");
export const occurrences = via("occurrences");

/* ---------- sessions ---------- */
export const listSessions = via("listSessions");
export const getSession = via("getSession");
export const latestSession = via("latestSession");
export const createSession = via("createSession");
export const updateSession = via("updateSession");
export const addSessionEvent = via("addSessionEvent");
export const sessionEvents = via("sessionEvents");
export const sessionEventsFor = via("sessionEventsFor");
export const doneTimes = via("doneTimes");

/* ---------- reports and their images ---------- */
export const countSessionImages = via("countSessionImages");
export const attachmentFile = via("attachmentFile");
export const addAttachment = via("addAttachment");
export const pendingImages = via("pendingImages");
export const createReport = via("createReport");
export const setReportChanges = via("setReportChanges");
export const deleteReport = via("deleteReport");
export const reportsForTasks = via("reportsForTasks");
export const reportBriefs = via("reportBriefs");
export const reportsForSessions = via("reportsForSessions");
export const latestReport = via("latestReport");
export const latestSessionReport = via("latestSessionReport");
export const heldOutcomes = via("heldOutcomes");
export const heldTaskIds = via("heldTaskIds");

/* ---------- flows ---------- */
export const flowSnapshot = via("flowSnapshot");
export const listEdges = via("listEdges");
export const createEdge = via("createEdge");
export const updateEdge = via("updateEdge");
export const deleteEdge = via("deleteEdge");
export const deleteEdgesOf = via("deleteEdgesOf");
export const setIncomingMode = via("setIncomingMode");

/**
 * After you changed a flow in this computer's window (only for a flow that's on): the connections into and
 * out of `tasks` count as confirmed as they are now, connections that are gone are forgotten, and with
 * `after` so does the project it starts after. Other connections keep their state: one an agent added
 * meanwhile stays unconfirmed. MCP tools and the web app never call this.
 */
export async function confirmFlowChange(projectId: string | null | undefined, change: { tasks?: number[]; after?: boolean }) {
  if (MODE !== "desktop" || !projectId || !flowArmed(projectId)) return;
  const was = confirmedFlow(projectId) ?? { edges: [], after: null };
  const now = await flowSnapshot(projectId);
  const touched = new Set(change.tasks ?? []);
  const ends = (sig: string) => sig.split(":")[0].split(">").map(Number);
  const edges = new Set(was.edges.filter((sig) => now.edges.includes(sig)));
  for (const sig of now.edges) if (ends(sig).some((id) => touched.has(id))) edges.add(sig);
  reconfirmFlow(projectId, { edges: [...edges], after: change.after ? now.after : was.after });
}

/* ---------- settings ---------- */
export const getSettings = via("getSettings");
export const setSettings = via("setSettings");

/* ---------- computers and requests to start sessions (PacedMind Cloud's) ---------- */
export const saveDeviceTools = via("saveDeviceTools");
export const listDevices = via("listDevices");
export const getDevice = via("getDevice");
export const registerDevice = via("registerDevice");
export const claimDevice = via("claimDevice");
export const revokeDevice = via("revokeDevice");
export const renameDevice = via("renameDevice");
export const setDefaultDevice = via("setDefaultDevice");
export const updateDeviceRow = via("updateDeviceRow");
export const listLaunchRequests = via("listLaunchRequests");
export const createLaunchRequest = via("createLaunchRequest");
export const settleLaunchRequest = via("settleLaunchRequest");

/* ---------- live refresh ---------- */
export const stateVersion = via("stateVersion");
