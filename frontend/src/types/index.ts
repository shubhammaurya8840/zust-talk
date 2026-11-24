export interface User {
  id: string;
  username: string;
  displayName: string;
  email?: string | null;
  phone?: string | null;
  avatarUrl?: string | null;
  bio?: string | null;
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

export interface Message {
  id: string;
  conversationId: string;
  senderId: string;
  body?: string | null;
  ciphertext?: string | null;
  type: 'TEXT' | 'IMAGE' | 'VIDEO' | 'DOCUMENT' | 'VOICE';
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
}

export interface ConversationMember {
  id: string;
  conversationId: string;
  userId: string;
  role: 'MEMBER' | 'ADMIN' | 'OWNER';
  joinedAt: string;
  lastReadAt?: string | null;
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
