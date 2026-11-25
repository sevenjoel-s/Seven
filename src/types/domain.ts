export type AccountType = 'employee' | 'customer' | 'external_guest';

export type RoleKey =
  | 'super_admin'
  | 'company_admin'
  | 'it_admin'
  | 'hr_manager'
  | 'department_manager'
  | 'meeting_admin'
  | 'meeting_organizer'
  | 'meeting_moderator'
  | 'employee'
  | 'support_agent'
  | 'customer'
  | 'external_guest';

export type AccountStatus = 'active' | 'pending_approval' | 'suspended' | 'deactivated' | 'blocked';
export type AvailabilityStatus = 'available' | 'busy' | 'dnd' | 'away' | 'offline';

export interface UserAccount {
  uid: string;
  email: string;
  fullName: string;
  phone?: string;
  photoUrl?: string;
  accountType: AccountType;
  role: RoleKey;
  status: AccountStatus;
  departmentId?: string;
  departmentName?: string;
  jobTitle?: string;
  availability?: AvailabilityStatus;
  mfaEnabled?: boolean;
  biometricEnabled?: boolean;
  forcePasswordChange?: boolean;
  inviteId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface EmployeeDirectoryEntry {
  uid: string;
  fullName: string;
  role: RoleKey | string;
  departmentId?: string;
  departmentName?: string;
  jobTitle?: string;
  availability: AvailabilityStatus;
  photoUrl?: string;
  updatedAt: string;
}

export interface CustomerDirectoryEntry {
  uid: string;
  displayName: string;
  photoUrl?: string;
  availability: AvailabilityStatus;
  updatedAt: string;
}

export interface Department {
  id: string;
  name: string;
  code: string;
  description?: string;
  managerUid?: string;
  isDemo?: boolean;
  demoBatchId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface RoleDefinition {
  id: string;
  key: string;
  name: string;
  description?: string;
  permissions: string[];
  isSystem: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface EmployeeInvite {
  id: string;
  email: string;
  role: RoleKey;
  departmentId?: string;
  departmentName?: string;
  jobTitle?: string;
  status: 'pending' | 'claimed' | 'revoked';
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export type ConversationType =
  | 'direct_employee'
  | 'group_employee'
  | 'department'
  | 'support'
  | 'customer_community'
  | 'customer_direct';

export type ConversationScope = 'internal' | 'support' | 'customer';

export interface Conversation {
  id: string;
  type: ConversationType;
  scope: ConversationScope;
  name: string;
  description?: string;
  departmentId?: string;
  orderId?: string;
  createdBy: string;
  memberUids: string[];
  adminUids?: string[];
  lastMessageText?: string;
  lastMessageAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ChatMessage {
  id: string;
  senderUid: string;
  senderName: string;
  senderAccountType?: AccountType;
  type: 'text' | 'image' | 'video' | 'audio' | 'file' | 'system';
  text: string;
  attachmentUrl?: string;
  attachmentName?: string;
  attachmentMime?: string;
  replyToId?: string;
  replyToPreview?: string;
  forwardedFrom?: string;
  pinned?: boolean;
  edited?: boolean;
  deleted?: boolean;
  reactions?: Record<string, string[]>;
  readBy?: string[];
  scheduledFor?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Meeting {
  id: string;
  title: string;
  description?: string;
  agenda?: string;
  meetingCode: string;
  hostUid: string;
  hostName: string;
  type: 'instant' | 'scheduled' | 'department' | 'customer' | 'external' | 'recurring';
  scope: 'internal' | 'customer' | 'public_invite';
  departmentId?: string;
  priority?: 'low' | 'normal' | 'high' | 'urgent';
  startTime: string;
  endTime: string;
  recurrence?: 'none' | 'daily' | 'weekly' | 'monthly';
  waitingRoomEnabled?: boolean;
  passcode?: string;
  status: 'scheduled' | 'live' | 'ended' | 'cancelled';
  recordingConsentRequired?: boolean;
  participantUids: string[];
  documentUrls?: string[];
  isDemo?: boolean;
  demoBatchId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface MeetingParticipant {
  uid: string;
  displayName: string;
  role: 'host' | 'co_host' | 'moderator' | 'participant' | 'guest';
  status: 'invited' | 'waiting' | 'admitted' | 'rejected' | 'left';
  handRaised?: boolean;
  micMuted?: boolean;
  camOff?: boolean;
  recordingConsented?: boolean;
  durationSeconds?: number;
  joinedAt?: string;
  updatedAt: string;
}

export type ProductAvailabilityStatus = 'in_stock' | 'low_stock' | 'out_of_stock' | 'preorder';

export interface ProductSpecification {
  key: string;
  value: string;
}

export interface ProductCategory {
  id: string;
  name: string;
  slug: string;
  description?: string;
  imageUrl?: string;
  sortOrder?: number;
  active: boolean;
  createdBy: string;
  isDemo?: boolean;
  demoBatchId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Product {
  id: string;
  name: string;
  sku: string;
  category: string;
  categoryId?: string;
  description?: string;
  unit?: string;
  specifications?: ProductSpecification[];
  price: number;
  currency: string;
  stock: number;
  availabilityStatus?: ProductAvailabilityStatus;
  imageUrl?: string;
  galleryImages?: string[];
  active: boolean;
  createdBy: string;
  isDemo?: boolean;
  demoBatchId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ShoppingCartItem {
  productId: string;
  name?: string;
  sku?: string;
  unitPrice?: number;
  currency?: string;
  unit?: string;
  imageUrl?: string;
  quantity: number;
  addedAt?: string;
}

export interface ShoppingCart {
  customerUid: string;
  items: ShoppingCartItem[];
  updatedAt: string;
}

export interface DeliveryAddress {
  id: string;
  customerUid: string;
  label: string;
  recipientName: string;
  phone: string;
  city: string;
  subCity?: string;
  streetAddress: string;
  notes?: string;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface OrderItem {
  productId: string;
  name: string;
  sku: string;
  unit?: string;
  imageUrl?: string;
  quantity: number;
  unitPrice: number;
}

export type OrderStatus =
  | 'pending'
  | 'confirmed'
  | 'processing'
  | 'ready_for_delivery'
  | 'shipped'
  | 'delivered'
  | 'cancelled';

export interface OrderStatusHistoryEntry {
  status: OrderStatus;
  timestamp: string;
  actorUid: string;
  note?: string;
}

export interface CustomerOrder {
  id: string;
  orderNumber: string;
  invoiceNumber: string;
  customerUid: string;
  customerName: string;
  customerEmail?: string;
  customerPhone?: string;
  items: OrderItem[];
  subtotal?: number;
  tax?: number;
  total: number;
  currency: string;
  status: OrderStatus;
  statusHistory?: OrderStatusHistoryEntry[];
  shippingAddress?: string;
  deliveryCity?: string;
  notes?: string;
  isDemo?: boolean;
  demoBatchId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CallRecord {
  id: string;
  callerUid: string;
  callerName: string;
  callerRole?: string;
  calleeUid: string;
  calleeName: string;
  answeredByUid?: string;
  answeredByName?: string;
  callType: 'audio' | 'video';
  status: 'ringing' | 'active' | 'ended' | 'rejected' | 'missed' | 'cancelled';
  orderId?: string;
  startedAt: string;
  answeredAt?: string;
  endedAt?: string;
  durationSeconds?: number;
  endReason?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SupportAgentInfo {
  uid: string;
  fullName: string;
  role: string;
  jobTitle?: string;
  availability: AvailabilityStatus;
}

export interface FinancialTransaction {
  id: string;
  txNumber: string;
  orderId?: string;
  orderNumber?: string;
  invoiceNumber?: string;
  customerUid: string;
  customerName: string;
  type: 'order_payment' | 'refund' | 'adjustment' | 'payout';
  method: 'bank_transfer' | 'card' | 'cash_on_delivery' | 'mobile_money' | 'credit_adjustment';
  amount: number;
  currency: string;
  status: 'pending' | 'completed' | 'refunded' | 'failed' | 'cancelled';
  recordedByUid: string;
  approvedByUid?: string;
  notes?: string;
  isDemo?: boolean;
  demoBatchId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CustomerFeedback {
  id: string;
  customerUid: string;
  customerName: string;
  orderId?: string;
  type: 'inquiry' | 'complaint' | 'feedback';
  subject: string;
  message: string;
  rating?: number;
  status: 'open' | 'in_review' | 'resolved';
  response?: string;
  respondedBy?: string;
  isDemo?: boolean;
  demoBatchId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface NotificationItem {
  id: string;
  targetUid: string;
  type: 'meeting' | 'message' | 'order' | 'support' | 'security' | 'system' | 'call';
  title: string;
  body: string;
  linkTab?: string;
  linkId?: string;
  read: boolean;
  createdAt: string;
}

export interface AuditLog {
  id: string;
  actorUid: string;
  actorEmail?: string;
  actorRole?: string;
  action: string;
  targetType: string;
  targetId?: string;
  details?: string;
  severity: 'info' | 'warning' | 'critical';
  createdAt: string;
}

export interface SyncRecord {
  id: string;
  uid: string;
  deviceId: string;
  deviceName: string;
  syncType: 'messages' | 'meetings' | 'contacts' | 'customer_data' | 'full';
  status: 'synced' | 'pending' | 'failed';
  itemsSynced: number;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
}

export interface UserBookmark {
  id: string;
  uid: string;
  conversationId: string;
  messageId: string;
  previewText: string;
  senderName?: string;
  createdAt: string;
}

export interface BlockedUser {
  id: string;
  uid: string;
  blockedUid: string;
  reason?: string;
  createdAt: string;
}

export interface ModerationReport {
  id: string;
  reporterUid: string;
  targetUid: string;
  conversationId?: string;
  messageId?: string;
  reason: string;
  status: 'open' | 'reviewed' | 'resolved';
  createdAt: string;
  updatedAt: string;
}
