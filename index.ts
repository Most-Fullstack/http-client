import axios, {
  AxiosInstance,
  AxiosRequestConfig,
  InternalAxiosRequestConfig,
  AxiosError,
  AxiosProgressEvent,
} from 'axios';
import { v4 as uuidv4 } from 'uuid';

// =============================================================================
// OpenTelemetry Integration (Optional)
// =============================================================================

interface OTelSpanContext {
  traceId: string;
  spanId: string;
  traceFlags: number;
}

interface OTelSpan {
  spanContext(): OTelSpanContext;
}

interface OTelContext {}

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
 * Attempts to load @opentelemetry/api if available.
 * Returns undefined if not installed - library works without it.
 */
function getOTelAPI(): OTelAPI | undefined {
  if (typeof globalThis !== 'undefined' && (globalThis as any).__otel_api) {
    return (globalThis as any).__otel_api as OTelAPI;
  }

  try {
    const requireFunc = typeof require !== 'undefined' ? require : undefined;
    if (requireFunc) {
      return requireFunc('@opentelemetry/api') as OTelAPI;
    }
  } catch {
    // @opentelemetry/api not installed
  }

  return undefined;
}

/**
 * Generates cryptographically random hex string.
 */
function randomHex(length: number): string {
  const bytes = new Uint8Array(length / 2);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Generates W3C Trace Context traceparent header.
 * @see https://www.w3.org/TR/trace-context/
 */
function generateTraceparent(): { traceparent: string; traceId: string } {
  const version = '00';
  const traceId = randomHex(32);
  const parentId = randomHex(16);
  const flags = '01';

  return {
    traceparent: `${version}-${traceId}-${parentId}-${flags}`,
    traceId,
  };
}

// =============================================================================
// Types & Interfaces
// =============================================================================

/**
 * Callback for injecting application-specific interceptors.
 */
export type InterceptorSetup = (instance: AxiosInstance) => void;

/**
 * Configuration options for BaseAPIService.
 */
export interface BaseAPIServiceConfig {
  /** Axios configuration (baseURL, timeout, headers, etc.) */
  axiosConfig: AxiosRequestConfig;

  /** Callback to inject custom interceptors (auth, i18n, error handling) */
  setupHooks?: InterceptorSetup;

  /** Transaction ID header name. Default: 'X-Transaction-ID' */
  transactionIdHeader?: string;

  /** Disable automatic Transaction ID injection */
  disableTransactionId?: boolean;

  /** Enable W3C Trace Context (traceparent header) for distributed tracing */
  enableTraceContext?: boolean;

  /** Use trace ID as Transaction ID for log-trace correlation */
  useTraceIdAsTransactionId?: boolean;

  /** Service name for frontend identification in traces */
  serviceName?: string;
}

/**
 * Options for individual HTTP requests.
 */
export interface RequestOptions {
  /** Query parameters */
  params?: Record<string, any>;

  /** Additional headers */
  headers?: Record<string, string>;

  /** Request timeout in milliseconds */
  timeout?: number;

  /** AbortSignal for request cancellation */
  signal?: AbortSignal;
}

/**
 * Options for file upload requests.
 */
export interface UploadOptions extends RequestOptions {
  /** Upload progress callback */
  onUploadProgress?: (progressEvent: AxiosProgressEvent) => void;
}

// =============================================================================
// BaseAPIService
// =============================================================================

/**
 * Framework-agnostic HTTP client with automatic tracing support.
 *
 * @example Basic usage
 * ```typescript
 * const api = createHttpClient({
 *   axiosConfig: { baseURL: 'https://api.example.com' },
 * });
 *
 * const users = await api.get<User[]>('/users');
 * ```
 *
 * @example With OpenTelemetry integration
 * ```typescript
 * const api = createHttpClient({
 *   axiosConfig: { baseURL: '/api' },
 *   enableTraceContext: true,
 *   useTraceIdAsTransactionId: true,
 *   serviceName: 'MY-FRONTEND',
 *   setupHooks: (instance) => {
 *     instance.interceptors.request.use((config) => {
 *       config.headers.Authorization = `Bearer ${getToken()}`;
 *       return config;
 *     });
 *   },
 * });
 * ```
 */
export class BaseAPIService {
  public readonly instance: AxiosInstance;
  private readonly transactionIdHeader: string;

  constructor(config: BaseAPIServiceConfig);
  /** @deprecated Use object config instead. Will be removed in v2.0 */
  constructor(axiosConfig: AxiosRequestConfig, setupHooks?: InterceptorSetup);
  constructor(
    configOrAxios: BaseAPIServiceConfig | AxiosRequestConfig,
    setupHooks?: InterceptorSetup
  ) {
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
    // Request Interceptor: Tracing Headers
    // -------------------------------------------------------------------------
    const shouldAddInterceptor =
      !disableTransactionId || enableTraceContext || !!serviceName;

    if (shouldAddInterceptor) {
      const otel = getOTelAPI();

      this.instance.interceptors.request.use(
        (config: InternalAxiosRequestConfig) => {
          config.headers = config.headers ?? {};

          let traceId: string | undefined;

          // Use active OTel span if available
          if (otel) {
            try {
              const currentSpan = otel.trace.getSpan(otel.context.active());
              if (currentSpan) {
                const spanContext = currentSpan.spanContext();
                traceId = spanContext.traceId;

                if (enableTraceContext && !config.headers['X-Trace-ID']) {
                  config.headers['X-Trace-ID'] = traceId;
                }
              }
            } catch {
              // OTel not initialized, continue with fallback
            }
          }

          // Generate traceparent if enabled
          if (enableTraceContext && !config.headers['traceparent']) {
            const trace = generateTraceparent();
            config.headers['traceparent'] = trace.traceparent;
            traceId = traceId ?? trace.traceId;
          }

          // Inject Transaction ID
          if (!disableTransactionId && !config.headers[this.transactionIdHeader]) {
            config.headers[this.transactionIdHeader] =
              useTraceIdAsTransactionId && traceId ? traceId : uuidv4();
          }

          // Inject Service Name
          if (serviceName && !config.headers['X-Source-Service']) {
            config.headers['X-Source-Service'] = serviceName;
          }

          return config;
        },
        (error) => Promise.reject(error)
      );
    }

    // -------------------------------------------------------------------------
    // Response Transform: Safe JSON Parsing
    // -------------------------------------------------------------------------
    const defaultTransform = (data: unknown) => {
      if (typeof data === 'string') {
        try {
          return JSON.parse(data);
        } catch {
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
    // Custom Interceptors
    // -------------------------------------------------------------------------
    if (hooks) {
      hooks(this.instance);
    }
  }

  // ===========================================================================
  // HTTP Methods
  // ===========================================================================

  /**
   * Performs a GET request.
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
   * Performs a POST request.
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
   * Performs a PUT request.
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
   * Performs a PATCH request.
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
   * Performs a DELETE request.
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
   * Performs a file upload with multipart/form-data.
   */
  public async postUploadFile<T = unknown>(
    url: string,
    data?: FormData | Record<string, any>,
    options?: UploadOptions
  ): Promise<T> {
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
  // Utility Methods
  // ===========================================================================

  /**
   * Creates an AbortController for request cancellation.
   *
   * @example
   * ```typescript
   * const controller = api.createAbortController();
   * api.get('/endpoint', { signal: controller.signal });
   * controller.abort(); // Cancel the request
   * ```
   */
  public createAbortController(): AbortController {
    return new AbortController();
  }

  /**
   * Type guard for AxiosError.
   */
  public isAxiosError(error: unknown): error is AxiosError {
    return axios.isAxiosError(error);
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Creates a configured BaseAPIService instance.
 */
export function createHttpClient(config: BaseAPIServiceConfig): BaseAPIService {
  return new BaseAPIService(config);
}

// =============================================================================
// Re-exports
// =============================================================================

export { AxiosError } from 'axios';
export type {
  AxiosInstance,
  AxiosRequestConfig,
  AxiosResponse,
  InternalAxiosRequestConfig,
  AxiosProgressEvent,
} from 'axios';
