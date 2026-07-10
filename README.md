# K3s Observability Stack

A complete **three-signal** observability platform on K3s — metrics, logs, and traces —
with PostgreSQL, Grafana, Prometheus, Loki, Tempo, Grafana Alloy, the OpenTelemetry
Collector, ArgoCD, and a Next.js demo app.

| Signal | Stored in | Collected by |
|---|---|---|
| **Metrics** | Prometheus (kube-prometheus-stack) | node-exporter, kube-state-metrics, cAdvisor, OTel Collector spanmetrics |
| **Logs** | Loki | Grafana Alloy (DaemonSet, scrapes pod stdout) |
| **Traces** | Tempo | Next.js OTel SDK → OTel Collector |

All three are visualized in Grafana. See **[grafana/DASHBOARD-GUIDE.md](grafana/DASHBOARD-GUIDE.md)**
for the pre-built dashboard and a step-by-step guide.

## Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│                              K3s Cluster                               │
│                                                                        │
│   demo-nextjs ──OTLP──►  OTel Collector ──┬──traces──►  Tempo          │
│  (OTel SDK: traces        (spanmetrics)   └──metrics─┐                 │
│   + metrics)                                         ▼                 │
│   pod stdout ──►  Alloy ──►  Loki           Prometheus ◄── node/kube   │
│                              (logs)         (metrics)      /cAdvisor   │
│                                                                        │
│          Tempo · Loki · Prometheus  ──────►  Grafana  ◄── dashboards   │
│                                              :3000       (sidecar CM)  │
│                                                                        │
│   PostgreSQL :5432   ◄── demo-nextjs        ArgoCD :80 (GitOps)        │
└──────────────────────────────────────────────────────────────────────┘
```

## Prerequisites

- K3s cluster running
- `kubectl` with `--kubeconfig ~/.kube/config`
- `helm` for chart installations
- `bun` v1.3.14+ (for Next.js app)

## Namespace & Helm repos

```bash
kubectl create namespace observability

helm repo add grafana https://grafana.github.io/helm-charts
helm repo add open-telemetry https://open-telemetry.github.io/opentelemetry-helm-charts
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
helm repo add argo https://argoproj.github.io/argo-helm
helm repo update
```

## Component Installation

Install in this order (later components depend on Prometheus CRDs / Tempo / Loki being up).

### 1. PostgreSQL

```bash
kubectl apply -f postgresql/secret.yaml
kubectl apply -f postgresql/service.yaml
kubectl apply -f postgresql/statefulset.yaml
```

**Verify:**
```bash
kubectl get pods -n observability -l app=postgresql
kubectl port-forward -n observability svc/postgresql 5432:5432
```

### 2. Prometheus (kube-prometheus-stack) — metrics

Installs Prometheus, Alertmanager, the Prometheus Operator (CRDs used by ServiceMonitors),
node-exporter, and kube-state-metrics. Grafana is disabled here (installed separately).

```bash
helm upgrade --install prometheus prometheus-community/kube-prometheus-stack \
  -n observability -f prometheus/values.yaml
```

### 3. Loki — logs

```bash
helm upgrade --install loki grafana/loki \
  -n observability -f loki/values.yaml
```

### 4. Grafana Alloy — log collection

DaemonSet that scrapes every pod's stdout and pushes to Loki.

```bash
helm upgrade --install alloy grafana/alloy \
  -n observability -f alloy/values.yaml
```

### 5. Tempo — traces

```bash
helm upgrade --install tempo grafana/tempo \
  -n observability -f tempo/values.yaml
```

### 6. OpenTelemetry Collector

Receives OTLP from the app, forwards traces to Tempo, and derives RED metrics
(`traces_span_metrics_*`) via the spanmetrics connector, exposed for Prometheus on :8889.

```bash
helm upgrade --install otel-collector open-telemetry/opentelemetry-collector \
  -n observability -f otel-collector/values.yaml
```

### 7. Grafana

Provisions the Prometheus, Loki, and Tempo data sources and auto-loads dashboards from
ConfigMaps labeled `grafana_dashboard: "1"` (the sidecar).

```bash
helm upgrade --install grafana grafana/grafana \
  -n observability -f grafana/values.yaml

# Load the pre-built cross-signal dashboard
kubectl apply -f grafana/dashboard-observability-configmap.yaml
```

**Access:** http://grafana.local (configure DNS or /etc/hosts). Credentials live in the
`grafana-admin` secret.

### 8. ArgoCD (optional) — GitOps

```bash
kubectl create namespace argocd
helm upgrade --install argocd argo/argo-cd \
  -n argocd -f argocd/values.yaml
```

**Access:** http://argocd.local

## Next.js Demo App

Located at `apps/demo-nextjs/`. Built with Next.js 16, React 19, Prisma ORM, and Bun.

### Setup

```bash
cd apps/demo-nextjs

# Install dependencies
bun install

# Start PostgreSQL port-forward (required for local dev)
kubectl port-forward -n observability svc/postgresql 5432:5432

# Push schema to database
bun run db:push

# Seed initial data
bun run db:seed

# Start development server
bun run dev
```

### Database Scripts

| Command | Description |
|---|---|
| `bun run db:push` | Push Prisma schema to database |
| `bun run db:seed` | Seed database with sample data |
| `bun run db:studio` | Open Prisma Studio (browser UI) |

### API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/users` | List all users with posts |
| `GET` | `/api/users/:id` | Get user by ID with posts |
| `POST` | `/api/users` | Create user `{email, name}` |

**Example: Create user**
```bash
curl -X POST http://localhost:3000/api/users \
  -H "Content-Type: application/json" \
  -d '{"email": "demo@example.com", "name": "Demo User"}'
```

### Prisma Schema

```prisma
generator client {
  provider = "prisma-client"
  output   = "../src/generated/prisma"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id        Int      @id @default(autoincrement())
  email     String   @unique
  name      String?
  posts     Post[]
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}

model Post {
  id        Int      @id @default(autoincrement())
  title     String
  content   String?
  published Boolean  @default(false)
  author    User     @relation(fields: [authorId], references: [id])
  authorId  Int
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}
```

### Seed Data

3 users with 4 posts:

| User | Email | Posts |
|---|---|---|
| Alice Johnson | alice@example.com | Getting Started with Next.js, Understanding Prisma ORM |
| Bob Smith | bob@example.com | Deploying to Kubernetes |
| Charlie Brown | charlie@example.com | Observability Best Practices |

## Environment Variables

### apps/demo-nextjs/.env

```env
# Local development (via port-forward)
DATABASE_URL="postgresql://demo:demo123@localhost:5432/demo?schema=public"

# In-cluster (when deployed to K3s)
# DATABASE_URL="postgresql://demo:***@postgresql.observability.svc.cluster.local:5432/demo"
```

## Project Structure

```
k3s/observability/
├── apps/
│   └── demo-nextjs/              # Next.js demo app
│       ├── prisma/
│       │   ├── schema.prisma     # Database schema
│       │   └── seed.ts           # Seed data
│       ├── src/
│       │   ├── app/
│       │   │   └── api/
│       │   │       └── users/
│       │   │           ├── route.ts        # GET, POST /api/users
│       │   │           └── [id]/
│       │   │               └── route.ts    # GET /api/users/:id
│       │   ├── lib/
│       │   │   └── prisma.ts     # Prisma client singleton
│       │   └── generated/
│       │       └── prisma/       # Auto-generated Prisma client
│       ├── .env                  # Environment variables
│       ├── package.json
│       └── tsconfig.json
├── grafana/
│   ├── values.yaml
│   └── admin-secret.yaml
├── otel-collector/
│   └── values.yaml
├── postgresql/
│   ├── secret.yaml
│   ├── service.yaml
│   └── statefulset.yaml
├── tempo/
│   └── values.yaml
└── README.md
```

## Troubleshooting

### Port 5432 already in use

```bash
# Kill existing port-forwards
pkill -f "kubectl.*port-forward"

# Restart
kubectl port-forward -n observability svc/postgresql 5432:5432
```

### Prisma client not found

```bash
cd apps/demo-nextjs
bunx prisma generate
```

### PostgreSQL pod stuck in ContainerCreating

Check disk space:
```bash
df -h /
```

## Tech Stack

| Component | Version |
|---|---|
| K3s | v1.36.2+k3s1 |
| PostgreSQL | 16.2 |
| Next.js | 16.2.10 |
| React | 19.2.4 |
| Prisma | 6.19.3 |
| Bun | 1.3.14 |
| TypeScript | 5.9.3 |

### Helm charts

| Release | Chart |
|---|---|
| prometheus | kube-prometheus-stack-87.12.3 |
| loki | loki-7.0.0 |
| alloy | alloy-1.10.0 |
| tempo | tempo-1.24.4 |
| otel-collector | opentelemetry-collector-0.164.1 |
| grafana | grafana-10.5.15 |
| argocd | argo-cd (namespace `argocd`) |
