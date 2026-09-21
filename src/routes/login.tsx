import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Eye, EyeOff, Github, Sparkles, Zap } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { AuthLayout } from "@/components/helix/auth-layout";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { ApiRequestError, demoLogin, loginUser, setStoredSessionToken, initiateGoogleOAuth, initiateGitHubOAuth } from "@/lib/api";

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

export const Route = createFileRoute("/login")({
  head: () => ({
    meta: [
      { title: "Sign in to HELIX" },
      { name: "description", content: "Welcome back. Sign in to your HELIX engineering office." },
      { property: "og:title", content: "Sign in to HELIX" },
      { property: "og:description", content: "Access your projects, agents and deployments." },
    ],
  }),
  component: Login,
});

function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDemoSubmitting, setIsDemoSubmitting] = useState(false);
  const navigate = useNavigate();

  async function handleDemoSignIn() {
    setIsDemoSubmitting(true);
    try {
      const session = await demoLogin();
      setStoredSessionToken(session.token);
      toast.success("Signed in as Demo Engineer! Loading office...");
      navigate({ to: "/dashboard" });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Demo sign in failed.");
    } finally {
      setIsDemoSubmitting(false);
    }
  }

  function fillDemoCredentials() {
    setEmail("demo@helix.app");
    setPassword("HelixDemo2026!");
    toast.info("Demo credentials loaded.");
  }

  return (
    <AuthLayout
      title="Welcome back 👋"
      subtitle="Sign in to your account to rejoin your AI engineering workforce."
      footer={
        <>
          Don't have an account?{" "}
          <Link to="/signup" className="font-medium text-primary hover:underline">
            Sign up
          </Link>
        </>
      }
    >
      {/* 1-Click Instant Demo Access Box */}
      <div className="mb-5 rounded-xl border border-primary/25 bg-primary/5 p-3.5 text-center">
        <div className="flex items-center justify-between gap-2">
          <div className="text-left">
            <p className="text-xs font-semibold text-primary flex items-center gap-1.5">
              <Sparkles className="h-3.5 w-3.5" /> Testing or evaluating HELIX?
            </p>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Jump straight into the active engineering office without passwords.
            </p>
          </div>
          <Button
            type="button"
            size="sm"
            variant="default"
            disabled={isDemoSubmitting || isSubmitting}
            onClick={handleDemoSignIn}
            className="shrink-0 font-medium text-xs bg-primary hover:bg-primary/90 shadow-sm"
          >
            {isDemoSubmitting ? "Entering..." : (
              <span className="flex items-center gap-1">
                <Zap className="h-3.5 w-3.5 fill-current" /> Demo Login
              </span>
            )}
          </Button>
        </div>
      </div>

      <form
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          if (isSubmitting) return;

          const payload = {
            email: email.trim(),
            password: password,
            rememberMe,
          };

          if (!payload.email || !payload.password) {
            toast.error("Please enter your email and password.");
            return;
          }

          setIsSubmitting(true);
          try {
            const session = await loginUser(payload);
            setStoredSessionToken(session.token);
            toast.success("Signed in — loading your dashboard.");
            navigate({ to: "/dashboard" });
          } catch (error) {
            const message = error instanceof Error ? error.message : "Login failed.";
            const errorCode = error instanceof ApiRequestError ? error.code : "";
            const verificationToken = error instanceof ApiRequestError
              ? error.verificationToken
              : undefined;
            if (errorCode === "EMAIL_NOT_VERIFIED" || message.includes("verify your email")) {
              toast.error("Please verify your email before logging in.");
              navigate({ 
                to: "/verify-email", 
                search: { email: payload.email, token: verificationToken }
              });
            } else if (errorCode === "RATE_LIMITED") {
              toast.error("Too many login attempts. Please try again later.");
            } else {
              toast.error(message);
            }
          } finally {
            setIsSubmitting(false);
          }
        }}
      >
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label htmlFor="email">Email</Label>
            <button
              type="button"
              onClick={fillDemoCredentials}
              className="text-[11px] text-primary hover:underline cursor-pointer"
            >
              Fill demo credentials
            </button>
          </div>
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
          <div className="flex items-center justify-between">
            <Label htmlFor="password">Password</Label>
            <Link to="/forgot-password" className="text-xs text-primary hover:underline">
              Forgot password?
            </Link>
          </div>
          <div className="relative">
            <Input
              id="password"
              name="password"
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
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
        </div>

        <label className="flex items-center gap-2.5 text-xs text-muted-foreground cursor-pointer">
          <Checkbox
            checked={rememberMe}
            onCheckedChange={(v) => setRememberMe(v === true)}
            aria-label="Remember me"
          />
          Remember me for 30 days
        </label>

        <Button type="submit" className="w-full" disabled={isSubmitting || isDemoSubmitting}>
          {isSubmitting ? "Signing in..." : "Sign in"}
        </Button>
      </form>

      <div className="my-6 flex items-center gap-3 text-xs text-muted-foreground">
        <Separator className="flex-1" /> or <Separator className="flex-1" />
      </div>

      <div className="space-y-2">
        <Button 
          variant="outline" 
          className="w-full"
          onClick={async () => {
            const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
            if (!clientId || clientId === "your-google-client-id-here" || clientId === "demo-client-id") {
              toast.error("Google OAuth is not configured. Please use email/password or Demo Login.");
              return;
            }
            try {
              await initiateGoogleOAuth();
            } catch (error) {
              toast.error(error instanceof Error ? error.message : "Google sign-in failed");
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
              toast.error("GitHub OAuth is not configured. Please use email/password or Demo Login.");
              return;
            }
            try {
              await initiateGitHubOAuth();
            } catch (error) {
              toast.error(error instanceof Error ? error.message : "GitHub sign-in failed");
            }
          }}
        >
          <Github className="mr-2 h-4 w-4" /> Continue with GitHub
        </Button>
      </div>

      <p className="mt-6 text-center text-xs text-muted-foreground">
        Prefer a tour first?{" "}
        <Link to="/office" className="text-primary hover:underline font-medium">
          Explore the live AI Office
        </Link>
      </p>
    </AuthLayout>
  );
}
