# Grafana Dashboard Guide — K3s Observability Stack

A step-by-step guide to building (and importing) a Grafana dashboard that visualizes
**all three signals** in this stack:

| Signal | Source | Grafana Data Source | Produced by |
|---|---|---|---|
| **Traces** | Tempo | `Tempo` (`tempo` :3200) | Next.js OTel SDK → OTel Collector → Tempo |
| **Metrics** | Prometheus | `prometheus` | kube-prometheus-stack (node-exporter, kube-state-metrics, cAdvisor) |
| **Logs** | Loki | `loki` | Grafana Alloy (DaemonSet) → Loki |

The finished dashboard ships in this repo:

- Model: [`grafana/dashboards/observability-overview.json`](dashboards/observability-overview.json)
- GitOps ConfigMap: [`grafana/dashboard-observability-configmap.yaml`](dashboard-observability-configmap.yaml)

---

## 1. How the data flows

```
                      ┌─────────────────────────────────────────────┐
   demo-nextjs        │                 K3s cluster                 │
  (OTel SDK, traces)  │                                             │
        │  OTLP/HTTP   │   ┌──────────────┐      ┌──────────┐        │
        └────4318──────┼──▶│ OTel         │─4317▶│  Tempo   │◀──┐    │
                       │   │ Collector    │      └──────────┘   │    │
   all pod stdout      │   └──────────────┘                     │    │
        │              │   ┌──────────────┐      ┌──────────┐   │    │
   Alloy (DaemonSet) ──┼──▶│ (push)       │─────▶│  Loki    │◀──┤    │
                       │   └──────────────┘      └──────────┘   │    │
   node/kube/cAdvisor  │                         ┌──────────┐   │    │
        └──────────────┼── scrape ──────────────▶│Prometheus│◀──┤    │
                       │                         └──────────┘   │    │
                       │                                    ┌───┴──┐ │
                       │                                    │Grafana│ │
                       │                                    └───────┘ │
                       └─────────────────────────────────────────────┘
```

**Key points:**
- The app ships **traces** via the OTel SDK. The Collector's **spanmetrics** connector
  turns those traces into RED metrics (`traces_span_metrics_*`) and exposes them for
  Prometheus — this powers the dashboard's *Application RED Metrics* row.
- The app also now initializes an **OTLP metric reader** (see P2), so app/runtime metrics
  can flow the same path once emitted.
- **Logs** come from Alloy scraping each pod's stdout → Loki.
- Infra **metrics** (CPU/mem/net) come from cAdvisor/kube-state-metrics.

> **Service name note:** depending on how the app is launched, its `service.name` may carry
> an environment suffix (e.g. `demo-nextjs-dev`, `demo-nextjs-prod`). The dashboard's trace
> panel matches `demo-nextjs.*`, and the **Service (spanmetrics)** variable lets you pick the
> exact service for the RED panels.

---

## 2. Confirm your data sources

The running Grafana (`http://grafana.local`, or `kubectl port-forward svc/grafana 33000:80`)
has these data sources provisioned. UIDs will differ in your cluster — **never hard-code them**;
the dashboard uses *data source template variables* instead (see step 4).

| Name | Type | URL |
|---|---|---|
| `prometheus` | prometheus | `http://prometheus-kube-prometheus-prometheus.observability.svc:9090` |
| `loki` | loki | `http://loki.observability.svc:3100` |
| `Tempo` | tempo | `http://tempo:3100` |
| `tempo-1` | tempo | `http://tempo:3200` ← query frontend (correct one) |

> ⚠️ The `Tempo` data source in `grafana/values.yaml` points at **:3100**, which is Tempo's
> distributor/ingest port, not the query API (**:3200**). Trace *search* works against :3200.
> Fix in [Review findings](#5-review-findings).

Login: user/password from the `grafana-admin` secret:
```bash
kubectl get secret -n observability grafana-admin -o jsonpath='{.data.admin-user}' | base64 -d; echo
kubectl get secret -n observability grafana-admin -o jsonpath='{.data.admin-password}' | base64 -d; echo
```

---

## 3. Generate some data first

A dashboard with no data is hard to build. Before starting:

```bash
# 1. Traces — run the app and hit an endpoint (SDK ships traces to the collector)
cd apps/demo-nextjs
kubectl port-forward -n observability svc/otel-collector-opentelemetry-collector 4318:4318 &
kubectl port-forward -n observability svc/postgresql 5432:5432 &
bun run dev
# in another shell:
for i in $(seq 1 20); do curl -s http://localhost:3000/api/users >/dev/null; done

# 2. Metrics & logs already flow continuously from the cluster (Prometheus + Alloy).
```

---

## 4. Build the dashboard from scratch (UI)

If you just want the finished result, skip to [step 6 — Import](#6-import-the-prebuilt-dashboard).
This section explains how it was built so you can extend it.

### 4.1 Create the dashboard and template variables

**Dashboards → New → New dashboard → Settings (⚙) → Variables → New variable.**

Add these five variables — the three data-source variables make the dashboard portable
across clusters (no baked-in UIDs):

| Variable | Type | Definition |
|---|---|---|
| `prometheus` | Data source | Type = *Prometheus* |
| `loki` | Data source | Type = *Loki* |
| `tempo` | Data source | Type = *Tempo* |
| `service` | Query (uses `$prometheus`) | `label_values(traces_span_metrics_calls_total, service_name)` — *Multi*, *Include All* `.*` |
| `namespace` | Query (uses `$prometheus`) | `label_values(kube_pod_info, namespace)` — default `observability` |
| `pod` | Query (uses `$prometheus`) | `label_values(kube_pod_info{namespace="$namespace"}, pod)` — *Multi-value*, *Include All*, All value `.*` |

### 4.2 Panels — Application RED Metrics (Prometheus / spanmetrics)

These use the Collector's spanmetrics output. `SPAN_KIND_SERVER` isolates inbound requests.

```promql
# Request rate (req/s)
sum(rate(traces_span_metrics_calls_total{service_name=~"$service", span_kind="SPAN_KIND_SERVER"}[$__rate_interval]))

# Error rate (%)
100 * sum(rate(traces_span_metrics_calls_total{service_name=~"$service", span_kind="SPAN_KIND_SERVER", status_code="STATUS_CODE_ERROR"}[$__rate_interval]))
    / clamp_min(sum(rate(traces_span_metrics_calls_total{service_name=~"$service", span_kind="SPAN_KIND_SERVER"}[$__rate_interval])), 1e-9)

# Latency p95 (ms)
histogram_quantile(0.95, sum by (le) (rate(traces_span_metrics_duration_milliseconds_bucket{service_name=~"$service", span_kind="SPAN_KIND_SERVER"}[$__rate_interval])))

# Request rate by endpoint
sum by (span_name) (rate(traces_span_metrics_calls_total{service_name=~"$service", span_kind="SPAN_KIND_SERVER"}[$__rate_interval]))
```

### 4.3 Panel — Traces (Tempo)

**Add panel → visualization = Table → data source = `$tempo`.**

- Query type: **Search** (TraceQL Search)
- Filter: `Service Name` `=` `demo-nextjs`
- Limit: `20`

This lists recent traces; clicking a Trace ID opens the span waterfall. Equivalent TraceQL:
```traceql
{ resource.service.name = "demo-nextjs" }
```

### 4.4 Panels — Pod & Cluster Metrics (Prometheus)

Add these **Time series** / **Stat** panels with data source `$prometheus`:

```promql
# CPU by pod (cores)
sum by (pod) (rate(container_cpu_usage_seconds_total{namespace="$namespace", pod=~"$pod", container!=""}[5m]))

# Memory working set by pod (unit: bytes)
sum by (pod) (container_memory_working_set_bytes{namespace="$namespace", pod=~"$pod", container!=""})

# Running pods (Stat panel)
sum(kube_pod_status_phase{namespace="$namespace", phase="Running"})

# Network receive by pod (unit: Bps)
sum by (pod) (rate(container_network_receive_bytes_total{namespace="$namespace", pod=~"$pod"}[5m]))
```

### 4.5 Panels — Logs (Loki)

Add a **Time series** (log volume) and a **Logs** panel with data source `$loki`:

```logql
# Log volume by pod (bars)
sum by (pod) (count_over_time({pod=~"$pod"}[$__interval]))

# Raw logs
{pod=~"$pod"}
```

> **Note:** Loki carries `namespace`, `pod`, `container`, `node`, and `app` labels (set by
> Alloy's relabel rules — see P5). Filter by `namespace` + `pod` to line up with the metric
> panels.

### 4.6 Save

**Save dashboard** → set a stable **UID** (`observability-overview`) so re-imports update
in place instead of creating duplicates.

---

## 5. Review findings

Issues found while reviewing the stack + OTel SDK. None block the dashboard, but fixing
them makes the "all data sources" story real.

> **Status:** P1–P6 have all been **applied** (see the ✅ notes on each). Changes span
> `otel-collector/values.yaml`, `grafana/values.yaml`, `alloy/values.yaml`,
> `apps/demo-nextjs/src/instrumentation.node.ts`, and `README.md`.

### 🔴 P1 — OTel Collector is crash-looping (metrics pipeline broken) — ✅ FIXED

`otel-collector/values.yaml` places the **`prometheus` exporter inside the `traces`
pipeline**. The Prometheus exporter only supports *metrics*, so the collector fails to
start:

```
Error: failed to build pipelines: failed to create "prometheus" exporter
for data type "traces": telemetry type is not supported
```

An older pod keeps serving, masking the outage, but every rollout of the new config
`CrashLoopBackOff`s. **Fix:** give it a real `metrics` pipeline (and a `spanmetrics`
connector if you want RED metrics from traces), and remove `prometheus` from `traces`:

```yaml
config:
  connectors:
    spanmetrics: {}            # derives request rate/error/duration from spans
  service:
    pipelines:
      traces:
        receivers: [otlp]
        processors: [memory_limiter, batch]
        exporters: [otlp, debug, spanmetrics]   # ← not "prometheus"
      metrics:
        receivers: [otlp, spanmetrics]
        processors: [memory_limiter, batch]
        exporters: [prometheus, debug]           # ← prometheus belongs here
```
Then scrape `:8889` with a `ServiceMonitor` (or `PodMonitor`) so Prometheus ingests the
collector's metrics. Once done, add RED panels (`traces_spanmetrics_calls_total`, latency
histograms) to the dashboard.

> ✅ **Applied:** `otel-collector/values.yaml` now has a `spanmetrics` connector, a real
> `metrics` pipeline (`prometheus` exporter moved here), and `serviceMonitor.enabled: true`.
> The collector runs `1/1`, and Prometheus scrapes `:8889` (`health=up`). RED metrics
> (`traces_spanmetrics_*`) appear once the app sends traces.

### 🟠 P2 — App exports traces only — ✅ FIXED

`instrumentation.node.ts` configured a `traceExporter` but no metrics/logs.

> ✅ **Applied:** added `@opentelemetry/exporter-metrics-otlp-http` and a
> `PeriodicExportingMetricReader` (15s interval) to the NodeSDK, pointing at
> `$OTEL_EXPORTER_OTLP_ENDPOINT/v1/metrics`. The SDK now logs
> *"Tracing + metrics initialized"*.
>
> In practice the **reliable RED signal comes from the Collector's spanmetrics connector**
> (`traces_span_metrics_*`, verified flowing into Prometheus), which the dashboard uses.
> App-level instrument metrics depend on the instrumentation/runtime emitting them; the
> pipeline is now wired for both.

### 🟠 P3 — Grafana provisions only Tempo — ✅ FIXED

`grafana/values.yaml → datasources` only defines `Tempo`. Prometheus and Loki are present
in the live cluster (added out-of-band), so they are **not reproducible from Git**. Add
them under `datasources.datasources.yaml` so the whole stack is declarative:

```yaml
- name: Prometheus
  type: prometheus
  uid: prometheus
  url: http://prometheus-kube-prometheus-prometheus.observability.svc:9090
- name: Loki
  type: loki
  uid: loki
  url: http://loki.observability.svc:3100
```

> ✅ **Applied:** `grafana/values.yaml` now provisions `Prometheus` (default), `Loki`, and
> `Tempo` with stable UIDs. The manually-added UI duplicates were removed, so provisioning
> is the single source of truth. (Note: changing an existing provisioned datasource's UID
> makes Grafana fail with `data source not found` — delete the old one first, then let
> provisioning recreate it, which is what was done here.)

### 🟡 P4 — Tempo data source URL uses the wrong port — ✅ FIXED

`Tempo` → `http://tempo:3100`. The query API is **:3200**. Point the provisioned data
source at `http://tempo:3200` (matches the working `tempo-1` entry) and drop the duplicate.

> ✅ **Applied:** the provisioned `Tempo` datasource now targets
> `http://tempo.observability.svc.cluster.local:3200`; trace search verified working.

### 🟡 P5 — Loki drops the `namespace` label — ✅ FIXED

The **root cause** was worse than a missing label: the live Alloy config had **no
`loki.*` blocks at all** and never shipped pod logs to Loki (the only logs present came
from `loki-canary`). The pipeline config in `alloy/values.yaml` was nested at top-level
`configMap.content`, but the grafana/alloy chart reads it from **`alloy.configMap.content`**
— so it was silently ignored and a default config ran instead.

> ✅ **Applied:** moved the config under `alloy.configMap.content`, added `namespace`,
> `container`, `node`, and `app` relabel targets (and switched the comment to Alloy's `//`
> syntax). After redeploy, Loki now carries labels `namespace, app, container, node, pod,
> service_name` across **24 pods**, and the dashboard's Logs panels filter by
> `{namespace="$namespace", pod=~"$pod"}`.

### 🟢 P6 — README drift — ✅ FIXED

`README.md` documents only PostgreSQL, OTel Collector, Grafana, and Tempo. Prometheus,
Loki, Alloy, and ArgoCD are now part of the stack — update the architecture diagram and
install steps.

---

## 6. Import the pre-built dashboard

Three ways, pick one. All target UID `observability-overview`, so they update in place.

### Option A — GitOps ConfigMap (recommended, persistent)

Grafana's sidecar (`sidecar.dashboards.enabled: true`, `searchNamespace: ALL`) auto-loads
any ConfigMap labeled `grafana_dashboard: "1"`:

```bash
kubectl apply -f grafana/dashboard-observability-configmap.yaml
```
The dashboard appears within ~30s in the **Observability** folder. Re-apply after editing
the JSON to roll out changes. This is the source-of-truth method — the dashboard survives
Grafana pod restarts.

### Option B — Grafana UI

**Dashboards → New → Import → Upload JSON file →**
`grafana/dashboards/observability-overview.json` → map the Prometheus/Loki/Tempo data
sources → **Import**.

### Option C — HTTP API

```bash
kubectl port-forward -n observability svc/grafana 33000:80 &
PASS=$(kubectl get secret -n observability grafana-admin -o jsonpath='{.data.admin-password}' | base64 -d)

jq '{dashboard: ., overwrite: true, message: "import"}' \
  grafana/dashboards/observability-overview.json \
| curl -s -u "admin:$PASS" -H "Content-Type: application/json" \
    -X POST http://localhost:33000/api/dashboards/db --data @-
```

---

## 7. Verify

```bash
kubectl port-forward -n observability svc/grafana 33000:80 &
PASS=$(kubectl get secret -n observability grafana-admin -o jsonpath='{.data.admin-password}' | base64 -d)

# Dashboard is registered
curl -s -u "admin:$PASS" "http://localhost:33000/api/search?query=Observability%20Overview" | jq '.[].url'
```

Then open the dashboard in the browser:

- **Traces** table populates after you exercise the app (step 3).
- **Metrics** panels populate immediately (cluster metrics always flow).
- **Logs** panels populate as Alloy ships pod logs (give a fresh Alloy a minute).

If a panel is empty, use the **Namespace**/**Pod** variables at the top to widen the scope,
or open the panel's query in **Explore** to debug.
