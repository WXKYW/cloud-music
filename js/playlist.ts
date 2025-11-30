/**
 * 歌单发现模块 (Playlist Discovery Module) - 完整版
 * 支持排行榜、热门歌单、精品歌单、分类浏览
 */

import * as api from './api.js';
import { showNotification, displaySearchResults, showLoading } from './ui.js';
import type { Song } from './api.js';

// ========== 类型定义 ==========
interface PlaylistState {
  currentView: 'main' | 'category' | 'detail';
  currentCategory: string;
  currentPlaylistId: string | null;
  currentPlaylistName: string | null;
  hotTags: string[];
  isLoading: boolean;
}

interface EventListenerEntry {
  target: EventTarget;
  type: string;
  listener: EventListener;
  options?: AddEventListenerOptions | boolean;
}

// ========== 模块状态 ==========
const state: PlaylistState = {
  currentView: 'main',
  currentCategory: '全部',
  currentPlaylistId: null,
  currentPlaylistName: null,
  hotTags: [],
  isLoading: false,
};

const registeredEventListeners: EventListenerEntry[] = [];

// ========== 排行榜配置 ==========
const RANK_LISTS = [
  { id: '3778678', name: '热歌榜', icon: '🔥', color: '#ff6b6b', desc: '全站最热单曲' },
  { id: '3779629', name: '新歌榜', icon: '🆕', color: '#4caf50', desc: '每日新歌推荐' },
  { id: '19723756', name: '飙升榜', icon: '📈', color: '#2196f3', desc: '热度增长最快' },
  { id: '2884035', name: '原创榜', icon: '✨', color: '#9c27b0', desc: '优秀原创作品' },
  { id: '10520166', name: '电音榜', icon: '⚡', color: '#e91e63', desc: '全球电音精选' },
  { id: '71385702', name: 'ACG榜', icon: '🎮', color: '#ff9800', desc: '二次元音乐' },
  { id: '991319590', name: '古典榜', icon: '🎻', color: '#795548', desc: '经典古典音乐' },
  { id: '745956260', name: '韩语榜', icon: '🇰🇷', color: '#00bcd4', desc: '韩国热门音乐' },
];

// 热门分类标签
const HOT_CATEGORIES = [
  { name: '全部', icon: '🌐' },
  { name: '华语', icon: '🇨🇳' },
  { name: '欧美', icon: '🇺🇸' },
  { name: '流行', icon: '🎤' },
  { name: '摇滚', icon: '🎸' },
  { name: '电子', icon: '🎹' },
  { name: '说唱', icon: '🎧' },
  { name: 'ACG', icon: '🎮' },
  { name: '轻音乐', icon: '🎶' },
  { name: '民谣', icon: '🪕' },
  { name: '运动', icon: '💪' },
  { name: '学习', icon: '📚' },
];

// ========== 工具函数 ==========
function registerEventListener(
  target: EventTarget,
  type: string,
  listener: EventListener,
  options?: AddEventListenerOptions | boolean
): void {
  target.addEventListener(type, listener, options);
  registeredEventListeners.push({ target, type, listener, options });
}

function clearCurrentListeners(): void {
  registeredEventListeners.forEach(({ target, type, listener, options }) => {
    target.removeEventListener(type, listener, options);
  });
  registeredEventListeners.length = 0;
}

function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function formatPlayCount(count: number): string {
  if (count >= 100000000) return (count / 100000000).toFixed(1) + '亿';
  if (count >= 10000) return (count / 10000).toFixed(1) + '万';
  return count.toString();
}

// ========== 渲染主页面 ==========
async function renderMainView(): Promise<void> {
  const container = document.getElementById('playlistContainer');
  if (!container) return;

  clearCurrentListeners();
  state.currentView = 'main';
  state.isLoading = true;

  container.innerHTML = `
    <div class="playlist-main">
      <!-- 分类标签区 -->
      <div class="playlist-section">
        <div class="section-header">
          <h3><i class="fas fa-tags"></i> 热门分类</h3>
        </div>
        <div class="category-tags" id="categoryTags">
          ${HOT_CATEGORIES.map(
            (cat) => `
            <span class="category-tag ${state.currentCategory === cat.name ? 'active' : ''}" data-category="${cat.name}">
              ${cat.icon} ${cat.name}
            </span>
          `
          ).join('')}
        </div>
      </div>

      <!-- 排行榜区 -->
      <div class="playlist-section">
        <div class="section-header">
          <h3><i class="fas fa-trophy"></i> 排行榜</h3>
        </div>
        <div class="rank-grid" id="rankGrid">
          ${RANK_LISTS.map(
            (rank) => `
            <div class="rank-card" data-rank-id="${rank.id}" style="--card-color: ${rank.color}">
              <div class="rank-icon">${rank.icon}</div>
              <div class="rank-info">
                <div class="rank-title">${escapeHtml(rank.name)}</div>
                <div class="rank-desc">${escapeHtml(rank.desc)}</div>
              </div>
              <div class="rank-arrow"><i class="fas fa-play-circle"></i></div>
            </div>
          `
          ).join('')}
        </div>
      </div>

      <!-- 精品歌单区 -->
      <div class="playlist-section">
        <div class="section-header">
          <h3><i class="fas fa-gem"></i> 精品歌单</h3>
          <button class="more-btn" id="moreHighQuality">更多 <i class="fas fa-chevron-right"></i></button>
        </div>
        <div class="playlist-grid" id="highQualityGrid">
          <div class="loading"><i class="fas fa-spinner fa-spin"></i><div>加载中...</div></div>
        </div>
      </div>

      <!-- 推荐歌单区 -->
      <div class="playlist-section">
        <div class="section-header">
          <h3><i class="fas fa-heart"></i> 推荐歌单</h3>
          <button class="more-btn" id="moreRecommend">更多 <i class="fas fa-chevron-right"></i></button>
        </div>
        <div class="playlist-grid" id="recommendGrid">
          <div class="loading"><i class="fas fa-spinner fa-spin"></i><div>加载中...</div></div>
        </div>
      </div>

      <!-- 热门歌单区 -->
      <div class="playlist-section">
        <div class="section-header">
          <h3><i class="fas fa-fire"></i> 热门歌单</h3>
        </div>
        <div class="playlist-grid" id="hotPlaylistGrid">
          <div class="loading"><i class="fas fa-spinner fa-spin"></i><div>加载中...</div></div>
        </div>
      </div>
    </div>
  `;

  // 绑定分类标签事件
  const categoryTags = container.querySelectorAll('.category-tag');
  categoryTags.forEach((tag) => {
    registerEventListener(tag, 'click', () => {
      const category = (tag as HTMLElement).dataset.category || '全部';
      state.currentCategory = category;
      loadCategoryPlaylists(category);
    });
  });

  // 绑定排行榜点击事件
  const rankCards = container.querySelectorAll('.rank-card');
  rankCards.forEach((card) => {
    registerEventListener(card, 'click', () => {
      const rankId = (card as HTMLElement).dataset.rankId;
      const rankName = (card as HTMLElement).querySelector('.rank-title')?.textContent || '';
      if (rankId) {
        loadPlaylistDetail(rankId, rankName);
      }
    });
  });

  // 绑定更多按钮
  const moreHighQualityBtn = document.getElementById('moreHighQuality');
  if (moreHighQualityBtn) {
    registerEventListener(moreHighQualityBtn, 'click', () => loadCategoryPlaylists('精品'));
  }

  const moreRecommendBtn = document.getElementById('moreRecommend');
  if (moreRecommendBtn) {
    registerEventListener(moreRecommendBtn, 'click', () => loadCategoryPlaylists('推荐'));
  }

  // 异步加载歌单数据
  await loadPlaylistData();
  state.isLoading = false;
}

// ========== 加载歌单数据 ==========
async function loadPlaylistData(): Promise<void> {
  try {
    // 并行加载三个区域的歌单
    const [highQuality, recommended, hot] = await Promise.all([
      api.getHighQualityPlaylists('全部', 8),
      api.getRecommendedPlaylists(8),
      api.getHotPlaylists('hot', '全部', 16),
    ]);

    // 渲染精品歌单
    renderPlaylistGrid('highQualityGrid', highQuality.playlists);

    // 渲染推荐歌单
    renderRecommendGrid('recommendGrid', recommended);

    // 渲染热门歌单
    renderPlaylistGrid('hotPlaylistGrid', hot.playlists);
  } catch (error) {
    console.error('加载歌单数据失败:', error);

    // 失败时显示错误
    const grids = ['highQualityGrid', 'recommendGrid', 'hotPlaylistGrid'];
    grids.forEach((gridId) => {
      const grid = document.getElementById(gridId);
      if (grid) {
        grid.innerHTML =
          '<div class="error-inline"><i class="fas fa-exclamation-circle"></i> 加载失败</div>';
      }
    });
  }
}

// ========== 渲染歌单网格 ==========
function renderPlaylistGrid(
  containerId: string,
  playlists: Array<{
    id: string;
    name: string;
    coverImgUrl: string;
    playCount: number;
    description?: string;
  }>
): void {
  const container = document.getElementById(containerId);
  if (!container) return;

  if (!playlists || playlists.length === 0) {
    container.innerHTML = '<div class="empty-state">暂无歌单</div>';
    return;
  }

  container.innerHTML = playlists
    .map(
      (playlist) => `
    <div class="playlist-card" data-id="${playlist.id}" data-name="${escapeHtml(playlist.name)}">
      <div class="playlist-cover">
        <img src="${playlist.coverImgUrl}?param=200y200" loading="lazy" alt="${escapeHtml(playlist.name)}" onerror="this.src='data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAwIiBoZWlnaHQ9IjIwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSIjMzMzIi8+PHRleHQgeD0iNTAlIiB5PSI1MCUiIGR5PSIuM2VtIiBmaWxsPSIjNjY2IiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBmb250LXNpemU9IjI0Ij7mrYzljZU8L3RleHQ+PC9zdmc+'">
        <div class="play-count"><i class="fas fa-play"></i> ${formatPlayCount(playlist.playCount)}</div>
        <div class="play-overlay" data-name="${escapeHtml(playlist.name)}"><i class="fas fa-play-circle"></i></div>
      </div>
      <div class="playlist-info">
        <div class="playlist-name">${escapeHtml(playlist.name)}</div>
      </div>
    </div>
  `
    )
    .join('');

  // 绑定点击事件
  container.querySelectorAll('.playlist-card').forEach((card) => {
    registerEventListener(card, 'click', () => {
      const id = (card as HTMLElement).dataset.id!;
      const name = (card as HTMLElement).dataset.name!;
      loadPlaylistDetail(id, name);
    });
  });
}

// ========== 渲染推荐歌单网格 ==========
function renderRecommendGrid(
  containerId: string,
  playlists: Array<{
    id: string;
    name: string;
    picUrl: string;
    playCount: number;
    copywriter?: string;
  }>
): void {
  const container = document.getElementById(containerId);
  if (!container) return;

  if (!playlists || playlists.length === 0) {
    container.innerHTML = '<div class="empty-state">暂无推荐</div>';
    return;
  }

  container.innerHTML = playlists
    .map(
      (playlist) => `
    <div class="playlist-card" data-id="${playlist.id}" data-name="${escapeHtml(playlist.name)}">
      <div class="playlist-cover">
        <img src="${playlist.picUrl}?param=200y200" loading="lazy" alt="${escapeHtml(playlist.name)}" onerror="this.src='data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAwIiBoZWlnaHQ9IjIwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSIjMzMzIi8+PHRleHQgeD0iNTAlIiB5PSI1MCUiIGR5PSIuM2VtIiBmaWxsPSIjNjY2IiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBmb250LXNpemU9IjI0Ij7mrYzljZU8L3RleHQ+PC9zdmc+'">
        <div class="play-count"><i class="fas fa-play"></i> ${formatPlayCount(playlist.playCount)}</div>
        <div class="play-overlay" data-name="${escapeHtml(playlist.name)}"><i class="fas fa-play-circle"></i></div>
      </div>
      <div class="playlist-info">
        <div class="playlist-name">${escapeHtml(playlist.name)}</div>
        ${playlist.copywriter ? `<div class="playlist-copywriter">${escapeHtml(playlist.copywriter)}</div>` : ''}
      </div>
    </div>
  `
    )
    .join('');

  // 绑定点击事件
  container.querySelectorAll('.playlist-card').forEach((card) => {
    registerEventListener(card, 'click', () => {
      const id = (card as HTMLElement).dataset.id!;
      const name = (card as HTMLElement).dataset.name!;
      loadPlaylistDetail(id, name);
    });
  });
}

// ========== 加载分类歌单 ==========
async function loadCategoryPlaylists(category: string): Promise<void> {
  const container = document.getElementById('playlistContainer');
  if (!container) return;

  clearCurrentListeners();
  state.currentView = 'category';
  state.currentCategory = category;
  state.isLoading = true;

  container.innerHTML = `
    <div class="category-view">
      <div class="nav-stage-header">
        <button class="back-btn" id="backToMain">
          <i class="fas fa-arrow-left"></i> 返回
        </button>
        <h3><i class="fas fa-folder-open"></i> ${escapeHtml(category === '精品' ? '精品歌单' : category === '推荐' ? '推荐歌单' : category + '歌单')}</h3>
      </div>
      <div class="playlist-grid large" id="categoryPlaylistGrid">
        <div class="loading"><i class="fas fa-spinner fa-spin"></i><div>加载中...</div></div>
      </div>
    </div>
  `;

  // 绑定返回按钮
  const backBtn = document.getElementById('backToMain');
  if (backBtn) {
    registerEventListener(backBtn, 'click', () => renderMainView());
  }

  try {
    let playlists: any[] = [];

    if (category === '精品') {
      // 加载精品歌单
      const result = await api.getHighQualityPlaylists('全部', 50);
      playlists = result.playlists;
    } else if (category === '推荐') {
      // 加载推荐歌单
      const result = await api.getRecommendedPlaylists(50);
      playlists = result.map((p) => ({
        id: p.id,
        name: p.name,
        coverImgUrl: p.picUrl,
        playCount: p.playCount,
      }));
    } else {
      // 加载分类热门歌单
      const result = await api.getHotPlaylists('hot', category, 50);
      playlists = result.playlists;
    }

    renderPlaylistGrid('categoryPlaylistGrid', playlists);

    if (playlists.length === 0) {
      const grid = document.getElementById('categoryPlaylistGrid');
      if (grid) {
        grid.innerHTML = `<div class="empty-state">该分类暂无歌单</div>`;
      }
    }
  } catch (error) {
    console.error('加载分类歌单失败:', error);
    const grid = document.getElementById('categoryPlaylistGrid');
    if (grid) {
      grid.innerHTML = `
        <div class="error">
          <i class="fas fa-exclamation-triangle"></i>
          <div>加载失败，请稍后重试</div>
        </div>
      `;
    }
  } finally {
    state.isLoading = false;
  }
}

// ========== 加载歌单详情 ==========
async function loadPlaylistDetail(playlistId: string, playlistName?: string): Promise<void> {
  const container = document.getElementById('playlistContainer');
  if (!container) return;

  clearCurrentListeners();
  state.currentView = 'detail';
  state.currentPlaylistId = playlistId;
  state.currentPlaylistName = playlistName || null;

  container.innerHTML =
    '<div class="loading"><i class="fas fa-spinner fa-spin"></i><div>正在加载歌单...</div></div>';

  try {
    const result = await api.parsePlaylistAPI(playlistId, 'netease');
    const songs: Song[] = result?.songs || [];

    if (!songs || songs.length === 0) {
      container.innerHTML = `
        <div class="nav-stage-header">
          <button class="back-btn" id="backToNav">
            <i class="fas fa-arrow-left"></i> 返回
          </button>
        </div>
        <div class="error">
          <i class="fas fa-exclamation-triangle"></i>
          <div>歌单为空或加载失败</div>
        </div>
      `;
      bindBackButton();
      return;
    }

    const headerHtml = `
      <div class="nav-stage-header">
        <button class="back-btn" id="backToNav">
          <i class="fas fa-arrow-left"></i> 返回
        </button>
        <h3><i class="fas fa-list-music"></i> ${escapeHtml(playlistName || result.name || '歌单')}</h3>
        <p class="result-count">共 ${songs.length} 首歌曲</p>
      </div>
      <div id="playlistSongs"></div>
    `;

    container.innerHTML = headerHtml;
    bindBackButton();

    displaySearchResults(songs, 'playlistSongs', songs);
    showNotification(`成功加载《${playlistName || result.name}》，共 ${songs.length} 首歌曲`, 'success');
  } catch (error) {
    console.error('加载歌单详情失败:', error);

    // 尝试自动切换 API 源重试
    if (error instanceof Error && error.name !== 'AbortError') {
      console.warn('尝试切换 API 源重试加载歌单...');
      const switched = await api.switchToNextAPI();
      if (switched) {
        try {
          const result = await api.parsePlaylistAPI(playlistId, 'netease');
          const songs: Song[] = result?.songs || [];

          if (songs.length > 0) {
            const headerHtml = `
              <div class="nav-stage-header">
                <button class="back-btn" id="backToNav">
                  <i class="fas fa-arrow-left"></i> 返回
                </button>
                <h3><i class="fas fa-list-music"></i> ${escapeHtml(playlistName || result.name || '歌单')}</h3>
                <p class="result-count">共 ${songs.length} 首歌曲</p>
              </div>
              <div id="playlistSongs"></div>
            `;

            container.innerHTML = headerHtml;
            bindBackButton();

            displaySearchResults(songs, 'playlistSongs', songs);
            showNotification(`成功加载《${playlistName || result.name}》`, 'success');
            return;
          }
        } catch (retryError) {
          console.error('重试加载歌单失败:', retryError);
        }
      }
    }

    container.innerHTML = `
      <div class="nav-stage-header">
        <button class="back-btn" id="backToNav">
          <i class="fas fa-arrow-left"></i> 返回
        </button>
      </div>
      <div class="error">
        <i class="fas fa-exclamation-triangle"></i>
        <div>加载歌单失败，请稍后重试</div>
      </div>
    `;
    bindBackButton();
    showNotification('加载歌单详情失败', 'error');
  }
}

// ========== 绑定返回按钮 ==========
function bindBackButton(): void {
  const backBtn = document.getElementById('backToNav');
  if (backBtn) {
    registerEventListener(backBtn, 'click', () => {
      if (state.currentView === 'detail' && state.currentCategory) {
        // 如果是从分类页进入的详情，返回分类页
        // 但我们简化逻辑，都返回主页
        renderMainView();
      } else {
        renderMainView();
      }
    });
  }
}

// ========== 初始化函数 ==========
function initPlaylist(): void {
  renderMainView();
}

// ========== 清理函数 ==========
function cleanup(): void {
  clearCurrentListeners();
  state.currentView = 'main';
  state.currentCategory = '全部';
  state.currentPlaylistId = null;
  state.currentPlaylistName = null;
  state.isLoading = false;
}

export { initPlaylist, cleanup };
export default { initPlaylist, cleanup };
