import test from 'node:test';
import assert from 'node:assert/strict';

import { createApp } from '../app.js';
import { createAiSubsystem } from '../ai/index.js';
import { AGENT_ROLES } from '../ai/contracts.js';

test('Real Project Creation & 9-Agent Workflow End-to-End Test', async () => {
  const ai = createAiSubsystem({ mockMode: true });
  const app = createApp({ storagePath: ':memory:', ai });

  // 1. Test 1-Click Demo Login
  const demoRes = await app.request('http://localhost/api/v1/auth/demo', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({}),
  });
  assert.equal(demoRes.status, 200);
  const demoData = await demoRes.json();
  assert.ok(demoData.token);
  assert.equal(demoData.user.email, 'demo@helix.app');

  // 2. Test User Registration with password validation
  const regRes = await app.request('http://localhost/api/v1/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: 'Lead AI Engineer',
      email: 'lead.engineer@helix.dev',
      password: 'HelixSecure2026!',
    }),
  });
  assert.equal(regRes.status, 201);
  const regUser = await regRes.json();
  assert.ok(regUser.verificationToken);

  // 3. Test Email Verification
  const verifyRes = await app.request('http://localhost/api/v1/auth/verify-email', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token: regUser.verificationToken }),
  });
  assert.equal(verifyRes.status, 200);
  const verifyData = await verifyRes.json();
  assert.equal(verifyData.user.emailVerified, true);

  // 4. Test User Login
  const loginRes = await app.request('http://localhost/api/v1/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email: 'lead.engineer@helix.dev',
      password: 'HelixSecure2026!',
      rememberMe: true,
    }),
  });
  assert.equal(loginRes.status, 200);
  const { token } = await loginRes.json();
  assert.ok(token);

  const authHeaders = {
    authorization: `Bearer ${token}`,
    'content-type': 'application/json',
  };

  // 5. Create a Real Project: Autonomous Incident Response Platform
  const createProjRes = await app.request('http://localhost/api/v1/projects', {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      name: 'Autonomous Incident Response Platform',
      description: 'Production-ready platform for multi-agent incident detection, root cause diagnosis, automated playbook remediation, and canary rollback.',
      keyFeatures: [
        'Real-time PagerDuty and Datadog webhook ingestion',
        'Multi-agent diagnostic correlation engine',
        'Canary deployment rollback and automated remediation',
        'Human-in-the-loop executive approval dashboard',
      ],
      techStack: ['Node.js', 'TypeScript', 'PostgreSQL', 'Docker', 'Tailwind CSS'],
    }),
  });
  assert.equal(createProjRes.status, 201);
  const project = await createProjRes.json();
  assert.equal(project.name, 'Autonomous Incident Response Platform');
  assert.ok(project.id);

  // 6. Verify project is listed
  const listRes = await app.request('http://localhost/api/v1/projects', {
    headers: authHeaders,
  });
  assert.equal(listRes.status, 200);
  const projectList = await listRes.json();
  assert.ok(projectList.some((p) => p.id === project.id));

  // 7. Start the 9-Agent AI Engineering Workflow
  const startWfRes = await app.request(`http://localhost/api/v1/projects/${project.id}/workflows`, {
    method: 'POST',
    headers: authHeaders,
  });
  assert.equal(startWfRes.status, 201);
  const initialWf = await startWfRes.json();
  assert.equal(initialWf.projectId, project.id);

  // Wait for PM and Architect steps to execute and hit checkpoint 1
  let workflow = initialWf;
  for (let i = 0; i < 50; i++) {
    const wfRes = await app.request(`http://localhost/api/v1/projects/${project.id}/workflows`, {
      headers: authHeaders,
    });
    workflow = await wfRes.json();
    if (workflow.status === 'awaiting_approval') break;
    await new Promise((r) => setTimeout(r, 20));
  }
  assert.equal(workflow.status, 'awaiting_approval');
  assert.equal(workflow.currentCheckpoint.checkpointType, 'architecture_approval');

  // Check Office floor state during architecture review
  const officeStep1Res = await app.request(`http://localhost/api/v1/projects/${project.id}/office`, {
    headers: authHeaders,
  });
  assert.equal(officeStep1Res.status, 200);
  const officeStep1 = await officeStep1Res.json();
  assert.equal(officeStep1.hasActiveWorkflow, true);
  assert.equal(officeStep1.agents.length, 9);
  
  // Verify PM and Architect have finished
  const pmAgent = officeStep1.agents.find((a) => a.role === AGENT_ROLES.PRODUCT_MANAGER);
  const archAgent = officeStep1.agents.find((a) => a.role === AGENT_ROLES.SYSTEM_ARCHITECT);
  assert.equal(pmAgent.status, 'done');
  assert.equal(archAgent.status, 'done');

  // 8. Human-in-the-loop Checkpoint 1: Approve Architecture
  const approveArchRes = await app.request(`http://localhost/api/v1/workflows/${workflow.id}/approve`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      checkpointType: 'architecture_approval',
      approved: true,
      comments: 'Architecture and PRD specifications approved for engineering implementation.',
    }),
  });
  assert.equal(approveArchRes.status, 200);
  const afterArchWf = await approveArchRes.json();
  assert.equal(afterArchWf.status, 'awaiting_approval');
  assert.equal(afterArchWf.currentCheckpoint.checkpointType, 'release_approval');

  // 9. Human-in-the-loop Checkpoint 2: Approve Deployment & Release
  const approveReleaseRes = await app.request(`http://localhost/api/v1/workflows/${workflow.id}/approve`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      checkpointType: 'release_approval',
      approved: true,
      comments: 'Security scans and test suites passed. Deploy to production approved.',
    }),
  });
  assert.equal(approveReleaseRes.status, 200);
  const completedWf = await approveReleaseRes.json();
  assert.equal(completedWf.status, 'completed');

  // 10. Verify Full 9-Agent Office State
  const finalOfficeRes = await app.request(`http://localhost/api/v1/projects/${project.id}/office`, {
    headers: authHeaders,
  });
  assert.equal(finalOfficeRes.status, 200);
  const finalOffice = await finalOfficeRes.json();
  assert.equal(finalOffice.agents.length, 9);
  for (const agent of finalOffice.agents) {
    assert.equal(agent.status, 'done', `Agent ${agent.role} should be done`);
  }
  for (const task of finalOffice.tasks) {
    assert.equal(task.status, 'completed', `Task ${task.role} should be completed`);
    assert.ok(task.summary, `Task ${task.role} should have a summary`);
  }

  // 11. Verify Artifacts generated across all domains
  const artifactsRes = await app.request(`http://localhost/api/v1/projects/${project.id}/artifacts`, {
    headers: authHeaders,
  });
  assert.equal(artifactsRes.status, 200);
  const { artifacts } = await artifactsRes.json();
  assert.ok(artifacts.length >= 9, 'Should have generated artifacts from all agents');

  // 12. Verify Observability Traces
  const tracesRes = await app.request(`http://localhost/api/v1/workflows/${workflow.id}/traces`, {
    headers: authHeaders,
  });
  assert.equal(tracesRes.status, 200);
  const { traces } = await tracesRes.json();
  assert.ok(traces.length > 0, 'Should have recorded execution traces');
});
