// ============================================================
// SignalFlow GTM Intelligence Engine — Shared Types & Interfaces
// ============================================================

// --- CRM Status ---

export type CRMStatus = 'New' | 'Contacted' | 'Replied' | 'Booked' | 'Closed';

/**
 * Pipeline order for CRM statuses.
 * Used to determine forward vs backward status transitions.
 */
export const CRM_PIPELINE_ORDER: Record<CRMStatus, number> = {
  New: 0,
  Contacted: 1,
  Replied: 2,
  Booked: 3,
  Closed: 4,
};

// --- ICP (Ideal Customer Profile) ---

export interface ICP {
  id: string;
  founderId: string;
  targetRole: string;
  industry: string;
  companyStage?: string;
  geography?: string;
  customTags?: string[];
  createdAt: Date;
  updatedAt: Date;
}

// --- ICP Project ---

export interface ICPProject {
  id: string;
  founderId: string;
  name: string;
  productDescription: string;
  isActive: boolean;
  isDeleted: boolean;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

// --- ICP Profile (Multi-ICP) ---

export interface ICPProfile {
  id: string;
  founderId: string;
  projectId?: string;
  targetRole: string;
  industry: string;
  companyStage?: string;
  geography?: string;
  painPoints: string[];
  buyingSignals: string[];
  customTags?: string[];
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface ICPSet {
  founderId: string;
  profiles: ICPProfile[];
  activeCount: number;
}

// --- Lead Scoring ---

export interface ScoreBreakdown {
  icpMatch: number; // 0–40
  roleRelevance: number; // 0–30
  intentSignals: number; // 0–30
}

export interface EnrichmentData {
  // Existing fields (unchanged)
  linkedinBio?: string;
  recentPosts?: string[];
  companyInfo?: string;
  failedSources?: string[];

  // New fields for lead discovery & enrichment
  email?: string;
  emailVerified?: boolean;
  emailVerificationMethod?:
    | 'smtp_rcpt_to'
    | 'hunter_api'
    | 'pattern_inference'
    | 'github_commit'
    | 'website_scrape'
    | 'press_release';
  linkedinUrl?: string;
  companyDomain?: string;
  dataConfidenceScore?: number; // 0.0 to 1.0
  lastVerifiedAt?: Date;
  dataSources?: string[]; // e.g., ["linkedin_scrape", "github_scrape", "smtp_verify"]
}

// --- Lead ---

export interface Lead {
  id: string;
  founderId: string;
  projectId?: string;
  name: string;
  role: string;
  company: string;
  industry?: string;
  geography?: string;
  email?: string;
  leadScore: number; // 1–100
  scoreBreakdown: ScoreBreakdown;
  enrichmentStatus: 'pending' | 'complete' | 'partial' | 'researching';
  enrichmentData?: EnrichmentData;
  crmStatus: CRMStatus;
  isDeleted: boolean;
  deletedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
  correlationScore?: number;
  correlationFlag?: string;
  icpProfileId?: string;
}

// --- Scoring Service ---

export interface ScoringInput {
  lead: Pick<Lead, 'role' | 'industry' | 'geography' | 'company' | 'enrichmentData'>;
  icp: ICP;
}

export interface ScoringOutput {
  totalScore: number; // 1–100
  breakdown: ScoreBreakdown;
}

// --- Lead Scoring V2 (Multi-ICP) ---

export interface ScoreBreakdownV2 {
  icpMatch: number; // 0–25
  roleRelevance: number; // 0–25
  intentSignals: number; // 0–30
  painPointRelevance: number; // 0–20
}

export interface ScoringInputV2 {
  lead: Pick<Lead, 'role' | 'industry' | 'geography' | 'company' | 'enrichmentData'>;
  icpProfile: ICPProfile;
}

export interface ScoringOutputV2 {
  totalScore: number; // 1–100
  breakdown: ScoreBreakdownV2;
}

// --- Outreach ---

export interface OutreachRecord {
  id: string;
  leadId: string;
  founderId: string;
  channel: 'email' | 'dm';
  messageContent: string;
  outreachDate: Date;
  isFollowUp: boolean;
  createdAt: Date;
}

// --- CRM Pipeline ---

export interface StatusChange {
  id: string;
  leadId: string;
  fromStatus: CRMStatus;
  toStatus: CRMStatus;
  reason?: string;
  meetingDate?: Date;
  changedAt: Date;
}

// --- Insight Extractor ---

export interface Tag {
  id: string;
  category: 'pain_point' | 'objection' | 'feature_request';
  value: string;
}

export interface CallNote {
  id: string;
  leadId: string;
  founderId: string;
  painPoints: string[];
  objections: string[];
  featureRequests: string[];
  nextSteps: string;
  sentiment: 'positive' | 'neutral' | 'negative';
  sentimentInferred: boolean;
  rawText: string;
  tags: Tag[];
  tagGenerationFailed: boolean;
  createdAt: Date;
}

// --- Throttle Service ---

export interface ThrottleConfig {
  founderId: string;
  emailLimit: number; // 5–50, default 20
  dmLimit: number; // 5–50, default 20
}

export interface ThrottleStatus {
  channel: 'email' | 'dm';
  used: number;
  limit: number;
  remaining: number;
  warningThreshold: boolean; // true when >= 80% used
}

// --- Message Generator ---

export type MessageType = 'cold_email' | 'cold_dm';
export type TonePreference = 'professional' | 'casual' | 'direct';

export interface MessageRequest {
  leadId: string;
  messageType: MessageType;
  tone: TonePreference;
  productContext: string;
}

export interface MessageResponse {
  message: string;
  personalizationDetails: string[];
  limitedPersonalization: boolean;
}

// --- Dashboard ---

export interface UpcomingMeeting {
  leadName: string;
  date: Date;
  time: string;
}

export interface WeeklySummary {
  leadsContacted: number;
  replyRate: number; // percentage
  meetingsBooked: number;
  conversionRate: number;
  statusCounts: Record<CRMStatus, number>;
  upcomingMeetings: UpcomingMeeting[];
  highPrioritySuggestions: Lead[];
  lowMeetingPrompt?: Lead[];
}

// --- API Error ---

export interface ApiError {
  error: string; // machine-readable error code
  message: string; // human-readable description
  details?: Record<string, string>;
}

// ============================================================
// Automated Calendar Pipeline — Types & Interfaces
// ============================================================

// --- Pipeline Orchestrator ---

export interface PipelineRun {
  id: string;
  founderId: string;
  projectId?: string;
  status: 'running' | 'completed' | 'failed' | 'partial';
  stagesCompleted: string[];
  stageErrors: Record<string, string>;
  prospectsDiscovered: number;
  messagesSent: number;
  repliesProcessed: number;
  meetingsBooked: number;
  startedAt: Date;
  completedAt?: Date;
}

export interface PipelineStatus {
  state: 'running' | 'paused' | 'error';
  hasActiveRun: boolean;
  lastRun?: PipelineRun;
  nextRunAt?: Date;
}

// --- Pipeline Configuration ---

export interface PipelineConfig {
  founderId: string;
  runIntervalMinutes: number;
  businessHoursStart: string;
  businessHoursEnd: string;
  businessDays: number[];
  timezone: string;
  dailyDiscoveryCap: number;
  minLeadScore: number;
  maxFollowUps: number;
  sequenceCadenceDays: number[];
  tonePreference: TonePreference;
  productContext: string;
  valueProposition: string;
  targetPainPoints: string[];
}

// --- Email Integration ---

export interface EmailConnection {
  id: string;
  founderId: string;
  email: string;
  provider: 'gmail';
  accessToken: string;
  refreshToken: string;
  tokenExpiresAt: Date;
  sendingName: string;
  emailSignature: string;
  isActive: boolean;
  lastSyncAt?: Date;
  createdAt: Date;
}

export interface IncomingReply {
  id: string;
  founderId: string;
  leadId: string;
  outreachRecordId: string;
  gmailMessageId: string;
  gmailThreadId: string;
  fromEmail: string;
  subject: string;
  bodyText: string;
  receivedAt: Date;
  classificationResult?: string;
  classificationConfidence?: number;
  requiresManualReview: boolean;
  processedAt?: Date;
}

// --- Calendar Integration ---

export interface CalendarConnection {
  id: string;
  founderId: string;
  calendarId: string;
  provider: 'google';
  accessToken: string;
  refreshToken: string;
  tokenExpiresAt: Date;
  isActive: boolean;
  createdAt: Date;
}

export interface AvailabilityWindow {
  founderId: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  timezone: string;
}

export interface TimeSlot {
  start: Date;
  end: Date;
}

export interface CalendarEvent {
  id: string;
  calendarEventId: string;
  founderId: string;
  leadId: string;
  title: string;
  description: string;
  startTime: Date;
  endTime: Date;
  attendeeEmail: string;
  createdAt: Date;
}

// --- Response Classifier ---

export type ResponseClassification =
  | 'interested'
  | 'not_interested'
  | 'objection'
  | 'question'
  | 'out_of_office';

export interface ClassificationResult {
  classification: ResponseClassification;
  confidence: number;
  reasoning: string;
  detectedReturnDate?: Date;
}

// --- Booking Agent ---

export interface BookingProposal {
  id: string;
  leadId: string;
  founderId: string;
  proposedSlots: TimeSlot[];
  status: 'proposed' | 'confirmed' | 'declined' | 'expired';
  proposedAt: Date;
  respondedAt?: Date;
  confirmedSlot?: TimeSlot;
  followUpSentAt?: Date;
}

// --- Quality Gate ---

export interface QualityCheckResult {
  passed: boolean;
  failures: QualityFailure[];
}

export interface QualityFailure {
  check: string;
  reason: string;
}

// --- Strategy ---

export interface OutreachStrategy {
  productContext: string;
  valueProposition: string;
  targetPainPoints: string[];
  tonePreference: TonePreference;
}

// --- Pipeline Dashboard & Monitoring ---

export interface PipelineMetrics {
  prospectsDiscoveredToday: number;
  messagesSentToday: number;
  repliesReceivedToday: number;
  meetingsBookedToday: number;
  replyRatePercent: number;
  pipelineStatus: PipelineStatus;
}

export interface ConversationThread {
  leadId: string;
  leadName: string;
  company: string;
  messages: ConversationMessage[];
}

export interface ConversationMessage {
  id: string;
  direction: 'outbound' | 'inbound';
  content: string;
  timestamp: Date;
  classification?: ResponseClassification;
  confidence?: number;
}

export interface ManualReviewItem {
  replyId: string;
  leadName: string;
  company: string;
  replyText: string;
  suggestedClassification: ResponseClassification;
  confidence: number;
  receivedAt: Date;
}

// ============================================================
// Intelligent Outreach Personalization — Types & Interfaces
// ============================================================

// --- Enriched ICP ---

export interface EnrichedICP extends ICP {
  productDescription?: string;
  valueProposition?: string;
  painPointsSolved?: string[];
  competitorContext?: string;
  idealCustomerCharacteristics?: string;
  enrichmentGeneratedAt?: Date;
}

// --- Research Profile ---

export interface ResearchActivity {
  summary: string;
  source: string;
  timestamp: Date;
  url?: string;
}

export interface ResearchProfile {
  leadId: string;
  topicsOfInterest: string[];
  currentChallenges: string[];
  recentActivity: ResearchActivity[];
  publishedContentSummaries: string[];
  overallSentiment: 'positive' | 'neutral' | 'negative';
  sourcesUsed: string[];
  sourcesUnavailable: string[];
  researchedAt: Date;
}

// --- Correlation Engine ---

export interface CorrelationBreakdown {
  roleFit: number;
  industryAlignment: number;
  painPointOverlap: number;
  buyingSignalStrength: number;
}

export interface CorrelationScore {
  total: number;
  breakdown: CorrelationBreakdown;
}

// --- Personalization Context ---

export interface PainPointMatch {
  founderPainPoint: string;
  prospectChallenge: string;
  similarityScore: number;
}

export interface IntersectionAnalysis {
  painPointMatches: PainPointMatch[];
  overallRelevanceScore: number;
}

export interface PersonalizationContext {
  enrichedICP: EnrichedICP;
  researchProfile: ResearchProfile;
  intersectionAnalysis: IntersectionAnalysis;
  recentContentReference: ResearchActivity | null;
  painPointReference: PainPointMatch | null;
  contentSummaries?: ContentSummary[]; // Parsed structured summaries from publishedContentSummaries
  selectedContentDetail?: ContentSummary; // Most relevant ContentSummary for outreach
}

// --- Enhanced Message Generation ---

export interface PersonalizationMetadata {
  sourcesUsed: string[];
  painPointsReferenced: string[];
  contentReferenced: string[];
  intersectionScore: number;
}

export interface EnhancedMessageResponse extends MessageResponse {
  personalizationMetadata?: PersonalizationMetadata;
}

// --- Auto-Research Orchestrator ---

export interface AutoResearchProgress {
  stage:
    | 'researching_linkedin'
    | 'researching_twitter'
    | 'researching_blogs'
    | 'analyzing_content'
    | 'generating_message'
    | 'complete'
    | 'failed';
  percentComplete: number;
  message: string;
}

// ============================================================
// Deep Content Extraction — Types & Interfaces
// ============================================================

export interface ContentSummary {
  synopsis: string; // Plain-text summary, max 300 characters
  keyPoints: string[]; // 1–5 items
  notableQuotes: string[]; // 0–3 items
  opinions: string[]; // 0–3 items
  topics: string[]; // 1–5 items
  sourceUrl: string; // Original page URL
}
