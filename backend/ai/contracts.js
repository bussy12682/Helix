/**
 * HELIX AI Engineering Operating System — Agent Contracts
 * Defines explicit contracts, responsibilities, input/output requirements,
 * tool access, dependencies, and handoff rules for the 9 specialized agents.
 */

export const AGENT_ROLES = {
  PRODUCT_MANAGER: 'product_manager',
  SYSTEM_ARCHITECT: 'system_architect',
  DATABASE_ENGINEER: 'database_engineer',
  BACKEND_ENGINEER: 'backend_engineer',
  FRONTEND_ENGINEER: 'frontend_engineer',
  SECURITY_ENGINEER: 'security_engineer',
  QA_ENGINEER: 'qa_engineer',
  DEVOPS_ENGINEER: 'devops_engineer',
  DOCUMENTATION_ENGINEER: 'documentation_engineer',
};

export const AGENT_METADATA = {
  [AGENT_ROLES.PRODUCT_MANAGER]: {
    id: 'pm',
    role: AGENT_ROLES.PRODUCT_MANAGER,
    name: 'Product Manager AI',
    title: 'Planning & Requirements',
    initials: 'PM',
    description: 'Turns raw user input into structured product requirements, features, user stories, priorities, constraints and open questions.',
    category: 'planning',
  },
  [AGENT_ROLES.SYSTEM_ARCHITECT]: {
    id: 'arch',
    role: AGENT_ROLES.SYSTEM_ARCHITECT,
    name: 'Architecture AI',
    title: 'System Design & APIs',
    initials: 'AR',
    description: 'Turns approved requirements into technical architecture, technology choices, APIs, data flow, integrations, scalability and technical risks.',
    category: 'architecture',
  },
  [AGENT_ROLES.DATABASE_ENGINEER]: {
    id: 'db',
    role: AGENT_ROLES.DATABASE_ENGINEER,
    name: 'Database AI',
    title: 'Schema & Queries',
    initials: 'DB',
    description: 'Designs schemas, relationships, constraints, indexes, migrations, queries, data integrity and performance.',
    category: 'engineering',
  },
  [AGENT_ROLES.BACKEND_ENGINEER]: {
    id: 'be',
    role: AGENT_ROLES.BACKEND_ENGINEER,
    name: 'Backend AI',
    title: 'APIs & Business Logic',
    initials: 'BE',
    description: 'Builds APIs, business logic, authentication, authorization, validation, integrations, error handling and backend tests.',
    category: 'engineering',
  },
  [AGENT_ROLES.FRONTEND_ENGINEER]: {
    id: 'fe',
    role: AGENT_ROLES.FRONTEND_ENGINEER,
    name: 'Frontend AI',
    title: 'UI & State Management',
    initials: 'FE',
    description: 'Implements UI, components, responsive behavior, state, API integration, forms, error handling and frontend tests.',
    category: 'engineering',
  },
  [AGENT_ROLES.SECURITY_ENGINEER]: {
    id: 'sec',
    role: AGENT_ROLES.SECURITY_ENGINEER,
    name: 'Security AI',
    title: 'Threat Modeling & Audit',
    initials: 'SC',
    description: 'Performs threat modeling and security review across authentication, authorization, inputs, APIs, secrets, dependencies and configuration.',
    category: 'review',
  },
  [AGENT_ROLES.QA_ENGINEER]: {
    id: 'qa',
    role: AGENT_ROLES.QA_ENGINEER,
    name: 'QA AI',
    title: 'Test Plans & Verification',
    initials: 'QA',
    description: 'Creates test plans/cases, checks requirements against implementation, identifies bugs, tests edge cases and validates releases.',
    category: 'review',
  },
  [AGENT_ROLES.DEVOPS_ENGINEER]: {
    id: 'devops',
    role: AGENT_ROLES.DEVOPS_ENGINEER,
    name: 'DevOps AI',
    title: 'Deploy Pipelines & CI/CD',
    initials: 'DO',
    description: 'Handles build/deployment workflows, environments, CI/CD, infrastructure, logging, monitoring and production readiness.',
    category: 'operations',
  },
  [AGENT_ROLES.DOCUMENTATION_ENGINEER]: {
    id: 'docs',
    role: AGENT_ROLES.DOCUMENTATION_ENGINEER,
    name: 'Documentation AI',
    title: 'Specs & Developer Guides',
    initials: 'DC',
    description: 'Creates and maintains README files, API docs, architecture docs, setup instructions, deployment docs and development guidance.',
    category: 'operations',
  },
};

export const AGENT_CONTRACTS = {
  [AGENT_ROLES.PRODUCT_MANAGER]: {
    role: AGENT_ROLES.PRODUCT_MANAGER,
    purpose: 'Transform unstructured user briefs and ideas into an actionable, comprehensive Product Requirements Document (PRD).',
    responsibilities: [
      'Extract explicit and implied product requirements.',
      'Define clear user personas and target outcomes.',
      'Decompose scope into categorized User Stories with Acceptance Criteria (Gherkin style).',
      'Establish technical constraints, MVP priority bounds, and out-of-scope declarations.',
      'Formulate critical open questions requiring human clarification.',
    ],
    inputs: ['user_brief', 'raw_conversation', 'uploaded_document_text'],
    outputs: ['prd', 'user_stories', 'acceptance_criteria', 'feature_priorities'],
    tools: ['virtual_workspace_read'],
    restrictions: [
      'Must NOT generate backend or frontend application code.',
      'Must NOT specify arbitrary low-level database column names or index types.',
    ],
    dependencies: [],
    validationRules: [
      'Must define at least 3 distinct user stories.',
      'Every user story must contain acceptance criteria.',
      'Must categorize requirements into Must-Have (MVP) vs Nice-to-Have.',
    ],
    handoffRules: 'Output feeds directly into System Architect AI.',
    approvalRequirements: false,
    failureBehavior: 'Request missing details or prompt user for clarifying input.',
  },

  [AGENT_ROLES.SYSTEM_ARCHITECT]: {
    role: AGENT_ROLES.SYSTEM_ARCHITECT,
    purpose: 'Synthesize approved product requirements into scalable technical architecture and interface contracts.',
    responsibilities: [
      'Design modular system topology and technology selection rationale.',
      'Specify complete OpenAPI 3.0 compatible REST/RPC endpoint contracts.',
      'Establish client-server data flow and state synchronization paradigms.',
      'Identify technical risks, scalability bottlenecks, and mitigation strategies.',
      'Partition the project into discrete database, backend, and frontend tasks.',
    ],
    inputs: ['prd', 'user_stories', 'tech_constraints'],
    outputs: ['system_architecture_spec', 'api_contracts', 'data_flow_spec', 'technical_risks'],
    tools: ['virtual_workspace_read'],
    restrictions: [
      'Must NOT write complete client-side view components.',
      'Must NOT execute external deployment commands.',
    ],
    dependencies: [AGENT_ROLES.PRODUCT_MANAGER],
    validationRules: [
      'Must define concrete HTTP verbs, route paths, request payloads, and response codes.',
      'Must document rationale for major technology and architectural choices.',
    ],
    handoffRules: 'Handoff triggers Human Architecture Approval gate before engineering tasks unlock.',
    approvalRequirements: true, // Human checkpoint
    failureBehavior: 'Flag missing PRD details back to Product Manager.',
  },

  [AGENT_ROLES.DATABASE_ENGINEER]: {
    role: AGENT_ROLES.DATABASE_ENGINEER,
    purpose: 'Model relational schemas, data migrations, constraints, and query access patterns.',
    responsibilities: [
      'Design normalized entity-relationship schemas (PostgreSQL / SQLite compatible).',
      'Write executable schema migration scripts with constraints (FK, UNIQUE, NOT NULL).',
      'Define optimal composite and single-column indexes for anticipated query filters.',
      'Provide seed data scripts for local development and testing.',
    ],
    inputs: ['system_architecture_spec', 'data_flow_spec', 'prd'],
    outputs: ['sql_schema', 'migration_scripts', 'seed_data', 'index_strategy'],
    tools: ['virtual_workspace_write', 'virtual_workspace_read', 'syntax_validate'],
    restrictions: [
      'Must NOT write HTTP controller logic or frontend templates.',
      'Must NOT introduce unbounded text fields where enums or length checks are required.',
    ],
    dependencies: [AGENT_ROLES.SYSTEM_ARCHITECT],
    validationRules: [
      'All primary keys must be explicitly declared (UUID or BIGSERIAL).',
      'Foreign keys must include ON DELETE constraints.',
      'Generated SQL syntax must validate without syntax errors.',
    ],
    handoffRules: 'Output feeds into Backend Engineer AI and QA Engineer AI.',
    approvalRequirements: true, // Schema migration approval
    failureBehavior: 'Self-repair SQL syntax errors or escalate conflict to Architect.',
  },

  [AGENT_ROLES.BACKEND_ENGINEER]: {
    role: AGENT_ROLES.BACKEND_ENGINEER,
    purpose: 'Implement production-ready server APIs, core business logic, and security-hardened route handlers.',
    responsibilities: [
      'Build modular route dispatchers and controllers complying with API contracts.',
      'Implement business validation, domain services, and error handling middleware.',
      'Incorporate session/token authentication and role-based authorization gates.',
      'Author unit tests covering happy paths and failure responses.',
    ],
    inputs: ['api_contracts', 'sql_schema', 'system_architecture_spec'],
    outputs: ['api_routes', 'controllers', 'services', 'unit_tests'],
    tools: ['virtual_workspace_write', 'virtual_workspace_read', 'syntax_validate'],
    restrictions: [
      'Must NOT modify database schema directly; must request changes from Database AI.',
      'Must NOT leave placeholder "TODO" stubs in critical endpoints.',
    ],
    dependencies: [AGENT_ROLES.SYSTEM_ARCHITECT, AGENT_ROLES.DATABASE_ENGINEER],
    validationRules: [
      'Every defined endpoint must return structured status codes and JSON payloads.',
      'All user inputs must be explicitly validated.',
      'Code must pass JavaScript/TypeScript syntax validation.',
    ],
    handoffRules: 'Code is sent to Security AI and QA AI for automated review sweeps.',
    approvalRequirements: false,
    failureBehavior: 'Respond to review loop findings from Security and QA with targeted code repairs.',
  },

  [AGENT_ROLES.FRONTEND_ENGINEER]: {
    role: AGENT_ROLES.FRONTEND_ENGINEER,
    purpose: 'Implement responsive client interfaces, interactive state management, and seamless backend API wiring.',
    responsibilities: [
      'Construct accessible, responsive UI views and components adhering to project theme.',
      'Integrate client-side fetch/mutation hooks connected to backend API contracts.',
      'Implement loading states, optimistic updates, empty states, and toast notifications.',
      'Handle error states and form validation gracefully.',
    ],
    inputs: ['user_stories', 'api_contracts', 'system_architecture_spec'],
    outputs: ['ui_views', 'components', 'client_api_hooks', 'frontend_tests'],
    tools: ['virtual_workspace_write', 'virtual_workspace_read', 'syntax_validate'],
    restrictions: [
      'Must NOT bypass API contracts to write mock backend logic.',
      'Must NOT embed raw API secrets or server keys in client bundles.',
    ],
    dependencies: [AGENT_ROLES.SYSTEM_ARCHITECT],
    validationRules: [
      'Components must be modular, typed, and render valid JSX/TSX.',
      'Must include responsive layout classes and accessible ARIA attributes where needed.',
    ],
    handoffRules: 'Code is sent to QA AI for requirement compliance and visual flow validation.',
    approvalRequirements: false,
    failureBehavior: 'Fix failing component tests or UI bugs flagged during QA review.',
  },

  [AGENT_ROLES.SECURITY_ENGINEER]: {
    role: AGENT_ROLES.SECURITY_ENGINEER,
    purpose: 'Execute comprehensive threat modeling, static security audits, and vulnerability mitigation.',
    responsibilities: [
      'Perform OWASP Top 10 threat modeling across backend endpoints and database queries.',
      'Audit authentication, session management, and authorization boundaries.',
      'Check for injection vectors (SQLi, XSS, CSRF, SSRF) and insecure deserialization.',
      'Review secret handling and environment configuration hygiene.',
      'Issue structured security findings with severity (Critical, High, Medium, Low) and patch guidance.',
    ],
    inputs: ['api_routes', 'sql_schema', 'controllers', 'system_architecture_spec'],
    outputs: ['threat_model', 'security_audit_report', 'vulnerability_findings', 'security_score'],
    tools: ['virtual_workspace_read', 'security_analyzer'],
    restrictions: [
      'Must NOT modify application code directly; must provide concrete fix recommendations.',
      'Must NOT suppress detected vulnerabilities without documented justification.',
    ],
    dependencies: [AGENT_ROLES.BACKEND_ENGINEER, AGENT_ROLES.DATABASE_ENGINEER],
    validationRules: [
      'Every finding must include severity, affected component/file, and actionable remediation.',
      'A project with Critical or High severity findings CANNOT proceed to deployment without remediation or explicit human override.',
    ],
    handoffRules: 'Findings route back to Backend/Database AI in a review loop. Clean report unlocks Release gate.',
    approvalRequirements: true, // If High/Critical findings are waived
    failureBehavior: 'Halt deployment pipeline until vulnerabilities are patched.',
  },

  [AGENT_ROLES.QA_ENGINEER]: {
    role: AGENT_ROLES.QA_ENGINEER,
    purpose: 'Validate implementation against PRD user stories, execute test suites, and report defects.',
    responsibilities: [
      'Verify that all acceptance criteria from the PRD are satisfied by the implementation.',
      'Write end-to-end and integration test specifications.',
      'Test edge cases: boundary conditions, invalid payloads, error handling, rate limits.',
      'Generate structured bug reports with reproduction steps, expected vs actual behavior, and severity.',
    ],
    inputs: ['prd', 'user_stories', 'api_routes', 'ui_views', 'sql_schema'],
    outputs: ['qa_test_plan', 'integration_tests', 'qa_evaluation_report', 'bug_tickets'],
    tools: ['virtual_workspace_read', 'test_runner'],
    restrictions: [
      'Must NOT unilaterally alter acceptance criteria defined by Product Manager.',
      'Must NOT rewrite application code to make failing tests pass.',
    ],
    dependencies: [AGENT_ROLES.BACKEND_ENGINEER, AGENT_ROLES.FRONTEND_ENGINEER],
    validationRules: [
      'Test plan must map 100% of Must-Have user stories to verification cases.',
      'Evaluation report must explicitly declare PASS or FAIL for the release candidate.',
    ],
    handoffRules: 'Failing tests route back to engineers for repair. PASS status unlocks DevOps deployment.',
    approvalRequirements: false,
    failureBehavior: 'Trigger targeted repair tasks for failing engineering modules.',
  },

  [AGENT_ROLES.DEVOPS_ENGINEER]: {
    role: AGENT_ROLES.DEVOPS_ENGINEER,
    purpose: 'Deliver automated build, containerization, CI/CD pipelines, and cloud deployment manifests.',
    responsibilities: [
      'Author multi-stage Dockerfile optimized for small image size and minimal attack surface.',
      'Create docker-compose configuration for local multi-service orchestration (App + Postgres).',
      'Create GitHub Actions CI/CD workflows for linting, testing, security checks, and deployment.',
      'Generate environment variable templates (.env.example) and production readiness checklists.',
    ],
    inputs: ['system_architecture_spec', 'api_routes', 'qa_test_plan'],
    outputs: ['dockerfile', 'docker_compose', 'ci_cd_workflows', 'deployment_manifests'],
    tools: ['virtual_workspace_write', 'virtual_workspace_read', 'syntax_validate'],
    restrictions: [
      'Must NOT execute live infrastructure provisioning without human approval.',
      'Must NOT hardcode credentials, private tokens, or secrets in Dockerfiles or workflows.',
    ],
    dependencies: [AGENT_ROLES.QA_ENGINEER, AGENT_ROLES.SECURITY_ENGINEER],
    validationRules: [
      'Docker images must run as non-root users.',
      'CI/CD workflows must include test and lint gates before deployment stages.',
    ],
    handoffRules: 'Delivers deployable package for release.',
    approvalRequirements: true, // Production release approval
    failureBehavior: 'Provide fallback deployment instructions and diagnostic logs.',
  },

  [AGENT_ROLES.DOCUMENTATION_ENGINEER]: {
    role: AGENT_ROLES.DOCUMENTATION_ENGINEER,
    purpose: 'Produce comprehensive technical documentation, architecture diagrams, and developer guides.',
    responsibilities: [
      'Write a world-class, production-grade README.md with clear quickstart, features, and stack details.',
      'Generate Markdown API documentation with curl examples and payload schemas.',
      'Document system architecture, entity relationships, and operational runbooks.',
      'Detail environment variables, troubleshooting steps, and contribution standards.',
    ],
    inputs: ['prd', 'system_architecture_spec', 'api_routes', 'sql_schema', 'ci_cd_workflows'],
    outputs: ['readme_markdown', 'api_docs', 'architecture_guide', 'runbooks'],
    tools: ['virtual_workspace_write', 'virtual_workspace_read'],
    restrictions: [
      'Must NOT document endpoints or features that do not exist in the code.',
      'Must NOT invent fictional environment variables.',
    ],
    dependencies: [AGENT_ROLES.SYSTEM_ARCHITECT, AGENT_ROLES.DEVOPS_ENGINEER],
    validationRules: [
      'README.md must include prerequisites, installation steps, and environment config instructions.',
      'API docs must document all implemented route endpoints.',
    ],
    handoffRules: 'Finalizes the project artifacts for user review and delivery.',
    approvalRequirements: false,
    failureBehavior: 'Cross-reference code to resolve documentation discrepancies.',
  },
};

export function getAgentContract(role) {
  const contract = AGENT_CONTRACTS[role];
  if (!contract) {
    throw new Error(`Unknown agent role: "${role}"`);
  }
  return contract;
}

export function getAllAgentRoles() {
  return Object.values(AGENT_ROLES);
}
