/**
 * 播放故障统计与分析模块
 * 用于记录播放失败情况，智能跳过不可用的资源
 */

import { storage } from './utils.js';

interface FailureRecord {
  timestamp: number;
  reason: string;
  attempts: number;
  quality?: string; // Add quality to the failure record
}

interface PlaybackStats {
  total: number;
  success: number;
  failures: number;
}

const STORAGE_KEY = 'playback_analytics_failures';
const STATS_KEY = 'playback_analytics_stats';

class PlaybackAnalytics {
  private failureCache: Map<string, FailureRecord>;
  private stats: PlaybackStats;

  constructor() {
    this.failureCache = new Map();
    this.stats = { total: 0, success: 0, failures: 0 };
    this.loadFromStorage();
  }

  private loadFromStorage() {
    try {
      const cached = storage.get<Record<string, FailureRecord>>(STORAGE_KEY, {});
      if (cached) {
        Object.entries(cached).forEach(([key, value]) => {
          // 只保留24小时内的记录
          if (Date.now() - value.timestamp < 24 * 3600 * 1000) {
            this.failureCache.set(key, value);
          }
        });
      }

      this.stats = storage.get<PlaybackStats>(STATS_KEY, { total: 0, success: 0, failures: 0 });
    } catch (e) {
      // Failed to load analytics
    }
  }

  private saveToStorage() {
    try {
      const obj = Object.fromEntries(this.failureCache);
      storage.set(STORAGE_KEY, obj);
      storage.set(STATS_KEY, this.stats);
    } catch (e) {
      // Failed to save analytics
    }
  }

  /**
   * 记录播放失败
   * @param songId 歌曲ID
   * @param platform 平台 (netease, tencent, etc)
   * @param reason 失败原因
   * @param quality 音质 (e.g., '999000', '320', '128')
   */
  recordFailure(songId: string | number, platform: string, reason: string, quality?: string) {
    const key = `${platform}-${songId}-${quality || 'default'}`; // Include quality in key
    const existing = this.failureCache.get(key);

    this.failureCache.set(key, {
      timestamp: Date.now(),
      reason,
      attempts: (existing?.attempts || 0) + 1,
      quality,
    });

    this.stats.failures++;
    this.stats.total++;
    this.saveToStorage();
  }

  /**
   * 记录播放成功
   */
  recordSuccess() {
    this.stats.success++;
    this.stats.total++;
    this.saveToStorage();
  }

  /**
   * 检查是否应该跳过该歌曲（因历史失败记录）
   * @param songId 歌曲ID
   * @param platform 平台 (netease, tencent, etc)
   * @param quality 音质 (e.g., '999000', '320', '128')
   */
  shouldSkip(songId: string | number, platform: string, quality?: string): boolean {
    const key = `${platform}-${songId}-${quality || 'default'}`; // Include quality in key
    const record = this.failureCache.get(key);

    // 24小时内失败3次以上，建议跳过
    if (record && record.attempts >= 3 && Date.now() - record.timestamp < 24 * 3600 * 1000) {
      return true;
    }
    return false;
  }

  /**
   * 获取成功率统计
   */
  getStats() {
    const rate = this.stats.total === 0 ? 0 : this.stats.success / this.stats.total;
    return {
      ...this.stats,
      successRate: (rate * 100).toFixed(1) + '%',
    };
  }

  /**
   * 清除过期记录
   */
  cleanup() {
    const now = Date.now();
    let changed = false;
    for (const [key, record] of this.failureCache.entries()) {
      if (now - record.timestamp > 24 * 3600 * 1000) {
        this.failureCache.delete(key);
        changed = true;
      }
    }
    if (changed) this.saveToStorage();
  }
}

export const playbackAnalytics = new PlaybackAnalytics();
