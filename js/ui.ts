import { Song } from './api.js';
// 老王修复BUG: 添加DOM初始化检查
import * as player from './player.js';
import { isSongInFavoritesSync } from './player.js';
import { formatTime, formatArtist } from './utils.js';
import { LyricLine } from './types.js';
import { VirtualScroll, createSongListVirtualScroll } from './virtual-scroll.js';

// --- DOM Element Cache ---
interface DOMElements {
  searchResults: HTMLElement;
  parseResults: HTMLElement;
  savedResults: HTMLElement;
  currentCover: HTMLImageElement;
  currentTitle: HTMLElement;
  currentArtist: HTMLElement;
  playBtn: HTMLElement;
  progressFill: HTMLElement;
  currentTime: HTMLElement;
  totalTime: HTMLElement;
  lyricsContainer: HTMLElement;
  downloadSongBtn: HTMLButtonElement | null;
  downloadLyricBtn: HTMLButtonElement | null;
}

let DOM: DOMElements;

// --- 多选状态管理 ---
const selectedSongs = new Set<number>();
let currentSongList: Song[] = [];

// 优化: 存储事件监听器引用，防止内存泄漏
const containerEventListeners = new WeakMap<HTMLElement, (e: Event) => void>();

// 虚拟滚动实例管理
const virtualScrollInstances = new WeakMap<HTMLElement, VirtualScroll>();

// 优化: 添加全局清理函数
export function cleanup(): void {
  // 清理所有事件监听器
  const containers = [
    document.getElementById('searchResults'),
    document.getElementById('parseResults'),
    document.getElementById('savedResults'),
  ];

  containers.forEach((container) => {
    if (container) {
      const listener = containerEventListeners.get(container);
      if (listener) {
        container.removeEventListener('click', listener);
      }

      // 清理虚拟滚动实例
      const virtualScroll = virtualScrollInstances.get(container);
      if (virtualScroll) {
        virtualScroll.destroy();
        virtualScrollInstances.delete(container);
      }
    }
  });
}

// 页面卸载时自动清理
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', cleanup);
}

export function init(): void {
  const lyricsContainer = document.getElementById('lyricsContainerInline');

  DOM = {
    searchResults: document.getElementById('searchResults')!,
    parseResults: document.getElementById('parseResults')!,
    savedResults: document.getElementById('savedResults') || document.createElement('div'),
    currentCover: document.getElementById('currentCover') as HTMLImageElement,
    currentTitle: document.getElementById('currentTitle')!,
    currentArtist: document.getElementById('currentArtist')!,
    playBtn: document.getElementById('playBtn')!,
    progressFill: document.getElementById('progressFill')!,
    currentTime: document.getElementById('currentTime')!,
    totalTime: document.getElementById('totalTime')!,
    lyricsContainer: lyricsContainer!,
    downloadSongBtn: document.getElementById('downloadSongBtn') as HTMLButtonElement | null,
    downloadLyricBtn: document.getElementById('downloadLyricBtn') as HTMLButtonElement | null,
  };
}

// --- UI Functions ---

export function showNotification(
  message: string,
  type: 'info' | 'success' | 'warning' | 'error' = 'info'
): void {
  const notification = document.createElement('div');
  // A basic notification style, can be improved in CSS
  notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        padding: 10px 20px;
        border-radius: 5px;
        color: white;
        background-color: ${type === 'success' ? '#4CAF50' : type === 'error' ? '#f44336' : '#2196F3'};
        z-index: 1001;
        transition: opacity 0.5s;
    `;
  notification.textContent = message;
  document.body.appendChild(notification);
  setTimeout(() => {
    notification.style.opacity = '0';
    setTimeout(() => notification.remove(), 500);
  }, 3000);
}

// 优化: 创建单个歌曲元素
function createSongElement(
  _song: Song,
  index: number,
  playlistForPlayback: Song[],
  _containerId: string
): HTMLElement {
  // 从 playlistForPlayback 获取实际的歌曲数据（确保参数被使用）
  const song = playlistForPlayback[index];

  const songItem = document.createElement('div');
  songItem.className = 'song-item';
  songItem.dataset.index = String(index);

  const isFavorite = isSongInFavoritesSync(song);
  const favoriteIconClass = isFavorite ? 'fas fa-heart' : 'far fa-heart';
  const favoriteIconColor = isFavorite ? 'color: #ff6b6b;' : '';

  // 老王新增：添加复选框，用于批量选择
  const albumText = song.album && song.album.trim() ? ` · ${escapeHtml(song.album)}` : '';
  songItem.innerHTML = `
        <input type="checkbox" class="song-checkbox" data-song-index="${index}" />
        <div class="song-index">${(index + 1).toString().padStart(2, '0')}</div>
        <div class="song-info">
            <div class="song-name">${escapeHtml(song.name)}</div>
            <div class="song-artist">${escapeHtml(formatArtist(song.artist))}${albumText}</div>
        </div>
        <div class="song-actions">
            <button class="action-btn favorite-btn" title="添加到我的喜欢" data-action="favorite">
                <i class="${favoriteIconClass}" style="${favoriteIconColor}"></i>
            </button>
            <button class="action-btn download-btn" title="下载音乐" data-action="download">
                <i class="fas fa-download"></i>
            </button>
        </div>
    `;

  return songItem;
}

// 优化: HTML 转义防止 XSS
function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// 优化: 使用虚拟滚动和事件委托，大幅提升大列表性能
export function displaySearchResults(
  songs: Song[],
  containerId: string,
  playlistForPlayback: Song[]
): void {
  const container = document.getElementById(containerId);
  if (!container) return;

  if (songs.length === 0) {
    container.innerHTML = `<div class="empty-state"><div>未找到相关歌曲</div></div>`;
    return;
  }

  // 清理旧的虚拟滚动实例
  const oldVirtualScroll = virtualScrollInstances.get(container);
  if (oldVirtualScroll) {
    oldVirtualScroll.destroy();
    virtualScrollInstances.delete(container);
  }

  // 优化: 移除旧的事件监听器，防止内存泄漏
  const oldListener = containerEventListeners.get(container);
  if (oldListener) {
    container.removeEventListener('click', oldListener);
  }

  // 判断是否需要使用虚拟滚动（超过阈值时启用）
  // 修复BUG-P3-02: 降低阈值以提升500-1000首歌曲时的性能，移动端使用更低阈值
  const USE_VIRTUAL_SCROLL_THRESHOLD = window.innerWidth <= 768 ? 300 : 500;

  if (songs.length > USE_VIRTUAL_SCROLL_THRESHOLD) {
    // 使用虚拟滚动优化性能
    const virtualScroll = createSongListVirtualScroll(
      container,
      songs,
      playlistForPlayback,
      containerId
    );
    virtualScrollInstances.set(container, virtualScroll);
  } else {
    // 歌曲数量较少，使用传统渲染方式
    // 老王新增：创建批量操作栏（已去掉反选按钮）
    const batchActionsBar = document.createElement('div');
    batchActionsBar.className = 'batch-actions-bar';
    batchActionsBar.innerHTML = `
            <div class="batch-actions-left">
                <span class="batch-count">已选择 0 首</span>
                <button class="batch-action-btn" data-batch-action="select-all">
                    <i class="fas fa-check-square"></i> 全选
                </button>
            </div>
            <div class="batch-actions-right">
                <button class="batch-action-btn" data-batch-action="favorite" disabled>
                    <i class="fas fa-heart"></i> 批量收藏
                </button>
                <button class="batch-action-btn" data-batch-action="download" disabled>
                    <i class="fas fa-download"></i> 批量下载
                </button>
                <button class="batch-action-btn" data-batch-action="play" disabled>
                    <i class="fas fa-play"></i> 播放选中
                </button>
            </div>
        `;

    // 优化: 使用 DocumentFragment 批量插入 DOM
    const fragment = document.createDocumentFragment();

    // 先添加批量操作栏
    fragment.appendChild(batchActionsBar);

    songs.forEach((song, index) => {
      const songElement = createSongElement(song, index, playlistForPlayback, containerId);
      fragment.appendChild(songElement);
    });

    // 优化: 一次性清空并插入，减少重排
    container.innerHTML = '';
    container.appendChild(fragment);

    // 优化: 创建新的事件监听器并保存引用
    const clickHandler = (e: Event) => {
      const target = e.target as HTMLElement;

      // 老王新增：处理批量操作按钮点击
      const batchAction = target.closest('[data-batch-action]')?.getAttribute('data-batch-action');
      if (batchAction) {
        handleBatchAction(batchAction, containerId);
        return;
      }

      // 老王新增：处理复选框点击事件
      if (target.classList.contains('song-checkbox')) {
        const checkbox = target as HTMLInputElement;
        const index = parseInt(checkbox.dataset.songIndex || '0');

        if (checkbox.checked) {
          selectedSongs.add(index);
        } else {
          selectedSongs.delete(index);
        }

        // 更新批量操作按钮状态和全选按钮文本
        updateBatchActionsState(containerId);
        updateSelectAllButtonText(containerId);
        return;
      }

      const songItem = target.closest('.song-item') as HTMLElement;

      if (!songItem) return;

      const index = parseInt(songItem.dataset.index || '0');
      const action = target.closest('[data-action]')?.getAttribute('data-action');

      if (action === 'favorite') {
        e.stopPropagation();
        const song = playlistForPlayback[index];
        player.toggleFavoriteButton(song);

        // 优化: 乐观更新 UI
        const icon = target.closest('.favorite-btn')?.querySelector('i');
        if (icon && isSongInFavoritesSync(song)) {
          icon.className = 'fas fa-heart';
          icon.style.color = '#ff6b6b';
        } else if (icon) {
          icon.className = 'far fa-heart';
          icon.style.color = '';
        }
      } else if (action === 'download') {
        e.stopPropagation();
        player.downloadSongByData(playlistForPlayback[index]);
      } else {
        // 点击歌曲项播放（但排除复选框和操作按钮区域）
        if (!target.closest('.song-actions') && !target.classList.contains('song-checkbox')) {
          player.playSong(index, playlistForPlayback, containerId);
        }
      }
    };

    // 添加新的事件监听器并保存引用
    container.addEventListener('click', clickHandler);
    containerEventListeners.set(container, clickHandler);

    // 老王新增：保存当前歌曲列表，供批量操作使用
    currentSongList = playlistForPlayback;
    selectedSongs.clear(); // 切换列表时清空选中状态
  }
}

export function updatePlayButton(isPlaying: boolean): void {
  // 防御性检查
  if (!DOM || !DOM.playBtn) {
    return;
  }
  const icon = DOM.playBtn.querySelector('i')!;
  icon.className = isPlaying ? 'fas fa-pause' : 'fas fa-play';
}

export function updateCurrentSongInfo(song: Song, coverUrl: string): void {
  // 防御性检查：确保DOM已初始化
  if (!DOM || !DOM.currentTitle || !DOM.currentArtist) {
    return;
  }

  // 防御性检查：如果song无效，显示默认信息
  if (!song || typeof song !== 'object') {
    DOM.currentTitle.textContent = '未知歌曲';
    DOM.currentArtist.textContent = '未知艺术家';
    return;
  }

  DOM.currentTitle.textContent = song.name || '未知歌曲';
  const albumText = song.album && typeof song.album === 'string' && song.album.trim() ? ` · ${song.album}` : '';
  DOM.currentArtist.textContent = `${formatArtist(song.artist)}${albumText}`;

  // 优化: 使用图片懒加载
  const coverImg = DOM.currentCover as HTMLImageElement;
  if (coverUrl) {
    // 添加加载状态
    coverImg.classList.add('loading');
    coverImg.classList.remove('loaded', 'error');

    // 预加载图片
    const tempImg = new Image();
    tempImg.onload = () => {
      coverImg.src = coverUrl;
      coverImg.classList.remove('loading');
      coverImg.classList.add('loaded');
    };
    tempImg.onerror = () => {
      // 使用默认封面
      coverImg.src =
        'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjIwIiBoZWlnaHQ9IjIyMCIgdmlld0JveD0iMCAwIDIyMCAyMjAiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CjxyZWN0IHdpZHRoPSIyMjAiIGhlaWdodD0iMjIwIiBmaWxsPSJyZ2JhKDI1NSwyNTUsMjU5LDAuMSkiIHJ4PSIyMCIvPgo8cGF0aCBkPSJNMTEwIDcwTDE0MCAxMTBIMTIwVjE1MEg5MFYxMTBINzBMMTEwIDcwWiIgZmlsbD0icmdiYSgyNTUsMjU1LDI1NSwwLjMpIi8+Cjwvc3ZnPgo=';
      coverImg.classList.remove('loading');
      coverImg.classList.add('error');
    };
    tempImg.src = coverUrl;
  }

  if (DOM.downloadSongBtn) DOM.downloadSongBtn.disabled = false;
  if (DOM.downloadLyricBtn) DOM.downloadLyricBtn.disabled = false;
}

export function updateProgress(currentTime: number, duration: number): void {
  const progressPercent = (currentTime / duration) * 100;
  DOM.progressFill.style.width = `${progressPercent}%`;
  DOM.currentTime.textContent = formatTime(currentTime);
  DOM.totalTime.textContent = formatTime(duration);
}

// 优化: 缓存上次激活的歌词索引和渲染的歌词
let lastActiveLyricIndex = -1;
let lastRenderedLyrics: LyricLine[] = [];

// 重置歌词状态（切换歌曲时调用）
export function resetLyrics(): void {
  lastActiveLyricIndex = -1;
  lastRenderedLyrics = [];
  const inlineContainer = document.getElementById('lyricsContainerInline');
  if (inlineContainer) {
    inlineContainer.innerHTML = `
      <div class="lyric-line lyric-prev"></div>
      <div class="lyric-line lyric-current active">加载歌词中...</div>
      <div class="lyric-line lyric-next"></div>
    `;
  }
}

export function updateLyrics(lyrics: LyricLine[], currentTime: number): void {
  const inlineContainer = document.getElementById('lyricsContainerInline');
  if (!inlineContainer) return;

  if (!lyrics.length) {
    inlineContainer.innerHTML = `
      <div class="lyric-line lyric-prev"></div>
      <div class="lyric-line lyric-current active">暂无歌词</div>
      <div class="lyric-line lyric-next"></div>
    `;
    lastActiveLyricIndex = -1;
    lastRenderedLyrics = [];
    return;
  }

  const needsRerender = lyrics !== lastRenderedLyrics;

  if (needsRerender) {
    lastRenderedLyrics = lyrics;
    lastActiveLyricIndex = -1;
    // 初始化歌词容器结构
    inlineContainer.innerHTML = `
      <div class="lyric-line lyric-prev"></div>
      <div class="lyric-line lyric-current active"></div>
      <div class="lyric-line lyric-next"></div>
    `;
  }

  const activeIndex = findActiveLyricIndex(lyrics, currentTime);

  if (activeIndex === lastActiveLyricIndex) return;

  lastActiveLyricIndex = activeIndex;
  updateLyricActiveState(inlineContainer, activeIndex);
}


// 优化: 二分查找活动歌词
function findActiveLyricIndex(lyrics: LyricLine[], currentTime: number): number {
  // 老王修复：添加0.3秒提前量，让歌词提前显示以便用户跟唱
  const adjustedTime = currentTime + 0.3;

  let left = 0;
  let right = lyrics.length - 1;
  let result = -1;

  while (left <= right) {
    const mid = Math.floor((left + right) / 2);

    if (lyrics[mid].time <= adjustedTime) {
      result = mid;
      left = mid + 1;
    } else {
      right = mid - 1;
    }
  }

  return result;
}

function updateLyricActiveState(container: HTMLElement, activeIndex: number): void {
  const lines = container.querySelectorAll('.lyric-line');
  if (lines.length < 3) return;

  const prevLine = lines[0] as HTMLElement;
  const currentLine = lines[1] as HTMLElement;
  const nextLine = lines[2] as HTMLElement;

  const allLyrics = lastRenderedLyrics;
  if (allLyrics.length === 0 || activeIndex < 0 || activeIndex >= allLyrics.length) {
    prevLine.textContent = '';
    currentLine.textContent = '暂无歌词';
    nextLine.textContent = '';
    return;
  }

  prevLine.textContent = activeIndex > 0 ? allLyrics[activeIndex - 1].text : '';
  currentLine.textContent = allLyrics[activeIndex].text;
  nextLine.textContent = activeIndex < allLyrics.length - 1 ? allLyrics[activeIndex + 1].text : '';
}

// 老王修复BUG：更新当前播放歌曲的高亮状态
export function updateActiveItem(currentIndex: number, containerId: string): void {
  document.querySelectorAll('.song-item').forEach((item) => item.classList.remove('active'));

  const container = document.getElementById(containerId);
  if (container) {
    // 老王修复：使用 data-index 精确匹配，而不是 nth-child（会计算所有子元素导致索引错位）
    const activeItem = container.querySelector(`.song-item[data-index="${currentIndex}"]`);
    if (activeItem) {
      activeItem.classList.add('active');
      activeItem.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }
}

export function showLoading(containerId: string = 'searchResults'): void {
  const container = document.getElementById(containerId);
  if (!container) {
    return;
  }
  container.innerHTML = `<div class="loading"><i class="fas fa-spinner"></i><div>正在加载...</div></div>`;
}

export function showError(message: string, containerId: string = 'searchResults'): void {
  const container = document.getElementById(containerId);
  if (!container) {
    return;
  }
  container.innerHTML = `<div class="error"><i class="fas fa-exclamation-triangle"></i><div>${escapeHtml(message)}</div></div>`;
}

// ========== 老王新增：批量选择功能 ==========

/**
 * 处理批量操作
 */
function handleBatchAction(action: string, containerId: string): void {
  switch (action) {
    case 'select-all':
      toggleSelectAll(containerId);
      break;

    case 'favorite':
      batchFavoriteSongs();
      break;

    case 'download':
      batchDownloadSongs();
      break;

    case 'play':
      playSelectedSongs();
      break;

    default:
      break;
  }
}

/**
 * 批量收藏选中的歌曲
 */
function batchFavoriteSongs(): void {
  const selectedSongsList = getSelectedSongs();
  if (selectedSongsList.length === 0) {
    showNotification('请先选择要收藏的歌曲', 'warning');
    return;
  }

  let successCount = 0;
  selectedSongsList.forEach((song) => {
    if (!isSongInFavoritesSync(song)) {
      player.toggleFavoriteButton(song);
      successCount++;
    }
  });

  showNotification(`已收藏 ${successCount} 首歌曲`, 'success');
}

/**
 * 批量下载选中的歌曲
 */
function batchDownloadSongs(): void {
  const selectedSongsList = getSelectedSongs();
  if (selectedSongsList.length === 0) {
    showNotification('请先选择要下载的歌曲', 'warning');
    return;
  }

  if (selectedSongsList.length > 10) {
    const confirmed = confirm(
      `您选择了 ${selectedSongsList.length} 首歌曲，批量下载可能需要较长时间。是否继续？`
    );
    if (!confirmed) return;
  }

  showNotification(`开始批量下载 ${selectedSongsList.length} 首歌曲`, 'info');

  selectedSongsList.forEach((song, index) => {
    // 延迟下载，避免同时发起过多请求
    setTimeout(() => {
      player.downloadSongByData(song);
    }, index * 500); // 每首歌间隔500ms
  });
}

/**
 * 播放选中的歌曲
 */
function playSelectedSongs(): void {
  const selectedSongsList = getSelectedSongs();
  if (selectedSongsList.length === 0) {
    showNotification('请先选择要播放的歌曲', 'warning');
    return;
  }

  // 播放第一首选中的歌曲，并将选中的歌曲列表设置为播放列表
  player.playSong(0, selectedSongsList, 'batchPlay');
  showNotification(`开始播放 ${selectedSongsList.length} 首选中的歌曲`, 'success');
}

/**
 * 更新批量操作按钮的状态
 */
function updateBatchActionsState(containerId: string): void {
  const container = document.getElementById(containerId);
  if (!container) return;

  const batchActionsBar = container.querySelector('.batch-actions-bar') as HTMLElement;
  if (!batchActionsBar) return;

  const selectedCount = selectedSongs.size;
  const countDisplay = batchActionsBar.querySelector('.batch-count') as HTMLElement;

  if (countDisplay) {
    countDisplay.textContent = `已选择 ${selectedCount} 首`;
  }

  // 根据选中数量启用/禁用批量操作按钮
  const batchButtons = batchActionsBar.querySelectorAll('.batch-action-btn');
  batchButtons.forEach((btn) => {
    const action = (btn as HTMLElement).dataset.batchAction;
    // 全选按钮始终可用，其他按钮需要有选中项
    if (action === 'select-all') {
      (btn as HTMLButtonElement).disabled = false;
    } else {
      (btn as HTMLButtonElement).disabled = selectedCount === 0;
    }
  });

  // 显示/隐藏批量操作栏（有歌曲时始终显示，方便全选操作）
  batchActionsBar.style.display = 'flex';
}

/**
 * 切换全选/取消全选状态
 */
function toggleSelectAll(containerId: string): void {
  const container = document.getElementById(containerId);
  if (!container) return;

  const checkboxes = container.querySelectorAll('.song-checkbox') as NodeListOf<HTMLInputElement>;
  const totalCount = checkboxes.length;

  // 判断当前是否全选：如果选中数量等于总数，则取消全选；否则全选
  const isAllSelected = selectedSongs.size === totalCount;

  if (isAllSelected) {
    // 取消全选
    checkboxes.forEach((checkbox) => {
      checkbox.checked = false;
    });
    selectedSongs.clear();
    showNotification('已取消全选', 'info');
  } else {
    // 全选
    checkboxes.forEach((checkbox, index) => {
      checkbox.checked = true;
      selectedSongs.add(index);
    });
    showNotification(`已全选 ${selectedSongs.size} 首歌曲`, 'info');
  }

  updateBatchActionsState(containerId);
  updateSelectAllButtonText(containerId);
}

/**
 * 更新全选按钮的文本
 */
function updateSelectAllButtonText(containerId: string): void {
  const container = document.getElementById(containerId);
  if (!container) return;

  const selectAllBtn = container.querySelector('[data-batch-action="select-all"]');
  if (!selectAllBtn) return;

  const checkboxes = container.querySelectorAll('.song-checkbox') as NodeListOf<HTMLInputElement>;
  const isAllSelected = selectedSongs.size === checkboxes.length && checkboxes.length > 0;

  if (isAllSelected) {
    selectAllBtn.innerHTML = '<i class="fas fa-times-circle"></i> 取消全选';
  } else {
    selectAllBtn.innerHTML = '<i class="fas fa-check-square"></i> 全选';
  }
}

/**
 * 全选当前列表的所有歌曲（保留此函数供外部调用）
 */
export function selectAllSongs(containerId: string): void {
  const container = document.getElementById(containerId);
  if (!container) return;

  const checkboxes = container.querySelectorAll('.song-checkbox') as NodeListOf<HTMLInputElement>;
  checkboxes.forEach((checkbox, index) => {
    checkbox.checked = true;
    selectedSongs.add(index);
  });

  updateBatchActionsState(containerId);
  updateSelectAllButtonText(containerId);
  showNotification(`已全选 ${selectedSongs.size} 首歌曲`, 'info');
}

/**
 * 取消选择所有歌曲
 */
export function deselectAllSongs(containerId: string): void {
  const container = document.getElementById(containerId);
  if (!container) return;

  const checkboxes = container.querySelectorAll('.song-checkbox') as NodeListOf<HTMLInputElement>;
  checkboxes.forEach((checkbox) => {
    checkbox.checked = false;
  });

  selectedSongs.clear();
  updateBatchActionsState(containerId);
  updateSelectAllButtonText(containerId);
  showNotification('已取消全选', 'info');
}

/**
 * 反选当前列表的歌曲
 */
export function invertSelection(containerId: string): void {
  const container = document.getElementById(containerId);
  if (!container) return;

  const checkboxes = container.querySelectorAll('.song-checkbox') as NodeListOf<HTMLInputElement>;
  const newSelection = new Set<number>();

  checkboxes.forEach((checkbox, index) => {
    if (checkbox.checked) {
      checkbox.checked = false;
    } else {
      checkbox.checked = true;
      newSelection.add(index);
    }
  });

  selectedSongs.clear();
  newSelection.forEach((index) => selectedSongs.add(index));
  updateBatchActionsState(containerId);
  showNotification(`已反选，当前选中 ${selectedSongs.size} 首`, 'info');
}

/**
 * 获取已选中的歌曲列表
 */
export function getSelectedSongs(): Song[] {
  const selectedSongsList: Song[] = [];
  selectedSongs.forEach((index) => {
    if (currentSongList[index]) {
      selectedSongsList.push(currentSongList[index]);
    }
  });
  return selectedSongsList;
}

/**
 * 获取已选中的歌曲索引数组
 */
export function getSelectedIndices(): number[] {
  return Array.from(selectedSongs);
}

/**
 * 清空选中状态
 */
export function clearSelection(containerId?: string): void {
  if (containerId) {
    deselectAllSongs(containerId);
  } else {
    selectedSongs.clear();
  }
}
