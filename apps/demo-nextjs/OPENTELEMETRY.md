# OpenTelemetry Tracing — Human Guide

## What Is This?

OpenTelemetry (OTel) lets you **see exactly what happens** inside your app when a request comes in. Instead of guessing why something is slow or broken, you get a visual timeline (called a **trace**) showing every step: HTTP handling, database queries, external calls — with timing.

**Before OTel:** "The `/api/users` endpoint is slow... why?"

**After OTel:** "The `/api/users` endpoint takes 500ms, of which 480ms is a Prisma database query — the SQL is unoptimized."

---

## How It Works

```
┌─────────────┐      ┌─────────────────┐      ┌─────────┐      ┌─────────┐
│  Next.js    │ ───► │  OTel Collector  │ ───► │  Tempo  │ ───► │ Grafana │
│  App        │ OTLP │  (localhost:4318)│ gRPC │         │      │ Explore │
│             │ HTTP │                  │      │         │      │         │
└─────────────┘      └─────────────────┘      └─────────┘      └─────────┘
```

1. Your app creates **spans** (individual steps like "GET /api/users" or "Prisma query")
2. Spans are bundled into **traces** (the full request lifecycle)
3. Traces are sent to the **OTel Collector** via HTTP (port 4318)
4. The Collector forwards them to **Tempo** (a trace storage database)
5. You view everything in **Grafana** Explore → Tempo

---

## Step 1: Install Packages

```bash
cd apps/demo-nextjs

# Core OTel SDK
bun add @opentelemetry/api \
        @opentelemetry/sdk-node \
        @opentelemetry/sdk-trace-node \
        @opentelemetry/sdk-trace-base \
        @opentelemetry/resources \
        @opentelemetry/semantic-conventions \
        @opentelemetry/exporter-trace-otlp-http

# Auto-instrumentation (captures HTTP requests automatically)
bun add @opentelemetry/instrumentation-http \
        @opentelemetry/instrumentation-fetch

# Prisma instrumentation (captures database queries)
bun add @prisma/instrumentation
```

| Package | What It Does |
|---|---|
| `@opentelemetry/api` | Core API — creates and manages spans |
| `@opentelemetry/sdk-node` | Node.js SDK — runs the tracing pipeline |
| `@opentelemetry/sdk-trace-base` | Trace processing (batching, sampling) |
| `@opentelemetry/resources` | Attaches metadata (service name, version) |
| `@opentelemetry/exporter-trace-otlp-http` | Sends traces to OTel Collector via HTTP |
| `@opentelemetry/instrumentation-http` | Auto-traces all incoming HTTP requests |
| `@opentelemetry/instrumentation-fetch` | Auto-traces all outgoing `fetch()` calls |
| `@prisma/instrumentation` | Auto-traces Prisma database queries |

---

## Step 2: Configure Environment

Add this to your `.env` file:

```env
# OpenTelemetry Collector endpoint
OTEL_EXPORTER_OTLP_ENDPOINT="http://127.0.0.1:4318"
```

> **Production:** Change `127.0.0.1` to your actual Collector address.
> For Kubernetes: `http://otel-collector-opentelemetry-collector.observability.svc.cluster.local:4318`

---

## Step 3: Create Files

### `src/instrumentation.ts` — Entry Point

This is Next.js's built-in instrumentation hook. It runs before your app starts.

```typescript
// src/instrumentation.ts
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./instrumentation.node");
  }
}
```

### `src/instrumentation.node.ts` — OTel SDK Setup

This configures and starts the OpenTelemetry SDK.

```typescript
import { NodeSDK } from "@opentelemetry/sdk-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { HttpInstrumentation } from "@opentelemetry/instrumentation-http";
import { FetchInstrumentation } from "@opentelemetry/instrumentation-fetch";
import { PrismaInstrumentation } from "@prisma/instrumentation";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from "@opentelemetry/semantic-conventions";

const OTLP_ENDPOINT =
  process.env.OTEL_EXPORTER_OTLP_ENDPOINT || "http://127.0.0.1:4318";

const exporter = new OTLPTraceExporter({
  url: `${OTLP_ENDPOINT}/v1/traces`,
});

const sdk = new NodeSDK({
  resource: resourceFromAttributes({
    [ATTR_SERVICE_NAME]: "demo-nextjs",
    [ATTR_SERVICE_VERSION]: "0.1.0",
  }),
  traceExporter: exporter,
  instrumentations: [
    new HttpInstrumentation(),
    new FetchInstrumentation(),
    new PrismaInstrumentation(),
  ],
});

sdk.start();
console.log(`[OTel] Tracing initialized → ${OTLP_ENDPOINT}`);

process.on("SIGTERM", () => {
  sdk.shutdown().then(() => process.exit(0));
});
```

**What each part does:**

| Code | Purpose |
|---|---|
| `OTLPTraceExporter` | Sends traces to the OTel Collector |
| `resourceFromAttributes` | Tags traces with service name + version |
| `HttpInstrumentation` | Auto-creates spans for every incoming HTTP request |
| `FetchInstrumentation` | Auto-creates spans for outgoing `fetch()` calls |
| `PrismaInstrumentation` | Auto-creates spans for every Prisma query |
| `sdk.shutdown()` | Gracefully flushes remaining traces on shutdown |

---

## Step 4: Add Custom Spans (Optional)

Auto-instrumentation captures the basics. For **deeper visibility**, add custom spans to your business logic.

### Minimal Example

```typescript
import { trace, SpanStatusCode } from "@opentelemetry/api";

const tracer = trace.getTracer("my-app");

export async function GET() {
  return tracer.startActiveSpan("GET /api/users", async (span) => {
    try {
      // Your logic here
      const users = await prisma.user.findMany();

      span.setAttribute("http.status_code", 200);
      span.setAttribute("users.count", users.length);
      return Response.json(users);
    } catch (error) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: String(error) });
      return Response.json({ error: "Failed" }, { status: 500 });
    } finally {
      span.end(); // ALWAYS end the span
    }
  });
}
```

### Full Example with Nested Spans

```typescript
import { trace, SpanStatusCode } from "@opentelemetry/api";

const tracer = trace.getTracer("demo-nextjs-api");

export async function GET() {
  return tracer.startActiveSpan("GET /api/users", async (span) => {
    try {
      span.setAttribute("http.method", "GET");
      span.setAttribute("http.route", "/api/users");

      // Nested span: database query
      const users = await tracer.startActiveSpan(
        "prisma.user.findMany",
        async (dbSpan) => {
          try {
            const result = await prisma.user.findMany({
              include: { posts: true },
            });
            dbSpan.setAttribute("db.users.count", result.length);
            return result;
          } catch (e) {
            dbSpan.setStatus({
              code: SpanStatusCode.ERROR,
              message: String(e),
            });
            throw e;
          } finally {
            dbSpan.end();
          }
        }
      );

      span.setAttribute("http.status_code", 200);
      return Response.json(users);
    } catch (error) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: String(error),
      });
      return Response.json({ error: "Failed" }, { status: 500 });
    } finally {
      span.end();
    }
  });
}
```

### Key Concepts

| Concept | What It Is |
|---|---|
| **Span** | A single unit of work (e.g., "GET /api/users", "Prisma query") |
| **Trace** | A collection of spans forming a complete request lifecycle |
| **Tracer** | Creates spans (one per service, named after your app) |
| **Attributes** | Key-value metadata on a span (e.g., `http.status_code: 200`) |
| **Status** | OK or ERROR — set on failure |
| **`span.end()`** | Must be called! Otherwise the span never closes. Always use `finally` |

---

## Step 5: Verify

### 1. Start Your App

```bash
cd apps/demo-nextjs
bun run dev
```

You should see:

```
[OTel] Tracing initialized → http://127.0.0.1:4318
```

### 2. Make a Request

```bash
curl http://localhost:3000/api/users
```

### 3. Check the OTel Collector

```bash
# Port-forward the collector
kubectl port-forward -n observability svc/otel-collector-opentelemetry-collector 4318:4318

# Check Collector health
curl http://localhost:4318/
```

### 4. Check Tempo

```bash
# Port-forward Tempo
kubectl port-forward -n observability svc/tempo 3200:3200

# Search for traces from your service
curl -s "http://localhost:3200/api/search?service=demo-nextjs&limit=5" | jq
```

Expected output:

```json
{
  "traces": [
    {
      "traceID": "...",
      "rootServiceName": "demo-nextjs",
      "rootTraceName": "GET /api/users",
      "durationMs": 14
    }
  ]
}
```

---

## Step 6: Visualize in Grafana

### Setup (One Time)

1. Open Grafana: `http://localhost:3001` (port-forward `svc/grafana`)
2. Login: `admin` / `admin` (or your configured password)
3. Go to **Connections → Data Sources → Add data source**
4. Select **Tempo**
5. Set URL: `http://tempo.observability.svc.cluster.local:3100`
6. Click **Save & Test**

### View Traces

1. Go to **Explore** (compass icon in left sidebar)
2. Select **Tempo** as the data source
3. In the search bar, type:

```
service.name = "demo-nextjs"
```

4. Click **Run Query**
5. Click any trace to see the full waterfall:

```
GET /api/users [14ms]
├── resolve page components [2ms]
├── executing api route /api/users [10ms]
│   └── prisma.user.findMany [8ms]
└── serialize response [1ms]
```

### Useful Query Examples

```promql
# All traces from your service
service.name = "demo-nextjs"

# Only errors
status = error

# Slow requests (> 100ms)
service.name = "demo-nextjs" && duration > 100ms

# Specific endpoint
name = "GET /api/users"
```

---

## What Gets Traced Automatically

| What | How |
|---|---|
| Incoming HTTP requests | `HttpInstrumentation` |
| Outgoing `fetch()` calls | `FetchInstrumentation` |
| Prisma DB queries | `PrismaInstrumentation` |
| Custom business logic | Your manual spans |

---

## Data Flow

```
Request: GET /api/users
    │
    ▼
┌─────────────────────────────────┐
│  HttpInstrumentation (auto)     │  Creates span: "GET /api/users"
│  Custom span (manual)           │  Adds: http.method, http.route
│                                 │
│  PrismaInstrumentation (auto)   │  Creates span: "prisma.user.findMany"
│  Custom dbSpan (manual)         │  Adds: db.users.count
└─────────────────────────────────┘
    │
    ▼  OTLP HTTP (port 4318)
┌─────────────────────────────────┐
│  OTel Collector                 │
│  ├── Batch processor            │  Groups traces for efficiency
│  ├── Memory limiter             │  Prevents OOM
│  └── OTLP exporter              │  Forwards to Tempo
└─────────────────────────────────┘
    │
    ▼  gRPC (port 4317)
┌─────────────────────────────────┐
│  Tempo                          │  Stores traces
└─────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────┐
│  Grafana Explore                │  Visual query + waterfall view
└─────────────────────────────────┘
```

---

## Troubleshooting

### "No traces appearing"

1. Check the OTel endpoint is reachable:
   ```bash
   curl http://localhost:4318/v1/traces -X POST -H "Content-Type: application/json" -d '{}' -o /dev/null -w "%{http_code}"
   # Should return 200
   ```

2. Check the Collector logs:
   ```bash
   kubectl logs -n observability -l app.kubernetes.io/name=opentelemetry-collector --tail=20
   ```

3. Check `OTEL_EXPORTER_OTLP_ENDPOINT` in `.env`

### "Traces appear in Tempo but no spans"

The auto-instrumentation needs a request to trigger. Make an actual HTTP request to your app:

```bash
curl http://localhost:3000/api/users
```

### "Prisma queries not showing"

Ensure `@prisma/instrumentation` is installed and imported in `instrumentation.node.ts`.

### "High memory usage"

The OTel Collector has memory limits. Check:

```bash
kubectl describe pod -n observability -l app.kubernetes.io/name=opentelemetry-collector
```

---

## Summary

| What You Get | How |
|---|---|
| Auto HTTP tracing | Install `@opentelemetry/instrumentation-http` |
| Auto fetch() tracing | Install `@opentelemetry/instrumentation-fetch` |
| Auto Prisma tracing | Install `@prisma/instrumentation` |
| Custom business spans | Use `tracer.startActiveSpan()` |
| Visual waterfall in Grafana | Explore → Tempo → Query by service name |
| Error tracking | Set `span.setStatus({ code: SpanStatusCode.ERROR })` |
| Performance insights | Check `durationMs` in trace search results |
