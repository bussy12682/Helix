import test from 'node:test';
import assert from 'node:assert/strict';

import { createAiSubsystem } from '../ai/index.js';
import { AGENT_ROLES, AGENT_CONTRACTS } from '../ai/contracts.js';
import { validateAgentOutput } from '../ai/schemas.js';

test('AI Evaluation Benchmark: End-to-end multi-agent evaluation on E-commerce Platform', async () => {
  const ai = createAiSubsystem({ mockMode: true });

  const benchmarkProject = {
    name: 'E-commerce Market Platform',
    description: 'A multi-vendor marketplace with product catalog, cart, and Stripe checkout.',
    keyFeatures: ['Vendor Catalog', 'Cart & Checkout', 'Order History', 'Inventory Management'],
    techStack: ['React', 'TypeScript', 'Node.js', 'PostgreSQL', 'Tailwind CSS'],
  };

  const workflow = await ai.orchestrator.createWorkflow('benchmark_ecom', benchmarkProject);

  // 1. Initial Step: PM and System Architect run
  await ai.orchestrator.runNextSteps(workflow.id);
  assert.equal(workflow.status, 'awaiting_approval');
  assert.equal(workflow.currentCheckpoint.checkpointType, 'architecture_approval');

  // Verify PM output quality
  const pmTask = workflow.tasks.find((t) => t.agent === AGENT_ROLES.PRODUCT_MANAGER);
  assert.equal(pmTask.status, 'completed');
  const pmOutput = validateAgentOutput(pmTask.output, AGENT_ROLES.PRODUCT_MANAGER);
  assert.ok(pmOutput.artifacts.some((a) => a.path.includes('prd')));
  assert.ok(pmOutput.summary.length > 10);

  // Verify Architect output quality
  const archTask = workflow.tasks.find((t) => t.agent === AGENT_ROLES.SYSTEM_ARCHITECT);
  assert.equal(archTask.status, 'completed');
  const archOutput = validateAgentOutput(archTask.output, AGENT_ROLES.SYSTEM_ARCHITECT);
  assert.ok(archOutput.artifacts.some((a) => a.name.includes('architecture')));
  assert.ok(archOutput.artifacts.some((a) => a.name.includes('api-spec')));

  // 2. Approve Architecture checkpoint
  await ai.orchestrator.approveCheckpoint(workflow.id, 'architecture_approval', {
    approved: true,
    comments: 'Benchmark test approval',
  });

  // Database, Backend, Frontend, Security, QA run and hit release checkpoint
  assert.equal(workflow.status, 'awaiting_approval');
  assert.equal(workflow.currentCheckpoint.checkpointType, 'release_approval');

  // Verify Database output
  const dbTask = workflow.tasks.find((t) => t.agent === AGENT_ROLES.DATABASE_ENGINEER);
  assert.equal(dbTask.status, 'completed');
  const dbOutput = validateAgentOutput(dbTask.output, AGENT_ROLES.DATABASE_ENGINEER);
  assert.ok(dbOutput.artifacts.some((a) => a.path.includes('schema.sql')));

  // Verify Backend output
  const beTask = workflow.tasks.find((t) => t.agent === AGENT_ROLES.BACKEND_ENGINEER);
  assert.equal(beTask.status, 'completed');
  const beOutput = validateAgentOutput(beTask.output, AGENT_ROLES.BACKEND_ENGINEER);
  assert.ok(beOutput.artifacts.some((a) => a.name.includes('routes')));

  // Verify Frontend output
  const feTask = workflow.tasks.find((t) => t.agent === AGENT_ROLES.FRONTEND_ENGINEER);
  assert.equal(feTask.status, 'completed');
  const feOutput = validateAgentOutput(feTask.output, AGENT_ROLES.FRONTEND_ENGINEER);
  assert.ok(feOutput.artifacts.length > 0);

  // Verify Security Audit output
  const secTask = workflow.tasks.find((t) => t.agent === AGENT_ROLES.SECURITY_ENGINEER);
  assert.equal(secTask.status, 'completed');
  const secOutput = validateAgentOutput(secTask.output, AGENT_ROLES.SECURITY_ENGINEER);
  assert.ok(secOutput.artifacts.some((a) => a.name.includes('security-audit')));

  // Verify QA output
  const qaTask = workflow.tasks.find((t) => t.agent === AGENT_ROLES.QA_ENGINEER);
  assert.equal(qaTask.status, 'completed');
  const qaOutput = validateAgentOutput(qaTask.output, AGENT_ROLES.QA_ENGINEER);
  assert.ok(qaOutput.artifacts.some((a) => a.name.includes('test-plan')));

  // 3. Approve Release checkpoint
  await ai.orchestrator.approveCheckpoint(workflow.id, 'release_approval', {
    approved: true,
    comments: 'Release approved',
  });

  // Verify DevOps and Documentation run and workflow completes
  assert.equal(workflow.status, 'completed');

  const devopsTask = workflow.tasks.find((t) => t.agent === AGENT_ROLES.DEVOPS_ENGINEER);
  assert.equal(devopsTask.status, 'completed');
  const devopsOutput = validateAgentOutput(devopsTask.output, AGENT_ROLES.DEVOPS_ENGINEER);
  assert.ok(devopsOutput.artifacts.some((a) => a.name === 'Dockerfile'));

  const docsTask = workflow.tasks.find((t) => t.agent === AGENT_ROLES.DOCUMENTATION_ENGINEER);
  assert.equal(docsTask.status, 'completed');
  const docsOutput = validateAgentOutput(docsTask.output, AGENT_ROLES.DOCUMENTATION_ENGINEER);
  assert.ok(docsOutput.artifacts.some((a) => a.name === 'README.md'));

  // Verify Observability Traces
  const metrics = ai.observability.getWorkflowMetrics(workflow.id);
  assert.equal(metrics.completed, 9);
  assert.equal(metrics.failed, 0);
  assert.equal(metrics.agentBreakdown.length, 9);
});
