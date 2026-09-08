export type AgentStatus = "working" | "queued" | "done" | "idle";

export type Agent = {
  id: string;
  name: string;
  role: string;
  status: AgentStatus;
  progress: number;
  initials: string;
};

export const agents: Agent[] = [
  { id: "pm", name: "Project Manager AI", role: "Planning & orchestration", status: "working", progress: 72, initials: "PM" },
  { id: "arch", name: "Architecture AI", role: "System design", status: "working", progress: 64, initials: "AR" },
  { id: "db", name: "Database AI", role: "Schema & queries", status: "working", progress: 48, initials: "DB" },
  { id: "be", name: "Backend AI", role: "APIs & services", status: "queued", progress: 12, initials: "BE" },
  { id: "fe", name: "Frontend AI", role: "UI implementation", status: "queued", progress: 8, initials: "FE" },
  { id: "sec", name: "Security AI", role: "Threat review", status: "idle", progress: 0, initials: "SC" },
  { id: "qa", name: "QA AI", role: "Test authoring", status: "idle", progress: 0, initials: "QA" },
  { id: "docs", name: "Documentation AI", role: "Specs & guides", status: "idle", progress: 0, initials: "DC" },
  { id: "devops", name: "DevOps AI", role: "Deploy pipelines", status: "queued", progress: 20, initials: "DO" },
];

export const statusLabel: Record<AgentStatus, string> = {
  working: "Working",
  queued: "Queued",
  done: "Completed",
  idle: "Waiting for input",
};

export const projects = [
  { name: "E-commerce Platform", stack: "Next.js · Stripe", status: "In progress", progress: 68 },
  { name: "ERP System", stack: "React · Postgres", status: "In progress", progress: 41 },
  { name: "Task Management App", stack: "Vue · MongoDB", status: "Completed", progress: 100 },
  { name: "AI SaaS Starter", stack: "TanStack · Supabase", status: "Building", progress: 23 },
];

export const activity = [
  { title: "E-commerce Platform", detail: "Frontend AI shipped checkout flow", time: "2 min ago" },
  { title: "Database schema updated", detail: "Database AI added 4 tables", time: "18 min ago" },
  { title: "API routes created", detail: "Backend AI generated 12 endpoints", time: "41 min ago" },
  { title: "Frontend components", detail: "26 components generated", time: "1 hr ago" },
  { title: "Deployment succeeded", detail: "staging.helix.dev is live", time: "3 hrs ago" },
];

export const tasks = [
  { agent: "Project Manager AI", task: "Break down requirements", progress: 100, status: "done" },
  { agent: "Architecture AI", task: "Design service topology", progress: 84, status: "working" },
  { agent: "Database AI", task: "Normalize order schema", progress: 62, status: "working" },
  { agent: "Backend AI", task: "Implement payments API", progress: 35, status: "working" },
  { agent: "Frontend AI", task: "Build product listing", progress: 18, status: "working" },
  { agent: "Security AI", task: "Audit auth boundaries", progress: 0, status: "queued" },
  { agent: "QA AI", task: "Write E2E specs", progress: 0, status: "queued" },
  { agent: "Documentation AI", task: "Draft API reference", progress: 0, status: "queued" },
  { agent: "DevOps AI", task: "Provision staging", progress: 55, status: "working" },
] as const;

export const integrations = [
  { name: "GitHub", kind: "Repository", connected: true },
  { name: "Supabase", kind: "Database", connected: true },
  { name: "Firebase", kind: "Realtime", connected: false },
  { name: "Vercel", kind: "Hosting", connected: true },
  { name: "Stripe", kind: "Payments", connected: false },
  { name: "Resend", kind: "Email", connected: true },
  { name: "Cloudflare", kind: "Edge & DNS", connected: false },
  { name: "Railway", kind: "Workers", connected: false },
];

export const deployments = [
  { env: "Production", url: "helix-shop.app", status: "Live", build: "#1284", time: "May 16, 20:41 UTC" },
  { env: "Staging", url: "staging.helix-shop.app", status: "Live", build: "#1291", time: "May 16, 21:10 UTC" },
  { env: "Development", url: "dev.helix-shop.app", status: "Building", build: "#1292", time: "May 16, 21:33 UTC" },
];

export const maintenanceUpdates = [
  { name: "react", from: "19.1.0", to: "19.2.0", kind: "Minor" },
  { name: "@tanstack/react-query", from: "5.90.1", to: "5.101.1", kind: "Minor" },
  { name: "zod", from: "3.23.8", to: "3.24.2", kind: "Patch" },
  { name: "vite", from: "7.1.0", to: "8.2.0", kind: "Major" },
];

export const threats = [
  { title: "SQL injection risk in legacy report query", severity: "High", area: "Backend API" },
  { title: "Missing rate limit on /auth/login", severity: "Medium", area: "Auth" },
  { title: "Dependency with known CVE: image-resize", severity: "Medium", area: "Dependencies" },
  { title: "Verbose error messages in production", severity: "Low", area: "Observability" },
];
