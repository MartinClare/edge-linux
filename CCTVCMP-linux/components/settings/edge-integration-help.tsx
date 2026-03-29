"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function EdgeIntegrationHelp() {
  const [webhookUrl, setWebhookUrl] = useState("");

  useEffect(() => {
    if (typeof window !== "undefined") {
      setWebhookUrl(`${window.location.origin}/api/webhook/edge-report`);
    }
  }, []);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Connecting the edge (PPE-UI)</CardTitle>
        <p className="text-sm text-muted-foreground">
          AXON Vision edge devices send AI analysis to this CMP. Configure the on-site <strong>PPE-UI</strong> (or the
          edge <code className="rounded bg-muted px-1 py-0.5 text-xs">app.config.json</code>) so reports reach this
          deployment.
        </p>
      </CardHeader>
      <CardContent className="space-y-6 text-sm">
        <section className="space-y-2">
          <h3 className="font-medium text-foreground">1. Webhook URL for this CMP</h3>
          <p className="text-muted-foreground">
            The edge must POST JSON to the path below (include <code className="rounded bg-muted px-1">/api/webhook/edge-report</code>
            exactly).
          </p>
          <div className="rounded-md border border-border bg-muted/40 p-3 font-mono text-xs break-all">
            {webhookUrl || "…loading (open this page in the browser)…"}
          </div>
        </section>

        <section className="space-y-2">
          <h3 className="font-medium text-foreground">2. PPE-UI Settings (recommended)</h3>
          <ol className="list-decimal space-y-1 pl-5 text-muted-foreground">
            <li>Open the edge <strong>PPE-UI</strong> in a browser (same machine or LAN as the edge API).</li>
            <li>Open <strong>Settings</strong> (sidebar).</li>
            <li>Enable <strong>CMP reporting</strong>.</li>
            <li>Paste the webhook URL above into <strong>CMP Webhook URL</strong>.</li>
            <li>
              Set <strong>CMP API Key</strong> to the same value as this server&apos;s environment variable{" "}
              <code className="rounded bg-muted px-1">EDGE_API_KEY</code> (Vercel → Project → Settings → Environment
              Variables).
            </li>
            <li>Save. The edge API updates <code className="rounded bg-muted px-1">app.config.json</code> and starts forwarding when Deep Vision runs.</li>
          </ol>
        </section>

        <section className="space-y-2">
          <h3 className="font-medium text-foreground">3. Config file (headless / advanced)</h3>
          <p className="text-muted-foreground">
            The Python service reads the repo-root <code className="rounded bg-muted px-1">app.config.json</code> on the edge. Ensure{" "}
            <code className="rounded bg-muted px-1">centralServer</code> includes:
          </p>
          <pre className="overflow-x-auto rounded-md border border-border bg-muted/40 p-3 text-xs">
{`"centralServer": {
  "enabled": true,
  "url": "<webhook URL from step 1>",
  "apiKey": "<same as EDGE_API_KEY on this CMP>"
}`}
          </pre>
        </section>

        <section className="space-y-2">
          <h3 className="font-medium text-foreground">4. When edge devices appear here</h3>
          <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
            <li>
              <strong>Edge Devices</strong> lists cameras after the <strong>first successful</strong> webhook (HTTP 200).
            </li>
            <li>
              The edge must run <strong>Deep Vision</strong> with at least one enabled RTSP camera and a working cloud
              analysis service, or no payload is sent.
            </li>
            <li>
              If this CMP is on Vercel, turn off <strong>Deployment Protection</strong> for the URL the edge calls, or
              server-to-server POSTs will be blocked before they reach the app.
            </li>
          </ul>
        </section>

        <p className="text-xs text-muted-foreground">
          Full step-by-step: see <code className="rounded bg-muted px-1">USER_MANUAL.md</code> §15 in the edge-linux
          repository. API payload details: <code className="rounded bg-muted px-1">WEBHOOK_API.md</code>.
        </p>
      </CardContent>
    </Card>
  );
}
