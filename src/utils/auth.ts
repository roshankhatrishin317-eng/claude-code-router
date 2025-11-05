/**
 * JWT Authentication and RBAC System
 *
 * This module provides enterprise-grade authentication and authorization
 * with Role-Based Access Control (RBAC) for multi-user support.
 */

import jwt from 'jsonwebtoken';
import { FastifyRequest, FastifyReply } from 'fastify';
import { randomBytes, scryptSync, timingSafeEqual } from 'crypto';

export interface User {
  id: string;
  email: string;
  role: 'admin' | 'user' | 'readonly';
  apiKey: string;
  rateLimitPerMinute: number;
  monthlyTokenBudget: number;
  isActive: boolean;
  createdAt: number;
  lastLogin?: number;
  permissions: Permission[];
  monthlyTokenUsage?: { tokens: number; month: number; year: number };
  lastTokenTracking?: { month: number; year: number };
  totalRequests?: number;
  totalTokens?: number;
}

export interface Permission {
  resource: string;
  actions: string[]; // ['read', 'write', 'delete', 'admin']
}

export interface AuthToken {
  token: string;
  expiresAt: number;
  userId: string;
  role: string;
}

export interface RateLimitConfig {
  requestsPerMinute: number;
  requestsPerHour: number;
  requestsPerDay: number;
  tokensPerMonth: number;
}

export class AuthManager {
  private users: Map<string, User> = new Map();
  private tokens: Map<string, AuthToken> = new Map();
  private apiKeyToUserId: Map<string, string> = new Map();
  private sessionTokens: Map<string, string> = new Map(); // token -> userId
  private jwtSecret: string;
  private rateLimits: Map<string, RateLimitBucket> = new Map();

  constructor() {
    this.jwtSecret = process.env.JWT_SECRET || this.generateJWTSecret();
    this.initializeDefaultAdmin();
  }

  /**
   * Create a new user
   */
  createUser(userData: {
    email: string;
    password: string;
    role?: 'admin' | 'user' | 'readonly';
    rateLimitPerMinute?: number;
    monthlyTokenBudget?: number;
  }): { user: User; apiKey: string } {
    // Check if user already exists
    if (this.users.has(userData.email)) {
      throw new Error('User already exists');
    }

    const userId = `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const apiKey = this.generateApiKey();

    // Hash password with salt
    const salt = randomBytes(16).toString('hex');
    const hashedPassword = scryptSync(userData.password, salt, 64).toString('hex');
    const passwordHash = `${salt}:${hashedPassword}`;

    const user: User = {
      id: userId,
      email: userData.email,
      role: userData.role || 'user',
      apiKey: passwordHash,
      rateLimitPerMinute: userData.rateLimitPerMinute || 100,
      monthlyTokenBudget: userData.monthlyTokenBudget || 1000000,
      isActive: true,
      createdAt: Date.now(),
      permissions: this.getDefaultPermissions(userData.role || 'user')
    };

    this.users.set(userData.email, user);
    this.apiKeyToUserId.set(apiKey, userId);

    // Return user without password
    const { apiKey: _, ...userWithoutPassword } = user;
    return { user: userWithoutPassword as User, apiKey };
  }

  /**
   * Authenticate user with email and password
   */
  async authenticateUser(email: string, password: string): Promise<{ user: User; token: string }> {
    const user = this.users.get(email);
    if (!user || !user.isActive) {
      throw new Error('Invalid credentials');
    }

    // Verify password
    const [salt, hashedPassword] = user.apiKey.split(':');
    const testHash = scryptSync(password, salt, 64).toString('hex');

    if (!timingSafeEqual(Buffer.from(hashedPassword, 'hex'), Buffer.from(testHash, 'hex'))) {
      throw new Error('Invalid credentials');
    }

    // Generate JWT token
    const token = this.generateJWT(user);
    const expiresAt = Date.now() + (24 * 60 * 60 * 1000); // 24 hours

    this.tokens.set(token, {
      token,
      expiresAt,
      userId: user.id,
      role: user.role
    });

    // Update last login
    user.lastLogin = Date.now();

    const { apiKey: _, ...userWithoutPassword } = user;
    return { user: userWithoutPassword as User, token };
  }

  /**
   * Authenticate using API key
   */
  async authenticateWithApiKey(apiKey: string): Promise<User | null> {
    const userId = this.apiKeyToUserId.get(apiKey);
    if (!userId) {
      return null;
    }

    // Find user by ID
    const user = Array.from(this.users.values()).find(u => u.id === userId);
    if (!user || !user.isActive) {
      return null;
    }

    return user;
  }

  /**
   * Verify JWT token
   */
  verifyToken(token: string): { user: User; valid: boolean } | null {
    const tokenData = this.tokens.get(token);
    if (!tokenData) {
      return null;
    }

    if (Date.now() > tokenData.expiresAt) {
      this.tokens.delete(token);
      return null;
    }

    // Find user
    const user = Array.from(this.users.values()).find(u => u.id === tokenData.userId);
    if (!user) {
      return null;
    }

    return { user, valid: true };
  }

  /**
   * Check if user has permission
   */
  hasPermission(user: User, resource: string, action: string): boolean {
    const permission = user.permissions.find(p => p.resource === resource);
    if (!permission) {
      return false;
    }

    return permission.actions.includes(action) || permission.actions.includes('admin');
  }

  /**
   * Rate limiting check
   */
  checkRateLimit(userId: string, identifier: string): { allowed: boolean; remaining: number; resetTime: number } {
    const key = `${userId}:${identifier}`;
    let bucket = this.rateLimits.get(key);

    if (!bucket) {
      bucket = this.createRateLimitBucket();
      this.rateLimits.set(key, bucket);
    }

    const now = Date.now();
    const minuteWindow = now - 60000; // 1 minute

    // Clean old requests
    bucket.requests = bucket.requests.filter(time => time > minuteWindow);

    if (bucket.requests.length >= bucket.requestsPerMinute) {
      return {
        allowed: false,
        remaining: 0,
        resetTime: bucket.requests[0] + 60000
      };
    }

    bucket.requests.push(now);
    return {
      allowed: true,
      remaining: bucket.requestsPerMinute - bucket.requests.length,
      resetTime: now + 60000
    };
  }

  /**
   * Track token usage
   */
  trackTokenUsage(userId: string, tokens: number): void {
    const user = Array.from(this.users.values()).find(u => u.id === userId);
    if (!user) return;

    const currentMonth = new Date().getMonth();
    const currentYear = new Date().getFullYear();

    if (user.lastTokenTracking?.month !== currentMonth || user.lastTokenTracking?.year !== currentYear) {
      // Reset monthly counter
      user.monthlyTokenUsage = { tokens: 0, month: currentMonth, year: currentYear };
      user.lastTokenTracking = { month: currentMonth, year: currentYear };
    }

    user.monthlyTokenUsage = {
      tokens: user.monthlyTokenUsage?.tokens || 0,
      month: currentMonth,
      year: currentYear
    };
    user.monthlyTokenUsage.tokens += tokens;
  }

  /**
   * Get user statistics
   */
  getUserStats(userId: string): {
    totalRequests: number;
    totalTokens: number;
    currentMonthTokens: number;
    monthlyLimit: number;
    usagePercent: number;
  } | null {
    const user = Array.from(this.users.values()).find(u => u.id === userId);
    if (!user) return null;

    const currentMonthTokens = user.monthlyTokenUsage?.tokens || 0;
    const usagePercent = (currentMonthTokens / user.monthlyTokenBudget) * 100;

    return {
      totalRequests: user.totalRequests || 0,
      totalTokens: user.totalTokens || 0,
      currentMonthTokens,
      monthlyLimit: user.monthlyTokenBudget,
      usagePercent
    };
  }

  /**
   * Generate API key
   */
  private generateApiKey(): string {
    return `ccr_${randomBytes(32).toString('hex')}`;
  }

  /**
   * Generate JWT secret if not provided
   */
  private generateJWTSecret(): string {
    return randomBytes(64).toString('hex');
  }

  /**
   * Generate JWT token
   */
  private generateJWT(user: User): string {
    return jwt.sign(
      {
        userId: user.id,
        email: user.email,
        role: user.role,
        permissions: user.permissions
      },
      this.jwtSecret,
      { expiresIn: '24h' }
    );
  }

  /**
   * Initialize default admin user
   */
  private initializeDefaultAdmin(): void {
    const defaultAdmin = {
      email: 'admin@claude-code-router.local',
      password: 'admin123' // Should be changed on first login
    };

    try {
      const existingAdmin = this.users.get(defaultAdmin.email);
      if (!existingAdmin) {
        const admin = this.createUser({
          email: defaultAdmin.email,
          password: defaultAdmin.password,
          role: 'admin',
          rateLimitPerMinute: 1000,
          monthlyTokenBudget: 10000000 // 10M tokens
        });
        console.log('Default admin created:', admin.user.email);
        console.log('API Key:', admin.apiKey);
        console.log('⚠️  Please change the default password immediately!');
      }
    } catch (error) {
      console.error('Failed to create default admin:', error);
    }
  }

  /**
   * Get default permissions based on role
   */
  private getDefaultPermissions(role: 'admin' | 'user' | 'readonly'): Permission[] {
    switch (role) {
      case 'admin':
        return [
          { resource: 'metrics', actions: ['read', 'write', 'admin'] },
          { resource: 'users', actions: ['read', 'write', 'delete', 'admin'] },
          { resource: 'providers', actions: ['read', 'write', 'admin'] },
          { resource: 'config', actions: ['read', 'write', 'admin'] }
        ];
      case 'user':
        return [
          { resource: 'metrics', actions: ['read'] },
          { resource: 'providers', actions: ['read'] },
          { resource: 'config', actions: ['read'] }
        ];
      case 'readonly':
        return [
          { resource: 'metrics', actions: ['read'] },
          { resource: 'providers', actions: ['read'] }
        ];
      default:
        return [];
    }
  }

  /**
   * Create rate limit bucket
   */
  private createRateLimitBucket(): RateLimitBucket {
    return {
      requests: [],
      requestsPerMinute: 100,
      requestsPerHour: 1000,
      requestsPerDay: 10000
    };
  }

  /**
   * Cleanup expired tokens
   */
  cleanup(): void {
    const now = Date.now();
    for (const [token, tokenData] of this.tokens.entries()) {
      if (now > tokenData.expiresAt) {
        this.tokens.delete(token);
      }
    }
  }
}

interface RateLimitBucket {
  requests: number[];
  requestsPerMinute: number;
  requestsPerHour: number;
  requestsPerDay: number;
}

// Singleton instance
export const authManager = new AuthManager();

// Cleanup expired tokens every hour
let authCleanupInterval: NodeJS.Timeout | undefined = setInterval(() => {
  authManager.cleanup();
}, 60 * 60 * 1000);

// Cleanup function for auth manager
export function cleanupAuthManagerInterval(): void {
  if (authCleanupInterval) {
    clearInterval(authCleanupInterval);
    authCleanupInterval = undefined;
  }
}
