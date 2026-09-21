import { createFileRoute, Link, useNavigate, useSearch } from "@tanstack/react-router";
import { CheckCircle2, ShieldCheck, Sparkles } from "lucide-react";
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
  const [verificationError, setVerificationError] = useState("");
  const [verificationToken, setVerificationToken] = useState(search.token ?? "");

  useEffect(() => {
    if (search.token) {
      setVerificationToken(search.token);
    }
  }, [search.token]);

  async function verifyNow(token: string) {
    if (!token) {
      toast.error("Verification token is required.");
      return;
    }

    setIsSubmitting(true);
    setVerificationError("");
    try {
      await verifyEmail(token);
      setIsVerified(true);
      toast.success("Email verified successfully! You can now sign in.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Email verification failed.";
      setVerificationError(message);
      toast.error(message);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <AuthLayout
      title="Verify your email"
      subtitle={
        search.email
          ? `We've sent a verification code to ${search.email}. Enter your verification token below.`
          : "Enter the verification token from your email to activate your account."
      }
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
        <div className="space-y-4 text-center">
          <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-5 text-center">
            <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-500" />
            <h3 className="mt-3 text-base font-semibold text-foreground">Email verified!</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Your HELIX account is active. You can now log into your AI engineering office.
            </p>
          </div>
          <Button asChild className="w-full size-lg font-medium">
            <Link to="/login" search={{ email: search.email }}>
              Continue to Sign In
            </Link>
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
          {search.token && (
            <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 text-xs flex items-center justify-between">
              <span className="text-muted-foreground flex items-center gap-1.5">
                <Sparkles className="h-3.5 w-3.5 text-primary" /> Token detected from URL
              </span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                onClick={() => verifyNow(search.token!)}
                disabled={isSubmitting}
              >
                Instant Verify
              </Button>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="token">Verification token</Label>
            <Input
              id="token"
              placeholder="Paste token (e.g. verify_...)"
              value={verificationToken}
              onChange={(e) => setVerificationToken(e.target.value)}
              aria-invalid={Boolean(verificationError)}
              required
            />
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <ShieldCheck className="h-3.5 w-3.5 text-primary" />
              {search.email
                ? `Check ${search.email} for your activation code.`
                : "Enter the code generated when you registered."}
            </p>
            {verificationError && <p className="text-xs text-destructive">{verificationError}</p>}
          </div>

          <Button type="submit" className="w-full" disabled={isSubmitting}>
            {isSubmitting ? "Verifying..." : "Verify email"}
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}
