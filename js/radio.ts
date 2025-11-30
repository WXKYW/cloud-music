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

// 电台频道定义 - 使用精选歌单ID
const RADIO_CHANNELS: (RadioChannel & { playlistId?: string })[] = [
  {
    id: 'personal_fm',
    name: '私人FM',
    icon: 'fas fa-radio',
    color: '#E91E63',
    tags: [],
    isFM: true,
    playlistId: '3778678', // 热歌榜作为备用FM源
  },
  {
    id: 'study',
    name: '专注学习',
    icon: 'fas fa-book-reader',
    color: '#4CAF50',
    tags: ['学习', '专注', '轻音乐', 'Study'],
    playlistId: '26467411', // 学习歌单
  },
  {
    id: 'sleep',
    name: '助眠时光',
    icon: 'fas fa-moon',
    color: '#673AB7',
    tags: ['助眠', '睡前', '白噪音', 'Sleep'],
    playlistId: '2246473066', // 助眠歌单
  },
  {
    id: 'workout',
    name: '运动能量',
    icon: 'fas fa-dumbbell',
    color: '#F44336',
    tags: ['运动', '跑步', '健身', 'Workout'],
    playlistId: '2341523302', // 运动歌单
  },
  {
    id: 'relax',
    name: '放松心情',
    icon: 'fas fa-coffee',
    color: '#FF9800',
    tags: ['放松', '治愈', '下午茶', 'Relax'],
    playlistId: '7244643266', // 放松歌单
  },
  {
    id: 'party',
    name: '派对狂欢',
    icon: 'fas fa-glass-cheers',
    color: '#E91E63',
    tags: ['派对', '电音', '舞曲', 'Party'],
    playlistId: '312377398', // 派对歌单
  },
  {
    id: 'coding',
    name: '代码之魂',
    icon: 'fas fa-laptop-code',
    color: '#2196F3',
    tags: ['编程', 'Coding', '黑客', '电子'],
    playlistId: '7463163', // 编程歌单
  },
  {
    id: 'emotional',
    name: '情感治愈',
    icon: 'fas fa-heart-broken',
    color: '#9C27B0',
    tags: ['伤感', '治愈', '情感', 'Emo'],
    playlistId: '2483435062', // 情感歌单
  },
  {
    id: 'driving',
    name: '驾驶时刻',
    icon: 'fas fa-car',
    color: '#009688',
    tags: ['驾车', '兜风', '公路', 'Trip'],
    playlistId: '2409964975', // 驾驶歌单
  },
];

// ... (currentChannel, radioPlaylist, isLoading definitions) ...

/**
 * 播放指定频道
 */
async function playChannel(channel: RadioChannel & { playlistId?: string }): Promise<void> {
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
    let songs: Song[] = [];

    if (channel.isFM) {
      // 私人FM模式：优先尝试搜索"推荐"，如果失败则使用热歌榜
      try {
        // 尝试搜索获取动态推荐
        const searchSongs = await api.searchMusicAPI('私人推荐', 'netease', 30);
        if (searchSongs && searchSongs.length > 0) {
          songs = searchSongs;
        } else {
          throw new Error('搜索结果为空');
        }
      } catch (e) {
        console.warn('FM搜索失败，降级使用歌单:', e);
        // 降级：使用热歌榜
        if (channel.playlistId) {
          const playlist = await api.parsePlaylistAPI(channel.playlistId, 'netease');
          songs = playlist.songs;
        }
      }
    } else if (channel.playlistId) {
      // 常规频道：直接解析对应的高质量歌单
      try {
        const playlist = await api.parsePlaylistAPI(channel.playlistId, 'netease');
        songs = playlist.songs;
      } catch (e) {
        console.error(`解析电台歌单 ${channel.playlistId} 失败:`, e);
        // 最后的降级：尝试用标签搜索
        if (channel.tags.length > 0) {
          songs = await api.searchMusicAPI(channel.tags[0], 'netease', 30);
        }
      }
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
// 默认导出，增强兼容性
export default { initRadio, cleanup };
