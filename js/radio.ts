/**
 * 电台模块 (Radio Module) - 优化版
 * 支持真正的私人FM和电台分类浏览
 */

import * as api from './api.js';
import * as ui from './ui.js';
import * as player from './player.js';
import { Song } from './api.js';

// 电台频道类型
interface RadioChannel {
  id: string;
  name: string;
  icon: string;
  color: string;
  tags: string[];
  type: 'fm' | 'playlist' | 'dj'; // fm=私人FM, playlist=歌单模式, dj=真实电台
  playlistId?: string; // 歌单模式用
  djCategoryId?: number; // 电台分类用
}

// 模块状态
let currentChannel: RadioChannel | null = null;
let radioPlaylist: Song[] = [];
let isLoading = false;
let currentView: 'channels' | 'player' | 'djList' = 'channels';

// 预设频道配置
const RADIO_CHANNELS: RadioChannel[] = [
  {
    id: 'personal_fm',
    name: '私人FM',
    icon: 'fas fa-radio',
    color: '#E91E63',
    tags: ['个性推荐', '无限惊喜'],
    type: 'fm',
  },
  {
    id: 'study',
    name: '专注学习',
    icon: 'fas fa-book-reader',
    color: '#4CAF50',
    tags: ['学习', '专注', '轻音乐'],
    type: 'playlist',
    playlistId: '26467411',
  },
  {
    id: 'sleep',
    name: '助眠时光',
    icon: 'fas fa-moon',
    color: '#673AB7',
    tags: ['助眠', '睡前', '白噪音'],
    type: 'playlist',
    playlistId: '2246473066',
  },
  {
    id: 'workout',
    name: '运动能量',
    icon: 'fas fa-dumbbell',
    color: '#F44336',
    tags: ['运动', '跑步', '健身'],
    type: 'playlist',
    playlistId: '2341523302',
  },
  {
    id: 'relax',
    name: '放松心情',
    icon: 'fas fa-coffee',
    color: '#FF9800',
    tags: ['放松', '治愈', '下午茶'],
    type: 'playlist',
    playlistId: '7244643266',
  },
  {
    id: 'party',
    name: '派对狂欢',
    icon: 'fas fa-glass-cheers',
    color: '#E91E63',
    tags: ['派对', '电音', '舞曲'],
    type: 'playlist',
    playlistId: '312377398',
  },
  {
    id: 'coding',
    name: '代码之魂',
    icon: 'fas fa-laptop-code',
    color: '#2196F3',
    tags: ['编程', 'Coding', '电子'],
    type: 'playlist',
    playlistId: '7463163',
  },
  {
    id: 'emotional',
    name: '情感治愈',
    icon: 'fas fa-heart-broken',
    color: '#9C27B0',
    tags: ['伤感', '治愈', '情感'],
    type: 'playlist',
    playlistId: '2483435062',
  },
  {
    id: 'driving',
    name: '驾驶时刻',
    icon: 'fas fa-car',
    color: '#009688',
    tags: ['驾车', '兜风', '公路'],
    type: 'playlist',
    playlistId: '2409964975',
  },
];

/**
 * 播放指定频道
 */
async function playChannel(channel: RadioChannel): Promise<void> {
  if (isLoading) return;
  isLoading = true;
  currentChannel = channel;

  const listContainer = document.getElementById('radioChannelList');
  const playerContainer = document.getElementById('radioPlayerContainer');
  const titleEl = document.getElementById('radioCurrentChannel');
  const statusEl = document.getElementById('radioStatus');

  if (listContainer) listContainer.style.display = 'none';
  if (playerContainer) playerContainer.style.display = 'flex';
  if (titleEl) titleEl.textContent = channel.name;
  if (statusEl) statusEl.textContent = '正在加载...';
  currentView = 'player';

  ui.showLoading('radioSongList');

  try {
    let songs: Song[] = [];

    if (channel.type === 'fm') {
      // Use real Personal FM API
      if (statusEl) statusEl.textContent = '正在获取私人FM推荐...';
      songs = await api.getPersonalFM();

      if (songs.length === 0) {
        // Fallback: search for recommended songs
        songs = await api.searchMusicAPI('推荐热门', 'netease', 30);
      }
    } else if (channel.type === 'playlist' && channel.playlistId) {
      // Playlist mode
      if (statusEl) statusEl.textContent = '正在解析歌单...';
      try {
        const playlist = await api.parsePlaylistAPI(channel.playlistId, 'netease');
        songs = playlist.songs;
      } catch (e) {
        // Fallback: search by tags
        if (channel.tags.length > 0) {
          songs = await api.searchMusicAPI(channel.tags[0], 'netease', 30);
        }
      }
    }

    if (songs.length > 0) {
      radioPlaylist = songs;
      // Shuffle for variety
      radioPlaylist.sort(() => Math.random() - 0.5);

      ui.displaySearchResults(radioPlaylist, 'radioSongList', radioPlaylist);
      await player.playSong(0, radioPlaylist, 'radioSongList');

      if (statusEl) statusEl.textContent = `正在播放: ${channel.name}`;
    } else {
      if (statusEl) statusEl.textContent = '该频道暂无音乐';
      ui.showError('加载失败', 'radioSongList');
    }
  } catch (error) {
    if (statusEl) statusEl.textContent = '连接失败';
    ui.showError('加载失败，请重试', 'radioSongList');
  } finally {
    isLoading = false;
  }
}

/**
 * Load more FM songs (for continuous playback)
 */
async function loadMoreFMSongs(): Promise<void> {
  if (currentChannel?.type !== 'fm' || isLoading) return;

  try {
    const moreSongs = await api.getPersonalFM();
    if (moreSongs.length > 0) {
      radioPlaylist.push(...moreSongs);
    }
  } catch (error) {
    // Load more failed silently
  }
}

/**
 * Return to channel list
 */
function showChannelList(): void {
  const listContainer = document.getElementById('radioChannelList');
  const playerContainer = document.getElementById('radioPlayerContainer');

  if (listContainer) listContainer.style.display = 'grid';
  if (playerContainer) playerContainer.style.display = 'none';
  currentView = 'channels';
}

/**
 * Render the channel list
 */
function renderChannelList(): void {
  const container = document.getElementById('radioChannelList');
  if (!container) {
    return;
  }

  container.innerHTML = RADIO_CHANNELS.map(channel => `
    <div class="radio-channel-card" data-channel-id="${channel.id}" data-name="${channel.name}" style="--channel-color: ${channel.color}">
      <div class="radio-channel-icon" style="background: ${channel.color}">
        <i class="${channel.icon}"></i>
      </div>
      <div class="radio-channel-info">
        <h4 class="radio-channel-name">${channel.name}</h4>
        <div class="radio-channel-tags">
          ${channel.tags.slice(0, 3).map(tag => `<span class="radio-tag">${tag}</span>`).join('')}
        </div>
      </div>
      ${channel.type === 'fm' ? '<span class="fm-badge">FM</span>' : ''}
      <div class="radio-channel-overlay" data-name="${channel.name}"><i class="fas fa-play"></i></div>
    </div>
  `).join('');
}

/**
 * Bind event listeners
 */
function bindEvents(): void {
  const channelList = document.getElementById('radioChannelList');
  if (channelList) {
    channelList.addEventListener('click', (e: Event) => {
      const target = e.target as HTMLElement;
      const card = target.closest('.radio-channel-card') as HTMLElement;
      if (card) {
        const channelId = card.dataset.channelId;
        const channel = RADIO_CHANNELS.find(ch => ch.id === channelId);
        if (channel) {
          playChannel(channel);
        }
      }
    });
  }

  const backBtn = document.getElementById('radioBackBtn');
  if (backBtn) {
    backBtn.addEventListener('click', () => {
      showChannelList();
    });
  }

  // Listen for track end to load more FM songs
  const audioPlayer = document.getElementById('audioPlayer') as HTMLAudioElement;
  if (audioPlayer) {
    audioPlayer.addEventListener('ended', () => {
      if (currentChannel?.type === 'fm' && radioPlaylist.length < 5) {
        loadMoreFMSongs();
      }
    });
  }
}

function cleanup(): void {
  currentChannel = null;
  radioPlaylist = [];
  isLoading = false;
  currentView = 'channels';
}

function initRadio(): void {
  renderChannelList();
  bindEvents();
}

export { initRadio, cleanup };
export default { initRadio, cleanup };
