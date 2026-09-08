import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowRight,
  Bot,
  Cloud,
  Layers,
  Mic,
  PlayCircle,
  RefreshCw,
  ShieldCheck,
  Workflow,
} from "lucide-react";

import { HelixLogo, HelixMark } from "@/components/helix/logo";
import heroVisual from "@/assets/helix-hero.jpg";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "HELIX — Build Software at the Speed of Thought" },
      {
        name: "description",
        content:
          "HELIX is an AI engineering office: plan, build, test, secure, deploy and maintain production software from a single description.",
      },
      { property: "og:title", content: "HELIX — Build Software at the Speed of Thought" },
      {
        property: "og:description",
        content:
          "An entire office of AI engineers that ships and maintains production software for you.",
      },
    ],
  }),
  component: Landing,
});

const pillars = [
  { icon: Bot, title: "AI Engineering Office", copy: "Nine specialised agents with a PM that assigns and reviews their work." },
  { icon: Workflow, title: "Smart Automation", copy: "Requirements become architecture, schema, code, tests and pipelines." },
  { icon: ShieldCheck, title: "Security Guardian", copy: "Continuous threat review baked into every build, not bolted on." },
  { icon: Cloud, title: "Cloud Connect", copy: "GitHub, databases, hosting and payments wired in one click." },
  { icon: RefreshCw, title: "Always Improving", copy: "Dependency upkeep, monitoring and self-healing maintenance." },
];

const flow = [
  "You describe",
  "AI analyses",
  "AI builds",
  "AI tests",
  "AI deploys",
  "AI maintains",
  "AI secures",
];

function Landing() {
  return (
    <div className="surface-night min-h-screen">
      <header className="grid-glow border-b border-night-border">
        <div className="mx-auto flex max-w-6xl items-center gap-6 px-6 py-5">
          <HelixLogo tone="night" />
          <nav className="hidden flex-1 items-center gap-6 text-sm text-night-muted md:flex">
            <a href="#pillars" className="hover:text-night-foreground">Product</a>
            <a href="#flow" className="hover:text-night-foreground">Solutions</a>
            <a href="#pricing" className="hover:text-night-foreground">Pricing</a>
            <Link to="/office" className="hover:text-night-foreground">Docs</Link>
            <Link to="/dashboard" className="hover:text-night-foreground">Company</Link>
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <Button asChild variant="ghost" className="text-night-muted hover:bg-white/5 hover:text-night-foreground">
              <Link to="/login">Log in</Link>
            </Button>
            <Button asChild>
              <Link to="/signup">Get Started</Link>
            </Button>
          </div>
        </div>

        <div className="mx-auto grid max-w-6xl items-center gap-10 px-6 pb-20 pt-12 lg:grid-cols-[1.05fr_1fr]">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full border border-night-border px-3 py-1 text-xs text-night-muted">
              <HelixMark className="h-3.5 w-3.5" /> HELIX V1 · now in open beta
            </span>
            <h1 className="mt-6 font-display text-5xl font-bold leading-[1.05] sm:text-6xl">
              Build Software at the{" "}
              <span className="text-gradient">Speed of Thought.</span>
            </h1>
            <p className="mt-5 max-w-md text-night-muted">
              Plan, build, secure, deploy and maintain production-ready software with
              your AI engineering team — from one conversation.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button asChild size="lg">
                <Link to="/signup">
                  Get Started Free <ArrowRight className="ml-1.5 h-4 w-4" />
                </Link>
              </Button>
              <Button
                asChild
                size="lg"
                variant="outline"
                className="border-night-border bg-transparent text-night-foreground hover:bg-white/5"
              >
                <Link to="/call">
                  <PlayCircle className="mr-1.5 h-4 w-4" /> Watch Demo
                </Link>
              </Button>
            </div>
            <p className="mt-4 text-xs text-night-muted">
              No credit card required · Free 14-day trial
            </p>
          </div>

          <div className="relative">
            <img
              src={heroVisual}
              alt="Abstract violet data helix representing HELIX AI agents collaborating"
              className="w-full rounded-3xl border border-night-border shadow-glow"
              loading="eager"
            />
          </div>
        </div>

        <div id="pillars" className="mx-auto grid max-w-6xl gap-6 border-t border-night-border px-6 py-10 sm:grid-cols-3 lg:grid-cols-5">
          {pillars.map((p) => (
            <div key={p.title}>
              <p.icon className="h-5 w-5 text-primary" />
              <h2 className="mt-3 text-sm font-semibold">{p.title}</h2>
              <p className="mt-1.5 text-xs leading-relaxed text-night-muted">{p.copy}</p>
            </div>
          ))}
        </div>
      </header>

      <section id="flow" className="mx-auto max-w-6xl px-6 py-20">
        <h2 className="max-w-lg font-display text-3xl font-bold">
          One description in. A maintained product out.
        </h2>
        <div className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-7">
          {flow.map((step, i) => (
            <div
              key={step}
              className="rounded-xl border border-night-border bg-night-soft/60 p-4"
            >
              <span className="font-display text-xs text-primary">
                0{i + 1}
              </span>
              <p className="mt-2 text-sm font-medium">{step}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="pricing" className="mx-auto max-w-6xl px-6 pb-24">
        <div className="rounded-3xl border border-night-border bg-night-soft/60 p-10">
          <div className="flex flex-wrap items-end gap-8">
            <div className="flex-1">
              <h2 className="font-display text-3xl font-bold">Pro — $49/month</h2>
              <p className="mt-2 max-w-md text-sm text-night-muted">
                Unlimited projects, all nine agents, staging and production deploys,
                continuous security review and dependency maintenance.
              </p>
            </div>
            <div className="flex gap-3">
              <Button asChild size="lg">
                <Link to="/signup">Start free trial</Link>
              </Button>
              <Button
                asChild
                size="lg"
                variant="outline"
                className="border-night-border bg-transparent text-night-foreground hover:bg-white/5"
              >
                <Link to="/billing">See plan details</Link>
              </Button>
            </div>
          </div>
        </div>
      </section>

      <footer className="border-t border-night-border">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-4 px-6 py-8 text-xs text-night-muted">
          <span className="flex items-center gap-2 font-display text-sm font-bold text-night-foreground">
            <Layers className="h-4 w-4 text-primary" /> HELIX
          </span>
          <span>The complete AI software engineering platform</span>
          <span className="ml-auto flex items-center gap-2">
            <Mic className="h-3.5 w-3.5" /> Talk to HELIX any time
          </span>
        </div>
      </footer>
    </div>
  );
}
