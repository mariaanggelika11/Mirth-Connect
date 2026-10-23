import type { UserRole } from '../middleware/auth.js';
import type { BrowserSessionMetadata } from '../services/sessionPolicy.services.js';
declare global {
  namespace Express {
    interface Request {
      user?: { id: number; role: UserRole; name: string; tokenId?: string; expiresAt?: number };
      browserSession?: BrowserSessionMetadata & { familyId: string };
      requestId: string;
    }
  }
}
export {};
