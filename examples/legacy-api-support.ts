/**
 * Example: Supporting Multiple API Response Formats
 *
 * This demonstrates how to use the flexible generics to support
 * both legacy and modern API response shapes simultaneously.
 */

import { BaseAPIService } from '@my-org/http-client';

const api = new BaseAPIService({
  axiosConfig: { baseURL: 'https://api.example.com' },
});

// ============================================================================
// Scenario: Your org has multiple API response formats
// ============================================================================

// Legacy API format (older services)
interface LegacyResponse<T> {
  code: number;
  message: string;
  data: T;
}

// Modern API format (newer services)
interface ModernResponse<T> {
  success: boolean;
  payload: T;
  errors?: Array<{ field: string; message: string }>;
}

// Direct response (third-party integrations)
interface User {
  id: number;
  name: string;
}

// ============================================================================
// All three work with the same api instance
// ============================================================================

// Legacy endpoint - unwrap manually
async function fetchLegacyUsers(): Promise<User[]> {
  const response = await api.get<LegacyResponse<User[]>>('/v1/users');
  if (response.code !== 200) {
    throw new Error(response.message);
  }
  return response.data;
}

// Modern endpoint - different unwrap logic
async function fetchModernUsers(): Promise<User[]> {
  const response = await api.get<ModernResponse<User[]>>('/v2/users');
  if (!response.success) {
    throw new Error(response.errors?.[0]?.message ?? 'Unknown error');
  }
  return response.payload;
}

// Direct response (e.g., GitHub API) - no unwrapping needed
async function fetchGitHubUser(username: string): Promise<User> {
  return api.get<User>(`https://api.github.com/users/${username}`);
}

// ============================================================================
// Optional: Create typed service wrappers for consistency
// ============================================================================

/**
 * Service wrapper for legacy v1 APIs
 */
export class LegacyApiService {
  constructor(private api: BaseAPIService) {}

  async get<T>(url: string, params?: Record<string, any>): Promise<T> {
    const response = await this.api.get<LegacyResponse<T>>(url, { params });
    if (response.code !== 200) {
      throw new Error(response.message);
    }
    return response.data;
  }

  async post<T>(url: string, data?: any): Promise<T> {
    const response = await this.api.post<LegacyResponse<T>>(url, data);
    if (response.code !== 200) {
      throw new Error(response.message);
    }
    return response.data;
  }
}

/**
 * Service wrapper for modern v2 APIs
 */
export class ModernApiService {
  constructor(private api: BaseAPIService) {}

  async get<T>(url: string, params?: Record<string, any>): Promise<T> {
    const response = await this.api.get<ModernResponse<T>>(url, { params });
    if (!response.success) {
      const error = new Error(response.errors?.[0]?.message ?? 'Request failed');
      (error as any).errors = response.errors;
      throw error;
    }
    return response.payload;
  }

  async post<T>(url: string, data?: any): Promise<T> {
    const response = await this.api.post<ModernResponse<T>>(url, data);
    if (!response.success) {
      const error = new Error(response.errors?.[0]?.message ?? 'Request failed');
      (error as any).errors = response.errors;
      throw error;
    }
    return response.payload;
  }
}

// Usage
const legacyApi = new LegacyApiService(api);
const modernApi = new ModernApiService(api);

// Both return Promise<User[]> with clean interfaces
const v1Users = await legacyApi.get<User[]>('/v1/users');
const v2Users = await modernApi.get<User[]>('/v2/users');
