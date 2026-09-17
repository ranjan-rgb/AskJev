/** Sliding-window rate limiter (e.g. 30 acts / minute). */
export class RateLimiter {
  private readonly timestamps: number[] = [];
  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  try(): boolean {
    const now = Date.now();
    while (this.timestamps.length && this.timestamps[0]! < now - this.windowMs) {
      this.timestamps.shift();
    }
    if (this.timestamps.length >= this.limit) return false;
    this.timestamps.push(now);
    return true;
  }

  remaining(): number {
    const now = Date.now();
    while (this.timestamps.length && this.timestamps[0]! < now - this.windowMs) {
      this.timestamps.shift();
    }
    return Math.max(0, this.limit - this.timestamps.length);
  }
}
