import { Request } from 'express';
import type { DatabaseTransaction } from '../config/db.js';
import { getConnection } from '../config/db.js';
export async function audit(
  action: string,
  req: Request,
  resourceType: string,
  resourceId?: number,
  transaction?: DatabaseTransaction,
) {
  const executor = transaction || (await getConnection());
  await executor
    .request()
    .input('userId', req.user?.id ?? null)
    .input('action', action)
    .input('resourceType', resourceType)
    .input('resourceId', resourceId ?? null)
    .input('requestId', req.requestId)
    .input('ip', req.ip || '')
    .query(
      'INSERT INTO "AuditLog"(user_id,action,resource_type,resource_id,request_id,ip_address) VALUES(@userId,@action,@resourceType,@resourceId,@requestId,@ip)',
    );
}
