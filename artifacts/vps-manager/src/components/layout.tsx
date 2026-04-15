import { useState } from "react";
import { Link, useLocation } from "wouter";
import { Server, Globe, Activity, Cloud, LayoutDashboard, TerminalSquare, Menu, X } from "lucide-react";

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const [open, setOpen] = useState(false);

  const nav = [
    { name: "Dashboard", href: "/", icon: LayoutDashboard },
    { name: "Servers", href: "/servers", icon: Server },
    { name: "Sites", href: "/sites", icon: Globe },
    { name: "Cloudflare", href: "/cloudflare", icon: Cloud },
    { name: "Terminal", href: "/terminal", icon: TerminalSquare },
    { name: "Activity", href: "/activity", icon: Activity },
  ];

  const NavLinks = () => (
    <>
      {nav.map((item) => {
        const active = location === item.href || (item.href !== "/" && location.startsWith(item.href));
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={() => setOpen(false)}
            className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
              active
                ? "bg-accent text-accent-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            }`}
          >
            <item.icon className="h-4 w-4 shrink-0" />
            {item.name}
          </Link>
        );
      })}
    </>
  );

  return (
    <div className="flex h-screen overflow-hidden dark">
      {/* ── Desktop sidebar ── */}
      <div className="hidden md:flex w-64 border-r bg-card flex-col shrink-0">
        <div className="h-14 flex items-center px-4 border-b">
          <span className="font-bold text-lg">VPS Manager</span>
        </div>
        <nav className="flex-1 overflow-y-auto p-4 space-y-1">
          <NavLinks />
        </nav>
      </div>

      {/* ── Mobile overlay backdrop ── */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/60 md:hidden"
          onClick={() => setOpen(false)}
        />
      )}

      {/* ── Mobile slide-in drawer ── */}
      <div
        className={`fixed inset-y-0 left-0 z-50 w-64 bg-card border-r flex flex-col transform transition-transform duration-200 md:hidden ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="h-14 flex items-center justify-between px-4 border-b">
          <span className="font-bold text-lg">VPS Manager</span>
          <button onClick={() => setOpen(false)} className="text-muted-foreground hover:text-foreground p-1">
            <X className="h-5 w-5" />
          </button>
        </div>
        <nav className="flex-1 overflow-y-auto p-4 space-y-1">
          <NavLinks />
        </nav>
      </div>

      {/* ── Main content ── */}
      <div className="flex-1 flex flex-col overflow-hidden bg-background min-w-0">
        {/* Mobile top bar */}
        <div className="md:hidden h-14 flex items-center gap-3 px-4 border-b bg-card shrink-0">
          <button
            onClick={() => setOpen(true)}
            className="text-muted-foreground hover:text-foreground p-1"
            aria-label="Open menu"
          >
            <Menu className="h-5 w-5" />
          </button>
          <span className="font-bold text-base">VPS Manager</span>
        </div>

        <main className="flex-1 overflow-y-auto p-4 md:p-8">
          <div className="max-w-6xl mx-auto">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
