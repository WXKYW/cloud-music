// js/daily-recommend.ts - 每日推荐功能

import { parsePlaylistAPI, getDailyRecommendSongs, type Song } from './api.js';
import { playSong } from './player.js';
import { showNotification } from './ui.js';

// 每日推荐配置
const DAILY_RECOMMEND_CONFIG = {
  STORAGE_KEY: 'daily_recommend',
  SONGS_COUNT: 30, // 每日推荐歌曲数量
  CACHE_DURATION: 24 * 60 * 60 * 1000, // 缓存时长24小时
  USE_QQ_DAILY: false, // 禁用QQ推荐，只使用NCM
};

// 推荐源配置
const RECOMMEND_SOURCES = [
  { id: '3778678', source: 'netease', weight: 0.4 }, // 网易云飙升榜 40%
  { id: '19723756', source: 'netease', weight: 0.3 }, // 网易云热歌榜 30%
  { id: '3779629', source: 'netease', weight: 0.3 }, // 网易云新歌榜 30%
];

interface DailyRecommendCache {
  date: string;
  songs: Song[];
  timestamp: number;
  isPersonalized?: boolean;
}

let currentRecommendSongs: Song[] = [];

// 初始化每日推荐
export function initDailyRecommend() {
  // 初始化推荐标签页内的内容
  initRecommendTab();

  // 监听用户登录事件，登录后自动刷新推荐
  window.addEventListener('userLoggedIn', () => {
    loadDailyRecommend(true);
  });
}

// 初始化推荐标签页
function initRecommendTab() {
  // 绑定刷新按钮
  const refreshBtn = document.getElementById('refreshRecommendBtn');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => loadDailyRecommend(true));
  }

  // 绑定播放全部按钮
  const playAllBtn = document.getElementById('playAllRecommendBtn');
  if (playAllBtn) {
    playAllBtn.addEventListener('click', playAllRecommend);
  }

  // 立即检查并加载推荐（修复首次加载BUG）
  const songsContainer = document.getElementById('recommendSongs');
  if (songsContainer && songsContainer.querySelector('.loading')) {
    // 模块初始化时立即加载推荐
    loadDailyRecommend();
  }
}

// 显示推荐歌曲
async function displayRecommendSongs(songs: Song[], containerId: string = 'searchResults') {
  const songsContainer = document.getElementById(containerId);
  if (!songsContainer) {
    return;
  }

  // 动态导入UI模块
  const { displaySearchResults, showLoading } = await import('./ui.js');

  // 显示加载状态（可选，如果渲染很快可以省略）
  // showLoading(containerId);

  // 使用统一的显示方法，自动包含批量操作功能
  displaySearchResults(songs, containerId, songs);
}

// 加载每日推荐
export async function loadDailyRecommend(forceRefresh: boolean = false, containerId: string = 'searchResults') {
  const songsContainer = document.getElementById(containerId);
  // const dateElement = document.getElementById('recommendDate'); // 只有在独立推荐页才需要

  if (!songsContainer) return;

  try {
    // 检查缓存
    if (!forceRefresh) {
      const cached = getCachedRecommend();
      if (cached) {
        currentRecommendSongs = cached.songs;
        await displayRecommendSongs(cached.songs, containerId);
        
        // 更新日期和标题 (仅当元素存在时)
        const dateElement = document.getElementById('recommendDate');
        if (dateElement) {
          const typeText = cached.isPersonalized ? '个性化推荐' : '热门推荐';
          dateElement.textContent = `${typeText} - 更新时间: ${cached.date}`;
        }
        return;
      }
    }

    // 只有在不是 searchResults 时才显示加载动画，避免覆盖已有的搜索结果
    // 或者使用特定的 loading 样式
    songsContainer.innerHTML =
      '<div class="loading"><i class="fas fa-spinner fa-spin"></i> 正在生成推荐...</div>';

    let songs: Song[] = [];
    let isPersonalized = false;

    // 1. 尝试获取个性化每日推荐 (需登录)
    try {
      const dailySongs = await getDailyRecommendSongs();
      if (dailySongs.length > 0) {
        songs = dailySongs;
        isPersonalized = true;
      }
    } catch (e) {
      // 降级到榜单推荐
    }

    // 2. 降级方案：榜单混合推荐
    if (songs.length === 0) {
      const allSongs: Song[] = [];
      for (const source of RECOMMEND_SOURCES) {
        try {
          const result = await parsePlaylistAPI(source.id, source.source);
          const count = Math.floor(DAILY_RECOMMEND_CONFIG.SONGS_COUNT * source.weight);
          const randomSongs = shuffleArray(result.songs).slice(0, count);
          allSongs.push(...randomSongs);
        } catch (error) {
          // Skip failed source
        }
      }

      if (allSongs.length > 0) {
        songs = shuffleArray(allSongs).slice(0, DAILY_RECOMMEND_CONFIG.SONGS_COUNT);
      }
    }

    if (songs.length === 0) {
      songsContainer.innerHTML = '<div class="error">获取推荐失败，请稍后重试</div>';
      showNotification('获取推荐失败', 'error');
      return;
    }

    currentRecommendSongs = songs;

    // 缓存推荐
    cacheRecommend(songs, isPersonalized);

    // 显示推荐
    await displayRecommendSongs(songs, containerId);

    // 更新日期和标题
    const dateElement = document.getElementById('recommendDate');
    if (dateElement) {
      const today = new Date().toLocaleDateString('zh-CN');
      const typeText = isPersonalized ? '个性化推荐' : '热门推荐';
      dateElement.textContent = `${typeText} - 更新时间: ${today}`;
    }

    const msg = isPersonalized
      ? `已为你生成 ${songs.length} 首个性化推荐`
      : `已为你推荐 ${songs.length} 首热门歌曲`;
    showNotification(msg, 'success');
  } catch (error) {
    songsContainer.innerHTML = '<div class="error">加载失败，请重试</div>';
    showNotification('加载推荐失败', 'error');
  }
}

// 播放全部推荐
function playAllRecommend() {
  if (currentRecommendSongs.length > 0) {
    playSong(0, currentRecommendSongs, 'recommendSongs');
    showNotification('开始播放每日推荐', 'success');
  }
}

// 缓存推荐
function cacheRecommend(songs: Song[], isPersonalized: boolean = false) {
  const cache: DailyRecommendCache = {
    date: new Date().toLocaleDateString('zh-CN'),
    songs: songs,
    timestamp: Date.now(),
    isPersonalized,
  };

  try {
    localStorage.setItem(DAILY_RECOMMEND_CONFIG.STORAGE_KEY, JSON.stringify(cache));
  } catch (error: any) {
    // 处理配额超限
    if (error.name === 'QuotaExceededError' || error.code === 22) {
      try {
        localStorage.removeItem(DAILY_RECOMMEND_CONFIG.STORAGE_KEY);
        localStorage.setItem(DAILY_RECOMMEND_CONFIG.STORAGE_KEY, JSON.stringify(cache));
      } catch (retryError) {
        // Failed to cache
      }
    }
  }
}

// 获取缓存的推荐
function getCachedRecommend(): DailyRecommendCache | null {
  try {
    const cached = localStorage.getItem(DAILY_RECOMMEND_CONFIG.STORAGE_KEY);
    if (!cached) return null;

    const data: DailyRecommendCache = JSON.parse(cached);

    // 检查是否过期
    const now = Date.now();
    if (now - data.timestamp > DAILY_RECOMMEND_CONFIG.CACHE_DURATION) {
      localStorage.removeItem(DAILY_RECOMMEND_CONFIG.STORAGE_KEY);
      return null;
    }

    // 检查是否是今天的推荐
    const today = new Date().toLocaleDateString('zh-CN');
    if (data.date !== today) {
      localStorage.removeItem(DAILY_RECOMMEND_CONFIG.STORAGE_KEY);
      return null;
    }

    return data;
  } catch (error) {
    return null;
  }
}

// 数组随机打乱
function shuffleArray<T>(array: T[]): T[] {
  const newArray = [...array];
  for (let i = newArray.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [newArray[i], newArray[j]] = [newArray[j], newArray[i]];
  }
  return newArray;
}

// 在搜索结果区域加载每日推荐 (用于降级或其他用途)
export async function loadDailyRecommendInSearch(forceRefresh: boolean = false) {
  // 明确指定渲染到 searchResults 容器
  await loadDailyRecommend(forceRefresh, 'searchResults');
}

// 刷新推荐
export async function refreshRecommend() {
  await loadDailyRecommend(true);
}

// 获取当前推荐歌曲
export function getCurrentRecommendSongs(): Song[] {
  return currentRecommendSongs;
}

// 清除推荐缓存
export function clearRecommendCache() {
  localStorage.removeItem(DAILY_RECOMMEND_CONFIG.STORAGE_KEY);
  showNotification('已清除推荐缓存', 'success');
}
