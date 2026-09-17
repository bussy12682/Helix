import test from 'node:test';
import assert from 'node:assert/strict';

import { createApp } from '../app.js';
import { createAiSubsystem } from '../ai/index.js';

test('Workflow HTTP API endpoints work correctly', async () => {
  const ai = createAiSubsystem({ mockMode: true });
  const app = createApp({ storagePath: ':memory:', ai });

  // 1. Register and login
  const regRes = await app.request('http://localhost/api/v1/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Engineer Alice', email: 'alice@helix.dev', password: 'Password123!' }),
  });
  const regUser = await regRes.json();

  // Verify email
  await app.request('http://localhost/api/v1/auth/verify-email', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token: regUser.verificationToken }),
  });

  // Login
  const loginRes = await app.request('http://localhost/api/v1/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'alice@helix.dev', password: 'Password123!' }),
  });
  const { token } = await loginRes.json();
  const authHeaders = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };

  // 2. Create project
  const createProjRes = await app.request('http://localhost/api/v1/projects', {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({ name: 'Cloud Storage App', description: 'S3-compatible file storage API' }),
  });
  assert.equal(createProjRes.status, 201);
  const project = await createProjRes.json();

  // 3. Start Workflow
  const startWfRes = await app.request(`http://localhost/api/v1/projects/${project.id}/workflows`, {
    method: 'POST',
    headers: authHeaders,
  });
  assert.equal(startWfRes.status, 201);
  const workflow = await startWfRes.json();
  assert.equal(workflow.projectId, project.id);

  // 4. Check Office floor state
  const officeRes = await app.request(`http://localhost/api/v1/projects/${project.id}/office`, {
    headers: authHeaders,
  });
  assert.equal(officeRes.status, 200);
  const officeState = await officeRes.json();
  assert.equal(officeState.hasActiveWorkflow, true);
  assert.equal(officeState.agents.length, 9);

  // 5. Check Artifacts
  const artifactsRes = await app.request(`http://localhost/api/v1/projects/${project.id}/artifacts`, {
    headers: authHeaders,
  });
  assert.equal(artifactsRes.status, 200);
  const artifactsPayload = await artifactsRes.json();
  assert.ok(Array.isArray(artifactsPayload.artifacts));
});
