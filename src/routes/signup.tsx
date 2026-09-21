import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Check, Eye, EyeOff, Github, Sparkles, X } from "lucide-react";
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
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [passwordValidation, setPasswordValidation] = useState(validatePasswordComplexity(""));
  const navigate = useNavigate();

  const handlePasswordChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newPassword = e.target.value;
    setPassword(newPassword);
    setPasswordValidation(validatePasswordComplexity(newPassword));
  };

  const fillDemoDetails = () => {
    const rand = Math.floor(1000 + Math.random() * 9000);
    setName("Demo Engineer");
    setEmail(`engineer.${rand}@helix.dev`);
    const demoPw = "Helix2026!Dev";
    setPassword(demoPw);
    setPasswordValidation(validatePasswordComplexity(demoPw));
    setAccepted(true);
    toast.info("Demo details generated & filled.");
  };

  // Live checklist criteria
  const hasMinLen = password.length >= 8;
  const hasUpper = /[A-Z]/.test(password);
  const hasLower = /[a-z]/.test(password);
  const hasNumber = /[0-9]/.test(password);
  const hasSpecial = /[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(password);

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
      <div className="mb-4 flex items-center justify-between rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-xs">
        <span className="text-muted-foreground flex items-center gap-1.5">
          <Sparkles className="h-3.5 w-3.5 text-primary" /> Quick test mode?
        </span>
        <button
          type="button"
          onClick={fillDemoDetails}
          className="font-medium text-primary hover:underline cursor-pointer"
        >
          Fill Demo Details
        </button>
      </div>

      <form
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          if (isSubmitting) return;
          if (!accepted) {
            toast.error("Please accept the Terms and Privacy Policy.");
            return;
          }

          const payload = {
            name: name.trim(),
            email: email.trim(),
            password: password,
          };

          if (!payload.name || !payload.email) {
            toast.error("Name and email are required.");
            return;
          }

          if (!passwordValidation.isValid) {
            toast.error("Password does not meet complexity requirements.");
            return;
          }

          setIsSubmitting(true);
          try {
            const result = await registerUser(payload);
            setStoredSessionToken(null);
            if (result.verificationEmailSent) {
              toast.success("Account created — check your email to verify.");
            } else if (result.verificationToken) {
              toast.success(`Account created! Token: ${result.verificationToken}`);
            } else {
              toast.success("Account created successfully!");
            }
            navigate({
              to: "/verify-email", 
              search: { email: payload.email, token: result.verificationToken }
            });
          } catch (error) {
            const message = error instanceof Error ? error.message : "Registration failed.";
            const errorCode = error instanceof ApiRequestError ? error.code : "";
            if (errorCode === "WEAK_PASSWORD" || message.includes("complexity")) {
              toast.error("Password does not meet complexity requirements.");
            } else if (errorCode === "USER_EXISTS") {
              toast.error("An account with this email already exists. Please sign in.");
            } else if (errorCode === "RATE_LIMITED") {
              toast.error("Too many signup attempts. Please try again later.");
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
          <Input
            id="name"
            name="name"
            placeholder="Enoch Fisayo"
            autoComplete="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="email">Work email</Label>
          <Input
            id="email"
            name="email"
            type="email"
            placeholder="you@company.com"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="password">Password</Label>
          <div className="relative">
            <Input
              id="password"
              name="password"
              type={showPassword ? "text" : "password"}
              placeholder="At least 8 characters"
              autoComplete="new-password"
              value={password}
              onChange={handlePasswordChange}
              required
              className="pr-10"
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground cursor-pointer"
              aria-label={showPassword ? "Hide password" : "Show password"}
            >
              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>

          {/* Real-time visual password requirements */}
          <div className="mt-2 space-y-1.5 rounded-lg border border-border/60 bg-muted/30 p-2.5 text-xs">
            <div className="flex items-center justify-between pb-1 border-b border-border/40">
              <span className="text-muted-foreground">Password strength:</span>
              <span className={`font-semibold capitalize ${
                passwordValidation.strength === 'weak' ? 'text-destructive' :
                passwordValidation.strength === 'fair' ? 'text-amber-500' :
                passwordValidation.strength === 'good' ? 'text-blue-500' :
                'text-emerald-500'
              }`}>
                {password ? passwordValidation.strength : "Not entered"}
              </span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 text-[11px] pt-1">
              <span className={`flex items-center gap-1.5 ${hasMinLen ? 'text-emerald-600 dark:text-emerald-400 font-medium' : 'text-muted-foreground'}`}>
                {hasMinLen ? <Check className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5 text-muted-foreground/60" />} 8+ characters
              </span>
              <span className={`flex items-center gap-1.5 ${hasUpper ? 'text-emerald-600 dark:text-emerald-400 font-medium' : 'text-muted-foreground'}`}>
                {hasUpper ? <Check className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5 text-muted-foreground/60" />} Uppercase letter (A-Z)
              </span>
              <span className={`flex items-center gap-1.5 ${hasLower ? 'text-emerald-600 dark:text-emerald-400 font-medium' : 'text-muted-foreground'}`}>
                {hasLower ? <Check className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5 text-muted-foreground/60" />} Lowercase letter (a-z)
              </span>
              <span className={`flex items-center gap-1.5 ${hasNumber ? 'text-emerald-600 dark:text-emerald-400 font-medium' : 'text-muted-foreground'}`}>
                {hasNumber ? <Check className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5 text-muted-foreground/60" />} Number (0-9)
              </span>
              <span className={`col-span-1 sm:col-span-2 flex items-center gap-1.5 ${hasSpecial ? 'text-emerald-600 dark:text-emerald-400 font-medium' : 'text-muted-foreground'}`}>
                {hasSpecial ? <Check className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5 text-muted-foreground/60" />} Special character (!@#$%...)
              </span>
            </div>
          </div>
        </div>

        <label className="flex items-start gap-2.5 text-xs text-muted-foreground cursor-pointer">
          <Checkbox
            checked={accepted}
            onCheckedChange={(v) => setAccepted(v === true)}
            aria-label="Accept terms"
          />
          I agree to the Terms of Service and Privacy Policy.
        </label>

        <Button type="submit" className="w-full" disabled={isSubmitting}>
          {isSubmitting ? "Creating account..." : "Create account"}
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
            if (!clientId || clientId === "your-google-client-id-here" || clientId === "demo-client-id") {
              toast.error("Google OAuth is not configured. Please use email/password signup.");
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
            if (!clientId || clientId === "your-github-client-id-here" || clientId === "demo-client-id") {
              toast.error("GitHub OAuth is not configured. Please use email/password signup.");
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
