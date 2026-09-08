import { createFileRoute, useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect } from "react";
import { toast } from "sonner";

import { setStoredSessionToken, completeGitHubOAuth } from "@/lib/api";

export const Route = createFileRoute("/auth/github/callback")({
  head: () => ({
    meta: [
      { title: "Completing GitHub sign-in..." },
    ],
  }),
  component: GitHubCallback,
});

function GitHubCallback() {
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as { code?: string; state?: string; error?: string };

  useEffect(() => {
    (async () => {
      if (search.error) {
        toast.error(search.error);
        navigate({ to: '/login' });
        return;
      }

      if (!search.code || !search.state) {
        toast.error('Missing authorization code or state');
        navigate({ to: '/login' });
        return;
      }

      try {
        const session = await completeGitHubOAuth(search.code, search.state);
        setStoredSessionToken(session.token);
        toast.success('Signed in with GitHub — loading your dashboard.');
        navigate({ to: '/dashboard' });
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Failed to complete GitHub sign-in');
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
