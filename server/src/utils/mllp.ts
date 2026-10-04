import { AppError } from './errors.js';
export const frame = (payload: string) => Buffer.from('\x0b' + payload + '\x1c\r', 'utf8');
export class MllpDecoder {
  private pending = Buffer.alloc(0);
  constructor(private maxBytes = 1048576) {}
  push(chunk: Buffer): string[] {
    this.pending = Buffer.concat([this.pending, chunk]);
    const messages: string[] = [];
    while (this.pending.length) {
      if (this.pending[0] !== 0x0b)
        throw new AppError(400, 'INVALID_MLLP_FRAME', 'Expected start block');
      const end = this.pending.indexOf(0x1c, 1);
      if (end < 0) {
        if (this.pending.length > this.maxBytes + 3)
          throw new AppError(413, 'MLLP_TOO_LARGE', 'Frame too large');
        break;
      }
      if (end > this.maxBytes + 1) throw new AppError(413, 'MLLP_TOO_LARGE', 'Frame too large');
      if (end + 1 >= this.pending.length) break;
      if (this.pending[end + 1] !== 0x0d || this.pending.subarray(1, end).includes(0x0b))
        throw new AppError(400, 'INVALID_MLLP_FRAME', 'Invalid end block');
      messages.push(this.pending.subarray(1, end).toString('utf8'));
      this.pending = this.pending.subarray(end + 2);
    }
    return messages;
  }
  get incomplete() {
    return this.pending.length > 0;
  }
}
