#!/usr/bin/env node
/**
 * askjev-mcp — MCP stdio server + localhost WebSocket bridge for AskJev.
 *
 * Env:
 *   ASKJEV_TOKEN  (required) pairing token from extension Options
 *   ASKJEV_PORT   (optional) default 17373
 *
 * Claude Desktop may spawn this process twice (Chat + Cowork/Code). The first
 * binds 127.0.0.1:PORT; the second attaches as a controller peer (see BridgeAttach).
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { BridgeAttach } from "./bridge-attach.js";
import {
  BridgeServer,
  isEaddrInUse,
  type BridgeStatus,
} from "./bridge-server.js";
import { BridgeError } from "./errors.js";
import { DEFAULT_BRIDGE_PORT } from "./protocol.js";

/** Shared surface for BridgeServer (owner) and BridgeAttach (peer). */
export interface BridgeLike {
  getStatus(): BridgeStatus | Promise<BridgeStatus>;
  call(method: string, params?: Record<string, unknown>): Promise<unknown>;
  close(): Promise<void>;
}

function requireToken(): string {
  const token = (process.env.ASKJEV_TOKEN || "").trim();
  if (!token) {
    console.error(
      "AskJev MCP: ASKJEV_TOKEN is missing.\n" +
        "Claude Desktop / Cursor should set it via mcpServers.askjev.env in their config.\n" +
        "Fix: AskJev Options → Auto-connect → Copy Claude/Cursor config (or run the downloaded installer), then restart the client.\n" +
        "Do not export ASKJEV_TOKEN in a shell for daily use — Claude starts the bridge for you.",
    );
    process.exit(1);
  }
  if (token.length < 64) {
    console.error(
      "AskJev MCP: ASKJEV_TOKEN looks too short (need 32+ random bytes as hex, ≥64 chars).\n" +
        "Re-run Auto-connect in AskJev Options to generate a fresh pairing token.",
    );
    process.exit(1);
  }
  return token;
}

function toolError(err: unknown): {
  content: { type: "text"; text: string }[];
  isError: true;
} {
  if (err instanceof BridgeError) {
    const payload = { error: err.code, message: err.message };
    return {
      content: [{ type: "text", text: JSON.stringify(payload) }],
      isError: true,
    };
  }
  const message = err instanceof Error ? err.message : String(err);
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({ error: "internal", message }),
      },
    ],
    isError: true,
  };
}

function toolOk(result: unknown): {
  content: { type: "text"; text: string }[];
} {
  return {
    content: [{ type: "text", text: JSON.stringify(result ?? null, null, 2) }],
  };
}

async function openBridge(
  token: string,
  port: number,
): Promise<BridgeLike> {
  const owner = new BridgeServer({ token, port, host: "127.0.0.1" });
  try {
    await owner.listen();
    console.error(
      `AskJev MCP ready — waiting for extension on 127.0.0.1:${port}`,
    );
    return owner;
  } catch (err) {
    if (!isEaddrInUse(err)) {
      throw err;
    }
    try {
      await owner.close();
    } catch {
      /* ignore partial listen cleanup */
    }
    console.error(
      `AskJev MCP: port ${port} already in use (EADDRINUSE) — attaching as peer controller (Claude Desktop Chat + Cowork/Code double-spawn).`,
    );
    const peer = await BridgeAttach.connect({ token, port, host: "127.0.0.1" });
    console.error(
      `AskJev MCP ready — attached to existing bridge on 127.0.0.1:${port}`,
    );
    return peer;
  }
}

async function main(): Promise<void> {
  const token = requireToken();
  const port =
    Number(process.env.ASKJEV_PORT || DEFAULT_BRIDGE_PORT) ||
    DEFAULT_BRIDGE_PORT;

  const bridge: BridgeLike = await openBridge(token, port);

  const server = new McpServer({
    name: "askjev-mcp",
    version: "1.5.5",
  });

  // ---- Mode A: goal-driven autopilot ----
  server.registerTool(
    "askjev_start_goal",
    {
      description:
        "Start AskJev Autopilot on the active browser tab with a natural-language goal. Guard blocks irreversible steps (≥0.65).",
      inputSchema: {
        goal: z.string().describe("What the browser should accomplish"),
        typeText: z
          .string()
          .optional()
          .describe("Optional text used when Jev chooses TYPE_TEXT"),
      },
    },
    async ({ goal, typeText }) => {
      try {
        const result = await bridge.call("start_goal", {
          goal,
          typeText,
        });
        return toolOk(result);
      } catch (e) {
        return toolError(e);
      }
    },
  );

  server.registerTool(
    "askjev_stop",
    {
      description: "Stop the running AskJev Autopilot loop.",
      inputSchema: {},
    },
    async () => {
      try {
        const result = await bridge.call("stop", {});
        return toolOk(result);
      } catch (e) {
        return toolError(e);
      }
    },
  );

  server.registerTool(
    "askjev_status",
    {
      description:
        "Bridge + Autopilot status (paired, running, last event). Does not require rate limit.",
      inputSchema: {},
    },
    async () => {
      try {
        const local = await Promise.resolve(bridge.getStatus());
        if (!local.paired) {
          return toolOk({
            ...local,
            extension: null,
            note: "Extension not paired — enable Agent Bridge and ensure token matches ASKJEV_TOKEN",
          });
        }
        const extension = await bridge.call("status", {});
        return toolOk({ ...local, extension });
      } catch (e) {
        return toolError(e);
      }
    },
  );

  // ---- Mode B: low-level DOM control ----
  server.registerTool(
    "askjev_snapshot",
    {
      description:
        "Snapshot interactive elements on the active tab (ids for askjev_act).",
      inputSchema: {
        goal: z
          .string()
          .optional()
          .describe("Optional goal context included in the snapshot state"),
      },
    },
    async ({ goal }) => {
      try {
        const result = await bridge.call("snapshot", { goal: goal || "" });
        return toolOk(result);
      } catch (e) {
        return toolError(e);
      }
    },
  );

  server.registerTool(
    "askjev_act",
    {
      description:
        "Execute one DOM action on the active tab (CLICK, TYPE_TEXT, SELECT, SCROLL_DOWN, SCROLL_UP, WAIT). Rate-limited 30/min. Guard blocks irreversible acts.",
      inputSchema: {
        action: z
          .enum([
            "CLICK",
            "TYPE_TEXT",
            "SELECT",
            "SCROLL_DOWN",
            "SCROLL_UP",
            "WAIT",
          ])
          .describe("DOM action to perform"),
        targetId: z
          .number()
          .optional()
          .describe(
            "Element id from askjev_snapshot (required for CLICK/TYPE_TEXT/SELECT)",
          ),
        text: z.string().optional().describe("Text for TYPE_TEXT / SELECT"),
      },
    },
    async ({ action, targetId, text }) => {
      try {
        const result = await bridge.call("act", { action, targetId, text });
        return toolOk(result);
      } catch (e) {
        return toolError(e);
      }
    },
  );

  server.registerTool(
    "askjev_list_tabs",
    {
      description: "List open browser tabs (id, title, url, active).",
      inputSchema: {},
    },
    async () => {
      try {
        const result = await bridge.call("list_tabs", {});
        return toolOk(result);
      } catch (e) {
        return toolError(e);
      }
    },
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("AskJev MCP: stdio connected — Claude/Cursor owns this process");

  const shutdown = async () => {
    try {
      await bridge.close();
    } catch {
      /* ignore */
    }
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}

main().catch((err) => {
  console.error("askjev-mcp failed:", err);
  process.exit(1);
});
