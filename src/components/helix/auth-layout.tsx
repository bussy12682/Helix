import type { ReactNode } from "react";

import { HelixLogo, HelixMark } from "./logo";

export function AuthLayout({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
  footer: ReactNode;
}) {
  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="flex flex-col px-6 py-8 sm:px-12">
        <HelixLogo />
        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-10">
          <h1 className="text-2xl font-semibold">{title}</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">{subtitle}</p>
          <div className="mt-7">{children}</div>
          <div className="mt-6 text-center text-sm text-muted-foreground">{footer}</div>
        </div>
      </div>

      <div className="relative hidden grid-glow surface-night flex-col justify-between p-12 lg:flex">
        <div className="flex items-center gap-2 text-sm text-night-muted">
          <HelixMark className="h-5 w-5" />
          The complete AI software engineering platform
        </div>
        <div className="max-w-md">
          <p className="font-display text-3xl font-bold leading-tight">
            A full engineering office of AI agents, working while you describe.
          </p>
          <ul className="mt-8 space-y-4 text-sm text-night-muted">
            {[
              "Architecture, backend, frontend, QA and security agents in one room",
              "Live task assignment you can watch and redirect",
              "Deploys, monitoring and dependency upkeep handled continuously",
            ].map((item) => (
              <li key={item} className="flex gap-3">
                <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                {item}
              </li>
            ))}
          </ul>
        </div>
        <p className="text-xs text-night-muted">
          Trusted with 40M+ generated lines of production code.
        </p>
      </div>
    </div>
  );
}
