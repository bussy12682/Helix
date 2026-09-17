/**
 * HELIX AI Engineering Operating System — Base Agent Runner
 * Common lifecycle engine for all 9 specialized agents: prompt generation,
 * model execution, output validation, automatic schema repair, and telemetry.
 */

import { AGENT_CONTRACTS } from '../contracts.js';
import { parseAndValidateAgentOutput, ValidationError } from '../schemas.js';

export class BaseAgent {
  constructor({ role, modelRouter, toolRegistry, observability }) {
    this.role = role;
    this.contract = AGENT_CONTRACTS[role];
    if (!this.contract) {
      throw new Error(`Invalid agent role: "${role}"`);
    }
    this.modelRouter = modelRouter;
    this.toolRegistry = toolRegistry;
    this.observability = observability;
  }

  /**
   * Override in sub-classes to provide role-specific instructions.
   */
  getSystemInstructions() {
    return `You are the ${this.contract.role} in HELIX AI Engineering Operating System.
Purpose: ${this.contract.purpose}
Responsibilities:
${this.contract.responsibilities.map((r) => `- ${r}`).join('\n')}
Restrictions:
${this.contract.restrictions.map((r) => `- ${r}`).join('\n')}

MANDATORY OUTPUT FORMAT:
You MUST respond with a single, strictly valid JSON object adhering to this schema:
{
  "agent": "${this.role}",
  "status": "completed",
  "task_id": "<task_id>",
  "summary": "<1-2 sentence executive summary of what was engineered>",
  "artifacts": [
    {
      "name": "<file name with extension>",
      "type": "spec" | "code" | "sql" | "config" | "doc",
      "path": "<relative file path in project>",
      "content": "<complete file contents as a string>"
    }
  ],
  "decisions": [
    { "key": "<decision_key>", "decision": "<what was decided>", "rationale": "<why>" }
  ],
  "dependencies": ["<task_ids_this_depends_on>"],
  "risks": [
    { "description": "<risk description>", "severity": "low" | "medium" | "high" | "critical" }
  ],
  "next_actions": ["<agent_roles_recommended_to_run_next>"]
}
Do not wrap your JSON in markdown unless necessary; return clean JSON.`;
  }

  /**
   * Executes a task with automatic validation, schema repair loops, and tracing.
   */
  async execute({ workflowId, taskId, taskTitle, context, maxRetries = 2, options = {} }) {
    const span = this.observability.startSpan({
      workflowId,
      taskId,
      agentRole: this.role,
      taskTitle,
    });

    const systemPrompt = this.getSystemInstructions();
    const userPrompt = JSON.stringify({
      taskId,
      taskTitle,
      context,
    }, null, 2);

    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ];

    let attempt = 0;
    let lastError = null;

    while (attempt <= maxRetries) {
      attempt += 1;
      try {
        const result = await this.modelRouter.complete({
          agentRole: this.role,
          messages,
          options,
        });

        const validatedOutput = parseAndValidateAgentOutput(result.content, this.role);
        validatedOutput.task_id = taskId; // guarantee task_id aligns

        // Write created artifacts to the virtual workspace if tool is authorized
        if (this.toolRegistry.isAuthorized(this.role, 'virtual_workspace_write')) {
          for (const artifact of validatedOutput.artifacts) {
            await this.toolRegistry.executeTool(this.role, 'virtual_workspace_write', {
              projectId: context.project?.id || workflowId,
              filePath: artifact.path,
              content: artifact.content,
            });
          }
        }

        this.observability.endSpan(span, {
          status: 'completed',
          model: result.model,
          provider: result.provider,
          usage: result.usage,
          artifacts: validatedOutput.artifacts,
        });

        return validatedOutput;
      } catch (err) {
        lastError = err;
        console.warn(`[Agent ${this.role}] Attempt ${attempt} failed: ${err.message}`);

        if (attempt <= maxRetries) {
          // Push repair message into conversation for next attempt
          messages.push({
            role: 'user',
            content: `Your previous output had validation errors: ${err.message}. Please fix the JSON output and ensure all required fields match the schema.`,
          });
        }
      }
    }

    this.observability.endSpan(span, {
      status: 'failed',
      error: lastError,
    });

    throw lastError || new ValidationError(`Agent ${this.role} failed to produce valid output after ${maxRetries} retries.`);
  }
}
