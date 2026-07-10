# Alerting Guide — Prometheus → Alertmanager → Telegram

How the stack turns metrics into Telegram messages, the two alerts that ship with it,
and how to wire your own bot.

---

## 1. How it works

```
 Prometheus                       Alertmanager                     Telegram
 ┌──────────────┐   fires   ┌────────────────────┐   HTTP POST  ┌───────────┐
 │ PrometheusRule│ ───────► │ route: namespace=  │ ───────────► │  Bot API  │
 │ (alert rules) │          │   prod-namespace   │              │  → chat   │
 └──────────────┘          │   → receiver:telegram│             └───────────┘
        ▲                   └────────────────────┘
   evaluates                    bot_token_file (mounted Secret)
   every 30s                    chat_id (in values.yaml)
```

1. **Prometheus** evaluates the rules in [`alert-rules.yaml`](alert-rules.yaml) every 30s.
2. When a rule's expression is true for its `for:` duration, the alert **fires** and is
   pushed to **Alertmanager**.
3. Alertmanager's **route** matches `namespace="prod-namespace"` and sends to the
   **`telegram`** receiver.
4. The receiver POSTs a formatted message to the Telegram Bot API using the bot token
   (from a mounted Kubernetes Secret) and your `chat_id`.

Config lives in:

| File | What |
|---|---|
| [`prometheus/alert-rules.yaml`](alert-rules.yaml) | The alert rules (`PrometheusRule` CRD) |
| [`prometheus/values.yaml`](values.yaml) → `alertmanager.config` | Route + Telegram receiver |
| Secret `telegram-bot-token` | Bot token, mounted into Alertmanager |

---

## 2. The alerts

| Alert | Fires when | For | Severity |
|---|---|---|---|
| **ProdNamespaceHighMemory** | a pod's working-set memory in `prod-namespace` > **200 MiB** | 5m | warning |
| **ProdNamespacePodDown** | a pod in `prod-namespace` is **not Ready** (crash-loop / pending / failed) | 2m | critical |

Expressions:

```promql
# ProdNamespaceHighMemory
sum by (namespace, pod) (
  container_memory_working_set_bytes{namespace="prod-namespace", container!="", container!="POD"}
) > 200 * 1024 * 1024

# ProdNamespacePodDown
kube_pod_status_ready{namespace="prod-namespace", condition="true"} == 0
```

> `ProdNamespacePodDown` catches pods that exist but aren't Ready. To also alert when a
> Deployment has **fewer replicas than desired** (e.g. scaled to zero / all pods gone), add
> a rule on `kube_deployment_status_replicas_available < kube_deployment_status_replicas`.

---

## 3. One-time setup

### 3.1 Create a Telegram bot & get the token

1. In Telegram, message **@BotFather** → `/newbot` → follow prompts.
2. Copy the **bot token** — looks like `123456789:AAExxxxxxxxxxxxxxxxxxxxxxxxxxx`.

### 3.2 Get your chat ID

- **Personal chat:** message your new bot once, then open
  `https://api.telegram.org/bot<TOKEN>/getUpdates` and read `result[].message.chat.id`.
- **Group:** add the bot to the group, send a message, hit the same URL — the group
  `chat.id` is negative (e.g. `-1001234567890`).

### 3.3 Store the bot token as a Secret

The token must **never** be committed. Create it imperatively:

```bash
kubectl -n observability create secret generic telegram-bot-token \
  --from-literal=token='123456789:AAExxxxxxxxxxxxxxxxxxxxxxxxxxx'
```

(The key **must** be `token`. See [`telegram-bot-token.secret.example.yaml`](telegram-bot-token.secret.example.yaml).)

### 3.4 Set your chat ID and roll out

Edit `prometheus/values.yaml` → `alertmanager.config.receivers[telegram].telegram_configs[0].chat_id`
and replace the placeholder `123456789` with your real chat ID. Then:

```bash
# Apply the Alertmanager config (mounts the secret, adds the telegram receiver)
helm upgrade prometheus prometheus-community/kube-prometheus-stack \
  -n observability -f prometheus/values.yaml

# Apply the alert rules
kubectl apply -f prometheus/alert-rules.yaml
```

> The `PrometheusRule` carries the label `release: prometheus` — required so the
> kube-prometheus-stack Prometheus (whose `ruleSelector` is `matchLabels: release=prometheus`)
> actually loads it.

---

## 4. Verify

```bash
# 1. Rules loaded & their state (pending → firing after the `for:` window)
kubectl port-forward -n observability svc/prometheus-kube-prometheus-prometheus 9090:9090 &
curl -s localhost:9090/api/v1/rules?type=alert | jq '.data.groups[]|select(.name=="prod-namespace.rules").rules[]|{name,state}'

# 2. Alert reached Alertmanager and routed to telegram
kubectl port-forward -n observability svc/prometheus-kube-prometheus-alertmanager 9093:9093 &
curl -s localhost:9093/api/v2/alerts | jq '.[]|select(.labels.namespace=="prod-namespace")|{alertname:.labels.alertname,receivers:[.receivers[].name]}'

# 3. Delivery attempts in the Alertmanager log
kubectl logs -n observability alertmanager-prometheus-kube-prometheus-alertmanager-0 \
  -c alertmanager | grep -i telegram
```

**Send a test alert** without waiting for a real one (routes through the whole pipeline):

```bash
kubectl port-forward -n observability svc/prometheus-kube-prometheus-alertmanager 9093:9093 &
curl -s -XPOST localhost:9093/api/v2/alerts -H 'Content-Type: application/json' -d '[{
  "labels":{"alertname":"TelegramTest","namespace":"prod-namespace","severity":"warning"},
  "annotations":{"description":"hello from alertmanager"}
}]'
```

> A log line `err="telegram: Not Found (404)"` means the **bot token is wrong/placeholder**.
> `err="telegram: Bad Request: chat not found"` means the **chat_id is wrong** (or the bot
> was never messaged/added to the group). A successful send logs nothing and the message
> arrives in Telegram.

---

## 5. Routing, grouping & noise control

From `alertmanager.config`:

- **route.routes** — `namespace="prod-namespace"` → `telegram`; the always-on `Watchdog`
  heartbeat → `null` (silently dropped).
- **group_by `[namespace, alertname]`** — alerts for the same namespace+name are batched
  into one message.
- **group_wait 30s / group_interval 5m / repeat_interval 4h** — first notify after 30s,
  updates every 5m, re-notify an unresolved alert every 4h.
- **send_resolved: true** — you also get a ✅ RESOLVED message when it clears.
- **inhibit_rules** — a `critical` alert suppresses `warning`/`info` for the same
  namespace+alertname.

**Silence** an alert temporarily (e.g. during maintenance):

```bash
# via UI: http://localhost:9093  → Silences → New Silence
# or with amtool inside the pod:
kubectl exec -n observability alertmanager-prometheus-kube-prometheus-alertmanager-0 -c alertmanager -- \
  amtool silence add alertname=ProdNamespaceHighMemory --duration=2h \
  --comment="planned" --alertmanager.url=http://localhost:9093
```

---

## 6. Adding more alerts

Append rules to `prometheus/alert-rules.yaml` under `spec.groups[].rules`, then
`kubectl apply -f prometheus/alert-rules.yaml`. Anything with `namespace="prod-namespace"`
in its labels routes to Telegram automatically. To route **other** namespaces/severities,
add a matcher + (optionally) a second `route` entry in `values.yaml` and re-run
`helm upgrade`.

Handy building blocks:

```promql
# CPU > 0.5 cores (5m)
sum by (namespace,pod)(rate(container_cpu_usage_seconds_total{namespace="prod-namespace",container!=""}[5m])) > 0.5

# Container restarting (crash-loop)
increase(kube_pod_container_status_restarts_total{namespace="prod-namespace"}[15m]) > 3

# App RED: error ratio > 5% (from OTel spanmetrics)
sum(rate(traces_span_metrics_calls_total{service_name="demo-nextjs-prod",status_code="STATUS_CODE_ERROR"}[5m]))
  / sum(rate(traces_span_metrics_calls_total{service_name="demo-nextjs-prod"}[5m])) > 0.05
```

---

## 7. Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| Rule not in Prometheus | Missing `release: prometheus` label on the `PrometheusRule`. |
| Alert `pending` forever | Metric dips below threshold within the `for:` window (resets the timer). Lower `for:` or the threshold. |
| Alertmanager pod won't start | Secret `telegram-bot-token` missing — `alertmanagerSpec.secrets` can't mount it. Create it (§3.3). |
| `telegram: Not Found (404)` | Bad/placeholder **bot token**. |
| `chat not found` | Bad **chat_id**, or the bot hasn't been messaged / added to the group. |
| Nothing routes to telegram | Alert has no `namespace="prod-namespace"` label; check the route matchers. |
