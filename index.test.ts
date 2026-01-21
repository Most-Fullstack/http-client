import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import MockAdapter from 'axios-mock-adapter';
import {
  BaseAPIService,
  createHttpClient,
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

  describe('constructor', () => {
    it('should create instance with object config', () => {
      const service = new BaseAPIService({
        axiosConfig: { baseURL: 'https://example.com' },
      });
      expect(service.instance).toBeDefined();
      expect(service.instance.defaults.baseURL).toBe('https://example.com');
    });

    it('should call setupHooks with instance', () => {
      const setupHooks = vi.fn();
      new BaseAPIService({
        axiosConfig: { baseURL: 'https://example.com' },
        setupHooks,
      });
      expect(setupHooks).toHaveBeenCalledTimes(1);
    });
  });

  describe('Transaction ID injection', () => {
    it('should inject X-Transaction-ID header automatically', async () => {
      mock.onGet('/test').reply(200, { success: true });
      await api.get('/test');
      const requestHeaders = mock.history.get[0].headers;
      expect(requestHeaders?.['X-Transaction-ID']).toBeDefined();
    });

    it('should not override existing X-Transaction-ID', async () => {
      mock.onGet('/test').reply(200, {});
      await api.get('/test', {
        headers: { 'X-Transaction-ID': 'custom-id-123' },
      });
      const requestHeaders = mock.history.get[0].headers;
      expect(requestHeaders?.['X-Transaction-ID']).toBe('custom-id-123');
    });
  });

  describe('HTTP Methods', () => {
    it('should make GET request and return data', async () => {
      const mockData = { id: 1, name: 'Test' };
      mock.onGet('/users/1').reply(200, mockData);
      const result = await api.get<typeof mockData>('/users/1');
      expect(result).toEqual(mockData);
    });

    it('should make POST request with body', async () => {
      const requestBody = { name: 'New User' };
      const responseData = { id: 1, ...requestBody };
      mock.onPost('/users').reply(201, responseData);
      const result = await api.post('/users', requestBody);
      expect(result).toEqual(responseData);
    });

    it('should make PUT request with body', async () => {
      const updateData = { name: 'Updated Name' };
      mock.onPut('/users/1').reply(200, { id: 1, ...updateData });
      const result = await api.put('/users/1', updateData);
      expect(result).toEqual({ id: 1, name: 'Updated Name' });
    });

    it('should make DELETE request', async () => {
      mock.onDelete('/users/1').reply(200, { deleted: true });
      const result = await api.delete('/users/1');
      expect(result).toEqual({ deleted: true });
    });
  });

  describe('W3C Trace Context', () => {
    it('should inject traceparent when enabled', async () => {
      const service = new BaseAPIService({
        axiosConfig: { baseURL: 'https://example.com' },
        enableTraceContext: true,
      });
      const serviceMock = new MockAdapter(service.instance);
      serviceMock.onGet('/test').reply(200, {});
      await service.get('/test');
      const headers = serviceMock.history.get[0].headers;
      expect(headers?.['traceparent']).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/);
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
  });

  describe('Error Handling', () => {
    it('should throw on network error', async () => {
      mock.onGet('/test').networkError();
      await expect(api.get('/test')).rejects.toThrow();
    });

    it('should identify axios errors correctly', async () => {
      mock.onGet('/error').reply(400, { message: 'Bad Request' });
      try {
        await api.get('/error');
      } catch (error) {
        expect(api.isAxiosError(error)).toBe(true);
      }
    });
  });

  describe('createHttpClient factory', () => {
    it('should create BaseAPIService instance', () => {
      const client = createHttpClient({
        axiosConfig: { baseURL: 'https://factory.test.com' },
      });
      expect(client).toBeInstanceOf(BaseAPIService);
    });
  });
});
