export interface SocialLinks {
  instagram?: string;
  twitter?: string;
  linkedin?: string;
  youtube?: string;
  github?: string;
  website?: string;
}

export interface User {
  id: string;
  username: string;
  displayName: string;
  email?: string | null;
  phone?: string | null;
  avatarUrl?: string | null;
  bio?: string | null;
  primaryLanguage?: string;
  socialLinks?: SocialLinks | null;
  isVerified?: boolean;
  lastSeenAt?: string | null;
  isOnline?: boolean;
  createdAt?: string;
}

export interface Attachment {
  id: string;
  messageId: string;
  originalName: string;
  storagePath: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
}

export interface MessageReceipt {
  id: string;
  messageId: string;
  userId: string;
  deliveredAt?: string | null;
  readAt?: string | null;
}

export interface PollVote {
  id: string;
  userId: string;
  optionId: string;
}

export interface PollOption {
  id: string;
  pollId: string;
  text: string;
  position: number;
  votes: PollVote[];
}

export interface PollData {
  id: string;
  conversationId: string;
  messageId: string;
  creatorId: string;
  question: string;
  allowMultiple: boolean;
  closedAt?: string | null;
  createdAt: string;
  options: PollOption[];
}

export interface Message {
  id: string;
  conversationId: string;
  senderId: string;
  body?: string | null;
  ciphertext?: string | null;
  type: 'TEXT' | 'IMAGE' | 'VIDEO' | 'DOCUMENT' | 'VOICE' | 'SYSTEM' | 'POLL';
  isViewOnce?: boolean;
  viewedAt?: string | null;
  replyToId?: string | null;
  editedAt?: string | null;
  deletedAt?: string | null;
  createdAt: string;
  sender?: {
    id: string;
    username: string;
    displayName: string;
    avatarUrl?: string | null;
  };
  attachments?: Attachment[];
  receipts?: MessageReceipt[];
  poll?: PollData | null;
}

export interface ConversationMember {
  id: string;
  conversationId: string;
  userId: string;
  role: 'MEMBER' | 'ADMIN' | 'OWNER';
  joinedAt: string;
  lastReadAt?: string | null;
  archivedAt?: string | null;
  user?: User;
}

export interface Conversation {
  id: string;
  type: 'DIRECT' | 'GROUP';
  title?: string | null;
  createdAt: string;
  updatedAt: string;
  members: ConversationMember[];
  messages: Message[];
}

export interface NearbyCommonGroup {
  id: string;
  title: string;
}

export type NearbyConnectionStatus =
  | 'NONE'
  | 'PENDING_SENT'
  | 'PENDING_RECEIVED'
  | 'CONNECTED'
  | 'REJECTED';

export interface NearbyUser {
  id: string;
  username: string;
  displayName: string;
  avatarUrl?: string | null;
  bio?: string | null;
  isOnline?: boolean;
  lastSeenAt?: string | null;
  distanceMeters: number;
  commonGroups: NearbyCommonGroup[];
  connectionStatus: NearbyConnectionStatus;
  requestId?: string;
  conversationId?: string;
  lastActiveAt?: string;
}

export interface ConnectionRequestItem {
  id: string;
  senderId: string;
  receiverId: string;
  status: 'PENDING' | 'ACCEPTED' | 'REJECTED';
  message?: string | null;
  createdAt: string;
  sender?: User;
  receiver?: User;
}

export interface AssistantTask {
  id: string;
  userId: string;
  title: string;
  dueAt?: string | null;
  status: 'PENDING' | 'COMPLETED';
  createdAt: string;
}

export interface ScheduledAction {
  id: string;
  userId: string;
  type: 'SEND_MESSAGE' | 'REMINDER' | 'CREATE_POLL' | 'CALL';
  status: 'PENDING' | 'EXECUTED' | 'FAILED' | 'CANCELLED';
  scheduledFor: string;
  executedAt?: string | null;
  targetUserId?: string | null;
  targetConversationId?: string | null;
  targetLabel?: string | null;
  payload: Record<string, any>;
  resultMessage?: string | null;
  createdAt: string;
}

export interface AssistantPendingAction {
  id: string;
  type: 'SEND_MESSAGE' | 'SCHEDULE_MESSAGE' | 'START_CALL' | 'CREATE_GROUP' | 'CREATE_POLL' | 'SET_REMINDER' | 'CANCEL_SCHEDULED';
  status: 'PENDING' | 'CONFIRMED' | 'CANCELLED' | 'FAILED';
  language?: string;
  targetUserId?: string;
  targetConversationId?: string;
  targetLabel?: string;
  isTargetOnline?: boolean;
  body?: string;
  scheduledForIso?: string;
  isVideo?: boolean;
  groupTitle?: string;
  memberIds?: string[];
  question?: string;
  options?: string[];
  reminderText?: string;
  scheduledActionId?: string;
  candidates?: Array<{
    kind: 'USER' | 'GROUP';
    userId?: string;
    conversationId?: string;
    label: string;
    sublabel?: string;
    isOnline?: boolean;
  }>;
}

export interface AssistantMessage {
  id: string;
  userId: string;
  role: 'user' | 'assistant';
  content: string;
  language: string;
  metadata?: {
    pendingAction?: AssistantPendingAction;
    executedResult?: { ok: boolean; text: string };
    unreadItems?: Array<{ conversationId: string; title: string; count: number; latest: string }>;
    searchResults?: Array<{ id: string; conversationId: string; body: string; sender: string }>;
    conversationLink?: { conversationId: string; label: string };
  } | null;
  createdAt: string;
}

export interface AssistantRecentConversation {
  id: string;
  type: 'DIRECT' | 'GROUP';
  title: string;
  avatarUrl?: string | null;
  lastMessageBody: string;
  updatedAt: string;
}

export interface AssistantState {
  messages: AssistantMessage[];
  tasks: AssistantTask[];
  scheduledActions: ScheduledAction[];
  recentConversations: AssistantRecentConversation[];
  aiConfig?: {
    configured: boolean;
    provider: string;
  };
}
