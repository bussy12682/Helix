// Simple in-memory rate limiter
class RateLimiter {
  constructor() {
    this.attempts = new Map();
  }

  isLimited(key, maxAttempts = 5, windowMs = 15 * 60 * 1000) {
    const now = Date.now();
    const record = this.attempts.get(key) || { count: 0, resetAt: now + windowMs };

    // Reset if window has passed
    if (now > record.resetAt) {
      record.count = 0;
      record.resetAt = now + windowMs;
    }

    record.count++;
    this.attempts.set(key, record);

    return record.count > maxAttempts;
  }

  getRemainingAttempts(key, maxAttempts = 5, windowMs = 15 * 60 * 1000) {
    const now = Date.now();
    const record = this.attempts.get(key);

    if (!record || now > record.resetAt) {
      return maxAttempts;
    }

    return Math.max(0, maxAttempts - record.count);
  }

  reset(key) {
    this.attempts.delete(key);
  }
}

export { RateLimiter };
