/**
 * Example: Service Class Pattern with Response Mapping
 *
 * This demonstrates how to create domain-specific service classes
 * that wrap the http-client with consistent response handling.
 */

import { BaseAPIService, createHttpClient, AxiosError } from '@my-org/http-client';

// ============================================================================
// 1. SHARED TYPES (typically in @/types/api.ts)
// ============================================================================

export namespace API {
  export namespace Response {
    /** Standard API response wrapper */
    export interface Common<T> {
      code: number;
      message: string;
      data: T;
    }

    /** Mapped response for UI consumption */
    export interface ResponseMap<T> {
      success: boolean;
      data: T | null;
      error: string | null;
    }
  }
}

// ============================================================================
// 2. DOMAIN TYPES (typically in @/types/product.ts)
// ============================================================================

export namespace Product {
  export interface Item {
    id: string;
    name: string;
    price: number;
    category: string;
    stock: number;
  }

  export interface CreateBody {
    name: string;
    price: number;
    category: string;
    stock?: number;
  }

  export interface UpdateBody {
    name?: string;
    price?: number;
    category?: string;
    stock?: number;
  }

  export interface SearchParams {
    query?: string;
    category?: string;
    minPrice?: number;
    maxPrice?: number;
    page?: number;
    limit?: number;
  }

  export interface SearchResult {
    items: Item[];
    total: number;
    page: number;
    totalPages: number;
  }
}

// ============================================================================
// 3. RESPONSE HELPERS (typically in @/services/helper.ts)
// ============================================================================

/**
 * Map successful response to UI-friendly format
 */
export function mapResponse<T>(data: T): API.Response.ResponseMap<T> {
  return {
    success: true,
    data,
    error: null,
  };
}

/**
 * Map error to UI-friendly format
 */
export function mapResponseError<T>(error: unknown): API.Response.ResponseMap<T> {
  let message = 'An unexpected error occurred';

  if (error instanceof AxiosError) {
    message = error.response?.data?.message ?? error.message;
  } else if (error instanceof Error) {
    message = error.message;
  }

  return {
    success: false,
    data: null,
    error: message,
  };
}

/**
 * Map array response
 */
export function mapResponseArray<T>(data: T[]): API.Response.ResponseMap<T[]> {
  return {
    success: true,
    data: data ?? [],
    error: null,
  };
}

/**
 * Map array error
 */
export function mapResponseErrorArray<T>(error: unknown): API.Response.ResponseMap<T[]> {
  return mapResponseError<T[]>(error);
}

/**
 * Handle API error with throw (for try/catch patterns)
 */
export function handleAPIError<T>(error: unknown): never {
  if (error instanceof AxiosError) {
    const apiError = new Error(error.response?.data?.message ?? error.message);
    (apiError as any).code = error.response?.status;
    (apiError as any).response = error.response?.data;
    throw apiError;
  }
  throw error;
}

// ============================================================================
// 4. API CLIENT INSTANCE (typically in @/services/api.ts)
// ============================================================================

export const api = createHttpClient({
  axiosConfig: {
    baseURL: process.env.API_BASE_URL ?? 'https://api.example.com',
    timeout: 30000,
  },
  setupHooks: (instance) => {
    // Add auth interceptor here (see vue-pinia-example.ts)
  },
});

// ============================================================================
// 5. SERVICE INTERFACE & CLASS (typically in @/services/product.service.ts)
// ============================================================================

interface IProductService {
  GetProducts: () => Promise<API.Response.ResponseMap<Product.Item[]>>;
  GetProductById: (id: string) => Promise<API.Response.ResponseMap<Product.Item>>;
  SearchProducts: (params: Product.SearchParams) => Promise<API.Response.ResponseMap<Product.SearchResult>>;
  CreateProduct: (data: Product.CreateBody) => Promise<API.Response.ResponseMap<Product.Item>>;
  UpdateProduct: (id: string, data: Product.UpdateBody) => Promise<API.Response.ResponseMap<Product.Item>>;
  DeleteProduct: (id: string) => Promise<API.Response.ResponseMap<{ deleted: boolean }>>;
}

class ProductService implements IProductService {
  /**
   * Get all products
   */
  public async GetProducts(): Promise<API.Response.ResponseMap<Product.Item[]>> {
    try {
      const response = await api.get<Product.Item[]>('/products');
      return mapResponseArray<Product.Item>(response);
    } catch (error) {
      return mapResponseErrorArray<Product.Item>(error);
    }
  }

  /**
   * Get single product by ID
   */
  public async GetProductById(id: string): Promise<API.Response.ResponseMap<Product.Item>> {
    try {
      const response = await api.get<Product.Item>(`/products/${id}`);
      return mapResponse<Product.Item>(response);
    } catch (error) {
      return mapResponseError<Product.Item>(error);
    }
  }

  /**
   * Search products with filters
   */
  public async SearchProducts(
    params: Product.SearchParams
  ): Promise<API.Response.ResponseMap<Product.SearchResult>> {
    try {
      const response = await api.get<Product.SearchResult>('/products/search', { params });
      return mapResponse<Product.SearchResult>(response);
    } catch (error) {
      return mapResponseError<Product.SearchResult>(error);
    }
  }

  /**
   * Create new product
   */
  public async CreateProduct(
    data: Product.CreateBody
  ): Promise<API.Response.ResponseMap<Product.Item>> {
    try {
      const response = await api.post<Product.Item, Product.CreateBody>('/products', data);
      return mapResponse<Product.Item>(response);
    } catch (error) {
      return mapResponseError<Product.Item>(error);
    }
  }

  /**
   * Update existing product
   */
  public async UpdateProduct(
    id: string,
    data: Product.UpdateBody
  ): Promise<API.Response.ResponseMap<Product.Item>> {
    try {
      const response = await api.put<Product.Item, Product.UpdateBody>(`/products/${id}`, data);
      return mapResponse<Product.Item>(response);
    } catch (error) {
      return mapResponseError<Product.Item>(error);
    }
  }

  /**
   * Delete product
   */
  public async DeleteProduct(id: string): Promise<API.Response.ResponseMap<{ deleted: boolean }>> {
    try {
      const response = await api.delete<{ deleted: boolean }>(`/products/${id}`);
      return mapResponse<{ deleted: boolean }>(response);
    } catch (error) {
      return mapResponseError<{ deleted: boolean }>(error);
    }
  }
}

// Export singleton instance
export const productService = new ProductService();

// ============================================================================
// 6. USAGE EXAMPLES
// ============================================================================

async function examples() {
  // List all products
  const listResult = await productService.GetProducts();
  if (listResult.success) {
    console.log('Products:', listResult.data);
  } else {
    console.error('Failed:', listResult.error);
  }

  // Search with filters
  const searchResult = await productService.SearchProducts({
    category: 'electronics',
    minPrice: 100,
    maxPrice: 500,
    page: 1,
    limit: 20,
  });

  // Create product
  const createResult = await productService.CreateProduct({
    name: 'New Product',
    price: 99.99,
    category: 'gadgets',
  });

  // Update product
  const updateResult = await productService.UpdateProduct('prod-123', {
    price: 89.99,
    stock: 50,
  });

  // Delete product
  const deleteResult = await productService.DeleteProduct('prod-123');
}

// ============================================================================
// 7. ALTERNATIVE: THROW PATTERN (for try/catch in components)
// ============================================================================

class ProductServiceThrow {
  /**
   * Get product - throws on error (use in try/catch)
   */
  public async GetProductById(id: string): Promise<Product.Item> {
    try {
      return await api.get<Product.Item>(`/products/${id}`);
    } catch (error) {
      throw handleAPIError<Product.Item>(error);
    }
  }
}

// Usage with try/catch
async function componentExample() {
  const service = new ProductServiceThrow();

  try {
    const product = await service.GetProductById('123');
    // Use product directly - no .data unwrapping
    console.log(product.name);
  } catch (error) {
    // Handle error in component
    console.error((error as Error).message);
  }
}
