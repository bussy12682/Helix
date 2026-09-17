import test from 'node:test';
import assert from 'node:assert/strict';

import { AGENT_ROLES, AGENT_METADATA, AGENT_CONTRACTS, getAllAgentRoles } from '../ai/contracts.js';
import { validateAgentOutput, parseAndValidateAgentOutput, ValidationError } from '../ai/schemas.js';

test('all 9 specialized agents are defined with explicit contracts', () => {
  const roles = getAllAgentRoles();
  assert.equal(roles.length, 9);

  const expectedRoles = [
    'product_manager',
    'system_architect',
    'database_engineer',
    'backend_engineer',
    'frontend_engineer',
    'security_engineer',
    'qa_engineer',
    'devops_engineer',
    'documentation_engineer',
  ];

  for (const expected of expectedRoles) {
    assert.ok(roles.includes(expected), `Missing role: ${expected}`);
    const meta = AGENT_METADATA[expected];
    assert.ok(meta, `Missing metadata for ${expected}`);
    assert.ok(meta.name);
    assert.ok(meta.initials);

    const contract = AGENT_CONTRACTS[expected];
    assert.ok(contract, `Missing contract for ${expected}`);
    assert.ok(contract.purpose);
    assert.ok(Array.isArray(contract.responsibilities) && contract.responsibilities.length > 0);
    assert.ok(Array.isArray(contract.inputs));
    assert.ok(Array.isArray(contract.outputs));
    assert.ok(Array.isArray(contract.tools));
    assert.ok(Array.isArray(contract.restrictions));
    assert.ok(Array.isArray(contract.validationRules));
  }
});

test('validateAgentOutput validates compliant structured envelopes', () => {
  const sample = {
    agent: 'system_architect',
    status: 'completed',
    task_id: 'TASK-001',
    summary: 'Designed architecture and API contracts.',
    artifacts: [
      { name: 'architecture.md', type: 'spec', path: 'docs/architecture.md', content: '# Architecture' },
    ],
    decisions: [
      { key: 'stack', decision: 'React + Node', rationale: 'Fast iteration' },
    ],
    dependencies: [],
    risks: [{ description: 'High traffic load', severity: 'medium' }],
    next_actions: ['database_engineer', 'backend_engineer'],
  };

  const validated = validateAgentOutput(sample, 'system_architect');
  assert.equal(validated.agent, 'system_architect');
  assert.equal(validated.status, 'completed');
  assert.equal(validated.artifacts.length, 1);
  assert.equal(validated.artifacts[0].name, 'architecture.md');
});

test('validateAgentOutput rejects malformed envelopes', () => {
  assert.throws(() => {
    validateAgentOutput(null);
  }, ValidationError);

  assert.throws(() => {
    validateAgentOutput({ agent: 'product_manager' }); // missing status, task_id, summary, artifacts
  }, ValidationError);

  assert.throws(() => {
    validateAgentOutput({
      agent: 'product_manager',
      status: 'unknown_status',
      task_id: '1',
      summary: 'test',
      artifacts: [],
    });
  }, ValidationError);

  assert.throws(() => {
    validateAgentOutput({
      agent: 'backend_engineer',
      status: 'completed',
      task_id: '1',
      summary: 'test',
      artifacts: 'not-an-array',
    });
  }, ValidationError);
});

test('parseAndValidateAgentOutput strips markdown fences and extracts JSON', () => {
  const fenced = `
Here is your requested output:
\`\`\`json
{
  "agent": "product_manager",
  "status": "completed",
  "task_id": "TASK-101",
  "summary": "Generated comprehensive user stories.",
  "artifacts": [
    { "name": "prd.md", "type": "spec", "path": "docs/prd.md", "content": "# PRD" }
  ],
  "decisions": [],
  "dependencies": [],
  "risks": [],
  "next_actions": ["system_architect"]
}
\`\`\`
Hope this helps!
`;

  const parsed = parseAndValidateAgentOutput(fenced, 'product_manager');
  assert.equal(parsed.agent, 'product_manager');
  assert.equal(parsed.task_id, 'TASK-101');
  assert.equal(parsed.artifacts[0].name, 'prd.md');
});
