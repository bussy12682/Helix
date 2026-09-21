import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
  Activity,
  ArrowRight,
  Bot,
  Check,
  CheckCircle2,
  ChevronDown,
  Cloud,
  Code2,
  Cpu,
  Database,
  ExternalLink,
  FileCode2,
  FileText,
  GitBranch,
  Layers,
  Lock,
  Mic,
  PlayCircle,
  RefreshCw,
  Server,
  Shield,
  ShieldCheck,
  Sparkles,
  Terminal,
  Users,
  Workflow,
  Zap,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { HelixLogo, HelixMark } from "@/components/helix/logo";
import heroVisual from "@/assets/helix-hero.jpg";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { demoLogin, setStoredSessionToken } from "@/lib/api";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "HELIX — The AI Engineering Operating System" },
      {
        name: "description",
        content:
          "HELIX coordinates an entire workforce of nine specialized AI agents to plan, architect, build, test, secure, and deploy production software from a single description.",
      },
      { property: "og:title", content: "HELIX — Build Software at the Speed of Thought" },
      {
        property: "og:description",
        content:
          "An autonomous coordinated AI engineering department that builds and maintains production software with human oversight.",
      },
    ],
  }),
  component: Landing,
});

// The 9 Specialized AI Agents
const agents = [
  {
    id: "pm",
    name: "Avery",
    role: "Product Manager",
    tier: "Deep Reasoning (Tier 1)",
    deliverable: "PRD & User Stories",
    icon: FileText,
    color: "from-blue-500/20 to-cyan-500/20 text-cyan-400 border-cyan-500/30",
    description: "Transforms user visions into structured PRDs, acceptance criteria, personas, and roadmap milestones.",
    snippet: `## 1. Executive Summary\nAutonomous Multi-Vendor Marketplace with real-time checkout & inventory tracking.\n\n## 2. User Stories\n- As a shopper, I can filter by tags and purchase items with Stripe.\n- As a vendor, I can manage inventory and view payouts.`,
  },
  {
    id: "architect",
    name: "Darius",
    role: "System Architect",
    tier: "Deep Reasoning (Tier 1)",
    deliverable: "C4 Architecture & OpenAPI",
    icon: Cpu,
    color: "from-purple-500/20 to-violet-500/20 text-purple-400 border-purple-500/30",
    description: "Designs system topology, component interactions, database models, and OpenAPI 3.1 contracts.",
    snippet: `openapi: 3.1.0\ninfo:\n  title: Helix Core Service API\n  version: 1.0.0\npaths:\n  /api/v1/orders:\n    post:\n      summary: Create new checkout session\n      responses:\n        '201':\n          description: Order registered`,
  },
  {
    id: "db",
    name: "Kaelen",
    role: "Database Engineer",
    tier: "Code Specialist (Tier 2)",
    deliverable: "PostgreSQL DDL & Migrations",
    icon: Database,
    color: "from-amber-500/20 to-orange-500/20 text-amber-400 border-amber-500/30",
    description: "Generates production-grade PostgreSQL schemas, foreign keys, B-tree indexes, and rollback migrations.",
    snippet: `CREATE TABLE orders (\n  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),\n  user_id UUID REFERENCES users(id) ON DELETE CASCADE,\n  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),\n  status VARCHAR(32) NOT NULL DEFAULT 'pending',\n  created_at TIMESTAMPTZ DEFAULT NOW()\n);\nCREATE INDEX idx_orders_user ON orders(user_id);`,
  },
  {
    id: "backend",
    name: "Devon",
    role: "Backend Engineer",
    tier: "Code Specialist (Tier 2)",
    deliverable: "REST/WebSocket Services",
    icon: Server,
    color: "from-emerald-500/20 to-green-500/20 text-emerald-400 border-emerald-500/30",
    description: "Implements domain logic, route handlers, database repositories, error middlewares, and auth security.",
    snippet: `export async function handleCreateOrder({ req, db, user }) {\n  const { items, total } = await req.json();\n  const order = await db.orders.create({\n    userId: user.id,\n    amountCents: total,\n    status: 'processing'\n  });\n  return Response.json({ success: true, orderId: order.id }, { status: 201 });\n}`,
  },
  {
    id: "frontend",
    name: "Lyra",
    role: "Frontend Engineer",
    tier: "Code Specialist (Tier 2)",
    deliverable: "React & Tailwind UI",
    icon: Code2,
    color: "from-pink-500/20 to-rose-500/20 text-pink-400 border-pink-500/30",
    description: "Crafts accessible, responsive React interfaces with state management, animations, and Tailwind styling.",
    snippet: `export function CheckoutPanel({ total, onConfirm }) {\n  const [loading, setLoading] = useState(false);\n  return (\n    <div className="rounded-2xl border border-white/10 bg-white/5 p-6 backdrop-blur">\n      <h3 className="text-lg font-semibold">Order Summary</h3>\n      <p className="mt-2 text-2xl font-bold">\${(total / 100).toFixed(2)}</p>\n      <Button onClick={onConfirm} className="w-full mt-4">Confirm Payment</Button>\n    </div>\n  );\n}`,
  },
  {
    id: "qa",
    name: "Tessa",
    role: "QA Engineer",
    tier: "Code Specialist (Tier 2)",
    deliverable: "Unit & E2E Test Suite",
    icon: CheckCircle2,
    color: "from-indigo-500/20 to-blue-500/20 text-indigo-400 border-indigo-500/30",
    description: "Builds comprehensive test suites, edge case validations, and triggers automated repair loops if tests fail.",
    snippet: `test('Order creation rejects invalid amounts and calculates taxes', async () => {\n  const res = await client.post('/api/v1/orders', { body: { items: [], total: -50 } });\n  assert.equal(res.status, 400);\n  assert.equal(res.body.error.code, 'INVALID_AMOUNT');\n});`,
  },
  {
    id: "devops",
    name: "Torin",
    role: "DevOps Engineer",
    tier: "Fast / Local (Tier 3)",
    deliverable: "Docker & CI/CD Pipelines",
    icon: Cloud,
    color: "from-sky-500/20 to-blue-500/20 text-sky-400 border-sky-500/30",
    description: "Produces multi-stage container builds, GitHub Actions pipelines, and zero-downtime deployment scripts.",
    snippet: `FROM node:20-alpine AS builder\nWORKDIR /app\nCOPY package*.json ./\nRUN npm ci\nCOPY . .\nRUN npm run build\n\nFROM node:20-alpine AS runner\nWORKDIR /app\nCOPY --from=builder /app/dist ./dist\nCMD ["node", "dist/server.js"]`,
  },
  {
    id: "security",
    name: "Sloan",
    role: "Security Engineer",
    tier: "Deep Reasoning (Tier 1)",
    deliverable: "SAST & Threat Audit",
    icon: Shield,
    color: "from-red-500/20 to-orange-500/20 text-red-400 border-red-500/30",
    description: "Audits code for OWASP Top 10 vulnerabilities, injection risks, secret leaks, and security compliance.",
    snippet: `{\n  "auditDate": "2026-09-21",\n  "status": "APPROVED",\n  "owaspScanned": ["Injection", "Broken Auth", "SSRF", "Secrets"],\n  "vulnerabilities": [],\n  "recommendations": ["Enforce strict Content Security Policy headers."]\n}`,
  },
  {
    id: "sre",
    name: "Rhea",
    role: "Site Reliability Engineer",
    tier: "Fast / Local (Tier 3)",
    deliverable: "SLOs & Health Runbooks",
    icon: Activity,
    color: "from-teal-500/20 to-emerald-500/20 text-teal-400 border-teal-500/30",
    description: "Instruments real-time Prometheus metrics, error budgets, health checks, and self-healing runbooks.",
    snippet: `slo:\n  service: helix-core\n  availability_target: 99.95%\n  latency_p99_ms: 150\ntelemetry:\n  prometheus_scrape: "/metrics"\n  health_endpoint: "/api/v1/health"\n  auto_healing: enabled`,
  },
];

const workflows = [
  {
    step: "01",
    phase: "Idea to Scope",
    title: "Voice or Text Project Briefing",
    agent: "Product Manager (Avery)",
    desc: "Describe your application via voice note or prompt. Avery structures user stories and acceptance criteria.",
    gate: null,
  },
  {
    step: "02",
    phase: "System Architecture",
    title: "C4 Diagrams & Schema Blueprint",
    agent: "Architect (Darius) & DB (Kaelen)",
    desc: "Darius architects services and OpenAPI contracts while Kaelen defines the normalized PostgreSQL schema.",
    gate: "🛑 Human Checkpoint #1: Architecture Approval",
  },
  {
    step: "03",
    phase: "Parallel Coding",
    title: "Fullstack Implementation",
    agent: "Backend (Devon) & Frontend (Lyra)",
    desc: "Devon writes server logic and REST APIs while Lyra crafts responsive Tailwind and React components.",
    gate: null,
  },
  {
    step: "04",
    phase: "Verification & Audit",
    title: "Automated QA & Threat Analysis",
    agent: "QA (Tessa) & Security (Sloan)",
    desc: "Tessa runs test matrices and Sloan executes SAST audits. If a bug is caught, self-healing loop triggers.",
    gate: "🛑 Human Checkpoint #2: Production Release Approval",
  },
  {
    step: "05",
    phase: "Cloud Deployment",
    title: "Zero-Downtime Release & Telemetry",
    agent: "DevOps (Torin) & SRE (Rhea)",
    desc: "Torin deploys Docker containers and Rhea configures Prometheus metrics and SLO monitors.",
    gate: null,
  },
];

const faqs = [
  {
    q: "How is HELIX different from a generic AI coding assistant?",
    a: "Generic AI tools are single chatbots that suggest snippets. HELIX is an entire autonomous engineering department. Nine specialized agents collaborate through a Directed Acyclic Graph (DAG), produce verifiable artifacts (PRDs, SQL, tests, code), and pause at mandatory human checkpoints for your review and sign-off.",
  },
  {
    q: "Do I need to supply my own AI API keys?",
    a: "HELIX includes an intelligent multi-model router with built-in fallbacks. You can bring your own Google Gemini, OpenAI, or Anthropic keys, connect to local Ollama models (such as Llama 3 or DeepSeek), or evaluate out-of-the-box in mock demo mode.",
  },
  {
    q: "Where does Human-in-the-Loop oversight take place?",
    a: "HELIX does not deploy blindly. By default, two critical checkpoints require explicit human approval: (1) Architecture Approval after PRD and schema specifications, and (2) Release Approval after QA test suites and security scans have passed.",
  },
  {
    q: "Can I export code directly to GitHub or host on my cloud?",
    a: "Yes. HELIX commits clean, idiomatic code to your connected repository. Every project includes Dockerfiles, GitHub Actions CI/CD workflows, and PostgreSQL schemas ready for production hosting on AWS, GCP, Vercel, or Render.",
  },
];

function Landing() {
  const [selectedAgent, setSelectedAgent] = useState(agents[0]);
  const [openFaq, setOpenFaq] = useState<number | null>(0);
  const [isDemoLoading, setIsDemoLoading] = useState(false);
  const navigate = useNavigate();

  async function handleQuickDemo() {
    setIsDemoLoading(true);
    try {
      const session = await demoLogin();
      setStoredSessionToken(session.token);
      toast.success("Signed in as Demo Engineer! Loading office...");
      navigate({ to: "/dashboard" });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Demo sign-in failed.");
    } finally {
      setIsDemoLoading(false);
    }
  }

  return (
    <div className="surface-night min-h-screen text-night-foreground selection:bg-primary/30">
      {/* Top Glass Navigation */}
      <header className="sticky top-0 z-50 border-b border-night-border/80 bg-night/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <HelixLogo tone="night" />
            <span className="hidden sm:inline-flex items-center rounded-full border border-primary/30 bg-primary/10 px-2.5 py-0.5 text-[11px] font-medium text-primary">
              v1.0 MVP
            </span>
          </div>

          <nav className="hidden items-center gap-8 text-sm font-medium text-night-muted md:flex">
            <a href="#workforce" className="transition hover:text-night-foreground">
              9-Agent Workforce
            </a>
            <a href="#workflow" className="transition hover:text-night-foreground">
              DAG Orchestration
            </a>
            <a href="#artifacts" className="transition hover:text-night-foreground">
              Artifacts
            </a>
            <a href="#comparison" className="transition hover:text-night-foreground">
              Comparison
            </a>
            <a href="#pricing" className="transition hover:text-night-foreground">
              Pricing
            </a>
            <Link to="/office" className="transition hover:text-night-foreground flex items-center gap-1">
              Live Office <ExternalLink className="h-3 w-3" />
            </Link>
          </nav>

          <div className="flex items-center gap-2.5">
            <Button
              variant="outline"
              size="sm"
              onClick={handleQuickDemo}
              disabled={isDemoLoading}
              className="border-primary/40 bg-primary/10 text-primary hover:bg-primary/20 hover:text-primary font-medium text-xs cursor-pointer"
            >
              {isDemoLoading ? "Entering..." : (
                <span className="flex items-center gap-1">
                  <Zap className="h-3.5 w-3.5 fill-current" /> Demo Sign In
                </span>
              )}
            </Button>
            <Button asChild variant="ghost" size="sm" className="text-night-muted hover:text-night-foreground hover:bg-white/5">
              <Link to="/login">Sign in</Link>
            </Button>
            <Button asChild size="sm" className="bg-primary hover:bg-primary/90 shadow-glow">
              <Link to="/signup">Get Started Free</Link>
            </Button>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="relative overflow-hidden pt-12 pb-24 lg:pt-20">
        {/* Glow ambient lights */}
        <div className="pointer-events-none absolute -top-40 left-1/2 -z-10 h-[500px] w-[800px] -translate-x-1/2 rounded-full bg-primary/20 blur-[130px]" />

        <div className="mx-auto max-w-7xl px-6">
          <div className="grid items-center gap-12 lg:grid-cols-[1.1fr_0.9fr]">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3.5 py-1 text-xs font-medium text-primary">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-primary"></span>
                </span>
                Autonomous Coordinated AI Engineering Workforce
              </div>

              <h1 className="mt-6 font-display text-4xl font-extrabold tracking-tight sm:text-6xl lg:text-7xl leading-[1.08]">
                Build Software at the{" "}
                <span className="bg-gradient-to-r from-violet-400 via-indigo-300 to-cyan-400 bg-clip-text text-transparent">
                  Speed of Thought.
                </span>
              </h1>

              <p className="mt-6 max-w-xl text-base sm:text-lg leading-relaxed text-night-muted">
                HELIX coordinates nine specialized AI agents — from Product Managers and System Architects
                to Database, Backend, Frontend, QA, Security, DevOps, and SREs — turning a single idea
                into production-ready software with structured human checkpoints.
              </p>

              <div className="mt-8 flex flex-wrap items-center gap-3.5">
                <Button asChild size="lg" className="bg-primary hover:bg-primary/90 text-sm font-semibold shadow-glow px-6">
                  <Link to="/signup">
                    Deploy AI Workforce <ArrowRight className="ml-2 h-4 w-4" />
                  </Link>
                </Button>

                <Button
                  size="lg"
                  variant="outline"
                  onClick={handleQuickDemo}
                  disabled={isDemoLoading}
                  className="border-night-border bg-night-soft/60 text-night-foreground hover:bg-night-soft text-sm font-semibold cursor-pointer"
                >
                  <Zap className="mr-2 h-4 w-4 text-primary fill-primary" /> 1-Click Live Demo
                </Button>

                <Button asChild size="lg" variant="ghost" className="text-night-muted hover:text-night-foreground hover:bg-white/5 text-sm">
                  <Link to="/office">
                    <PlayCircle className="mr-2 h-4 w-4" /> View AI Office
                  </Link>
                </Button>
              </div>

              {/* Trust Indicators */}
              <div className="mt-10 grid grid-cols-3 gap-4 border-t border-night-border/70 pt-6 text-xs text-night-muted">
                <div>
                  <p className="font-semibold text-night-foreground">9 Agents</p>
                  <p className="text-[11px] mt-0.5">Specialized contracts & schemas</p>
                </div>
                <div>
                  <p className="font-semibold text-night-foreground">Human-in-the-Loop</p>
                  <p className="text-[11px] mt-0.5">Two mandatory approval gates</p>
                </div>
                <div>
                  <p className="font-semibold text-night-foreground">Multi-Model</p>
                  <p className="text-[11px] mt-0.5">Gemini, Claude, GPT, Ollama</p>
                </div>
              </div>
            </div>

            {/* Interactive Live Workforce Terminal Preview */}
            <div className="relative">
              <div className="rounded-3xl border border-night-border bg-night-soft/80 p-4 shadow-2xl backdrop-blur-xl">
                <div className="flex items-center justify-between border-b border-night-border/80 pb-3 px-2">
                  <div className="flex items-center gap-2">
                    <span className="h-3 w-3 rounded-full bg-red-500/80" />
                    <span className="h-3 w-3 rounded-full bg-yellow-500/80" />
                    <span className="h-3 w-3 rounded-full bg-green-500/80" />
                    <span className="ml-2 font-mono text-xs text-night-muted flex items-center gap-1.5">
                      <Terminal className="h-3.5 w-3.5 text-primary" /> helix-orchestrator :: live-dispatch
                    </span>
                  </div>
                  <Badge variant="outline" className="border-emerald-500/40 bg-emerald-500/10 text-[10px] text-emerald-400">
                    Active Workflow
                  </Badge>
                </div>

                {/* Simulated Live Agents Grid */}
                <div className="mt-4 grid grid-cols-3 gap-2.5">
                  {agents.slice(0, 6).map((a) => (
                    <div
                      key={a.id}
                      className="rounded-xl border border-night-border/70 bg-night/60 p-2.5 transition hover:border-primary/50"
                    >
                      <div className="flex items-center justify-between">
                        <a.icon className="h-4 w-4 text-primary" />
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                      </div>
                      <p className="mt-2 text-xs font-semibold text-night-foreground truncate">{a.name}</p>
                      <p className="text-[10px] text-night-muted truncate">{a.role}</p>
                      <span className="mt-2 inline-block rounded bg-white/5 px-1.5 py-0.5 font-mono text-[9px] text-primary">
                        done · 100%
                      </span>
                    </div>
                  ))}
                </div>

                {/* Live Checkpoint notification */}
                <div className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="h-4 w-4 text-amber-400 shrink-0" />
                    <div>
                      <p className="font-semibold text-amber-300">Human Approval Gate #1</p>
                      <p className="text-[11px] text-amber-200/70">PRD & Database Architecture ready for review</p>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    onClick={handleQuickDemo}
                    className="h-7 text-[11px] bg-amber-500 hover:bg-amber-600 text-black font-semibold"
                  >
                    Review & Sign
                  </Button>
                </div>

                {/* Hero preview image overlay */}
                <div className="mt-4 overflow-hidden rounded-2xl border border-night-border">
                  <img
                    src={heroVisual}
                    alt="HELIX Autonomous Workforce"
                    className="h-40 w-full object-cover opacity-80"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* SECTION 1: The 9-Agent Engineering Workforce */}
      <section id="workforce" className="border-t border-night-border/80 bg-night-soft/40 py-24">
        <div className="mx-auto max-w-7xl px-6">
          <div className="text-center max-w-2xl mx-auto">
            <span className="text-xs font-semibold uppercase tracking-wider text-primary">
              The Architecture
            </span>
            <h2 className="mt-2 font-display text-3xl sm:text-4xl font-bold">
              Meet Your 9 Specialized AI Engineers
            </h2>
            <p className="mt-3 text-sm sm:text-base text-night-muted">
              Unlike generic assistants, each HELIX agent operates under an explicit contract, typed schema,
              and designated model tier optimized for their specific craft.
            </p>
          </div>

          <div className="mt-14 grid gap-8 lg:grid-cols-[1fr_1.3fr]">
            {/* Agent Select List */}
            <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-1 gap-2.5">
              {agents.map((agent) => {
                const isSelected = selectedAgent.id === agent.id;
                const Icon = agent.icon;
                return (
                  <button
                    key={agent.id}
                    onClick={() => setSelectedAgent(agent)}
                    className={`flex items-center gap-3.5 rounded-xl border p-3.5 text-left transition cursor-pointer ${
                      isSelected
                        ? "border-primary bg-primary/10 shadow-glow"
                        : "border-night-border bg-night/40 hover:border-night-border/90 hover:bg-night-soft/60"
                    }`}
                  >
                    <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border ${agent.color}`}>
                      <Icon className="h-5 w-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-semibold text-night-foreground">{agent.name}</span>
                        <span className="text-[10px] font-mono text-night-muted">{agent.deliverable}</span>
                      </div>
                      <p className="text-xs text-night-muted truncate">{agent.role}</p>
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Detailed Selected Agent Inspector Card */}
            <div className="rounded-3xl border border-night-border bg-night/80 p-8 shadow-2xl backdrop-blur-xl">
              <div className="flex flex-wrap items-center justify-between gap-4 border-b border-night-border pb-6">
                <div className="flex items-center gap-4">
                  <div className={`flex h-14 w-14 items-center justify-center rounded-2xl border ${selectedAgent.color}`}>
                    <selectedAgent.icon className="h-7 w-7" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-display text-2xl font-bold">{selectedAgent.name}</h3>
                      <Badge variant="outline" className="border-primary/40 bg-primary/10 text-primary text-xs">
                        {selectedAgent.role}
                      </Badge>
                    </div>
                    <p className="text-xs text-night-muted mt-1">{selectedAgent.tier}</p>
                  </div>
                </div>

                <Button asChild size="sm" variant="outline" className="border-night-border bg-white/5 hover:bg-white/10">
                  <Link to="/office">Interact in Office</Link>
                </Button>
              </div>

              <div className="mt-6">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-night-muted">
                  Core Responsibility & Contract
                </h4>
                <p className="mt-2 text-sm leading-relaxed text-night-foreground">
                  {selectedAgent.description}
                </p>
              </div>

              <div className="mt-6">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-night-muted flex items-center gap-1.5">
                    <Terminal className="h-3.5 w-3.5 text-primary" /> Generated Artifact Output Preview
                  </h4>
                  <span className="text-[11px] font-mono text-primary">{selectedAgent.deliverable}</span>
                </div>
                <pre className="mt-3 overflow-x-auto rounded-xl border border-night-border bg-black/60 p-4 font-mono text-xs leading-relaxed text-emerald-400">
                  <code>{selectedAgent.snippet}</code>
                </pre>
              </div>

              <div className="mt-6 grid grid-cols-2 gap-4 border-t border-night-border pt-6 text-xs text-night-muted">
                <div>
                  <span className="font-semibold text-night-foreground">Communication Channel:</span>
                  <p className="mt-0.5">Structured JSON Envelope & Memory Context</p>
                </div>
                <div>
                  <span className="font-semibold text-night-foreground">Validation Guarantee:</span>
                  <p className="mt-0.5">Strict Ajv/Zod Schema Contract</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* SECTION 2: Directed Acyclic Graph (DAG) & Human Checkpoints */}
      <section id="workflow" className="py-24">
        <div className="mx-auto max-w-7xl px-6">
          <div className="text-center max-w-2xl mx-auto">
            <span className="text-xs font-semibold uppercase tracking-wider text-primary">
              Orchestration Engine
            </span>
            <h2 className="mt-2 font-display text-3xl sm:text-4xl font-bold">
              Autonomous DAG with Human Checkpoints
            </h2>
            <p className="mt-3 text-sm sm:text-base text-night-muted">
              HELIX executes tasks through a dependency graph with self-healing feedback loops
              and mandatory review gates so you retain complete control over your code.
            </p>
          </div>

          <div className="mt-14 space-y-4">
            {workflows.map((wf) => (
              <div
                key={wf.step}
                className="group relative rounded-2xl border border-night-border bg-night-soft/40 p-6 transition hover:border-primary/40 hover:bg-night-soft/70"
              >
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div className="flex items-start gap-4">
                    <span className="font-display text-xl font-bold text-primary">{wf.step}</span>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold uppercase text-night-muted">{wf.phase}</span>
                        <span className="text-xs text-night-border">•</span>
                        <span className="text-xs font-medium text-primary">{wf.agent}</span>
                      </div>
                      <h3 className="mt-1 font-display text-lg font-bold text-night-foreground">{wf.title}</h3>
                      <p className="mt-1 max-w-3xl text-xs sm:text-sm text-night-muted">{wf.desc}</p>
                    </div>
                  </div>

                  {wf.gate ? (
                    <div className="shrink-0 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3.5 py-2 text-xs font-semibold text-amber-400 flex items-center gap-1.5 shadow-sm">
                      <Lock className="h-3.5 w-3.5" />
                      {wf.gate}
                    </div>
                  ) : (
                    <div className="shrink-0 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3.5 py-2 text-xs font-medium text-emerald-400 flex items-center gap-1.5">
                      <Check className="h-3.5 w-3.5" /> Autonomous Execution
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* SECTION 3: Interactive Multi-Artifact Explorer */}
      <section id="artifacts" className="border-t border-night-border/80 bg-night-soft/30 py-24">
        <div className="mx-auto max-w-7xl px-6">
          <div className="text-center max-w-2xl mx-auto">
            <span className="text-xs font-semibold uppercase tracking-wider text-primary">
              Real Output
            </span>
            <h2 className="mt-2 font-display text-3xl sm:text-4xl font-bold">
              Production-Grade Artifacts, Not Just Chat
            </h2>
            <p className="mt-3 text-sm sm:text-base text-night-muted">
              Every workflow step generates concrete, production-ready deliverables saved to your repository.
            </p>
          </div>

          <div className="mt-12 rounded-3xl border border-night-border bg-night/90 shadow-2xl overflow-hidden">
            <div className="flex flex-wrap items-center justify-between border-b border-night-border bg-black/40 px-6 py-3">
              <div className="flex items-center gap-2">
                <FileCode2 className="h-4 w-4 text-primary" />
                <span className="font-mono text-xs text-night-foreground">helix-project-output</span>
              </div>
              <div className="flex items-center gap-3 text-xs text-night-muted font-mono">
                <span>9 Files Generated</span>
                <span>•</span>
                <span>0 Build Errors</span>
                <span>•</span>
                <span className="text-emerald-400">100% Test Pass</span>
              </div>
            </div>

            <div className="p-6">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                <div className="space-y-2 font-mono text-xs">
                  <div className="p-3 rounded-lg border border-primary/40 bg-primary/10 text-primary flex items-center gap-2">
                    <FileText className="h-4 w-4" /> spec/prd.md
                  </div>
                  <div className="p-3 rounded-lg border border-night-border bg-night/40 text-night-muted hover:text-night-foreground flex items-center gap-2">
                    <Database className="h-4 w-4" /> schema/schema.sql
                  </div>
                  <div className="p-3 rounded-lg border border-night-border bg-night/40 text-night-muted hover:text-night-foreground flex items-center gap-2">
                    <Workflow className="h-4 w-4" /> api/openapi.yaml
                  </div>
                  <div className="p-3 rounded-lg border border-night-border bg-night/40 text-night-muted hover:text-night-foreground flex items-center gap-2">
                    <Code2 className="h-4 w-4" /> src/routes/app.tsx
                  </div>
                  <div className="p-3 rounded-lg border border-night-border bg-night/40 text-night-muted hover:text-night-foreground flex items-center gap-2">
                    <Cloud className="h-4 w-4" /> ci/deploy.yml
                  </div>
                </div>

                <div className="md:col-span-3 rounded-xl border border-night-border bg-black/70 p-5 font-mono text-xs leading-relaxed text-night-muted">
                  <p className="text-primary"># Product Requirements Document (PRD)</p>
                  <p className="text-night-foreground mt-2">## 1. Objective</p>
                  <p>Deliver an autonomous incident remediation engine that ingests observability alerts and executes canary playbooks.</p>
                  <p className="text-night-foreground mt-3">## 2. Agent Assignments</p>
                  <ul className="list-disc list-inside space-y-1 mt-1 text-night-muted">
                    <li><span className="text-cyan-400">Avery (PM):</span> Scope, PRD, and Acceptance Criteria.</li>
                    <li><span className="text-purple-400">Darius (Architect):</span> Service boundaries & OpenAPI specifications.</li>
                    <li><span className="text-amber-400">Kaelen (DB):</span> Normalized schema DDL & index strategies.</li>
                    <li><span className="text-emerald-400">Devon (Backend):</span> Fastify/Node service logic & telemetry hooks.</li>
                    <li><span className="text-pink-400">Lyra (Frontend):</span> Incident commander dashboard with live charts.</li>
                    <li><span className="text-indigo-400">Tessa (QA):</span> Vitest integration suite & load testing scenarios.</li>
                    <li><span className="text-red-400">Sloan (Security):</span> SAST vulnerability scan & secrets analysis.</li>
                    <li><span className="text-sky-400">Torin (DevOps):</span> Multi-stage Docker container & GitHub Actions.</li>
                    <li><span className="text-teal-400">Rhea (SRE):</span> Prometheus metrics exporter & self-healing runbook.</li>
                  </ul>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* SECTION 4: Comparison Table */}
      <section id="comparison" className="py-24">
        <div className="mx-auto max-w-7xl px-6">
          <div className="text-center max-w-2xl mx-auto">
            <span className="text-xs font-semibold uppercase tracking-wider text-primary">
              Why HELIX
            </span>
            <h2 className="mt-2 font-display text-3xl sm:text-4xl font-bold">
              Traditional Dev vs. Single AI vs. HELIX
            </h2>
          </div>

          <div className="mt-12 overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-night-border text-xs uppercase text-night-muted">
                  <th className="py-4 px-4 font-semibold">Capability</th>
                  <th className="py-4 px-4 font-semibold">Traditional Agency</th>
                  <th className="py-4 px-4 font-semibold">Single Chatbot / Copilot</th>
                  <th className="py-4 px-4 font-semibold text-primary">HELIX OS Workforce</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-night-border text-sm">
                <tr>
                  <td className="py-4 px-4 font-medium text-night-foreground">Time to Production MVP</td>
                  <td className="py-4 px-4 text-night-muted">8 – 16 Weeks</td>
                  <td className="py-4 px-4 text-night-muted">2 – 3 Weeks (Fragmented)</td>
                  <td className="py-4 px-4 font-semibold text-emerald-400">&lt; 15 Minutes</td>
                </tr>
                <tr>
                  <td className="py-4 px-4 font-medium text-night-foreground">Team Roles & Specialization</td>
                  <td className="py-4 px-4 text-night-muted">5 – 8 separate hires</td>
                  <td className="py-4 px-4 text-night-muted">Single generalist prompt</td>
                  <td className="py-4 px-4 font-semibold text-primary">9 Dedicated Specialized Agents</td>
                </tr>
                <tr>
                  <td className="py-4 px-4 font-medium text-night-foreground">Schema & DB Architecture</td>
                  <td className="py-4 px-4 text-night-muted">Days of schema meetings</td>
                  <td className="py-4 px-4 text-night-muted">Ad-hoc copy-pasting</td>
                  <td className="py-4 px-4 font-semibold text-primary">Normalized DDL + Migrations</td>
                </tr>
                <tr>
                  <td className="py-4 px-4 font-medium text-night-foreground">Human Approval Gates</td>
                  <td className="py-4 px-4 text-night-muted">Slow manual status calls</td>
                  <td className="py-4 px-4 text-night-muted">None (Prompt & Pray)</td>
                  <td className="py-4 px-4 font-semibold text-primary">2 Mandatory Structured Checkpoints</td>
                </tr>
                <tr>
                  <td className="py-4 px-4 font-medium text-night-foreground">Security & Vulnerability Scans</td>
                  <td className="py-4 px-4 text-night-muted">Costly third-party audits</td>
                  <td className="py-4 px-4 text-night-muted">Ignored / Hallucinated</td>
                  <td className="py-4 px-4 font-semibold text-emerald-400">Automated SAST & Secret Checks</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* SECTION 5: Pricing */}
      <section id="pricing" className="border-t border-night-border/80 bg-night-soft/40 py-24">
        <div className="mx-auto max-w-7xl px-6">
          <div className="text-center max-w-2xl mx-auto">
            <span className="text-xs font-semibold uppercase tracking-wider text-primary">
              Simple Pricing
            </span>
            <h2 className="mt-2 font-display text-3xl sm:text-4xl font-bold">
              Transparent Plans for Builders & Teams
            </h2>
            <p className="mt-3 text-sm sm:text-base text-night-muted">
              Start free with no credit card required. Upgrade when you need continuous production deployments.
            </p>
          </div>

          <div className="mt-14 grid gap-8 md:grid-cols-3">
            {/* Starter Plan */}
            <div className="rounded-3xl border border-night-border bg-night/60 p-8 flex flex-col justify-between">
              <div>
                <h3 className="font-display text-xl font-bold">Starter</h3>
                <p className="mt-1 text-xs text-night-muted">Ideal for exploring the 9-agent workforce.</p>
                <div className="mt-6 flex items-baseline gap-1">
                  <span className="font-display text-4xl font-extrabold">$0</span>
                  <span className="text-xs text-night-muted">/ 14-day trial</span>
                </div>
                <ul className="mt-8 space-y-3 text-xs text-night-muted">
                  <li className="flex items-center gap-2"><Check className="h-4 w-4 text-primary" /> All 9 specialized agents</li>
                  <li className="flex items-center gap-2"><Check className="h-4 w-4 text-primary" /> 3 active software projects</li>
                  <li className="flex items-center gap-2"><Check className="h-4 w-4 text-primary" /> Human Architecture Checkpoints</li>
                  <li className="flex items-center gap-2"><Check className="h-4 w-4 text-primary" /> Mock mode & Bring-your-own-key</li>
                </ul>
              </div>
              <Button asChild className="w-full mt-8" variant="outline">
                <Link to="/signup">Start Free Trial</Link>
              </Button>
            </div>

            {/* Pro Plan (Highlighted) */}
            <div className="relative rounded-3xl border-2 border-primary bg-night p-8 flex flex-col justify-between shadow-glow">
              <div className="absolute -top-3.5 right-6 rounded-full bg-primary px-3 py-1 font-sans text-[11px] font-bold text-primary-foreground uppercase tracking-wider">
                Most Popular
              </div>
              <div>
                <h3 className="font-display text-xl font-bold text-primary">Pro</h3>
                <p className="mt-1 text-xs text-night-muted">For founders, solo engineers, and fast-moving teams.</p>
                <div className="mt-6 flex items-baseline gap-1">
                  <span className="font-display text-4xl font-extrabold text-night-foreground">$49</span>
                  <span className="text-xs text-night-muted">/ month</span>
                </div>
                <ul className="mt-8 space-y-3 text-xs text-night-foreground">
                  <li className="flex items-center gap-2"><Check className="h-4 w-4 text-primary" /> Unlimited active projects</li>
                  <li className="flex items-center gap-2"><Check className="h-4 w-4 text-primary" /> All 9 AI agents with Priority Routing</li>
                  <li className="flex items-center gap-2"><Check className="h-4 w-4 text-primary" /> Continuous SAST & QA repair loops</li>
                  <li className="flex items-center gap-2"><Check className="h-4 w-4 text-primary" /> GitHub sync & automated PR creation</li>
                  <li className="flex items-center gap-2"><Check className="h-4 w-4 text-primary" /> Voice turns & natural briefings</li>
                </ul>
              </div>
              <Button asChild className="w-full mt-8 bg-primary hover:bg-primary/90 text-primary-foreground font-semibold shadow-glow">
                <Link to="/signup">Get Started with Pro</Link>
              </Button>
            </div>

            {/* Enterprise Plan */}
            <div className="rounded-3xl border border-night-border bg-night/60 p-8 flex flex-col justify-between">
              <div>
                <h3 className="font-display text-xl font-bold">Enterprise</h3>
                <p className="mt-1 text-xs text-night-muted">Custom VPC deployment and local models.</p>
                <div className="mt-6 flex items-baseline gap-1">
                  <span className="font-display text-4xl font-extrabold">Custom</span>
                </div>
                <ul className="mt-8 space-y-3 text-xs text-night-muted">
                  <li className="flex items-center gap-2"><Check className="h-4 w-4 text-primary" /> Self-hosted on AWS/GCP VPC</li>
                  <li className="flex items-center gap-2"><Check className="h-4 w-4 text-primary" /> Private Ollama / vLLM clusters</li>
                  <li className="flex items-center gap-2"><Check className="h-4 w-4 text-primary" /> Custom agent contracts & schemas</li>
                  <li className="flex items-center gap-2"><Check className="h-4 w-4 text-primary" /> Dedicated SLA & SSO / SAML</li>
                </ul>
              </div>
              <Button asChild className="w-full mt-8" variant="outline">
                <Link to="/billing">Contact Sales</Link>
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* SECTION 6: FAQ Accordion */}
      <section id="faq" className="py-24">
        <div className="mx-auto max-w-4xl px-6">
          <div className="text-center">
            <span className="text-xs font-semibold uppercase tracking-wider text-primary">
              Got Questions?
            </span>
            <h2 className="mt-2 font-display text-3xl sm:text-4xl font-bold">
              Frequently Asked Questions
            </h2>
          </div>

          <div className="mt-12 space-y-3">
            {faqs.map((faq, idx) => {
              const isOpen = openFaq === idx;
              return (
                <div
                  key={idx}
                  className="rounded-2xl border border-night-border bg-night-soft/40 transition overflow-hidden"
                >
                  <button
                    onClick={() => setOpenFaq(isOpen ? null : idx)}
                    className="flex w-full items-center justify-between p-5 text-left font-display text-sm sm:text-base font-semibold text-night-foreground hover:text-primary cursor-pointer"
                  >
                    <span>{faq.q}</span>
                    <ChevronDown
                      className={`h-4 w-4 shrink-0 transition-transform ${isOpen ? "rotate-180 text-primary" : "text-night-muted"}`}
                    />
                  </button>
                  {isOpen && (
                    <div className="border-t border-night-border/60 p-5 pt-3 text-xs sm:text-sm leading-relaxed text-night-muted">
                      {faq.a}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Call to Action Banner */}
      <section className="border-t border-night-border/80 bg-gradient-to-b from-night to-night-soft/80 py-20 text-center">
        <div className="mx-auto max-w-4xl px-6">
          <h2 className="font-display text-3xl sm:text-5xl font-extrabold tracking-tight">
            Ready to ship software at the speed of thought?
          </h2>
          <p className="mt-4 text-base text-night-muted">
            Launch your 9-agent engineering workforce today. No credit card required.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-4">
            <Button asChild size="lg" className="bg-primary hover:bg-primary/90 text-sm font-semibold shadow-glow px-8">
              <Link to="/signup">
                Create Free Account <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
            <Button
              size="lg"
              variant="outline"
              onClick={handleQuickDemo}
              disabled={isDemoLoading}
              className="border-night-border bg-white/5 hover:bg-white/10 text-sm font-semibold cursor-pointer"
            >
              <Zap className="mr-2 h-4 w-4 text-primary fill-primary" /> Instant 1-Click Demo
            </Button>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-night-border bg-black/40 py-12 text-xs text-night-muted">
        <div className="mx-auto max-w-7xl px-6 flex flex-col sm:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-3">
            <HelixLogo tone="night" />
            <span className="text-night-border">|</span>
            <span>The AI Engineering Operating System</span>
          </div>

          <div className="flex items-center gap-6">
            <Link to="/office" className="hover:text-night-foreground">AI Office</Link>
            <Link to="/dashboard" className="hover:text-night-foreground">Dashboard</Link>
            <Link to="/login" className="hover:text-night-foreground">Sign In</Link>
            <Link to="/signup" className="hover:text-night-foreground">Sign Up</Link>
          </div>

          <div className="flex items-center gap-2 text-[11px] text-emerald-400">
            <span className="h-2 w-2 rounded-full bg-emerald-400" />
            <span>All 9 Agents Operational</span>
          </div>
        </div>
        <div className="mx-auto max-w-7xl px-6 mt-8 pt-6 border-t border-night-border/40 text-center text-[11px] text-night-muted/60">
          © {new Date().getFullYear()} HELIX. Built for ambitious engineering teams.
        </div>
      </footer>
    </div>
  );
}

