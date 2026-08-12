export interface AuditJobPayload {
  organizationId: string;
  userId?: string;
  action: string;
  entityType?: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
  ip?: string;
  userAgent?: string;
}

export const AUDIT_QUEUE = 'audit';
export const AUDIT_JOB = 'record';
