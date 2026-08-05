// ============================================================================
// OPTIMIZED PONTO SERVICE - PERFORMANCE IMPROVEMENTS
// ============================================================================
// This file contains optimizations for PontoService:
// 1. Global cache with automatic invalidation
// 2. Pagination support
// 3. Removed SELECT * queries
// 4. Parallel requests instead of sequential
// 5. Query deduplication
// ============================================================================

import { TimeRecord, LogType, User, GeoLocation, EmployeeSummary, PunchMethod, Company, Adjustment, FraudFlag, Department, CompanyKPIs, LogSeverity } from '../types';

// ============================================================================
// CACHE MANAGER - Global cache with TTL and invalidation
// ============================================================================

interface CacheEntry<T> {
  data: T;
  expires: number;
  tags: string[];
}

class CacheManager {
  private cache = new Map<string, CacheEntry<any>>();
  private tagIndex = new Map<string, Set<string>>();

  set<T>(key: string, data: T, ttlMs: number = 60000, tags: string[] = []): void {
    const entry: CacheEntry<T> = {
      data,
      expires: Date.now() + ttlMs,
      tags
    };
    this.cache.set(key, entry);

    // Index by tags for bulk invalidation
    tags.forEach(tag => {
      if (!this.tagIndex.has(tag)) {
        this.tagIndex.set(tag, new Set());
      }
      this.tagIndex.get(tag)!.add(key);
    });
  }

  get<T>(key: string): T | null {
    const entry = this.cache.get(key);
    if (!entry) return null;

    if (Date.now() > entry.expires) {
      this.cache.delete(key);
      return null;
    }

    return entry.data as T;
  }

  invalidate(tag: string): void {
    const keys = this.tagIndex.get(tag);
    if (!keys) return;

    keys.forEach(key => {
      this.cache.delete(key);
    });
    this.tagIndex.delete(tag);
  }

  invalidateAll(): void {
    this.cache.clear();
    this.tagIndex.clear();
  }
}

const cacheManager = new CacheManager();

// ============================================================================
// PAGINATION HELPER
// ============================================================================

interface PaginationParams {
  page?: number;
  limit?: number;
}

interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
  };
}

function getPaginationParams(params: PaginationParams) {
  const page = Math.max(1, params.page || 1);
  const limit = Math.min(100, Math.max(1, params.limit || 50));
  const offset = (page - 1) * limit;
  return { page, limit, offset };
}

// ============================================================================
// OPTIMIZED PONTO SERVICE
// ============================================================================

export const PontoServiceOptimized = {
  // ========================================================================
  // EMPLOYEES - With pagination and specific columns
  // ========================================================================

  async getAllEmployees(
    companyId: string,
    pagination?: PaginationParams
  ): Promise<PaginatedResponse<EmployeeSummary>> {
    const { page, limit, offset } = getPaginationParams(pagination || {});
    const cacheKey = `employees:${companyId}:${page}:${limit}`;

    // Check cache first
    const cached = cacheManager.get<PaginatedResponse<EmployeeSummary>>(cacheKey);
    if (cached) return cached;

    // In production, this would call the optimized API endpoint
    // GET /api/employees?companyId={companyId}&page={page}&limit={limit}
    // which returns paginated data with specific columns

    // For now, simulate the optimized query
    const mockData = await this.getMockEmployees(companyId);
    const total = mockData.length;
    const totalPages = Math.ceil(total / limit);
    const paginatedData = mockData.slice(offset, offset + limit);

    const response: PaginatedResponse<EmployeeSummary> = {
      data: paginatedData,
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasNextPage: page < totalPages,
        hasPreviousPage: page > 1
      }
    };

    // Cache with 5 minute TTL and tag for invalidation
    cacheManager.set(cacheKey, response, 300000, [`employees:${companyId}`]);
    return response;
  },

  // ========================================================================
  // RECORDS - Optimized queries with specific columns
  // ========================================================================

  async getRecords(
    userId: string,
    pagination?: PaginationParams
  ): Promise<PaginatedResponse<TimeRecord>> {
    const { page, limit, offset } = getPaginationParams(pagination || {});
    const cacheKey = `records:${userId}:${page}:${limit}`;

    const cached = cacheManager.get<PaginatedResponse<TimeRecord>>(cacheKey);
    if (cached) return cached;

    // In production: SELECT id, user_id, type, created_at, location, fraud_flags
    // FROM time_records WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3
    // Uses index: idx_time_records_user_company_date

    const mockRecords = await this.getMockRecords(userId);
    const total = mockRecords.length;
    const totalPages = Math.ceil(total / limit);
    const paginatedData = mockRecords.slice(offset, offset + limit);

    const response: PaginatedResponse<TimeRecord> = {
      data: paginatedData,
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasNextPage: page < totalPages,
        hasPreviousPage: page > 1
      }
    };

    cacheManager.set(cacheKey, response, 60000, [`records:${userId}`]);
    return response;
  },

  // ========================================================================
  // COMPANY KPIs - Cached with automatic invalidation
  // ========================================================================

  async getCompanyKPIs(companyId: string): Promise<CompanyKPIs> {
    const cacheKey = `kpis:${companyId}`;
    const cached = cacheManager.get<CompanyKPIs>(cacheKey);
    if (cached) return cached;

    // In production: Complex aggregation query with indexes
    // SELECT COUNT(*), SUM(delay), etc. FROM time_records
    // WHERE company_id = $1 AND created_at > NOW() - INTERVAL '30 days'
    // Uses index: idx_time_records_company_date

    const kpis: CompanyKPIs = {
      punctuality: 95,
      absenteeism: 2.5,
      overtimeHours: 18,
      averageDelay: 5,
      trend: { punctuality: 'up', absenteeism: 'down' }
    };

    // Cache with 10 minute TTL
    cacheManager.set(cacheKey, kpis, 600000, [`kpis:${companyId}`]);
    return kpis;
  },

  // ========================================================================
  // INVALIDATION HELPERS
  // ========================================================================

  invalidateEmployeeCache(companyId: string): void {
    cacheManager.invalidate(`employees:${companyId}`);
  },

  invalidateRecordsCache(userId: string): void {
    cacheManager.invalidate(`records:${userId}`);
  },

  invalidateKPIsCache(companyId: string): void {
    cacheManager.invalidate(`kpis:${companyId}`);
  },

  // ========================================================================
  // MOCK DATA (Replace with actual Supabase queries in production)
  // ========================================================================

  async getMockEmployees(companyId: string): Promise<EmployeeSummary[]> {
    return [
      {
        id: 'usr_1',
        nome: 'Ana Silva',
        email: 'ana@corp.com',
        cargo: 'Dev Senior',
        role: 'employee',
        companyId,
        tenantId: companyId,
        departmentId: 'dept_1',
        createdAt: new Date(),
        preferences: {
          notifications: true,
          theme: 'light',
          allowManualPunch: true,
          language: 'pt-BR',
        },
        lastRecord: undefined,
        todayHours: '08h 30m',
        status: 'offline',
        riskScore: 0,
      },
    ];
  },

  async getMockRecords(_userId: string): Promise<TimeRecord[]> {
    return [];
  },
};

// ============================================================================
// QUERY DEDUPLICATION - Prevent duplicate requests
// ============================================================================

class QueryDeduplicator {
  private pending = new Map<string, Promise<any>>();

  async deduplicate<T>(key: string, fn: () => Promise<T>): Promise<T> {
    // If query is already in flight, return the same promise
    if (this.pending.has(key)) {
      return this.pending.get(key)!;
    }

    // Execute query and store promise
    const promise = fn().finally(() => {
      this.pending.delete(key);
    });

    this.pending.set(key, promise);
    return promise;
  }
}

export const queryDeduplicator = new QueryDeduplicator();

// ============================================================================
// BATCH OPERATIONS - Combine multiple queries into one
// ============================================================================

interface BatchRequest {
  type: 'employees' | 'records' | 'kpis';
  companyId?: string;
  userId?: string;
}

export async function batchFetch(requests: BatchRequest[]): Promise<any[]> {
  // Deduplicate requests
  const unique = new Map<string, BatchRequest>();
  requests.forEach(req => {
    const key = `${req.type}:${req.companyId || req.userId}`;
    unique.set(key, req);
  });

  // Execute in parallel
  const results = await Promise.all(
    Array.from(unique.values()).map(req => {
      if (req.type === 'employees') {
        return PontoServiceOptimized.getAllEmployees(req.companyId!);
      } else if (req.type === 'records') {
        return PontoServiceOptimized.getRecords(req.userId!);
      } else if (req.type === 'kpis') {
        return PontoServiceOptimized.getCompanyKPIs(req.companyId!);
      }
      return null;
    })
  );

  return results;
}

// ============================================================================
// EXPORT OPTIMIZED CACHE MANAGER
// ============================================================================

export { cacheManager, CacheManager };
