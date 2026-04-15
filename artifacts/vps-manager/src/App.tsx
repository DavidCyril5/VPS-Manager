import { useState, useEffect } from "react";
import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Layout } from "@/components/layout";
import Dashboard from "@/pages/dashboard";
import Servers from "@/pages/servers";
import ServerDetail from "@/pages/server-detail";
import Sites from "@/pages/sites";
import CloudflarePage from "@/pages/cloudflare";
import ActivityPage from "@/pages/activity";
import TerminalPage from "@/pages/terminal";
import SettingsPage from "@/pages/settings";
import LoginPage from "@/pages/login";
import NotFound from "@/pages/not-found";
import { setAuthTokenGetter } from "@workspace/api-client-react";

setAuthTokenGetter(() => localStorage.getItem("vpm-token"));

const queryClient = new QueryClient();

function Router() {
  return (
    <Layout>
      <Switch>
        <Route path="/" component={Dashboard} />
        <Route path="/servers" component={Servers} />
        <Route path="/servers/:id" component={ServerDetail} />
        <Route path="/sites" component={Sites} />
        <Route path="/cloudflare" component={CloudflarePage} />
        <Route path="/activity" component={ActivityPage} />
        <Route path="/terminal" component={TerminalPage} />
        <Route path="/settings" component={SettingsPage} />
        <Route component={NotFound} />
      </Switch>
    </Layout>
  );
}

function App() {
  const base = import.meta.env.BASE_URL.replace(/\/$/, "");
  const [authState, setAuthState] = useState<"loading" | "ok" | "required">("loading");

  useEffect(() => {
    const token = localStorage.getItem("vpm-token") ?? "";
    fetch(`${base}/api/auth/check`, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then((r) => r.json())
      .then((d: { required: boolean; valid?: boolean }) => {
        if (!d.required) { setAuthState("ok"); return; }
        if (d.valid) { setAuthState("ok"); return; }
        setAuthState("required");
      })
      .catch(() => setAuthState("ok"));
  }, []);

  function handleLogin(token: string) {
    localStorage.setItem("vpm-token", token);
    setAuthState("ok");
  }

  if (authState === "loading") {
    return (
      <div className="min-h-screen dark bg-background flex items-center justify-center">
        <div className="text-muted-foreground text-sm">Loading...</div>
      </div>
    );
  }

  if (authState === "required") {
    return (
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <LoginPage onLogin={handleLogin} />
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    );
  }

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
