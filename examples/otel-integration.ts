/**
 * Example: OpenTelemetry Integration with Grafana Stack
 *
 * This demonstrates how to use @my-org/http-client with:
 * - W3C Trace Context propagation (traceparent header)
 * - Go backend using otelgo (https://github.com/Maximumsoft-Co-LTD/otelgo)
 * - Grafana Stack (Tempo for traces, Loki for logs)
 */

import { createHttpClient } from '@my-org/http-client';

// Hybrid Approach: Frontend generates trace context, backend handles tracing
export const api = createHttpClient({
  axiosConfig: {
    baseURL: import.meta.env.VITE_API_URL,
    timeout: 30000,
  },
  // Enable W3C Trace Context propagation
  enableTraceContext: true,
  // Use trace ID as transaction ID for log correlation
  useTraceIdAsTransactionId: true,
  // Service name for backend to identify frontend in traces
  serviceName: 'INDO-FRONTEND',

  setupHooks: (instance) => {
    // Auth interceptor
    instance.interceptors.request.use((config) => {
      const token = localStorage.getItem('token');
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      }
      return config;
    });

    // Debug logging
    instance.interceptors.request.use((config) => {
      console.log('[HTTP]', config.method?.toUpperCase(), config.url, {
        traceparent: config.headers['traceparent'],
        transactionId: config.headers['X-Transaction-ID'],
        sourceService: config.headers['X-Source-Service'],
      });
      return config;
    });
  },
});

/**
 * Go Backend Middleware Example (otelgo):
 *
 * ```go
 * func Observe() gin.HandlerFunc {
 *     return func(c *gin.Context) {
 *         ctxOtel := eto.Propagate().FromHTTPRequest(c.Request)
 *
 *         // Create parent span for frontend if X-Source-Service exists
 *         sourceService := c.GetHeader("X-Source-Service")
 *         if sourceService != "" {
 *             var frontendSpan trace.Span
 *             ctxOtel, frontendSpan = eto.Trace().
 *                 Name("HTTP " + c.Request.Method + " " + c.Request.URL.Path).
 *                 FromContext(ctxOtel).
 *                 Kind(trace.SpanKindClient).
 *                 Attr("service.name", sourceService).
 *                 Start()
 *             defer frontendSpan.End()
 *         }
 *
 *         observe := lgtm.TraceCtx(ctxOtel, c.Request.URL.Path)
 *         defer observe.TraceClose()
 *
 *         c.Request = c.Request.WithContext(observe.TraceCtx)
 *         c.Next()
 *     }
 * }
 * ```
 *
 * Result in Grafana Tempo:
 *
 * INDO-FRONTEND HTTP POST /api/users
 *   └── INDO-CUSTOMER-SERVICE /api/users
 *         └── INDO-MEMBER-SERVICE /member/validate
 *               └── INDO-WALLET-SERVICE /wallet/check
 */

interface User {
  id: number;
  name: string;
}

async function example() {
  // Headers are automatically injected:
  // - traceparent: 00-{traceId}-{spanId}-01
  // - X-Transaction-ID: {traceId}
  // - X-Source-Service: INDO-FRONTEND
  const users = await api.get<User[]>('/users');
  console.log('Users:', users);
}

export { example };
