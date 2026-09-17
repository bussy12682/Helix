/**
 * HELIX AI Engineering Operating System — Structured Output Schemas & Validation
 * Provides deterministic validation and sanitization for all agent outputs.
 */

export class ValidationError extends Error {
  constructor(message, errors = []) {
    super(message);
    this.name = 'ValidationError';
    this.errors = errors;
  }
}

/**
 * Validates the core agent output envelope required across all 9 agents.
 * Format:
 * {
 *   agent: string,
 *   status: 'completed' | 'failed' | 'needs_clarification' | 'revision_requested',
 *   task_id: string,
 *   summary: string,
 *   artifacts: Array<{ name: string, type: string, path: string, content: string }>,
 *   decisions: Array<{ key: string, decision: string, rationale?: string }>,
 *   dependencies: string[],
 *   risks: Array<{ description: string, severity?: 'low' | 'medium' | 'high' | 'critical' }>,
 *   next_actions: string[]
 * }
 */
export function validateAgentOutput(payload, expectedAgentRole = null) {
  const errors = [];

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new ValidationError('Agent output must be a valid non-null JSON object', ['Invalid JSON envelope']);
  }

  // 1. Validate agent field
  if (typeof payload.agent !== 'string' || !payload.agent.trim()) {
    errors.push('Missing or empty "agent" field');
  } else if (expectedAgentRole && payload.agent !== expectedAgentRole) {
    errors.push(`Agent role mismatch: expected "${expectedAgentRole}", received "${payload.agent}"`);
  }

  // 2. Validate status
  const validStatuses = ['completed', 'failed', 'needs_clarification', 'revision_requested'];
  if (!validStatuses.includes(payload.status)) {
    errors.push(`Invalid status "${payload.status}". Must be one of: ${validStatuses.join(', ')}`);
  }

  // 3. Validate task_id
  if (typeof payload.task_id !== 'string' || !payload.task_id.trim()) {
    errors.push('Missing or empty "task_id" field');
  }

  // 4. Validate summary
  if (typeof payload.summary !== 'string' || !payload.summary.trim()) {
    errors.push('Missing or empty "summary" string');
  }

  // 5. Validate artifacts array
  if (!Array.isArray(payload.artifacts)) {
    errors.push('"artifacts" must be an array');
  } else {
    payload.artifacts.forEach((artifact, idx) => {
      if (!artifact || typeof artifact !== 'object') {
        errors.push(`Artifact at index ${idx} must be an object`);
        return;
      }
      if (typeof artifact.name !== 'string' || !artifact.name.trim()) {
        errors.push(`Artifact[${idx}] missing "name"`);
      }
      if (typeof artifact.path !== 'string' || !artifact.path.trim()) {
        errors.push(`Artifact[${idx}] missing "path"`);
      }
      if (typeof artifact.content !== 'string') {
        errors.push(`Artifact[${idx}] missing string "content"`);
      }
    });
  }

  // 6. Validate decisions array
  if (payload.decisions !== undefined && !Array.isArray(payload.decisions)) {
    errors.push('"decisions" must be an array when provided');
  }

  // 7. Validate dependencies array
  if (payload.dependencies !== undefined && !Array.isArray(payload.dependencies)) {
    errors.push('"dependencies" must be an array when provided');
  }

  // 8. Validate risks array
  if (payload.risks !== undefined && !Array.isArray(payload.risks)) {
    errors.push('"risks" must be an array when provided');
  }

  // 9. Validate next_actions array
  if (payload.next_actions !== undefined && !Array.isArray(payload.next_actions)) {
    errors.push('"next_actions" must be an array when provided');
  }

  if (errors.length > 0) {
    throw new ValidationError(`Agent output validation failed: ${errors.join('; ')}`, errors);
  }

  // Return clean normalized output with guaranteed defaults
  return {
    agent: payload.agent.trim(),
    status: payload.status,
    task_id: payload.task_id.trim(),
    summary: payload.summary.trim(),
    artifacts: (payload.artifacts ?? []).map((art) => ({
      name: String(art.name).trim(),
      type: String(art.type ?? 'file').trim(),
      path: String(art.path).trim(),
      content: String(art.content),
    })),
    decisions: Array.isArray(payload.decisions)
      ? payload.decisions.map((d) => ({
          key: String(d.key ?? '').trim(),
          decision: String(d.decision ?? '').trim(),
          rationale: d.rationale ? String(d.rationale).trim() : undefined,
        }))
      : [],
    dependencies: Array.isArray(payload.dependencies)
      ? payload.dependencies.map(String).map((d) => d.trim()).filter(Boolean)
      : [],
    risks: Array.isArray(payload.risks)
      ? payload.risks.map((r) => (typeof r === 'string' ? { description: r, severity: 'medium' } : {
          description: String(r.description ?? '').trim(),
          severity: ['low', 'medium', 'high', 'critical'].includes(r.severity) ? r.severity : 'medium',
        }))
      : [],
    next_actions: Array.isArray(payload.next_actions)
      ? payload.next_actions.map(String).map((a) => a.trim()).filter(Boolean)
      : [],
  };
}

/**
 * Parses and strips Markdown code fences (e.g. ```json ... ```) from LLM output,
 * then validates against the schema.
 */
export function parseAndValidateAgentOutput(rawText, expectedAgentRole = null) {
  if (typeof rawText !== 'string' || !rawText.trim()) {
    throw new ValidationError('Agent returned empty content', ['Empty output']);
  }

  let cleaned = rawText.trim();
  // Strip code fences if present
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  }

  // Attempt to extract JSON substring if there is surrounding conversational text
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    cleaned = cleaned.substring(firstBrace, lastBrace + 1);
  }

  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch (parseError) {
    throw new ValidationError(`JSON parsing failed: ${parseError.message}`, [parseError.message]);
  }

  return validateAgentOutput(parsed, expectedAgentRole);
}
