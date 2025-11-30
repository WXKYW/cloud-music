/**
 * 电台模块 (Radio Module)
 * 处理电台频道的展示、选择和播放
 */

import * as api from './api.js';
import * as ui from './ui.js';
import * as player from './player.js';
import { Song } from './api.js';

interface RadioChannel {
  id: string;
  name: string;
  icon: string;
  color: string;
  tags: string[];
  isFM?: boolean;
}

// 电台频道定义
const RADIO_CHANNELS: RadioChannel[] = [
  {
    id: 'personal_fm',
    name: '私人FM',
    icon: 'fas fa-radio',
    color: '#E91E63',
    tags: [],
    isFM: true,
  },
  {
    id: 'study',
    name: '专注学习',
    icon: 'fas fa-book-reader',
    color: '#4CAF50',
    tags: ['学习', '专注', '轻音乐', 'Study'],
  },
  {
    id: 'sleep',
    name: '助眠时光',
    icon: 'fas fa-moon',
    color: '#673AB7',
    tags: ['助眠', '睡前', '白噪音', 'Sleep'],
  },
  {
    id: 'workout',
    name: '运动能量',
    icon: 'fas fa-dumbbell',
    color: '#F44336',
    tags: ['运动', '跑步', '健身', 'Workout'],
  },
  {
    id: 'relax',
    name: '放松心情',
    icon: 'fas fa-coffee',
    color: '#FF9800',
    tags: ['放松', '治愈', '下午茶', 'Relax'],
  },
  {
    id: 'party',
    name: '派对狂欢',
    icon: 'fas fa-glass-cheers',
    color: '#E91E63',
    tags: ['派对', '电音', '舞曲', 'Party'],
  },
  {
    id: 'coding',
    name: '代码之魂',
    icon: 'fas fa-laptop-code',
    color: '#2196F3',
    tags: ['编程', 'Coding', '黑客', '电子'],
  },
  {
    id: 'emotional',
    name: '情感治愈',
    icon: 'fas fa-heart-broken',
    color: '#9C27B0',
    tags: ['伤感', '治愈', '情感', 'Emo'],
  },
  {
    id: 'driving',
    name: '驾驶时刻',
    icon: 'fas fa-car',
    color: '#009688',
    tags: ['驾车', '兜风', '公路', 'Trip'],
  },
];

// 当前电台状态
let currentChannel: RadioChannel | null = null;
let radioPlaylist: Song[] = [];
let isLoading = false;

/**
 * 初始化电台模块
 */
export function initRadio(): void {
  renderChannelList();
  bindEvents();
  // console.log('📻 电台模块已加载');
}

/**
 * 渲染电台频道列表
 */
function renderChannelList(): void {
  const listContainer = document.getElementById('radioChannelList');
  if (!listContainer) return;

  listContainer.innerHTML = RADIO_CHANNELS.map(createChannelCard).join('');

  // 绑定点击事件
  listContainer.querySelectorAll('.radio-card').forEach((card) => {
    card.addEventListener('click', () => {
      const channelId = (card as HTMLElement).dataset.id;
      const channel = RADIO_CHANNELS.find((c) => c.id === channelId);
      if (channel) {
        playChannel(channel);
      }
    });
  });
}

/**
 * 创建电台卡片 HTML
 */
function createChannelCard(channel: RadioChannel): string {
  return `
    <div class="radio-card" data-id="${channel.id}" style="--card-color: ${channel.color}">
        <div class="radio-icon">
            <i class="${channel.icon}"></i>
        </div>
        <div class="radio-info">
            <h3>${channel.name}</h3>
            <div class="radio-tags">
                ${channel.tags.map((tag) => `<span>#${tag}</span>`).join('')}
            </div>
        </div>
        <div class="radio-play-icon">
            <i class="fas fa-play"></i>
        </div>
    </div>
  `;
}

/**
 * 绑定事件
 */
function bindEvents(): void {
  const backBtn = document.getElementById('radioBackBtn');
  if (backBtn) {
    backBtn.addEventListener('click', showChannelList);
  }
}

/**
 * 播放指定频道
 */
async function playChannel(channel: RadioChannel): Promise<void> {
  if (isLoading) return;
  isLoading = true;
  currentChannel = channel;

  // 切换界面
  const listContainer = document.getElementById('radioChannelList');
  const playerContainer = document.getElementById('radioPlayerContainer');
  const titleEl = document.getElementById('radioCurrentChannel');
  const statusEl = document.getElementById('radioStatus');

  if (listContainer) listContainer.style.display = 'none';
  if (playerContainer) playerContainer.style.display = 'flex';
  if (titleEl) titleEl.textContent = channel.name;
  if (statusEl) statusEl.textContent = '正在加载电台音乐...';

  ui.showLoading('radioSongList');

  try {
    // 根据频道标签搜索歌曲
    let songs: Song[] = [];
    if (channel.isFM) {
      // 私人FM逻辑（暂用推荐接口替代）
      songs = await api.searchMusicAPI('推荐', 'netease');
    } else {
      // 使用标签搜索
      const keyword = channel.tags[0] || channel.name;
      songs = await api.searchMusicAPI(keyword, 'netease');
    }

    if (songs.length > 0) {
      radioPlaylist = songs;
      // 随机打乱
      radioPlaylist.sort(() => Math.random() - 0.5);

      // 渲染列表
      ui.displaySearchResults(radioPlaylist, 'radioSongList', radioPlaylist);

      // 自动播放第一首
      await player.playSong(0, radioPlaylist, 'radioSongList');

      if (statusEl) statusEl.textContent = `正在播放: ${channel.name}`;
    } else {
      if (statusEl) statusEl.textContent = '该频道暂无音乐';
      ui.showError('加载失败', 'radioSongList');
    }
  } catch (error) {
    console.error('加载电台失败:', error);
    if (statusEl) statusEl.textContent = '连接失败';
    ui.showError('加载失败，请重试', 'radioSongList');
  } finally {
    isLoading = false;
  }
}

/**
 * 返回频道列表
 */
function showChannelList(): void {
  const listContainer = document.getElementById('radioChannelList');
  const playerContainer = document.getElementById('radioPlayerContainer');

  if (listContainer) listContainer.style.display = 'grid';
  if (playerContainer) playerContainer.style.display = 'none';
}

export function cleanup(): void {
  // 清理逻辑
}
