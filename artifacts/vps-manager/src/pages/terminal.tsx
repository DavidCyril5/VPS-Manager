import { useEffect, useRef, useState } from "react";
import { useListServers } from "@workspace/api-client-react";
import { Terminal as TerminalIcon, Server } from "lucide-react";

export default function TerminalPage() {
  const { data: servers } = useListServers();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [connected, setConnected] = useState(false);
  const [statusMsg, setStatusMsg] = useState("Select a server to open a terminal.");
  const termRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const terminalRef = useRef<import("xterm").Terminal | null>(null);
  const fitRef = useRef<import("@xterm/addon-fit").FitAddon | null>(null);

  useEffect(() => {
    if (!termRef.current) return;
    if (terminalRef.current) return;

    import("xterm").then(({ Terminal }) => {
      import("@xterm/addon-fit").then(({ FitAddon }) => {
        const term = new Terminal({
          theme: {
            background: "#0a0e1a",
            foreground: "#e2e8f0",
            cursor: "#7c3aed",
            selectionBackground: "#7c3aed44",
            black: "#1e293b",
            red: "#f87171",
            green: "#34d399",
            yellow: "#fbbf24",
            blue: "#60a5fa",
            magenta: "#a78bfa",
            cyan: "#22d3ee",
            white: "#e2e8f0",
            brightBlack: "#475569",
            brightRed: "#fc8181",
            brightGreen: "#6ee7b7",
            brightYellow: "#fcd34d",
            brightBlue: "#93c5fd",
            brightMagenta: "#c4b5fd",
            brightCyan: "#67e8f9",
            brightWhite: "#f8fafc",
          },
          fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
          fontSize: 13,
          lineHeight: 1.4,
          cursorBlink: true,
          cursorStyle: "block",
          scrollback: 5000,
        });

        const fitAddon = new FitAddon();
        term.loadAddon(fitAddon);
        term.open(termRef.current!);
        fitAddon.fit();

        terminalRef.current = term;
        fitRef.current = fitAddon;

        term.writeln("\x1b[2m# Select a server above to connect\x1b[0m");

        const onResize = () => {
          fitAddon.fit();
          if (wsRef.current?.readyState === WebSocket.OPEN && terminalRef.current) {
            wsRef.current.send(JSON.stringify({
              type: "resize",
              cols: terminalRef.current.cols,
              rows: terminalRef.current.rows,
            }));
          }
        };

        window.addEventListener("resize", onResize);
        return () => window.removeEventListener("resize", onResize);
      });
    });
  }, []);

  function connect(serverId: number) {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    setSelectedId(serverId);
    setStatusMsg("Connecting...");
    setConnected(false);

    const term = terminalRef.current;
    if (!term) return;

    term.clear();
    term.writeln("\x1b[33mConnecting to server...\x1b[0m");

    const wsBase = window.location.origin.replace(/^http/, "ws");
    const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");
    const ws = new WebSocket(`${wsBase}${basePath}/api/terminal?serverId=${serverId}`);
    wsRef.current = ws;

    ws.onopen = () => {
      setStatusMsg("Connected");
      setConnected(true);
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === "data") {
          term.write(msg.data);
        } else if (msg.type === "exit") {
          term.writeln("\r\n\x1b[33mSession closed.\x1b[0m");
          setConnected(false);
          setStatusMsg("Session ended");
        } else if (msg.type === "error") {
          term.writeln(`\r\n\x1b[31m${msg.data}\x1b[0m`);
          setConnected(false);
          setStatusMsg("Connection failed");
        }
      } catch {
        term.write(event.data);
      }
    };

    ws.onerror = () => {
      term.writeln("\r\n\x1b[31mWebSocket error. Check server status.\x1b[0m");
      setConnected(false);
      setStatusMsg("Connection error");
    };

    ws.onclose = () => {
      if (connected) {
        term.writeln("\r\n\x1b[33mConnection closed.\x1b[0m");
      }
      setConnected(false);
    };

    term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "data", data }));
      }
    });
  }

  function disconnect() {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setConnected(false);
    setStatusMsg("Disconnected.");
    terminalRef.current?.writeln("\r\n\x1b[33mDisconnected.\x1b[0m");
  }

  return (
    <div className="space-y-4 h-full flex flex-col">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">SSH Terminal</h1>
          <p className="text-muted-foreground mt-1">Direct shell access to your servers.</p>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <Server className="h-4 w-4 text-muted-foreground" />
        <select
          value={selectedId ?? ""}
          onChange={(e) => {
            const id = Number(e.target.value);
            if (id) connect(id);
          }}
          className="rounded-lg bg-background border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring w-72"
        >
          <option value="">Select a server...</option>
          {servers?.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name} ({s.host})
            </option>
          ))}
        </select>

        {connected && (
          <button
            onClick={disconnect}
            className="text-xs bg-red-900/30 text-red-400 border border-red-800/50 px-3 py-1.5 rounded-lg hover:bg-red-900/50 transition-colors"
          >
            Disconnect
          </button>
        )}

        <div className="flex items-center gap-2 ml-auto">
          <div className={`h-2 w-2 rounded-full ${connected ? "bg-emerald-400" : "bg-muted-foreground"}`} />
          <span className="text-xs text-muted-foreground">{statusMsg}</span>
        </div>
      </div>

      <div
        className="rounded-xl border border-border overflow-hidden flex-1 relative"
        style={{ minHeight: "520px", background: "#0a0e1a" }}
      >
        <div className="absolute top-0 left-0 right-0 flex items-center gap-2 px-4 py-2 bg-card/80 border-b border-border z-10">
          <TerminalIcon className="h-3 w-3 text-muted-foreground" />
          <span className="text-xs text-muted-foreground font-mono">
            {selectedId && servers?.find(s => s.id === selectedId)
              ? `root@${servers.find(s => s.id === selectedId)?.host}`
              : "no session"}
          </span>
        </div>
        <div
          ref={termRef}
          className="pt-8 h-full"
          style={{ height: "520px" }}
          onClick={() => terminalRef.current?.focus()}
        />
      </div>
    </div>
  );
}
