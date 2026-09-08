import { Link } from "@tanstack/react-router";
import {
  Activity,
  Bell,
  Boxes,
  CreditCard,
  LayoutDashboard,
  Plug,
  Rocket,
  Search,
  Settings,
  Shield,
  Users,
  Wrench,
} from "lucide-react";
import type { ReactNode } from "react";

import { HelixLogo } from "./logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const nav = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/projects", label: "Projects", icon: Boxes },
  { to: "/office", label: "AI Office", icon: Users },
  { to: "/office/tasks", label: "Activity", icon: Activity },
  { to: "/integrations", label: "Integrations", icon: Plug },
  { to: "/deployments", label: "Deployments", icon: Rocket },
  { to: "/maintenance", label: "Maintenance", icon: Wrench },
  { to: "/security", label: "Security", icon: Shield },
  { to: "/billing", label: "Billing & Plan", icon: CreditCard },
  { to: "/settings", label: "Settings", icon: Settings },
] as const;

export function AppShell({
  title,
  subtitle,
  action,
  children,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto flex max-w-[1600px]">
        <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-sidebar-border bg-sidebar px-4 py-5 lg:flex">
          <HelixLogo />
          <nav className="mt-7 flex flex-1 flex-col gap-1">
            {nav.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                activeOptions={{ exact: item.to === "/office" }}
                className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium text-sidebar-foreground/80 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                activeProps={{
                  className:
                    "bg-sidebar-accent text-sidebar-accent-foreground font-semibold",
                }}
              >
                <item.icon className="h-4 w-4" />
                {item.label}
              </Link>
            ))}
          </nav>
          <div className="mt-4 flex items-center gap-3 rounded-xl border border-sidebar-border bg-card p-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
              EF
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">Enoch F.</p>
              <p className="truncate text-xs text-muted-foreground">Pro Plan</p>
            </div>
          </div>
        </aside>

        <div className="min-w-0 flex-1">
          <header className="sticky top-0 z-20 border-b border-border bg-background/85 backdrop-blur">
            <div className="flex flex-wrap items-center gap-3 px-5 py-4">
              <div className="min-w-0 flex-1">
                <h1 className="truncate text-xl font-semibold">{title}</h1>
                {subtitle ? (
                  <p className="truncate text-sm text-muted-foreground">{subtitle}</p>
                ) : null}
              </div>
              <div className="relative hidden md:block">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Search projects, agents…"
                  className="w-64 pl-9"
                  aria-label="Search"
                />
              </div>
              <Button variant="ghost" size="icon" aria-label="Notifications">
                <Bell className="h-4 w-4" />
              </Button>
              {action}
            </div>
            <div className="flex gap-1 overflow-x-auto px-3 pb-2 lg:hidden">
              {nav.map((item) => (
                <Link
                  key={item.to}
                  to={item.to}
                  className="whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-medium text-muted-foreground"
                  activeProps={{ className: "bg-accent text-accent-foreground" }}
                >
                  {item.label}
                </Link>
              ))}
            </div>
          </header>
          <main className="px-5 py-6">{children}</main>
        </div>
      </div>
    </div>
  );
}

export function Panel({
  title,
  description,
  action,
  className = "",
  children,
}: {
  title?: string;
  description?: string;
  action?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={`panel p-5 ${className}`}>
      {title ? (
        <header className="mb-4 flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold">{title}</h2>
            {description ? (
              <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
            ) : null}
          </div>
          {action}
        </header>
      ) : null}
      {children}
    </section>
  );
}

const toneMap = {
  working: "bg-primary/10 text-primary",
  queued: "bg-warning/15 text-warning-foreground",
  done: "bg-success/12 text-success",
  idle: "bg-muted text-muted-foreground",
  live: "bg-success/12 text-success",
  danger: "bg-destructive/10 text-destructive",
  info: "bg-info/12 text-info",
} as const;

export function StatusPill({
  tone = "info",
  children,
}: {
  tone?: keyof typeof toneMap;
  children: ReactNode;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${toneMap[tone]}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {children}
    </span>
  );
}

export function Meter({ value }: { value: number }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
      <div
        className="h-full rounded-full bg-primary transition-all"
        style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
      />
    </div>
  );
}
