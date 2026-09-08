import test from 'node:test';
import assert from 'node:assert/strict';

import { loadConfig } from '../config.js';
import { createApp } from '../app.js';

test('config loads defaults and supports environment overrides', () => {
  const config = loadConfig({
    NODE_ENV: 'test',
    APP_PORT: '4123',
    APP_NAME: 'HELIX TEST',
  });

  assert.equal(config.nodeEnv, 'test');
  assert.equal(config.appPort, 4123);
  assert.equal(config.appName, 'HELIX TEST');
});

test('health endpoint succeeds with structured status', async () => {
  const app = createApp({ storagePath: ':memory:' });
  const response = await app.request('http://localhost/api/v1/health');

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.service, 'helix-core');
});

test('project creation and retrieval are supported', async () => {
  const app = createApp({ storagePath: ':memory:' });

  const register = await app.request('http://localhost/api/v1/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: 'Ada Lovelace',
      email: 'ada@example.com',
      password: 'Password123!',
    }),
  });

  assert.equal(register.status, 201);
  const createdUser = await register.json();
  const verificationToken = createdUser.verificationToken;

  const blockedLogin = await app.request('http://localhost/api/v1/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email: 'ada@example.com',
      password: 'Password123!',
    }),
  });

  assert.equal(blockedLogin.status, 403);
  const blockedLoginBody = await blockedLogin.json();
  assert.equal(blockedLoginBody.error.code, 'EMAIL_NOT_VERIFIED');

  // Verify email before login
  const verify = await app.request('http://localhost/api/v1/auth/verify-email', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token: verificationToken }),
  });

  assert.equal(verify.status, 200);

  const login = await app.request('http://localhost/api/v1/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email: 'ada@example.com',
      password: 'Password123!',
    }),
  });

  assert.equal(login.status, 200);
  const session = await login.json();

  const dashboard = await app.request('http://localhost/api/v1/dashboard', {
    headers: { authorization: `Bearer ${session.token}` },
  });

  assert.equal(dashboard.status, 200);
  const dashboardPayload = await dashboard.json();
  assert.equal(dashboardPayload.user.email, 'ada@example.com');
  assert.equal(dashboardPayload.stats.projects, 0);

  const document = new FormData();
  document.append('file', new File(['# Helix Foundation\n\nA project brief from Markdown.'], 'brief.md', { type: 'text/markdown' }));
  const extractedDocument = await app.request('http://localhost/api/v1/projects/extract-document', {
    method: 'POST',
    headers: { authorization: `Bearer ${session.token}` },
    body: document,
  });

  assert.equal(extractedDocument.status, 200);
  const extractedDocumentPayload = await extractedDocument.json();
  assert.equal(extractedDocumentPayload.fileName, 'brief.md');
  assert.match(extractedDocumentPayload.description, /project brief from Markdown/);

  const project = await app.request('http://localhost/api/v1/projects', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${session.token}`,
    },
    body: JSON.stringify({ name: 'Helix Foundation', description: 'Phase 0 verification' }),
  });

  assert.equal(project.status, 201);
  const projectPayload = await project.json();
  assert.match(projectPayload.name, /Helix Foundation/);

  const dashboardAfterProject = await app.request('http://localhost/api/v1/dashboard', {
    headers: { authorization: `Bearer ${session.token}` },
  });

  assert.equal(dashboardAfterProject.status, 200);
  const dashboardAfterProjectPayload = await dashboardAfterProject.json();
  assert.equal(dashboardAfterProjectPayload.stats.projects, 1);
  assert.equal(dashboardAfterProjectPayload.projects[0].name, 'Helix Foundation');

  const fetchProject = await app.request(`http://localhost/api/v1/projects/${projectPayload.id}`, {
    headers: { authorization: `Bearer ${session.token}` },
  });

  assert.equal(fetchProject.status, 200);
  const fetchedProject = await fetchProject.json();
  assert.equal(fetchedProject.id, projectPayload.id);
});
