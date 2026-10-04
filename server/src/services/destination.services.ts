import { Request, Response, NextFunction } from 'express';
import { getConnection } from '../config/db.js';
import { AppError } from '../utils/errors.js';
import { audit } from './audit.services.js';
export const getDestinationLog = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const page=Number(req.query.page||1),size=Number(req.query.pageSize||10);
    if(!Number.isSafeInteger(page)||page<1||page>1000000||!Number.isSafeInteger(size)||size<1||size>25)throw new AppError(400,'INVALID_QUERY','Invalid log pagination');
    const pool = await getConnection();
    const result = await pool.request().input('id', Number(req.params.messageId)).input('offset',(page-1)*size).input('size',size).query('SELECT l.*,d.name destination_name FROM "MessageDestinationLog" l LEFT JOIN "Destinations" d ON d.id=l.destination_id WHERE l.message_id=@id ORDER BY l.sent_at DESC,l.id DESC LIMIT @size OFFSET @offset');
    await audit('VIEW_DESTINATION_PAYLOAD',req,'message',Number(req.params.messageId));
    res.json(result.recordset);
  } catch (error) {next(error);}
};
