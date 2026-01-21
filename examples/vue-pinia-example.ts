/**
 * Example: Using @my-org/http-client with Vue 3 + Pinia
 */

import { createHttpClient } from '@my-org/http-client';
import { useAuthStore } from '@/stores/auth';
import router from '@/router';

export const api = createHttpClient({
  axiosConfig: {
    baseURL: import.meta.env.VITE_API_BASE_URL,
    timeout: 30000,
  },
  enableTraceContext: true,
  serviceName: 'MY-FRONTEND',
  setupHooks: (instance) => {
    // Request Interceptor: Inject Auth Token
    instance.interceptors.request.use((config) => {
      const authStore = useAuthStore();
      if (authStore.accessToken) {
        config.headers.Authorization = `Bearer ${authStore.accessToken}`;
      }
      return config;
    });

    // Response Interceptor: Handle 401/403
    instance.interceptors.response.use(
      (response) => response,
      async (error) => {
        const authStore = useAuthStore();

        if (error.response?.status === 401) {
          const refreshed = await authStore.refreshToken();
          if (refreshed && error.config) {
            error.config.headers.Authorization = `Bearer ${authStore.accessToken}`;
            return instance.request(error.config);
          }
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

// Usage in composables
import { ref } from 'vue';

interface User {
  id: number;
  name: string;
  email: string;
}

export function useUsers() {
  const users = ref<User[]>([]);
  const loading = ref(false);

  async function fetchUsers() {
    loading.value = true;
    try {
      users.value = await api.get<User[]>('/users');
    } finally {
      loading.value = false;
    }
  }

  return { users, loading, fetchUsers };
}
