/**
 * Example: Using @my-org/http-client with React + Redux/Zustand
 *
 * This demonstrates that the library is truly framework-agnostic.
 * The same patterns work with any state management solution.
 */

import { BaseAPIService } from '@my-org/http-client';

// ============================================================================
// Setup with Zustand (lightweight state management)
// ============================================================================

// stores/authStore.ts (Zustand example)
import { create } from 'zustand';

interface AuthState {
  token: string | null;
  setToken: (token: string | null) => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  token: localStorage.getItem('token'),
  setToken: (token) => {
    if (token) {
      localStorage.setItem('token', token);
    } else {
      localStorage.removeItem('token');
    }
    set({ token });
  },
}));

// services/api.ts
export const api = new BaseAPIService({
  axiosConfig: {
    baseURL: process.env.REACT_APP_API_URL,
    timeout: 30000,
  },
  setupHooks: (instance) => {
    instance.interceptors.request.use((config) => {
      // Access Zustand store outside of React
      const token = useAuthStore.getState().token;
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      }
      return config;
    });

    instance.interceptors.response.use(
      (response) => response,
      (error) => {
        if (error.response?.status === 401) {
          useAuthStore.getState().setToken(null);
          window.location.href = '/login';
        }
        return Promise.reject(error);
      }
    );
  },
});

// ============================================================================
// React Query Integration
// ============================================================================

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

interface User {
  id: number;
  name: string;
  email: string;
}

// hooks/useUsers.ts
export function useUsers() {
  return useQuery({
    queryKey: ['users'],
    queryFn: () => api.get<User[]>('/users'),
  });
}

export function useUser(id: number) {
  return useQuery({
    queryKey: ['users', id],
    queryFn: () => api.get<User>(`/users/${id}`),
    enabled: !!id,
  });
}

export function useCreateUser() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: Omit<User, 'id'>) => api.post<User>('/users', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
    },
  });
}

export function useUpdateUser() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, ...data }: User) => api.put<User>(`/users/${id}`, data),
    onSuccess: (data) => {
      queryClient.setQueryData(['users', data.id], data);
      queryClient.invalidateQueries({ queryKey: ['users'] });
    },
  });
}

export function useDeleteUser() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: number) => api.delete<void>(`/users/${id}`),
    onSuccess: (_, id) => {
      queryClient.removeQueries({ queryKey: ['users', id] });
      queryClient.invalidateQueries({ queryKey: ['users'] });
    },
  });
}

// ============================================================================
// Component Usage Example
// ============================================================================

// components/UserList.tsx
import React from 'react';

export function UserList() {
  const { data: users, isLoading, error } = useUsers();
  const createUser = useCreateUser();

  if (isLoading) return <div>Loading...</div>;
  if (error) return <div>Error: {error.message}</div>;

  const handleCreate = async () => {
    await createUser.mutateAsync({
      name: 'New User',
      email: 'new@example.com',
    });
  };

  return (
    <div>
      <button onClick={handleCreate} disabled={createUser.isPending}>
        {createUser.isPending ? 'Creating...' : 'Add User'}
      </button>
      <ul>
        {users?.map((user) => (
          <li key={user.id}>{user.name}</li>
        ))}
      </ul>
    </div>
  );
}

// ============================================================================
// SWR Integration (Alternative to React Query)
// ============================================================================

import useSWR from 'swr';

// Generic fetcher using our api client
const fetcher = <T,>(url: string) => api.get<T>(url);

export function useUsersSWR() {
  return useSWR<User[]>('/users', fetcher);
}

export function useUserSWR(id: number) {
  return useSWR<User>(id ? `/users/${id}` : null, fetcher);
}
