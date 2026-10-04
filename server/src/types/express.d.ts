import type { UserRole } from '../middleware/auth.js';
declare global {
  namespace Express {
    interface Request {
      user?: { id: number; role: UserRole; name: string; tokenId?:string; expiresAt?:number };
      requestId: string;
    }
  }
}
export {};
