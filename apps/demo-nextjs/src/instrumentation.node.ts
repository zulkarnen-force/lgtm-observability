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
