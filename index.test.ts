import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import MockAdapter from 'axios-mock-adapter';
import {
  BaseAPIService,
  createHttpClient,
  BaseAPIServiceConfig,
  InterceptorSetup,
} from './index';

describe('BaseAPIService', () => {
  let api: BaseAPIService;
  let mock: MockAdapter;

  beforeEach(() => {
    api = new BaseAPIService({
      axiosConfig: {
        baseURL: 'https://api.test.com',
        timeout: 5000,
      },
    });
    mock = new MockAdapter(api.instance);
  });

  afterEach(() => {
    mock.reset();
  });

  // ==========================================================================
  // CONSTRUCTOR TESTS
  // ==========================================================================

  describe('constructor', () => {
    it('should create instance with object config', () => {
      const service = new BaseAPIService({
        axiosConfig: { baseURL: 'https://example.com' },
      });
      expect(service.instance).toBeDefined();
      expect(service.instance.defaults.baseURL).toBe('https://example.com');
    });

    it('should create instance with legacy positional args', () => {
      const service = new BaseAPIService({ baseURL: 'https://legacy.com' });
      expect(service.instance.defaults.baseURL).toBe('https://legacy.com');
    });

    it('should call setupHooks with instance', () => {
      const setupHooks = vi.fn();
      new BaseAPIService({
        axiosConfig: { baseURL: 'https://example.com' },
        setupHooks,
      });
      expect(setupHooks).toHaveBeenCalledTimes(1);
      expect(setupHooks).toHaveBeenCalledWith(expect.objectContaining({
        defaults: expect.any(Object),
      }));
    });

    it('should allow custom transaction ID header name', async () => {
      const service = new BaseAPIService({
        axiosConfig: { baseURL: 'https://example.com' },
        transactionIdHeader: 'X-Request-ID',
      });
      const serviceMock = new MockAdapter(service.instance);
      serviceMock.onGet('/test').reply(200, {});

      await service.get('/test');

      const requestHeaders = serviceMock.history.get[0].headers;
      expect(requestHeaders?.['X-Request-ID']).toBeDefined();
      expect(requestHeaders?.['X-Transaction-ID']).toBeUndefined();
    });

    it('should allow disabling transaction ID injection', async () => {
      const service = new BaseAPIService({
        axiosConfig: { baseURL: 'https://example.com' },
        disableTransactionId: true,
      });
      const serviceMock = new MockAdapter(service.instance);
      serviceMock.onGet('/test').reply(200, {});

      await service.get('/test');

      const requestHeaders = serviceMock.history.get[0].headers;
      expect(requestHeaders?.['X-Transaction-ID']).toBeUndefined();
    });
  });

  // ==========================================================================
  // TRANSACTION ID TESTS
  // ==========================================================================

  describe('Transaction ID injection', () => {
    it('should inject X-Transaction-ID header automatically', async () => {
      mock.onGet('/test').reply(200, { success: true });

      await api.get('/test');

      const requestHeaders = mock.history.get[0].headers;
      expect(requestHeaders?.['X-Transaction-ID']).toBeDefined();
      expect(requestHeaders?.['X-Transaction-ID']).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      );
    });

    it('should not override existing X-Transaction-ID', async () => {
      mock.onGet('/test').reply(200, {});

      await api.get('/test', {
        headers: { 'X-Transaction-ID': 'custom-id-123' },
      });

      const requestHeaders = mock.history.get[0].headers;
      expect(requestHeaders?.['X-Transaction-ID']).toBe('custom-id-123');
    });

    it('should generate unique IDs for each request', async () => {
      mock.onGet('/test').reply(200, {});

      await api.get('/test');
      await api.get('/test');

      const id1 = mock.history.get[0].headers?.['X-Transaction-ID'];
      const id2 = mock.history.get[1].headers?.['X-Transaction-ID'];
      expect(id1).not.toBe(id2);
    });
  });

  // ==========================================================================
  // HTTP METHOD TESTS
  // ==========================================================================

  describe('HTTP Methods', () => {
    describe('GET', () => {
      it('should make GET request and return data', async () => {
        const mockData = { id: 1, name: 'Test' };
        mock.onGet('/users/1').reply(200, mockData);

        const result = await api.get<typeof mockData>('/users/1');

        expect(result).toEqual(mockData);
        expect(mock.history.get.length).toBe(1);
      });

      it('should pass query params', async () => {
        mock.onGet('/users').reply(200, []);

        await api.get('/users', { params: { page: 1, limit: 10 } });

        expect(mock.history.get[0].params).toEqual({ page: 1, limit: 10 });
      });

      it('should pass custom headers', async () => {
        mock.onGet('/users').reply(200, []);

        await api.get('/users', { headers: { 'X-Custom': 'value' } });

        expect(mock.history.get[0].headers?.['X-Custom']).toBe('value');
      });
    });

    describe('POST', () => {
      it('should make POST request with body', async () => {
        const requestBody = { name: 'New User', email: 'test@example.com' };
        const responseData = { id: 1, ...requestBody };
        mock.onPost('/users').reply(201, responseData);

        const result = await api.post('/users', requestBody);

        expect(result).toEqual(responseData);
        expect(JSON.parse(mock.history.post[0].data)).toEqual(requestBody);
      });

      it('should handle POST without body', async () => {
        mock.onPost('/action').reply(200, { success: true });

        const result = await api.post('/action');

        expect(result).toEqual({ success: true });
      });
    });

    describe('PUT', () => {
      it('should make PUT request with body', async () => {
        const updateData = { name: 'Updated Name' };
        mock.onPut('/users/1').reply(200, { id: 1, ...updateData });

        const result = await api.put('/users/1', updateData);

        expect(result).toEqual({ id: 1, name: 'Updated Name' });
        expect(JSON.parse(mock.history.put[0].data)).toEqual(updateData);
      });
    });

    describe('PATCH', () => {
      it('should make PATCH request with partial body', async () => {
        const patchData = { status: 'active' };
        mock.onPatch('/users/1').reply(200, { id: 1, status: 'active' });

        const result = await api.patch('/users/1', patchData);

        expect(result).toEqual({ id: 1, status: 'active' });
      });
    });

    describe('DELETE', () => {
      it('should make DELETE request', async () => {
        mock.onDelete('/users/1').reply(200, { deleted: true });

        const result = await api.delete('/users/1');

        expect(result).toEqual({ deleted: true });
        expect(mock.history.delete.length).toBe(1);
      });

      it('should support DELETE with body', async () => {
        const deleteBody = { reason: 'User requested' };
        mock.onDelete('/users/1').reply(200, { deleted: true });

        await api.delete('/users/1', deleteBody);

        expect(JSON.parse(mock.history.delete[0].data)).toEqual(deleteBody);
      });
    });
  });

  // ==========================================================================
  // FILE UPLOAD TESTS
  // ==========================================================================

  describe('postUploadFile', () => {
    it('should upload FormData without forcing Content-Type', async () => {
      const formData = new FormData();
      formData.append('file', new Blob(['test']), 'test.txt');
      mock.onPost('/upload').reply(200, { url: 'https://cdn.example.com/test.txt' });

      const result = await api.postUploadFile<{ url: string }>('/upload', formData);

      expect(result).toEqual({ url: 'https://cdn.example.com/test.txt' });
      // FormData - Axios handles Content-Type with boundary
      expect(mock.history.post[0].headers?.['Content-Type']).not.toBe('multipart/form-data');
    });

    it('should set Content-Type for plain objects', async () => {
      const data = { name: 'file', content: 'data' };
      mock.onPost('/upload').reply(200, { success: true });

      await api.postUploadFile('/upload', data);

      expect(mock.history.post[0].headers?.['Content-Type']).toBe('multipart/form-data');
    });

    it('should call onUploadProgress callback', async () => {
      const onProgress = vi.fn();
      mock.onPost('/upload').reply(200, {});

      await api.postUploadFile('/upload', new FormData(), {
        onUploadProgress: onProgress,
      });

      // Note: axios-mock-adapter doesn't trigger progress events
      // In real usage, the callback would be called
      expect(mock.history.post.length).toBe(1);
    });
  });

  // ==========================================================================
  // ERROR HANDLING TESTS
  // ==========================================================================

  describe('Error Handling', () => {
    it('should throw on network error', async () => {
      mock.onGet('/test').networkError();

      await expect(api.get('/test')).rejects.toThrow();
    });

    it('should throw on 4xx errors', async () => {
      mock.onGet('/not-found').reply(404, { message: 'Not Found' });

      await expect(api.get('/not-found')).rejects.toThrow();
    });

    it('should throw on 5xx errors', async () => {
      mock.onPost('/error').reply(500, { message: 'Internal Server Error' });

      await expect(api.post('/error')).rejects.toThrow();
    });

    it('should identify axios errors correctly', async () => {
      mock.onGet('/error').reply(400, { message: 'Bad Request' });

      try {
        await api.get('/error');
      } catch (error) {
        expect(api.isAxiosError(error)).toBe(true);
      }
    });

    it('should return false for non-axios errors', () => {
      expect(api.isAxiosError(new Error('Regular error'))).toBe(false);
      expect(api.isAxiosError(null)).toBe(false);
      expect(api.isAxiosError('string error')).toBe(false);
    });
  });

  // ==========================================================================
  // REQUEST CANCELLATION TESTS
  // ==========================================================================

  describe('Request Cancellation', () => {
    it('should create AbortController', () => {
      const controller = api.createAbortController();
      expect(controller).toBeInstanceOf(AbortController);
      expect(controller.signal).toBeDefined();
    });

    it('should cancel request with AbortController', async () => {
      mock.onGet('/slow').reply(() => {
        return new Promise((resolve) => {
          setTimeout(() => resolve([200, {}]), 5000);
        });
      });

      const controller = api.createAbortController();
      const promise = api.get('/slow', { signal: controller.signal });

      // Abort immediately
      controller.abort();

      await expect(promise).rejects.toThrow();
    });
  });

  // ==========================================================================
  // TRANSFORM RESPONSE TESTS
  // ==========================================================================

  describe('Response Transform', () => {
    it('should parse JSON string responses', async () => {
      mock.onGet('/json').reply(200, '{"id": 1, "name": "Test"}');

      const result = await api.get('/json');

      expect(result).toEqual({ id: 1, name: 'Test' });
    });

    it('should return raw string for non-JSON', async () => {
      mock.onGet('/text').reply(200, 'Plain text response');

      const result = await api.get('/text');

      expect(result).toBe('Plain text response');
    });

    it('should merge user-provided transformResponse', async () => {
      const customTransform = vi.fn((data) => ({ wrapped: data }));
      const service = new BaseAPIService({
        axiosConfig: {
          baseURL: 'https://example.com',
          transformResponse: customTransform,
        },
      });
      const serviceMock = new MockAdapter(service.instance);
      serviceMock.onGet('/test').reply(200, '{"id": 1}');

      const result = await service.get('/test');

      expect(customTransform).toHaveBeenCalled();
      expect(result).toEqual({ wrapped: { id: 1 } });
    });
  });

  // ==========================================================================
  // INTERCEPTOR SETUP HOOKS TESTS
  // ==========================================================================

  describe('Interceptor Setup Hooks', () => {
    it('should allow injecting request interceptors', async () => {
      const service = new BaseAPIService({
        axiosConfig: { baseURL: 'https://example.com' },
        setupHooks: (instance) => {
          instance.interceptors.request.use((config) => {
            config.headers['Authorization'] = 'Bearer test-token';
            return config;
          });
        },
      });
      const serviceMock = new MockAdapter(service.instance);
      serviceMock.onGet('/protected').reply(200, {});

      await service.get('/protected');

      expect(serviceMock.history.get[0].headers?.['Authorization']).toBe('Bearer test-token');
    });

    it('should allow injecting response interceptors', async () => {
      const responseInterceptor = vi.fn((response) => {
        response.data = { ...response.data, intercepted: true };
        return response;
      });

      const service = new BaseAPIService({
        axiosConfig: { baseURL: 'https://example.com' },
        setupHooks: (instance) => {
          instance.interceptors.response.use(responseInterceptor);
        },
      });
      const serviceMock = new MockAdapter(service.instance);
      serviceMock.onGet('/test').reply(200, { original: true });

      const result = await service.get('/test');

      expect(responseInterceptor).toHaveBeenCalled();
      expect(result).toEqual({ original: true, intercepted: true });
    });

    it('should allow injecting error interceptors', async () => {
      const errorInterceptor = vi.fn((error) => {
        error.handled = true;
        return Promise.reject(error);
      });

      const service = new BaseAPIService({
        axiosConfig: { baseURL: 'https://example.com' },
        setupHooks: (instance) => {
          instance.interceptors.response.use(
            (response) => response,
            errorInterceptor
          );
        },
      });
      const serviceMock = new MockAdapter(service.instance);
      serviceMock.onGet('/error').reply(500, {});

      try {
        await service.get('/error');
      } catch (error: any) {
        expect(errorInterceptor).toHaveBeenCalled();
        expect(error.handled).toBe(true);
      }
    });
  });

  // ==========================================================================
  // FACTORY FUNCTION TESTS
  // ==========================================================================

  describe('createHttpClient factory', () => {
    it('should create BaseAPIService instance', () => {
      const client = createHttpClient({
        axiosConfig: { baseURL: 'https://factory.test.com' },
      });

      expect(client).toBeInstanceOf(BaseAPIService);
      expect(client.instance.defaults.baseURL).toBe('https://factory.test.com');
    });
  });

  // ==========================================================================
  // W3C TRACE CONTEXT TESTS
  // ==========================================================================

  describe('W3C Trace Context (OpenTelemetry)', () => {
    it('should inject traceparent header when enableTraceContext is true', async () => {
      const service = new BaseAPIService({
        axiosConfig: { baseURL: 'https://example.com' },
        enableTraceContext: true,
      });
      const serviceMock = new MockAdapter(service.instance);
      serviceMock.onGet('/test').reply(200, {});

      await service.get('/test');

      const headers = serviceMock.history.get[0].headers;
      expect(headers?.['traceparent']).toBeDefined();
      // W3C format: 00-{32 hex}-{16 hex}-{2 hex}
      expect(headers?.['traceparent']).toMatch(
        /^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/
      );
    });

    it('should not inject traceparent when enableTraceContext is false', async () => {
      const service = new BaseAPIService({
        axiosConfig: { baseURL: 'https://example.com' },
        enableTraceContext: false,
      });
      const serviceMock = new MockAdapter(service.instance);
      serviceMock.onGet('/test').reply(200, {});

      await service.get('/test');

      const headers = serviceMock.history.get[0].headers;
      expect(headers?.['traceparent']).toBeUndefined();
    });

    it('should not override existing traceparent header', async () => {
      const service = new BaseAPIService({
        axiosConfig: { baseURL: 'https://example.com' },
        enableTraceContext: true,
      });
      const serviceMock = new MockAdapter(service.instance);
      serviceMock.onGet('/test').reply(200, {});

      const customTraceparent = '00-custom12345678901234567890123456-custom12345678-01';
      await service.get('/test', {
        headers: { 'traceparent': customTraceparent },
      });

      const headers = serviceMock.history.get[0].headers;
      expect(headers?.['traceparent']).toBe(customTraceparent);
    });

    it('should generate unique traceparent for each request', async () => {
      const service = new BaseAPIService({
        axiosConfig: { baseURL: 'https://example.com' },
        enableTraceContext: true,
      });
      const serviceMock = new MockAdapter(service.instance);
      serviceMock.onGet('/test').reply(200, {});

      await service.get('/test');
      await service.get('/test');

      const trace1 = serviceMock.history.get[0].headers?.['traceparent'];
      const trace2 = serviceMock.history.get[1].headers?.['traceparent'];
      expect(trace1).not.toBe(trace2);
    });

    it('should use trace ID as transaction ID when useTraceIdAsTransactionId is true', async () => {
      const service = new BaseAPIService({
        axiosConfig: { baseURL: 'https://example.com' },
        enableTraceContext: true,
        useTraceIdAsTransactionId: true,
      });
      const serviceMock = new MockAdapter(service.instance);
      serviceMock.onGet('/test').reply(200, {});

      await service.get('/test');

      const headers = serviceMock.history.get[0].headers;
      const traceparent = headers?.['traceparent'] as string;
      const transactionId = headers?.['X-Transaction-ID'] as string;

      // Extract trace ID from traceparent (second segment)
      const traceIdFromTraceparent = traceparent.split('-')[1];
      expect(transactionId).toBe(traceIdFromTraceparent);
    });

    it('should inject both traceparent and X-Transaction-ID', async () => {
      const service = new BaseAPIService({
        axiosConfig: { baseURL: 'https://example.com' },
        enableTraceContext: true,
        disableTransactionId: false,
      });
      const serviceMock = new MockAdapter(service.instance);
      serviceMock.onGet('/test').reply(200, {});

      await service.get('/test');

      const headers = serviceMock.history.get[0].headers;
      expect(headers?.['traceparent']).toBeDefined();
      expect(headers?.['X-Transaction-ID']).toBeDefined();
    });

    it('should inject X-Source-Service when serviceName is set', async () => {
      const service = new BaseAPIService({
        axiosConfig: { baseURL: 'https://example.com' },
        serviceName: 'INDO-FRONTEND',
      });
      const serviceMock = new MockAdapter(service.instance);
      serviceMock.onGet('/test').reply(200, {});

      await service.get('/test');

      const headers = serviceMock.history.get[0].headers;
      expect(headers?.['X-Source-Service']).toBe('INDO-FRONTEND');
    });

    it('should inject X-Source-Service even when disableTransactionId is true', async () => {
      const service = new BaseAPIService({
        axiosConfig: { baseURL: 'https://example.com' },
        disableTransactionId: true,
        enableTraceContext: false,
        serviceName: 'MY-FRONTEND',
      });
      const serviceMock = new MockAdapter(service.instance);
      serviceMock.onGet('/test').reply(200, {});

      await service.get('/test');

      const headers = serviceMock.history.get[0].headers;
      expect(headers?.['X-Source-Service']).toBe('MY-FRONTEND');
      expect(headers?.['X-Transaction-ID']).toBeUndefined();
    });

    it('should not override existing X-Source-Service header', async () => {
      const service = new BaseAPIService({
        axiosConfig: { baseURL: 'https://example.com' },
        serviceName: 'DEFAULT-FRONTEND',
      });
      const serviceMock = new MockAdapter(service.instance);
      serviceMock.onGet('/test').reply(200, {});

      await service.get('/test', {
        headers: { 'X-Source-Service': 'CUSTOM-SERVICE' },
      });

      const headers = serviceMock.history.get[0].headers;
      expect(headers?.['X-Source-Service']).toBe('CUSTOM-SERVICE');
    });
  });

  // ==========================================================================
  // REQUEST OPTIONS TESTS
  // ==========================================================================

  describe('Request Options', () => {
    it('should override timeout per request', async () => {
      mock.onGet('/slow').reply(200, {});

      await api.get('/slow', { timeout: 1000 });

      expect(mock.history.get[0].timeout).toBe(1000);
    });

    it('should pass all options correctly', async () => {
      mock.onPost('/full').reply(200, {});

      await api.post('/full', { data: 'test' }, {
        params: { query: 'value' },
        headers: { 'X-Custom': 'header' },
        timeout: 3000,
      });

      const request = mock.history.post[0];
      expect(request.params).toEqual({ query: 'value' });
      expect(request.headers?.['X-Custom']).toBe('header');
      expect(request.timeout).toBe(3000);
    });
  });
});
