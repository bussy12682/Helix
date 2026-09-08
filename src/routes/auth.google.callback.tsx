import { createFileRoute, useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { setStoredSessionToken, completeGoogleOAuth } from "@/lib/api";

export const Route = createFileRoute("/auth/google/callback")({
  head: () => ({
    meta: [
      { title: "Completing Google sign-in..." },
    ],
  }),
  component: GoogleCallback,
});

function GoogleCallback() {
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as { code?: string; state?: string; error?: string };

  useEffect(() => {
    (async () => {
      if (search.error) {
        toast.error(search.error);
        navigate({ to: '/login' });
        return;
      }

      if (!search.code) {
        toast.error('No authorization code received');
        navigate({ to: '/login' });
        return;
      }

      try {
        const session = await completeGoogleOAuth(search.code);
        setStoredSessionToken(session.token);
        toast.success('Signed in with Google — loading your dashboard.');
        navigate({ to: '/dashboard' });
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Failed to complete Google sign-in');
        navigate({ to: '/login' });
      }
    })();
  }, [search, navigate]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="text-center">
        <h2 className="mb-2 text-lg font-semibold">Completing your sign-in...</h2>
        <p className="text-sm text-muted-foreground">Please wait while we set up your account.</p>
      </div>
    </div>
  );
}
