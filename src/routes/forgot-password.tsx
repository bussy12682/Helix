import { createFileRoute, Link, useSearch } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { AuthLayout } from "@/components/helix/auth-layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { requestPasswordReset, resetPassword, validatePasswordComplexity } from "@/lib/api";

export const Route = createFileRoute("/forgot-password")({
  head: () => ({
    meta: [
      { title: "Reset your password - HELIX" },
      { name: "description", content: "Reset your HELIX account password." },
      { property: "og:title", content: "Reset your password" },
    ],
  }),
  component: ForgotPassword,
});

function ForgotPassword() {
  const search = useSearch({ strict: false }) as { token?: string };
  const [step, setStep] = useState<'email' | 'reset'>('email');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [email, setEmail] = useState('');
  const [resetToken, setResetToken] = useState(search.token ?? '');
  const [password, setPassword] = useState('');
  const passwordValidation = validatePasswordComplexity(password);

  useEffect(() => {
    if (search.token) {
      setResetToken(search.token);
      setStep('reset');
    }
  }, [search.token]);

  return (
    <AuthLayout
      title={step === 'email' ? 'Reset your password' : 'Create new password'}
      subtitle={step === 'email' 
        ? "Enter your email address and we'll send you a link to reset your password." 
        : 'Enter a new password for your account.'}
      footer={
        <>
          Remember your password?{" "}
          <Link to="/login" className="font-medium text-primary hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      {step === 'email' ? (
        <form
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            
            if (!email.trim()) {
              toast.error('Please enter your email address.');
              return;
            }

            setIsSubmitting(true);
            try {
              await requestPasswordReset(email);
              toast.success('Check your email for a password reset link.');
            } catch (error) {
              toast.error(error instanceof Error ? error.message : 'Failed to send reset email.');
            } finally {
              setIsSubmitting(false);
            }
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="email">Email</Label>
            <Input 
              id="email" 
              type="email" 
              placeholder="you@company.com" 
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email" 
              required 
            />
          </div>
          <Button type="submit" className="w-full" disabled={isSubmitting}>
            {isSubmitting ? 'Sending email...' : 'Send reset link'}
          </Button>
        </form>
      ) : (
        <form
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();

            const formData = new FormData(e.currentTarget);
            const token = String(formData.get('token') ?? '').trim();
            const nextPassword = String(formData.get('password') ?? '');
            const confirmPassword = String(formData.get('confirmPassword') ?? '');

            if (!validatePasswordComplexity(nextPassword).isValid) {
              toast.error('Password does not meet complexity requirements.');
              return;
            }

            if (nextPassword !== confirmPassword) {
              toast.error('Passwords do not match.');
              return;
            }

            if (!token) {
              toast.error('Reset token is required.');
              return;
            }

            setIsSubmitting(true);
            try {
              await resetPassword(token, nextPassword);
              toast.success('Your password has been reset. Redirecting to login...');
              setTimeout(() => {
                window.location.href = '/login';
              }, 2000);
            } catch (error) {
              toast.error(error instanceof Error ? error.message : 'Failed to reset password.');
            } finally {
              setIsSubmitting(false);
            }
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="token">Reset Token</Label>
            <Input
              id="token" 
              name="token"
              placeholder="Paste the token from your email" 
              value={resetToken}
              onChange={(e) => setResetToken(e.target.value)}
              required 
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="password">New Password</Label>
            <Input 
              id="password" 
              name="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 8 characters" 
              autoComplete="new-password" 
              required 
            />
          </div>
          {password && !passwordValidation.isValid && (
            <ul className="list-inside list-disc text-xs text-destructive">
              {passwordValidation.errors.map((error) => <li key={error}>{error}</li>)}
            </ul>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="confirmPassword">Confirm Password</Label>
            <Input 
              id="confirmPassword" 
              name="confirmPassword"
              type="password" 
              placeholder="Confirm your password" 
              autoComplete="new-password" 
              required 
            />
          </div>
          <Button type="submit" className="w-full" disabled={isSubmitting}>
            {isSubmitting ? 'Resetting password...' : 'Reset password'}
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}
