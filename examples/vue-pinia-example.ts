/**
 * Example: Using @my-org/http-client with Vue 3 + Pinia
 *
 * This demonstrates how to inject auth tokens and handle errors
 * using Pinia stores without the library knowing about Vue/Pinia.
 */

import { BaseAPIService, createHttpClient } from '@my-org/http-client';
import { useAuthStore } from '@/stores/auth';
import { useAppStore } from '@/stores/app';
import router from '@/router';

// ============================================================================
// Option 1: Class-based instantiation
// ============================================================================

export const api = new BaseAPIService({
  axiosConfig: {
    baseURL: import.meta.env.VITE_API_BASE_URL,
    timeout: 30000,
    headers: {
      'Accept-Language': 'en',
    },
  },
  setupHooks: (instance) => {
    // --- REQUEST INTERCEPTOR: Inject Auth Token ---
    // NOTE: These interceptors run at REQUEST TIME (after app mount),
    // not at module load time. This is safe because Pinia is installed
    // before any HTTP requests are made. If you import this module before
    // calling createPinia(), the store calls will fail.
    instance.interceptors.request.use(
      (config) => {
        const authStore = useAuthStore();

        if (authStore.accessToken) {
          config.headers.Authorization = `Bearer ${authStore.accessToken}`;
        }

        // Inject locale from app store
        const appStore = useAppStore();
        config.headers['Accept-Language'] = appStore.locale;

        return config;
      },
      (error) => Promise.reject(error)
    );

    // --- RESPONSE INTERCEPTOR: Handle 401/403 ---
    instance.interceptors.response.use(
      (response) => response,
      async (error) => {
        const authStore = useAuthStore();

        if (error.response?.status === 401) {
          // Token expired - try refresh
          const refreshed = await authStore.refreshToken();
          if (refreshed && error.config) {
            // Retry original request with new token
            error.config.headers.Authorization = `Bearer ${authStore.accessToken}`;
            return instance.request(error.config);
          }
          // Refresh failed - logout
          authStore.logout();
          router.push('/login');
        }

        if (error.response?.status === 403) {
          router.push('/unauthorized');
        }

        return Promise.reject(error);
      }
    );
  },
});

// ============================================================================
// Option 2: Factory function (same result, different style)
// ============================================================================

export const apiClient = createHttpClient({
  axiosConfig: {
    baseURL: import.meta.env.VITE_API_BASE_URL,
    timeout: 30000,
  },
  setupHooks: (instance) => {
    // Same interceptor logic as above...
  },
});

// ============================================================================
// Usage in Vue Components / Composables
// ============================================================================

// types/api.ts
export interface User {
  id: number;
  email: string;
  name: string;
  avatar?: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  meta: {
    total: number;
    page: number;
    perPage: number;
  };
}

// composables/useUsers.ts
import { ref } from 'vue';
import { api } from '@/services/api';
import type { User, PaginatedResponse } from '@/types/api';

export function useUsers() {
  const users = ref<User[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);

  async function fetchUsers(page = 1) {
    loading.value = true;
    error.value = null;

    try {
      // Generic type flows through - no casting needed
      const response = await api.get<PaginatedResponse<User>>('/users', {
        params: { page, perPage: 20 },
      });
      users.value = response.data;
    } catch (e) {
      if (api.isAxiosError(e)) {
        error.value = e.response?.data?.message ?? 'Failed to fetch users';
      }
    } finally {
      loading.value = false;
    }
  }

  async function createUser(userData: Omit<User, 'id'>) {
    const newUser = await api.post<User>('/users', userData);
    users.value.push(newUser);
    return newUser;
  }

  return { users, loading, error, fetchUsers, createUser };
}

// ============================================================================
// File Upload Example
// ============================================================================

export async function uploadAvatar(userId: number, file: File) {
  const formData = new FormData();
  formData.append('avatar', file);
  formData.append('userId', String(userId));

  return api.postUploadFile<{ url: string }>(`/users/${userId}/avatar`, formData, {
    onUploadProgress: (event) => {
      const percent = Math.round((event.loaded * 100) / (event.total ?? 1));
      console.log(`Upload progress: ${percent}%`);
    },
  });
}

// ============================================================================
// Request Cancellation Example
// ============================================================================

export function useSearchUsers() {
  let abortController: AbortController | null = null;

  async function search(query: string) {
    // Cancel previous request
    abortController?.abort();
    abortController = api.createAbortController();

    try {
      return await api.get<User[]>('/users/search', {
        params: { q: query },
        signal: abortController.signal,
      });
    } catch (e) {
      if (api.isAxiosError(e) && e.code === 'ERR_CANCELED') {
        // Request was cancelled - ignore
        return [];
      }
      throw e;
    }
  }

  return { search };
}
