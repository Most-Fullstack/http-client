import axios, {
  AxiosInstance,
  AxiosRequestConfig,
  InternalAxiosRequestConfig,
  AxiosError,
  AxiosProgressEvent,
} from 'axios';
import { v4 as uuidv4 } from 'uuid';

// ============================================================================
// OPENTELEMETRY INTEGRATION (Optional)
// ============================================================================

/**
 * OpenTelemetry API types (optional peer dependency)
 * These match @opentelemetry/api interfaces
 */
interface OTelSpanContext {
  traceId: string;
  spanId: string;
  traceFlags: number;
}

interface OTelSpan {
  spanContext(): OTelSpanContext;
}

interface OTelContext {
  // Context interface
}

interface OTelTraceAPI {
  getSpan(context: OTelContext): OTelSpan | undefined;
}

interface OTelContextAPI {
  active(): OTelContext;
}

interface OTelAPI {
  trace: OTelTraceAPI;
  context: OTelContextAPI;
}

/**
 * Try to get OpenTelemetry API if available
 * Returns undefined if @opentelemetry/api is not installed
 */
function getOTelAPI(): OTelAPI | undefined {
  // Check if running in an environment that supports require
  if (typeof globalThis !== 'undefined' && (globalThis as any).__otel_api) {
    return (globalThis as any).__otel_api as OTelAPI;
  }
  
  try {
    // Dynamic require to avoid hard dependency
    // This will be tree-shaken in browser builds if not used
    const requireFunc = typeof require !== 'undefined' ? require : undefined;
    if (requireFunc) {
      const otel = requireFunc('@opentelemetry/api');
      return otel as OTelAPI;
    }
  } catch {
    // @opentelemetry/api not installed, which is fine
  }
  
  return undefined;
}

/**
 * Generate a random hex string of specified length
 */
function randomHex(length: number): string {
  const bytes = new Uint8Array(length / 2);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    // Fallback for non-browser environments
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Generate W3C Trace Context traceparent header
 * Format: {version}-{trace-id}-{parent-id}-{flags}
 * Example: 00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01
 */
function generateTraceparent(): { traceparent: string; traceId: string } {
  const version = '00';
  const traceId = randomHex(32); // 16 bytes = 32 hex chars
  const parentId = randomHex(16); // 8 bytes = 16 hex chars
  const flags = '01'; // sampled

  return {
    traceparent: `${version}-${traceId}-${parentId}-${flags}`,
    traceId,
  };
}

// ============================================================================
// TYPES & INTERFACES
// ============================================================================

/**
 * Hook type for injecting application-specific interceptors.
 * Use this to add auth tokens, locale headers, error handling, etc.
 */
export type InterceptorSetup = (instance: AxiosInstance) => void;

/**
 * Configuration options for BaseAPIService
 */
export interface BaseAPIServiceConfig {
  /** Axios request configuration (baseURL, timeout, headers, etc.) */
  axiosConfig: AxiosRequestConfig;
  /** Optional hook to inject app-specific interceptors (auth, i18n, etc.) */
  setupHooks?: InterceptorSetup;
  /** Custom Transaction ID header name (default: 'X-Transaction-ID') */
  transactionIdHeader?: string;
  /** Disable automatic Transaction ID injection */
  disableTransactionId?: boolean;
  /**
   * Enable W3C Trace Context propagation for OpenTelemetry
   * When enabled, injects 'traceparent' header for distributed tracing
   * Compatible with otelgo and other OTel implementations
   */
  enableTraceContext?: boolean;
  /**
   * Use OTel trace ID as Transaction ID when available
   * This correlates logs with traces in Grafana (Loki → Tempo)
   */
  useTraceIdAsTransactionId?: boolean;
  /**
   * Service name for trace identification (e.g., 'FRONTEND')
   * When set, injects 'X-Source-Service' header so backend can create
   * a parent span representing the frontend in distributed traces
   */
  serviceName?: string;
}

/**
 * Options for individual requests
 */
export interface RequestOptions {
  /** Query parameters */
  params?: Record<string, any>;
  /** Additional headers for this request only */
  headers?: Record<string, string>;
  /** Override timeout for this request */
  timeout?: number;
  /** Abort signal for request cancellation */
  signal?: AbortSignal;
}

/**
 * Options for file upload requests
 */
export interface UploadOptions extends RequestOptions {
  /** Upload progress callback */
  onUploadProgress?: (progressEvent: AxiosProgressEvent) => void;
}

// ============================================================================
// CORE SERVICE CLASS
// ============================================================================

/**
 * BaseAPIService - Framework-agnostic HTTP client wrapper
 *
 * Features:
 * - Automatic Transaction ID injection for request tracing
 * - Flexible generics (no enforced response shape)
 * - Dependency injection for app-specific interceptors
 * - TypeScript-first with full type safety
 *
 * @example
 * ```typescript
 * const api = new BaseAPIService({
 *   axiosConfig: { baseURL: 'https://api.example.com', timeout: 10000 },
 *   setupHooks: (instance) => {
 *     instance.interceptors.request.use((config) => {
 *       config.headers.Authorization = `Bearer ${getToken()}`;
 *       return config;
 *     });
 *   }
 * });
 *
 * const users = await api.get<User[]>('/users');
 * ```
 */
export class BaseAPIService {
  public readonly instance: AxiosInstance;
  private readonly transactionIdHeader: string;

  constructor(config: BaseAPIServiceConfig);
  /** @deprecated Use object config. Will be removed in v2.0 */
  constructor(axiosConfig: AxiosRequestConfig, setupHooks?: InterceptorSetup);
  constructor(
    configOrAxios: BaseAPIServiceConfig | AxiosRequestConfig,
    setupHooks?: InterceptorSetup
  ) {
    // Handle both new object config and legacy positional args
    const isLegacyCall = !('axiosConfig' in configOrAxios);
    const resolvedConfig: BaseAPIServiceConfig = isLegacyCall
      ? { axiosConfig: configOrAxios, setupHooks }
      : configOrAxios;

    const {
      axiosConfig,
      setupHooks: hooks,
      transactionIdHeader = 'X-Transaction-ID',
      disableTransactionId = false,
      enableTraceContext = false,
      useTraceIdAsTransactionId = false,
      serviceName,
    } = resolvedConfig;

    this.transactionIdHeader = transactionIdHeader;
    this.instance = axios.create(axiosConfig);

    // -------------------------------------------------------------------------
    // CORE INTERCEPTORS
    // -------------------------------------------------------------------------

    // A. Inject Transaction ID, Trace Context, and/or Service Name
    const shouldAddInterceptor = !disableTransactionId || enableTraceContext || !!serviceName;
    
    if (shouldAddInterceptor) {
      const otel = getOTelAPI();

      this.instance.interceptors.request.use(
        (config: InternalAxiosRequestConfig) => {
          config.headers = config.headers ?? {};

          let traceId: string | undefined;

          // 1. Try to get trace ID from active OTel span (if OTel SDK is initialized)
          if (otel) {
            try {
              const currentSpan = otel.trace.getSpan(otel.context.active());
              if (currentSpan) {
                const spanContext = currentSpan.spanContext();
                traceId = spanContext.traceId;

                // OTel SDK handles traceparent injection automatically via instrumentation
                // But we can also inject X-Trace-ID for explicit correlation
                if (enableTraceContext && !config.headers['X-Trace-ID']) {
                  config.headers['X-Trace-ID'] = traceId;
                }
              }
            } catch {
              // OTel API available but not initialized, continue with fallback
            }
          }

          // 2. Generate W3C traceparent if enabled and not already set
          if (enableTraceContext && !config.headers['traceparent']) {
            const trace = generateTraceparent();
            config.headers['traceparent'] = trace.traceparent;
            traceId = traceId ?? trace.traceId;
          }

          // 3. Inject Transaction ID
          if (!disableTransactionId && !config.headers[this.transactionIdHeader]) {
            // Use trace ID if available and configured, otherwise generate UUID
            config.headers[this.transactionIdHeader] =
              useTraceIdAsTransactionId && traceId ? traceId : uuidv4();
          }

          // 4. Inject Service Name for frontend identification in traces
          if (serviceName && !config.headers['X-Source-Service']) {
            config.headers['X-Source-Service'] = serviceName;
          }

          return config;
        },
        (error) => Promise.reject(error)
      );
    }

    // B. Default JSON Transform (safe parsing)
    // Merge with user-provided transforms instead of overwriting
    const defaultTransform = (data: unknown) => {
      if (typeof data === 'string') {
        try {
          return JSON.parse(data);
        } catch {
          // Return raw string if not valid JSON
          return data;
        }
      }
      return data;
    };

    const userTransforms = axiosConfig.transformResponse
      ? Array.isArray(axiosConfig.transformResponse)
        ? axiosConfig.transformResponse
        : [axiosConfig.transformResponse]
      : [];

    this.instance.defaults.transformResponse = [defaultTransform, ...userTransforms];

    // -------------------------------------------------------------------------
    // APP-SPECIFIC HOOKS (Auth, i18n, Error Handling, etc.)
    // -------------------------------------------------------------------------
    if (hooks) {
      hooks(this.instance);
    }
  }

  // ===========================================================================
  // HTTP METHODS
  // ===========================================================================

  /**
   * GET request
   * @param url - Endpoint path
   * @param options - Request options (params, headers, etc.)
   * @returns Promise resolving to response data of type T
   */
  public async get<T = unknown>(url: string, options?: RequestOptions): Promise<T> {
    const response = await this.instance.get<T>(url, {
      params: options?.params,
      headers: options?.headers,
      timeout: options?.timeout,
      signal: options?.signal,
    });
    return response.data;
  }

  /**
   * POST request
   * @param url - Endpoint path
   * @param data - Request body
   * @param options - Request options (params, headers, etc.)
   * @returns Promise resolving to response data of type T
   */
  public async post<T = unknown, D = unknown>(
    url: string,
    data?: D,
    options?: RequestOptions
  ): Promise<T> {
    const response = await this.instance.post<T>(url, data, {
      params: options?.params,
      headers: options?.headers,
      timeout: options?.timeout,
      signal: options?.signal,
    });
    return response.data;
  }

  /**
   * PUT request
   * @param url - Endpoint path
   * @param data - Request body
   * @param options - Request options (params, headers, etc.)
   * @returns Promise resolving to response data of type T
   */
  public async put<T = unknown, D = unknown>(
    url: string,
    data?: D,
    options?: RequestOptions
  ): Promise<T> {
    const response = await this.instance.put<T>(url, data, {
      params: options?.params,
      headers: options?.headers,
      timeout: options?.timeout,
      signal: options?.signal,
    });
    return response.data;
  }

  /**
   * PATCH request
   * @param url - Endpoint path
   * @param data - Request body
   * @param options - Request options (params, headers, etc.)
   * @returns Promise resolving to response data of type T
   */
  public async patch<T = unknown, D = unknown>(
    url: string,
    data?: D,
    options?: RequestOptions
  ): Promise<T> {
    const response = await this.instance.patch<T>(url, data, {
      params: options?.params,
      headers: options?.headers,
      timeout: options?.timeout,
      signal: options?.signal,
    });
    return response.data;
  }

  /**
   * DELETE request
   * @param url - Endpoint path
   * @param data - Optional request body (some APIs require it)
   * @param options - Request options (params, headers, etc.)
   * @returns Promise resolving to response data of type T
   */
  public async delete<T = unknown, D = unknown>(
    url: string,
    data?: D,
    options?: RequestOptions
  ): Promise<T> {
    const response = await this.instance.delete<T>(url, {
      data,
      params: options?.params,
      headers: options?.headers,
      timeout: options?.timeout,
      signal: options?.signal,
    });
    return response.data;
  }

  /**
   * POST file upload with multipart/form-data
   * @param url - Endpoint path
   * @param data - FormData or object to upload
   * @param options - Upload options (params, headers, onUploadProgress)
   * @returns Promise resolving to response data of type T
   *
   * @remarks
   * When passing FormData, Axios automatically sets the correct Content-Type
   * with boundary. For non-FormData objects, multipart/form-data is set explicitly.
   */
  public async postUploadFile<T = unknown>(
    url: string,
    data?: FormData | Record<string, any>,
    options?: UploadOptions
  ): Promise<T> {
    // Let Axios handle Content-Type for FormData (includes boundary)
    // Only force multipart/form-data for plain objects
    const headers: Record<string, string> = { ...options?.headers };
    if (data && !(data instanceof FormData)) {
      headers['Content-Type'] = 'multipart/form-data';
    }

    const response = await this.instance.post<T>(url, data, {
      params: options?.params,
      timeout: options?.timeout,
      signal: options?.signal,
      onUploadProgress: options?.onUploadProgress,
      headers,
    });
    return response.data;
  }

  // ===========================================================================
  // UTILITY METHODS
  // ===========================================================================

  /**
   * Create an AbortController for request cancellation
   * @returns AbortController instance
   *
   * @example
   * ```typescript
   * const controller = api.createAbortController();
   * api.get('/slow-endpoint', { signal: controller.signal });
   * // Later: controller.abort();
   * ```
   */
  public createAbortController(): AbortController {
    return new AbortController();
  }

  /**
   * Check if an error is an Axios error
   * @param error - Error to check
   * @returns True if error is an AxiosError
   */
  public isAxiosError(error: unknown): error is AxiosError {
    return axios.isAxiosError(error);
  }
}

// ============================================================================
// FACTORY FUNCTION (Alternative to class instantiation)
// ============================================================================

/**
 * Create a BaseAPIService instance
 * @param config - Service configuration
 * @returns Configured BaseAPIService instance
 */
export function createHttpClient(config: BaseAPIServiceConfig): BaseAPIService {
  return new BaseAPIService(config);
}

// ============================================================================
// RE-EXPORTS (Convenience for consuming apps)
// ============================================================================

export { AxiosError } from 'axios';
export type { AxiosInstance, AxiosRequestConfig, AxiosResponse, InternalAxiosRequestConfig, AxiosProgressEvent } from 'axios';
