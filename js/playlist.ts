// js/playlist.ts - 歌单发现模块（仅排行榜功能，热门歌单功能已移除）
import { parsePlaylistAPI, type Song } from './api';
import { showNotification, displaySearchResults } from './ui';

// 事件监听管理，避免重复绑定
interface EventListenerEntry {
  target: EventTarget;
  type: string;
  listener: EventListener;
  options?: AddEventListenerOptions | boolean;
}
const registeredEventListeners: EventListenerEntry[] = [];

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

export function cleanup(): void {
  clearCurrentListeners();
}

function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ========== 排行榜配置 ==========
const RANK_LISTS = [
  { id: '3778678', name: '热歌榜', icon: '🔥', color: '#ff6b6b', desc: '全站最热单曲' },
  { id: '3779629', name: '新歌榜', icon: '🆕', color: '#4caf50', desc: '每日新歌推荐' },
  { id: '19723756', name: '飙升榜', icon: '📈', color: '#2196f3', desc: '热度增长最快' },
  { id: '2884035', name: '原创榜', icon: '✨', color: '#9c27b0', desc: '优秀原创作品' },
  { id: '10520166', name: '电音榜', icon: '⚡', color: '#e91e63', desc: '全球电音精选' },
  { id: '180106', name: 'UK榜', icon: '🇬🇧', color: '#3f51b5', desc: '英国单曲排行' },
  { id: '60198', name: '美国榜', icon: '🇺🇸', color: '#f44336', desc: 'Billboard单曲' },
  { id: '71385702', name: 'ACG榜', icon: '🎮', color: '#ff9800', desc: '二次元音乐' },
  { id: '71384707', name: '古典榜', icon: '🎻', color: '#795548', desc: '经典古典音乐' },
];

// ... existing code ...

// ========== 渲染排行榜导航 ==========
function renderRankNav(): void {
  const container = document.getElementById('playlistContainer');
  if (!container) return;

  clearCurrentListeners();
  currentState.stage = 'rank';

  const navHtml = `
    <div class="nav-stage">
      <div class="nav-stage-header">
        <h3><i class="fas fa-trophy"></i> 排行榜</h3>
        <p class="result-count">选择一个排行榜查看详情</p>
      </div>
      <div class="rank-grid">
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
  `;

  container.innerHTML = navHtml;

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
}

// ========== 加载歌单详情 ==========
async function loadPlaylistDetail(playlistId: string, playlistName?: string): Promise<void> {
  const container = document.getElementById('playlistContainer');
  if (!container) return;

  clearCurrentListeners();
  currentState.stage = 'detail';
  currentState.playlistId = playlistId;
  currentState.playlistName = playlistName;

  container.innerHTML =
    '<div class="loading"><i class="fas fa-spinner fa-spin"></i><div>正在加载歌单...</div></div>';

  try {
    const result = await parsePlaylistAPI(playlistId, 'netease');
    const songs: Song[] = result?.songs || [];

    if (!songs || songs.length === 0) {
      container.innerHTML = `
        <div class="nav-stage-header">
          <button class="back-btn" id="backToRankNav">
            <i class="fas fa-arrow-left"></i> 返回
          </button>
        </div>
        <div class="error">
          <i class="fas fa-exclamation-triangle"></i>
          <div>歌单为空或加载失败</div>
        </div>
      `;
      const backBtn = document.getElementById('backToRankNav');
      if (backBtn) {
        registerEventListener(backBtn, 'click', renderRankNav);
      }
      return;
    }

    const headerHtml = `
      <div class="nav-stage-header">
        <button class="back-btn" id="backToRankNav">
          <i class="fas fa-arrow-left"></i> 返回
        </button>
        <h3><i class="fas fa-list-music"></i> ${escapeHtml(playlistName || result.name || '歌单')}</h3>
        <p class="result-count">共 ${songs.length} 首歌曲</p>
      </div>
      <div id="playlistSongs"></div>
    `;

    container.innerHTML = headerHtml;

    const backBtn = document.getElementById('backToRankNav');
    if (backBtn) {
      registerEventListener(backBtn, 'click', renderRankNav);
    }

    displaySearchResults(songs, 'playlistSongs', songs);
    showNotification(
      `成功加载《${playlistName || result.name}》，共 ${songs.length} 首歌曲`,
      'success'
    );
  } catch (error) {
    console.error('加载歌单详情失败:', error);

    // 尝试自动切换 API 源重试
    if (error instanceof Error && error.name !== 'AbortError') {
      console.warn('尝试切换 API 源重试加载歌单...');
      const switched = await import('./api.js').then(m => m.switchToNextAPI());
      if (switched) {
        try {
          const result = await parsePlaylistAPI(playlistId, 'netease');
          const songs: Song[] = result?.songs || [];
          
          if (songs.length > 0) {
            const headerHtml = `
              <div class="nav-stage-header">
                <button class="back-btn" id="backToRankNav">
                  <i class="fas fa-arrow-left"></i> 返回
                </button>
                <h3><i class="fas fa-list-music"></i> ${escapeHtml(playlistName || result.name || '歌单')}</h3>
                <p class="result-count">共 ${songs.length} 首歌曲</p>
              </div>
              <div id="playlistSongs"></div>
            `;
            
            container.innerHTML = headerHtml;
            
            const backBtn = document.getElementById('backToRankNav');
            if (backBtn) {
              registerEventListener(backBtn, 'click', renderRankNav);
            }
            
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
        <button class="back-btn" id="backToRankNav">
          <i class="fas fa-arrow-left"></i> 返回
        </button>
      </div>
      <div class="error">
        <i class="fas fa-exclamation-triangle"></i>
        <div>加载歌单失败，请稍后重试</div>
      </div>
    `;
    const backBtn = document.getElementById('backToRankNav');
    if (backBtn) {
      registerEventListener(backBtn, 'click', renderRankNav);
    }
    showNotification('加载歌单详情失败', 'error');
  }
}
// 默认导出，增强兼容性
export default { initPlaylist, cleanup };
