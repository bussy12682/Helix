import test from 'node:test';
import assert from 'node:assert/strict';

import { ModelRouter, MODEL_TIERS } from '../ai/model-router.js';
import { AGENT_ROLES } from '../ai/contracts.js';
import { parseAndValidateAgentOutput } from '../ai/schemas.js';

test('ModelRouter maps roles to appropriate capability tiers', () => {
  const router = new ModelRouter({
    aiProvider: 'google',
    googleReasoningModel: 'gemini-2.5-pro',
    googleCodingModel: 'gemini-2.5-flash',
    googleFastModel: 'gemini-2.5-flash',
  });

  const pmResolution = router.resolveModel(AGENT_ROLES.PRODUCT_MANAGER);
  assert.equal(pmResolution.tier, MODEL_TIERS.REASONING);
  assert.equal(pmResolution.model, 'gemini-2.5-pro');

  const beResolution = router.resolveModel(AGENT_ROLES.BACKEND_ENGINEER);
  assert.equal(beResolution.tier, MODEL_TIERS.CODING);
  assert.equal(beResolution.model, 'gemini-2.5-flash');

  const qaResolution = router.resolveModel(AGENT_ROLES.QA_ENGINEER);
  assert.equal(qaResolution.tier, MODEL_TIERS.FAST);
});

test('ModelRouter supports Ollama local endpoints', () => {
  const router = new ModelRouter({
    aiProvider: 'ollama',
    ollamaBaseUrl: 'http://localhost:11434',
    ollamaCodingModel: 'qwen2.5-coder:7b',
  });

  const resolution = router.resolveModel(AGENT_ROLES.BACKEND_ENGINEER);
  assert.equal(resolution.provider, 'ollama');
  assert.equal(resolution.model, 'qwen2.5-coder:7b');
  assert.equal(resolution.baseUrl, 'http://localhost:11434/v1');
});

test('ModelRouter mock generator produces compliant outputs for all 9 agents', async () => {
  const router = new ModelRouter({ mockMode: true });

  for (const role of Object.values(AGENT_ROLES)) {
    const response = await router.complete({
      agentRole: role,
      messages: [{ role: 'user', content: JSON.stringify({ name: 'E-commerce Shop' }) }],
    });

    assert.ok(response.content);
    const parsed = parseAndValidateAgentOutput(response.content, role);
    assert.equal(parsed.agent, role);
    assert.equal(parsed.status, 'completed');
    assert.ok(Array.isArray(parsed.artifacts));
  }
});
