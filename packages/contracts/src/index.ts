import storySchema from "../story.schema.json";
export const SCHEMA_VERSION = "1.0" as const;
export const RULES_VERSION = "1.0" as const;
export const LIMITS = {
  nodes: storySchema.properties.nodes.maxItems,
  variables: storySchema.properties.variables.maxItems,
  choices: storySchema.properties.nodes.items.properties.choices.maxItems,
  sessionChoices: 500,
  listItems: 100,
  states: 6000,
  timeMs: 5000,
} as const;
export type Condition = { variableId: string; equals: boolean };
export type Effect = { variableId: string; value: boolean };
export type Choice = {
  id: string;
  label: string;
  targetNodeId: string;
  conditions: Condition[];
  effects: Effect[];
};
export type StoryNode = {
  id: string;
  title: string;
  body: string;
  kind: "scene" | "ending";
  media: { backgroundId?: string; audioId?: string };
  choices: Choice[];
};
export type Story = {
  schemaVersion: "1.0";
  rulesVersion: "1.0";
  title: string;
  entryNodeId: string;
  variables: {
    id: string;
    label: string;
    kind: "item" | "flag";
    initial: boolean;
  }[];
  nodes: StoryNode[];
};
export type Layout = {
  positions: Record<string, { x: number; y: number }>;
  viewport: { x: number; y: number; zoom: number };
};
export type RuntimeState = { nodeId: string; values: Record<string, boolean> };
export type StateDelta = {
  variableId: string;
  before: boolean;
  after: boolean;
}[];
export type ChoiceView = {
  id: string;
  label: string;
  available: boolean;
  unmet: Condition[];
};
export type RuleErrorCode =
  | "INVALID_STORY"
  | "INVALID_STATE"
  | "UNSUPPORTED_VERSION"
  | "AT_ENDING"
  | "CHOICE_NOT_FOUND"
  | "CONDITION_NOT_MET";
export type ApplyResult =
  | { ok: true; state: RuntimeState; delta: StateDelta }
  | {
      ok: false;
      error: { code: RuleErrorCode; message: string; details?: unknown };
    };
export type Issue = {
  code: string;
  severity: "error" | "warning";
  nodeId?: string;
  choiceId?: string;
  variableId?: string;
  message: string;
  path?: string[];
  state?: RuntimeState;
  unmet?: Condition[];
};
export type ValidationReport = {
  reportId: string;
  activityId: string;
  revision: number;
  snapshotDigest: string;
  validatorVersion: string;
  complete: boolean;
  publishable: boolean;
  visitedStates: number;
  truncationReason: "STATE_LIMIT" | "TIME_LIMIT" | null;
  issues: Issue[];
};
export type Asset = {
  id: string;
  kind: "background" | "audio" | "icon";
  path: string;
  contentHash: string;
  license: string;
  source: string;
};
export type PublishedSnapshot = {
  versionId: string;
  activityId: string;
  versionNumber: number;
  sourceRevision: number;
  story: Story;
  assets: Asset[];
  snapshotDigest: string;
  publishedAt: string;
};
export type Session = {
  id: string;
  versionId: string;
  playerId: string;
  initialState: RuntimeState;
  state: RuntimeState;
  seq: number;
  source: { saveId: string; sessionId: string; eventSeq: number } | null;
  shareWithCreator: boolean;
  status: "active" | "ended";
};
export type PlayEvent = {
  id: string;
  sessionId: string;
  versionId: string;
  seq: number;
  requestId: string;
  choiceId: string;
  before: RuntimeState;
  after: RuntimeState;
  delta: StateDelta;
  createdAt: string;
};
export type ExecuteChoiceRequest = {
  choiceId: string;
  expectedSeq: number;
  requestId: string;
};
export type ExecuteChoiceResponse = {
  sessionId: string;
  versionId: string;
  seq: number;
  state: RuntimeState;
  choices: ChoiceView[];
  eventId: string;
  status: "active" | "ended";
};
export type Save = {
  id: string;
  playerId: string;
  versionId: string;
  sourceSessionId: string;
  sourceSeq: number;
  state: RuntimeState;
  label: string;
  createdAt: string;
};
export type FeedbackRequest = {
  requestId: string;
  eventSeq: number;
  nodeId: string;
  category: "bug" | "confusing" | "suggestion";
  text: string;
};
export type ApiError = {
  error: {
    code: string;
    message: string;
    requestId: string;
    details?: unknown;
  };
};
