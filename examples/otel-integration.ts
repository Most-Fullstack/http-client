/**
 * Example: OpenTelemetry Integration with Grafana Stack
 *
 * This demonstrates how to use @my-org/http-client with:
 * - W3C Trace Context propagation (traceparent header)
 * - Go backend using otelgo (https://github.com/Maximumsoft-Co-LTD/otelgo)
 * - Grafana Stack (Tempo for traces, Loki for logs)
 *
 * Architecture:
 * ┌─────────────────┐    traceparent     ┌─────────────────┐
 * │  Vue/React App  │ ─────────────────► │   Go Backend    │
 * │  (http-client)  │                    │    (otelgo)     │
 * └─────────────────┘                    └─────────────────┘
 *         │                                      │
 *         │ X-Transaction-ID                     │ Traces
 *         ▼                                      ▼
 * ┌─────────────────┐                    ┌─────────────────┐
 * │   Loki (Logs)   │◄────────────────── │  Tempo (Traces) │
 * └─────────────────┘                    └─────────────────┘
 *         │                                      │
 *         └──────────────┬───────────────────────┘
 *                        ▼
 *               ┌─────────────────┐
 *               │     Grafana     │
 *               │  (Correlation)  │
 *               └─────────────────┘
 */

import { BaseAPIService, createHttpClient } from '@my-org/http-client';

// ============================================================================
// OPTION 1: Hybrid Approach (Recommended)
// Frontend generates trace context, backend (otelgo) handles tracing
// ============================================================================

export const api = createHttpClient({
  axiosConfig: {
    baseURL: import.meta.env.VITE_API_URL,
    timeout: 30000,
  },
  // Enable W3C Trace Context propagation
  // This injects 'traceparent' header that otelgo can read
  enableTraceContext: true,

  // Use trace ID as transaction ID for log correlation
  // In Grafana: search Loki by X-Transaction-ID, jump to Tempo trace
  useTraceIdAsTransactionId: true,

  setupHooks: (instance) => {
    // Auth interceptor
    instance.interceptors.request.use((config) => {
      const token = localStorage.getItem('token');
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      }
      return config;
    });

    // Log request for debugging
    instance.interceptors.request.use((config) => {
      console.log('[HTTP]', config.method?.toUpperCase(), config.url, {
        traceparent: config.headers['traceparent'],
        transactionId: config.headers['X-Transaction-ID'],
      });
      return config;
    });
  },
});

// ============================================================================
// OPTION 2: Full OpenTelemetry in Frontend
// Install: npm install @opentelemetry/api @opentelemetry/sdk-trace-web
// ============================================================================

/**
 * Initialize OpenTelemetry in your app's entry point (main.ts)
 *
 * ```typescript
 * // src/tracing.ts
 * import { WebTracerProvider } from '@opentelemetry/sdk-trace-web';
 * import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
 * import { SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
 * import { Resource } from '@opentelemetry/resources';
 * import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';
 *
 * const provider = new WebTracerProvider({
 *   resource: new Resource({
 *     [ATTR_SERVICE_NAME]: 'my-frontend-app',
 *   }),
 * });
 *
 * provider.addSpanProcessor(
 *   new SimpleSpanProcessor(
 *     new OTLPTraceExporter({
 *       url: 'https://otel-collector.example.com/v1/traces',
 *     })
 *   )
 * );
 *
 * provider.register();
 * ```
 *
 * When OTel SDK is initialized, http-client automatically:
 * 1. Detects active OTel span
 * 2. Uses its trace ID for X-Transaction-ID
 * 3. Lets OTel SDK inject traceparent (via XMLHttpRequest instrumentation)
 */

// ============================================================================
// GO BACKEND: otelgo middleware example
// ============================================================================

/**
 * Your Go backend with otelgo will automatically:
 * 1. Read traceparent header from request
 * 2. Continue the trace with the same trace ID
 * 3. Export to Tempo via OTel Collector
 *
 * ```go
 * // middleware/otelgo.go
 * package middleware
 *
 * import (
 *     "github.com/Maximumsoft-Co-LTD/otelgo/eto"
 *     "github.com/gin-gonic/gin"
 *     "go.opentelemetry.io/otel/trace"
 * )
 *
 * func OTELMiddleware() gin.HandlerFunc {
 *     return func(c *gin.Context) {
 *         // eto.Propagate() reads traceparent header automatically
 *         ctx := eto.Propagate().FromHTTPRequest(c.Request)
 *
 *         ctx, span := eto.Trace().
 *             Name(c.FullPath()).
 *             FromContext(ctx).
 *             Kind(trace.SpanKindServer).
 *             Attr("http.method", c.Request.Method).
 *             Attr("http.route", c.FullPath()).
 *             Attr("transaction.id", c.GetHeader("X-Transaction-ID")).
 *             Start()
 *         defer span.End()
 *
 *         c.Request = c.Request.WithContext(ctx)
 *         c.Next()
 *
 *         // Propagate trace context to response (for debugging)
 *         eto.Propagate().FromContext(ctx).ToHTTPResponse(c.Writer)
 *     }
 * }
 * ```
 */

// ============================================================================
// USAGE EXAMPLE
// ============================================================================

interface User {
  id: number;
  name: string;
}

async function exampleUsage() {
  // Make request - traceparent and X-Transaction-ID are injected automatically
  const users = await api.get<User[]>('/users');

  console.log('Users:', users);

  // In browser console, you'll see:
  // [HTTP] GET /users {
  //   traceparent: "00-a1b2c3d4e5f6...-f1e2d3c4...-01",
  //   transactionId: "a1b2c3d4e5f6..."
  // }

  // In Grafana Loki, search: {transaction_id="a1b2c3d4e5f6..."}
  // Click "View Trace" → jumps to Tempo with full trace
}

// ============================================================================
// GRAFANA CORRELATION
// ============================================================================

/**
 * To enable Loki → Tempo correlation in Grafana:
 *
 * 1. In your Go backend, log the trace ID:
 *    ```go
 *    eto.Log().
 *        FromContext(ctx).
 *        Info().
 *        Field("trace_id", span.SpanContext().TraceID().String()).
 *        Field("transaction_id", c.GetHeader("X-Transaction-ID")).
 *        Msg("Request received")
 *        .Send()
 *    ```
 *
 * 2. Configure Loki data source in Grafana:
 *    - Go to Data Sources → Loki → Derived Fields
 *    - Add field:
 *      - Name: TraceID
 *      - Regex: "trace_id":"([a-f0-9]+)"
 *      - Internal link: Tempo
 *
 * 3. Now clicking a log line in Loki shows "View Trace" button
 */

export { exampleUsage };
