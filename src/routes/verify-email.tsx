import { createFileRoute, Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { AuthLayout } from "@/components/helix/auth-layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { verifyEmail } from "@/lib/api";

export const Route = createFileRoute("/verify-email")({
  head: () => ({
    meta: [
      { title: "Verify your email - HELIX" },
      { name: "description", content: "Verify your email to activate your HELIX account." },
      { property: "og:title", content: "Verify your email" },
    ],
  }),
  component: VerifyEmail,
});

function VerifyEmail() {
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as { email?: string; token?: string };
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isVerified, setIsVerified] = useState(false);
  const [verificationError, setVerificationError] = useState('');
  const [verificationToken, setVerificationToken] = useState(search.token ?? '');

  useEffect(() => {
    setVerificationToken(search.token ?? '');
  }, [search.token]);

  async function verifyNow(token: string) {
    if (!token) {
      toast.error('Verification token is required.');
      return;
    }

    setIsSubmitting(true);
    setVerificationError('');
    try {
      await verifyEmail(token);
      setIsVerified(true);
      toast.success('Email verified! You can now login.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Email verification failed.';
      setVerificationError(message);
      toast.error(message);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <AuthLayout
      title="Verify your email"
      subtitle={search.email 
        ? `We've sent a verification email to ${search.email}. Enter the verification token below.`
        : 'Enter the verification token from your email to activate your account.'}
      footer={
        <>
          Already verified?{" "}
          <Link to="/login" className="font-medium text-primary hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      {isVerified ? (
        <div className="space-y-4">
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
            Your email is verified. You can sign in to continue.
          </div>
          <Button asChild className="w-full">
            <Link to="/login">Continue to sign in</Link>
          </Button>
        </div>
      ) : (
        <form
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            await verifyNow(verificationToken);
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="token">Verification token</Label>
            <Input
              id="token"
              placeholder="Paste the token from your email"
              value={verificationToken}
              onChange={(e) => setVerificationToken(e.target.value)}
              aria-invalid={Boolean(verificationError)}
              required
            />
            <p className="text-xs text-muted-foreground">
              {search.email ? `Check ${search.email} for the verification link.` : 'Use the verification link from your email.'}
            </p>
            {verificationError && <p className="text-xs text-destructive">{verificationError}</p>}
          </div>
          <Button type="submit" className="w-full" disabled={isSubmitting}>
            {isSubmitting ? 'Verifying...' : 'Verify email'}
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}
