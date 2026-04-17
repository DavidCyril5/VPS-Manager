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
import NotFound from "@/pages/not-found";

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
