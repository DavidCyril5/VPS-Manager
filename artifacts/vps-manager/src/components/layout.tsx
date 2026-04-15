import { Link, useLocation } from "wouter";
import { Server, Globe, Activity, Cloud, LayoutDashboard } from "lucide-react";

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();

  const nav = [
    { name: "Dashboard", href: "/", icon: LayoutDashboard },
    { name: "Servers", href: "/servers", icon: Server },
    { name: "Sites", href: "/sites", icon: Globe },
    { name: "Cloudflare", href: "/cloudflare", icon: Cloud },
    { name: "Activity", href: "/activity", icon: Activity },
  ];

  return (
    <div className="flex h-screen overflow-hidden dark">
      {/* Sidebar */}
      <div className="w-64 border-r bg-card flex flex-col">
        <div className="h-14 flex items-center px-4 border-b">
          <span className="font-bold text-lg">VPS Manager</span>
        </div>
        <nav className="flex-1 overflow-y-auto p-4 space-y-1">
          {nav.map((item) => {
            const active = location === item.href || (item.href !== "/" && location.startsWith(item.href));
            return (
              <Link key={item.href} href={item.href} className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors ${active ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}>
                <item.icon className="h-4 w-4" />
                {item.name}
              </Link>
            );
          })}
        </nav>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-hidden bg-background">
        <main className="flex-1 overflow-y-auto p-8">
          <div className="max-w-6xl mx-auto">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
