import test from 'node:test';
import assert from 'node:assert/strict';

import { createAiSubsystem } from '../ai/index.js';
import { AGENT_ROLES } from '../ai/contracts.js';
import { WORKFLOW_STATUS, TASK_STATUS } from '../ai/orchestrator.js';

test('Orchestrator creates a DAG with 9 tasks and proper dependencies', async () => {
  const ai = createAiSubsystem({ mockMode: true });
  const workflow = await ai.orchestrator.createWorkflow('proj_1', {
    name: 'Invoice SaaS',
    description: 'B2B Invoicing platform',
  });

  assert.equal(workflow.projectId, 'proj_1');
  assert.equal(workflow.status, WORKFLOW_STATUS.PENDING);
  assert.equal(workflow.tasks.length, 9);

  // First task is Product Manager with 0 dependencies
  assert.equal(workflow.tasks[0].agent, AGENT_ROLES.PRODUCT_MANAGER);
  assert.equal(workflow.tasks[0].dependencies.length, 0);

  // Second task is System Architect depending on PM
  assert.equal(workflow.tasks[1].agent, AGENT_ROLES.SYSTEM_ARCHITECT);
  assert.equal(workflow.tasks[1].dependencies[0], workflow.tasks[0].id);
  assert.equal(workflow.tasks[1].requiresApproval, 'architecture_approval');
});

test('Orchestrator executes DAG up to Human Architecture Approval gate', async () => {
  const ai = createAiSubsystem({ mockMode: true });
  const workflow = await ai.orchestrator.createWorkflow('proj_2', {
    name: 'Invoice SaaS',
    description: 'B2B Invoicing platform',
  });

  await ai.orchestrator.runNextSteps(workflow.id);

  // Should have executed PM (completed) and Architect (completed), then paused on approval
  assert.equal(workflow.status, WORKFLOW_STATUS.AWAITING_APPROVAL);
  assert.ok(workflow.currentCheckpoint);
  assert.equal(workflow.currentCheckpoint.checkpointType, 'architecture_approval');

  const pmTask = workflow.tasks.find((t) => t.agent === AGENT_ROLES.PRODUCT_MANAGER);
  const archTask = workflow.tasks.find((t) => t.agent === AGENT_ROLES.SYSTEM_ARCHITECT);
  assert.equal(pmTask.status, TASK_STATUS.COMPLETED);
  assert.equal(archTask.status, TASK_STATUS.COMPLETED);

  // Check that artifacts were stored in ContextManager
  const artifacts = ai.contextManager.getArtifacts('proj_2');
  assert.ok(artifacts.some((a) => a.name === 'prd.md'));
  assert.ok(artifacts.some((a) => a.name === 'architecture.md'));
  assert.ok(artifacts.some((a) => a.name === 'openapi-spec.json'));
});

test('Approving checkpoints progresses workflow to completion', async () => {
  const ai = createAiSubsystem({ mockMode: true });
  const workflow = await ai.orchestrator.createWorkflow('proj_3', {
    name: 'Invoice SaaS',
    description: 'B2B Invoicing platform',
  });

  // Step 1: Run to architecture approval gate
  await ai.orchestrator.runNextSteps(workflow.id);
  assert.equal(workflow.status, WORKFLOW_STATUS.AWAITING_APPROVAL);
  assert.equal(workflow.currentCheckpoint.checkpointType, 'architecture_approval');

  // Step 2: Submit Human Architecture Approval
  await ai.orchestrator.approveCheckpoint(workflow.id, 'architecture_approval', {
    approved: true,
    comments: 'Architecture looks great, proceed with implementation.',
  });

  // Now Database, Backend, Frontend, Security, QA run and hit release_approval
  assert.equal(workflow.status, WORKFLOW_STATUS.AWAITING_APPROVAL);
  assert.equal(workflow.currentCheckpoint.checkpointType, 'release_approval');

  // Step 3: Submit Human Release Approval
  await ai.orchestrator.approveCheckpoint(workflow.id, 'release_approval', {
    approved: true,
    comments: 'Release approved for staging.',
  });

  // DevOps and Documentation complete, workflow finishes!
  assert.equal(workflow.status, WORKFLOW_STATUS.COMPLETED);

  const allComplete = workflow.tasks.every((t) => t.status === TASK_STATUS.COMPLETED);
  assert.equal(allComplete, true);

  // Verify full set of project artifacts generated across the 9 agents
  const artifacts = ai.contextManager.getArtifacts('proj_3');
  assert.ok(artifacts.length >= 7);
  assert.ok(artifacts.some((a) => a.name === 'README.md'));
  assert.ok(artifacts.some((a) => a.name === 'schema.sql'));
  assert.ok(artifacts.some((a) => a.name === 'Dockerfile'));
});

test('Orchestrator handles rejection of approval gate', async () => {
  const ai = createAiSubsystem({ mockMode: true });
  const workflow = await ai.orchestrator.createWorkflow('proj_reject', { name: 'Rejected App' });

  await ai.orchestrator.runNextSteps(workflow.id);
  assert.equal(workflow.status, WORKFLOW_STATUS.AWAITING_APPROVAL);

  await ai.orchestrator.approveCheckpoint(workflow.id, 'architecture_approval', {
    approved: false,
    comments: 'Need Redis cache added.',
  });

  assert.equal(workflow.status, WORKFLOW_STATUS.FAILED);
});
