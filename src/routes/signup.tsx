import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Github } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { AuthLayout } from "@/components/helix/auth-layout";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { ApiRequestError, registerUser, setStoredSessionToken, initiateGoogleOAuth, initiateGitHubOAuth, validatePasswordComplexity } from "@/lib/api";

function GoogleLogo(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg {...props} viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
    </svg>
  );
}

export const Route = createFileRoute("/signup")({
  head: () => ({
    meta: [
      { title: "Create your HELIX account" },
      {
        name: "description",
        content: "Start building with your AI engineering team. Free 14-day trial, no card required.",
      },
      { property: "og:title", content: "Create your HELIX account" },
      { property: "og:description", content: "Start building with your AI engineering team." },
    ],
  }),
  component: SignUp,
});

function SignUp() {
  const [accepted, setAccepted] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [password, setPassword] = useState('');
  const [passwordValidation, setPasswordValidation] = useState(validatePasswordComplexity(''));
  const navigate = useNavigate();

  const handlePasswordChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newPassword = e.target.value;
    setPassword(newPassword);
    setPasswordValidation(validatePasswordComplexity(newPassword));
  };

  return (
    <AuthLayout
      title="Create your account"
      subtitle="Spin up your AI engineering office in under a minute."
      footer={
        <>
          Already have an account?{" "}
          <Link to="/login" className="font-medium text-primary hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <form
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          if (isSubmitting) return;
          if (!accepted) {
            toast.error("Please accept the Terms and Privacy Policy.");
            return;
          }

          const formData = new FormData(e.currentTarget);
          const payload = {
            name: String(formData.get('name') ?? '').trim(),
            email: String(formData.get('email') ?? '').trim(),
            password: String(formData.get('password') ?? ''),
          };

          if (!payload.name || !payload.email) {
            toast.error('Name and email are required.');
            return;
          }

          if (!passwordValidation.isValid) {
            toast.error('Password does not meet complexity requirements.');
            return;
          }

          setIsSubmitting(true);
          try {
            const result = await registerUser(payload);
            setStoredSessionToken(null);
            if (result.verificationEmailSent) {
              toast.success('Account created — check your email to verify.');
            } else if (result.verificationToken) {
              toast.success(`Account created. Your development verification token is ${result.verificationToken}`);
            } else {
              toast.error('Account created, but the verification email could not be sent.');
            }
            navigate({
              to: '/verify-email', 
              search: { email: payload.email, token: result.verificationToken }
            });
          } catch (error) {
            const message = error instanceof Error ? error.message : 'Registration failed.';
            const errorCode = error instanceof ApiRequestError ? error.code : '';
            if (errorCode === 'WEAK_PASSWORD' || message.includes('complexity')) {
              toast.error('Password does not meet complexity requirements.');
            } else if (errorCode === 'RATE_LIMITED') {
              toast.error('Too many signup attempts. Please try again later.');
            } else {
              toast.error(message);
            }
          } finally {
            setIsSubmitting(false);
          }
        }}
      >
        <div className="space-y-1.5">
          <Label htmlFor="name">Full name</Label>
          <Input id="name" name="name" placeholder="Enoch Fisayo" autoComplete="name" required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="email">Work email</Label>
          <Input id="email" name="email" type="email" placeholder="you@company.com" autoComplete="email" required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            name="password"
            type="password"
            placeholder="At least 10 characters"
            autoComplete="new-password"
            value={password}
            onChange={handlePasswordChange}
            required
            className={password && !passwordValidation.isValid ? 'border-red-500' : ''}
          />
          {password && (
            <div className="text-xs space-y-1">
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">Strength:</span>
                <span className={`font-semibold ${
                  passwordValidation.strength === 'weak' ? 'text-red-500' :
                  passwordValidation.strength === 'fair' ? 'text-yellow-500' :
                  passwordValidation.strength === 'good' ? 'text-blue-500' :
                  'text-green-500'
                }`}>
                  {passwordValidation.strength.charAt(0).toUpperCase() + passwordValidation.strength.slice(1)}
                </span>
              </div>
              {passwordValidation.errors.length > 0 && (
                <ul className="text-red-500 list-disc list-inside">
                  {passwordValidation.errors.map((error, i) => (
                    <li key={i}>{error}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
        <label className="flex items-start gap-2.5 text-xs text-muted-foreground">
          <Checkbox
            checked={accepted}
            onCheckedChange={(v) => setAccepted(v === true)}
            aria-label="Accept terms"
          />
          I agree to the Terms of Service and Privacy Policy.
        </label>
        <Button type="submit" className="w-full" disabled={isSubmitting}>
          {isSubmitting ? 'Creating account...' : 'Create account'}
        </Button>
      </form>

      <div className="my-6 flex items-center gap-3 text-xs text-muted-foreground">
        <Separator className="flex-1" /> or continue with <Separator className="flex-1" />
      </div>

      <div className="space-y-2">
        <Button 
          variant="outline" 
          className="w-full" 
          onClick={async () => {
            const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
            if (!clientId || clientId === 'your-google-client-id-here' || clientId === 'demo-client-id') {
              toast.error('Google OAuth is not configured. Please use email/password signup.');
              return;
            }
            try {
              await initiateGoogleOAuth();
            } catch (error) {
              toast.error(error instanceof Error ? error.message : "Google sign-up failed");
            }
          }}
        >
          <GoogleLogo className="mr-2 h-4 w-4" /> Continue with Google
        </Button>
        <Button 
          variant="outline" 
          className="w-full" 
          onClick={async () => {
            const clientId = import.meta.env.VITE_GITHUB_CLIENT_ID;
            if (!clientId || clientId === 'your-github-client-id-here' || clientId === 'demo-client-id') {
              toast.error('GitHub OAuth is not configured. Please use email/password signup.');
              return;
            }
            try {
              await initiateGitHubOAuth();
            } catch (error) {
              toast.error(error instanceof Error ? error.message : "GitHub sign-up failed");
            }
          }}
        >
          <Github className="mr-2 h-4 w-4" /> Continue with GitHub
        </Button>
      </div>
    </AuthLayout>
  );
}
