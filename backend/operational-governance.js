/**
 * HELIX AI Engineering Operating System — Operational governance
 *
 *  - TokenBudgetService: daily per-user and per-project token budgets. Every
 *    real provider call is authorized BEFORE dispatch and recorded AFTER with
 *    the provider-reported usage (mock output costs nothing and is never
 *    counted). Spend persists across restarts, so budgets survive reboots.
 *  - AuditLog: append-only, bounded, redacted record of security- and
 *    cost-relevant events (auth, project lifecycle, execution, approvals,
 *    governance rejections). Secrets are stripped before persistence.
 */

import { randomUUID } from "node:crypto";
import { redact } from "./logger.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const AUDIT_LIMIT = 1000;

export class BudgetExceededError extends Error {
  constructor(message, { scope, limit, used } = {}) {
    super(message);
    this.name = "BudgetExceededError";
    this.status = 429;
    this.code = "BUDGET_EXCEEDED";
    this.scope = scope;
    this.limit = limit;
    this.used = used;
  }
}

function todayKey(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

export class TokenBudgetService {
  constructor({
    store,
    userDailyTokenLimit = 2_000_000,
    projectDailyTokenLimit = 4_000_000,
    logger = null,
  } = {}) {
    if (!store) throw new Error("TokenBudgetService requires a store");
    this.store = store;
    this.userDailyTokenLimit = Math.max(0, Number(userDailyTokenLimit) || 0); // 0 = unlimited
    this.projectDailyTokenLimit = Math.max(0, Number(projectDailyTokenLimit) || 0);
    this.logger = logger;
  }

  usageRecord(key) {
    return this.store.budgetUsage?.get?.(key) ?? null;
  }

  usedTokens({ userId = null, projectId = null, day = todayKey() } = {}) {
    let total = 0;
    if (userId) {
      const record = this.usageRecord(`user:${userId}:${day}`);
      total += record?.totalTokens ?? 0;
    }
    if (projectId) {
      const record = this.usageRecord(`project:${projectId}:${day}`);
      total += record?.totalTokens ?? 0;
    }
    return total;
  }

  /**
   * Pre-call gate. Throws BudgetExceededError (429) when the caller is already
   * at or over a configured budget for today.
   */
  authorize({ userId = null, projectId = null } = {}) {
    const day = todayKey();
    if (this.userDailyTokenLimit > 0 && userId) {
      const used = this.usageRecord(`user:${userId}:${day}`)?.totalTokens ?? 0;
      if (used >= this.userDailyTokenLimit) {
        throw new BudgetExceededError(
          `Daily AI token budget exhausted for this user (${used}/${this.userDailyTokenLimit}); resets at midnight UTC`,
          { scope: "user", limit: this.userDailyTokenLimit, used },
        );
      }
    }
    if (this.projectDailyTokenLimit > 0 && projectId) {
      const used = this.usageRecord(`project:${projectId}:${day}`)?.totalTokens ?? 0;
      if (used >= this.projectDailyTokenLimit) {
        throw new BudgetExceededError(
          `Daily AI token budget exhausted for this project (${used}/${this.projectDailyTokenLimit}); resets at midnight UTC`,
          { scope: "project", limit: this.projectDailyTokenLimit, used },
        );
      }
    }
  }

  /** Post-call accounting with the provider-reported usage. */
  record({ userId = null, projectId = null, provider = null, model = null, usage = null } = {}) {
    const totalTokens = Number(usage?.total_tokens ?? usage?.totalTokens ?? 0);
    if (!totalTokens) return { user: 0, project: 0, totalTokens: 0 };
    const day = todayKey();
    const apply = (key) => {
      const existing = this.usageRecord(key) ?? {
        key,
        day,
        totalTokens: 0,
        calls: 0,
        byProvider: {},
      };
      const updated = {
        ...existing,
        day,
        totalTokens: existing.totalTokens + totalTokens,
        calls: existing.calls + 1,
        byProvider: {
          ...existing.byProvider,
          [provider ?? "unknown"]:
            (existing.byProvider?.[provider ?? "unknown"] ?? 0) + totalTokens,
        },
        updatedAt: new Date().toISOString(),
      };
      if (model) updated.lastModel = model;
      this.store.saveBudgetUsage?.(updated);
      return updated.totalTokens;
    };
    const result = { user: 0, project: 0, totalTokens };
    if (userId) result.user = apply(`user:${userId}:${day}`);
    if (projectId) result.project = apply(`project:${projectId}:${day}`);
    return result;
  }

  getSummary({ userId, projectId = null } = {}) {
    const day = todayKey();
    return {
      day,
      limits: {
        userDailyTokens: this.userDailyTokenLimit,
        projectDailyTokens: this.projectDailyTokenLimit,
      },
      user: {
        usedTokens: this.usageRecord(`user:${userId}:${day}`)?.totalTokens ?? 0,
        calls: this.usageRecord(`user:${userId}:${day}`)?.calls ?? 0,
      },
      project: projectId
        ? {
            usedTokens: this.usageRecord(`project:${projectId}:${day}`)?.totalTokens ?? 0,
            calls: this.usageRecord(`project:${projectId}:${day}`)?.calls ?? 0,
          }
        : null,
      resetsAt: `${tomorrowKey()}T00:00:00.000Z`,
    };
  }
}

function tomorrowKey(now = new Date()) {
  return new Date(now.getTime() + DAY_MS).toISOString().slice(0, 10);
}

export class AuditLog {
  constructor({ store, limit = AUDIT_LIMIT } = {}) {
    if (!store) throw new Error("AuditLog requires a store");
    this.store = store;
    this.limit = limit;
  }

  /**
   * Records one audit event. Fields are redacted (token/password/secret-like
   * keys and nested values) BEFORE persistence; raw request data never lands.
   */
  record({
    type,
    userId = null,
    projectId = null,
    actor = "system",
    outcome = "success",
    details = {},
  } = {}) {
    const event = {
      id: `audit_${randomUUID()}`,
      type,
      userId,
      projectId,
      actor,
      outcome,
      details: redact(details),
      createdAt: new Date().toISOString(),
    };
    this.store.saveAuditEvent?.(event);
    this.trim();
    return event;
  }

  trim() {
    const events = this.store.auditEvents;
    if (!events || events.size <= this.limit) return;
    const ordered = [...events.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    for (const stale of ordered.slice(0, ordered.length - this.limit)) {
      this.store.deleteAuditEvent?.(stale.id);
    }
  }

  listForUser(userId, { limit = 100 } = {}) {
    return [...(this.store.auditEvents?.values() ?? [])]
      .filter((event) => event.userId === userId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit);
  }
}
