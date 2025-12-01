import * as api from './api.js';
import { Song } from './api.js';
import * as ui from './ui.js';
import {
  PLAYER_CONFIG,
  STORAGE_CONFIG,
  SOURCE_NAMES,
  QUALITY_NAMES,
  QUALITY_FALLBACK,
  DOWNLOAD_CONFIG,
  AVAILABLE_SOURCES,
} from './config.js';
import { generateSongFileName } from './utils.js';
import { LyricLine } from './types.js';
import { recordPlay } from './play-stats.js';
import { startDownloadWithProgress } from './download-progress.js';
import lyricsWorkerManager from './lyrics-worker-manager.js';
// BUG-004修复: 引入安全的localStorage操作函数
import { safeSetItem, safeGetItem } from './storage-utils.js';
// BUG-006修复: 引入统一的代理处理
import { getProxiedUrl, shouldBypassProxy } from './proxy-handler.js';
import { playbackAnalytics } from './playback-analytics.js';
// 引入IndexedDB存储
import indexedDB from './indexed-db.js';

// --- Player State ---
let currentPlaylist: Song[] = [];
let currentIndex: number = -1;
let isPlaying: boolean = false;
// 老王修复：音频播放器引用，在init时初始化
let audioPlayer: HTMLAudioElement;
let playMode: 'loop' | 'random' | 'single' = 'loop';
let playHistory: number[] = [];
let historyPosition: number = -1;
let lastActiveContainer: string = 'searchResults';
let consecutiveFailures: number = 0; // 连续播放失败计数
let currentLyrics: LyricLine[] = []; // 存储当前歌曲的歌词
let playStartTime: number = 0; // 记录播放开始时间
let lastRecordedSong: Song | null = null; // 上一首记录统计的歌曲

// 音质管理
const QUALITY_OPTIONS = ['128', '320', '999'];
const QUALITY_LABELS: { [key: string]: string } = {
  '128': '标准 128K',
  '320': '高品质 320K',
  '999': '无损',
};
let currentQualityIndex = 1; // 默认320K

// 事件监听器管理 - 防止内存泄漏
interface EventListenerRecord {
  element: HTMLElement | Window | Document;
  event: string;
  handler: EventListener;
}
let eventListeners: EventListenerRecord[] = [];

// 添加事件监听器并记录
function addManagedEventListener(
  element: HTMLElement | Window | Document,
  event: string,
  handler: EventListener
): void {
  element.addEventListener(event, handler);
  eventListeners.push({ element, event, handler });
}

// 清理所有事件监听器
export function cleanup(): void {
  // BUG-002修复: 清理状态检查定时器
  const stateCheckInterval = (window as any).playerStateCheckInterval;
  if (stateCheckInterval !== null && stateCheckInterval !== undefined) {
    clearInterval(stateCheckInterval);
    (window as any).playerStateCheckInterval = null;
  }

  // 移除所有记录的事件监听器
  eventListeners.forEach(({ element, event, handler }) => {
    element.removeEventListener(event, handler);
  });
  eventListeners = [];

  // 清理音频播放器
  if (audioPlayer) {
    audioPlayer.pause();
    audioPlayer.src = '';
  }
}

// 老王修复：初始化播放器，确保获取到HTML中的audio元素并绑定事件
function initAudioPlayer(): void {
  const audioElement = document.getElementById('audioPlayer') as HTMLAudioElement;
  if (!audioElement) {
    audioPlayer = new Audio();
    audioPlayer.id = 'audioPlayer';
    document.body.appendChild(audioPlayer);
  } else {
    audioPlayer = audioElement;
  }

  // 老王修复：在audioPlayer初始化后绑定事件监听器
  const playHandler = () => {
    isPlaying = true;
    ui.updatePlayButton(true);
    document.getElementById('currentCover')?.classList.add('playing');
  };
  addManagedEventListener(audioPlayer as any, 'play', playHandler);

  const pauseHandler = () => {
    isPlaying = false;
    ui.updatePlayButton(false);
    document.getElementById('currentCover')?.classList.remove('playing');
  };
  addManagedEventListener(audioPlayer as any, 'pause', pauseHandler);

  // 修复: 添加 playing 事件监听，确保状态同步
  const playingHandler = () => {
    isPlaying = true;
    ui.updatePlayButton(true);
    document.getElementById('currentCover')?.classList.add('playing');
  };
  addManagedEventListener(audioPlayer as any, 'playing', playingHandler);

  // 修复: 添加 waiting 事件监听，显示缓冲状态
  const waitingHandler = () => {};
  addManagedEventListener(audioPlayer as any, 'waiting', waitingHandler);

  // 修复: 添加 canplay 事件监听
  const canplayHandler = () => {};
  addManagedEventListener(audioPlayer as any, 'canplay', canplayHandler);

  const endedHandler = () => {
    // 记录播放统计
    recordPlayStats();

    // BUG-002修复: 确保状态同步
    isPlaying = false;
    ui.updatePlayButton(false);

    // 修复息屏自动下一曲：使用setTimeout确保在后台也能执行
    setTimeout(() => {
      if (playMode === 'single') {
        playSong(currentIndex, currentPlaylist, lastActiveContainer);
      } else {
        nextSong();
      }
    }, 100); // 延迟100ms确保在后台也能触发
  };
  addManagedEventListener(audioPlayer as any, 'ended', endedHandler);

  // BUG-001修复: 添加定期状态验证，防止死循环
  let stateCheckInterval: number | null = null;
  let stateCheckRetryCount = 0;
  const MAX_STATE_CHECK_RETRIES = 5;

  const startStateCheck = () => {
    if (stateCheckInterval !== null) return; // 防止重复启动

    stateCheckInterval = window.setInterval(() => {
      // 检查isPlaying变量与实际播放状态是否一致
      const actuallyPlaying =
        !audioPlayer.paused && !audioPlayer.ended && audioPlayer.currentTime > 0;

      if (isPlaying !== actuallyPlaying) {
        // BUG-001修复: 检查重试次数限制
        if (stateCheckRetryCount >= MAX_STATE_CHECK_RETRIES) {
          isPlaying = false;
          ui.updatePlayButton(false);
          document.getElementById('currentCover')?.classList.remove('playing');
          ui.showNotification('播放器状态异常，请刷新页面', 'error');
          stateCheckRetryCount = 0;
          return;
        }

        stateCheckRetryCount++;

        // 修正状态
        isPlaying = actuallyPlaying;
        ui.updatePlayButton(actuallyPlaying);

        if (actuallyPlaying) {
          document.getElementById('currentCover')?.classList.add('playing');
        } else {
          document.getElementById('currentCover')?.classList.remove('playing');
        }
      } else {
        // 状态一致时重置重试计数
        stateCheckRetryCount = 0;
      }
    }, 2000); // 每2秒检查一次
  };

  // 启动状态检查
  startStateCheck();

  // BUG-002修复: 在cleanup中清理状态检查定时器
  (window as any).playerStateCheckInterval = stateCheckInterval;

  const timeupdateHandler = () => {
    if (!audioPlayer.duration) return;

    const currentTime = audioPlayer.currentTime;
    const duration = audioPlayer.duration;

    // 老王修复：ui模块只导出updateProgress函数，同时更新进度条和时间
    ui.updateProgress(currentTime, duration);

    // 老王修复：更新歌词高亮，使用ui模块的方法
    if (currentLyrics.length > 0) {
      ui.updateLyrics(currentLyrics, currentTime);
    }
  };
  addManagedEventListener(audioPlayer as any, 'timeupdate', timeupdateHandler);

  const errorHandler = async () => {
    consecutiveFailures++;

    // 优化: 连续失败2次后先尝试切换API源
    if (consecutiveFailures >= 2 && consecutiveFailures < 4) {
      const switched = await api.switchToNextAPI();
      if (switched) {
        ui.showNotification(`已自动切换到 ${api.getCurrentSourceName()}`, 'warning');
        consecutiveFailures = 0;
        setTimeout(() => playSong(currentIndex, currentPlaylist, lastActiveContainer), 1000);
        return;
      }
    }

    // 如果切换源失败或失败次数过多，尝试下一首
    if (consecutiveFailures < 5) {
      ui.showNotification(`播放失败，尝试下一首... (${consecutiveFailures}/5)`, 'error');
      setTimeout(() => nextSong(), 1000);
    } else {
      ui.showNotification('连续播放失败，已暂停。请检查网络连接或更换歌单', 'error');
      consecutiveFailures = 0;
      isPlaying = false;
      ui.updatePlayButton(false);
    }
  };
  addManagedEventListener(audioPlayer as any, 'error', errorHandler as EventListener);
}

// --- Playlist & Favorites State ---
let playlistStorage = new Map<string, any>();
let playlistCounter: number = 0;

// --- Play History State ---
let playHistorySongs: Song[] = []; // 播放历史歌曲列表

// --- Core Player Functions ---

export function getCurrentSong(): Song | null {
  return currentPlaylist[currentIndex] || null;
}

export async function playSong(
  index: number,
  playlist: Song[],
  containerId: string,
  fromHistory: boolean = false
): Promise<void> {
  if (!playlist || index < 0 || index >= playlist.length) return;

  currentPlaylist = playlist;
  currentIndex = index;
  lastActiveContainer = containerId;
  const song = currentPlaylist[index];

  // 防御性检查：确保歌曲对象有效
  if (!song || typeof song !== 'object' || !song.id) {
    ui.showNotification('歌曲数据异常，尝试下一首...', 'warning');
    // 尝试播放下一首
    if (index + 1 < playlist.length) {
      setTimeout(() => playSong(index + 1, playlist, containerId, fromHistory), 500);
    }
    return;
  }

  if (song.source === 'kuwo') {
    ui.showNotification('正在播放酷我音乐...', 'info');
  }

  if (!fromHistory) {
    if (historyPosition < playHistory.length - 1) {
      playHistory = playHistory.slice(0, historyPosition + 1);
    }
    playHistory.push(index);
    historyPosition = playHistory.length - 1;
  }

  // 立即重置歌词状态，避免显示上一首歌的歌词
  ui.resetLyrics();
  currentLyrics = [];

  const coverUrl = await api.getAlbumCoverUrl(song);
  ui.updateCurrentSongInfo(song, coverUrl);
  ui.updateActiveItem(currentIndex, containerId);

  // 修复播放焦点问题：滚动到当前播放的歌曲
  setTimeout(() => {
    const songElements = document.querySelectorAll(`#${containerId} .song-item`);
    if (songElements[currentIndex]) {
      songElements[currentIndex].scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      });
    }
  }, 100); // 延迟100ms确保DOM更新完成

  updatePlayerFavoriteButton();

  try {
    ui.showNotification('正在加载音乐...', 'info');

    // 修改：从新的音质切换按钮获取当前音质
    const preferredQuality = getCurrentQuality();

    // 确保首选品质在队列首位
    const qualityQueue = [
      preferredQuality,
      ...QUALITY_FALLBACK.filter((q) => q !== preferredQuality),
    ];

    let urlData: { url: string; br: string; error?: string; usedSource?: string } | null = null;
    let successQuality = '';
    let lastError = '';

    // 依次尝试各个品质
    for (let i = 0; i < qualityQueue.length; i++) {
      const quality = qualityQueue[i];

      // P0-2 优化: 检查 PlaybackAnalytics 是否建议跳过该歌曲的此音源
      if (playbackAnalytics.shouldSkip(song.id, song.source, quality)) {
        continue; // 跳过当前品质，尝试下一个
      }

      try {
        // 策略：如果是重试（之前失败过）或者尝试第二种音质，则强制刷新缓存
        // 防止因为缓存了 403/404 的死链导致重试无效
        const shouldForceRefresh = consecutiveFailures > 0 || i > 0;

        // 先尝试原始音乐源
        const result = await api.getSongUrl(song, quality, shouldForceRefresh);

        // 如果原始源失败,尝试下一个品质
        if (result && result.url) {
          urlData = result;
          successQuality = quality;
          break;
        } else if (result && result.error) {
          lastError = result.error;
        }
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        // Record failure for this specific quality attempt
        playbackAnalytics.recordFailure(song.id, song.source, lastError, quality);
        continue;
      }
    }

    if (urlData && urlData.url) {
      // 播放成功,重置连续失败计数
      consecutiveFailures = 0;

      // 提示音乐源切换信息 (自动解灰成功)
      if (urlData.usedSource) {
        const sourceName = SOURCE_NAMES[urlData.usedSource] || urlData.usedSource;
        ui.showNotification(`已自动切换到 ${sourceName} 源播放`, 'success');
      }

      // 提示品质降级信息
      if (successQuality !== preferredQuality) {
        ui.showNotification(
          `原品质不可用，已自动切换到 ${QUALITY_NAMES[successQuality] || successQuality}`,
          'warning'
        );
      }

      // 启用歌词下载按钮（在歌词区域内）
      const lyricsDownloadBtn = document.getElementById('lyricsDownloadBtn') as HTMLButtonElement;
      if (lyricsDownloadBtn) {
        lyricsDownloadBtn.disabled = false;
      }

      // BUG-P0-1修复: FLAC音质且URL可信任时，跳过代理，直接连接
      // 避免Vercel 10秒超时限制
      let finalUrl: string;
      if (shouldBypassProxy(urlData.url, successQuality)) {
        finalUrl = urlData.url.replace(/^http:/, 'https:'); // Ensure HTTPS even for direct
      } else {
        finalUrl = getProxiedUrl(urlData.url, song.source);
      }

      // 修复歌词同步：先加载歌词，再设置音频源并播放
      const lyricsData = await api.getLyrics(song);
      const lyrics = lyricsData.lyric ? await lyricsWorkerManager.parseLyric(lyricsData.lyric) : [];
      currentLyrics = lyrics;
      ui.updateLyrics(lyrics, 0);

      audioPlayer.src = finalUrl;
      audioPlayer.load();

      // 添加到播放历史
      addToPlayHistory(song);
      playbackAnalytics.recordSuccess();

      // 触发播放事件（用于 Wake Lock 和 Media Session）
      window.dispatchEvent(
        new CustomEvent('songPlaying', {
          detail: { song, coverUrl },
        })
      );

      // 设置 Media Session API，支持息屏控制和自动下一曲
      if ('mediaSession' in navigator) {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: song.name,
          artist: Array.isArray(song.artist) ? song.artist.join(', ') : song.artist,
          album: song.album || '',
          artwork: coverUrl
            ? [
                { src: coverUrl, sizes: '96x96', type: 'image/jpeg' },
                { src: coverUrl, sizes: '128x128', type: 'image/jpeg' },
                { src: coverUrl, sizes: '192x192', type: 'image/jpeg' },
                { src: coverUrl, sizes: '256x256', type: 'image/jpeg' },
                { src: coverUrl, sizes: '384x384', type: 'image/jpeg' },
                { src: coverUrl, sizes: '512x512', type: 'image/jpeg' },
              ]
            : [],
        });

        // 设置播放控制处理器
        navigator.mediaSession.setActionHandler('play', () => {
          audioPlayer.play();
        });

        navigator.mediaSession.setActionHandler('pause', () => {
          audioPlayer.pause();
        });

        navigator.mediaSession.setActionHandler('previoustrack', () => {
          previousSong();
        });

        navigator.mediaSession.setActionHandler('nexttrack', () => {
          nextSong();
        });

        // 设置播放状态
        navigator.mediaSession.playbackState = 'playing';
      }

      try {
        const playPromise = audioPlayer.play();

        // 修复: 确保 play() Promise 被正确处理
        if (playPromise !== undefined) {
          await playPromise;
          // 记录播放开始时间
          playStartTime = Date.now();
          lastRecordedSong = song;
          // 修复: 显式更新状态
          isPlaying = true;
          ui.updatePlayButton(true);
        }
      } catch {
        ui.showNotification('播放失败，请点击页面以允许自动播放', 'warning');
        // 修复: 确保状态正确更新
        isPlaying = false;
        ui.updatePlayButton(false);
        document.getElementById('currentCover')?.classList.remove('playing');
      }
    } else {
      // 播放失败,增加连续失败计数
      consecutiveFailures++;

      // 构建详细错误信息
      let errorMsg = `无法获取音乐链接 (${song.name})`;
      if (lastError.includes('版权') || lastError.includes('copyright')) {
        errorMsg += ' - 版权保护';
      } else if (lastError.includes('空URL')) {
        errorMsg += ' - 音乐源无此资源';
      } else if (lastError.includes('timeout') || lastError.includes('超时')) {
        errorMsg += ' - 网络超时';
      }

      // 优化: 连续失败2次后先尝试切换API源
      if (consecutiveFailures === 2) {
        const switched = await api.switchToNextAPI();
        if (switched) {
          ui.showNotification(
            `${errorMsg}，已切换到 ${api.getCurrentSourceName()}，重试中...`,
            'warning'
          );
          // 重置失败计数，用新源重试当前歌曲
          consecutiveFailures = 0;
          setTimeout(() => playSong(currentIndex, currentPlaylist, lastActiveContainer), 1000);
          return;
        }
      }

      // 检查是否达到连续失败阈值
      if (consecutiveFailures >= PLAYER_CONFIG.MAX_CONSECUTIVE_FAILURES) {
        ui.showNotification(
          `连续失败${consecutiveFailures}首，已暂停播放。建议检查网络或更换歌单`,
          'error'
        );
        consecutiveFailures = 0; // 重置计数
        isPlaying = false;
        ui.updatePlayButton(false);
        return; // 停止自动播放
      }

      ui.showNotification(
        `${errorMsg}，将尝试下一首 (${consecutiveFailures}/${PLAYER_CONFIG.MAX_CONSECUTIVE_FAILURES})`,
        'error'
      );
      setTimeout(() => nextSong(), PLAYER_CONFIG.RETRY_DELAY);
    }
  } catch (error) {
    // This catch block handles general errors in playSong, not specific song/quality fetch failures.
    // Individual quality failures are now recorded inside the loop.
    // Do not record failure here, as it's not a specific song/quality failure.
    consecutiveFailures++;

    // 优化: 连续失败2次后先尝试切换API源
    if (consecutiveFailures === 2) {
      const switched = await api.switchToNextAPI();
      if (switched) {
        ui.showNotification(
          `播放异常，已切换到 ${api.getCurrentSourceName()}，重试中...`,
          'warning'
        );
        // 重置失败计数，用新源重试当前歌曲
        consecutiveFailures = 0;
        setTimeout(() => playSong(currentIndex, currentPlaylist, lastActiveContainer), 1000);
        return;
      }
    }

    if (consecutiveFailures >= PLAYER_CONFIG.MAX_CONSECUTIVE_FAILURES) {
      ui.showNotification(
        `连续失败${consecutiveFailures}首，已暂停播放。建议检查网络或更换歌单`,
        'error'
      );
      consecutiveFailures = 0;
      isPlaying = false;
      ui.updatePlayButton(false);
      return;
    }

    ui.showNotification(
      `播放失败，将尝试下一首 (${consecutiveFailures}/${PLAYER_CONFIG.MAX_CONSECUTIVE_FAILURES})`,
      'error'
    );
    setTimeout(() => nextSong(), PLAYER_CONFIG.RETRY_DELAY);
  }
}

export function nextSong(): void {
  if (currentPlaylist.length === 0) return;

  let newIndex: number;
  if (playMode === 'random') {
    newIndex = Math.floor(Math.random() * currentPlaylist.length);
  } else {
    newIndex = (currentIndex + 1) % currentPlaylist.length;
  }

  // 检查是否应该尝试切换音乐源而不是直接播放下一首
  if (consecutiveFailures >= PLAYER_CONFIG.SOURCE_SWITCH_THRESHOLD) {
    // 尝试找到同一首歌的其他源
    const currentSong = currentPlaylist[currentIndex];
    const alternativeSources = getAlternativeSources(currentSong);

    if (alternativeSources.length > 0) {
      // 优先尝试同一首歌的不同源
      const alternativeSong = alternativeSources[0];
      const tempPlaylist = [alternativeSong];
      // 减少失败计数，但不完全重置，避免无限循环
      consecutiveFailures = Math.max(0, consecutiveFailures - 1);
      playSong(0, tempPlaylist, lastActiveContainer);
      return;
    } else {
      // 没有找到替代源，减少失败计数并继续下一首
      consecutiveFailures = Math.max(0, consecutiveFailures - 1);
    }
  }

  playSong(newIndex, currentPlaylist, lastActiveContainer);
}

export function previousSong(): void {
  if (playHistory.length > 1 && historyPosition > 0) {
    historyPosition--;
    playSong(playHistory[historyPosition], currentPlaylist, lastActiveContainer, true);
  } else {
    if (currentPlaylist.length === 0) return;
    const newIndex = (currentIndex - 1 + currentPlaylist.length) % currentPlaylist.length;
    playSong(newIndex, currentPlaylist, lastActiveContainer);
  }
}

export function togglePlay(): void {
  if (!audioPlayer.src) return;

  // 修复: 基于 audio 元素的实际状态而非变量
  if (!audioPlayer.paused) {
    // 暂停时记录播放统计
    recordPlayStats();
    audioPlayer.pause();
    isPlaying = false;
    ui.updatePlayButton(false);
    window.dispatchEvent(new Event('songPaused'));

    // 更新 Media Session 状态
    if ('mediaSession' in navigator) {
      navigator.mediaSession.playbackState = 'paused';
    }
  } else {
    const playPromise = audioPlayer.play();
    if (playPromise !== undefined) {
      playPromise
        .then(() => {
          // 恢复播放时重置开始时间
          playStartTime = Date.now();
          isPlaying = true;
          ui.updatePlayButton(true);
          window.dispatchEvent(new Event('songPlaying'));

          // 更新 Media Session 状态
          if ('mediaSession' in navigator) {
            navigator.mediaSession.playbackState = 'playing';
          }
        })
        .catch(() => {
          isPlaying = false;
          ui.updatePlayButton(false);
          ui.showNotification('播放失败，请检查音频文件', 'error');
        });
    }
  }
}

export function setVolume(value: string): void {
  audioPlayer.volume = parseInt(value, 10) / 100;
}

export function seekTo(event: MouseEvent): void {
  if (!audioPlayer.duration) return;
  const progressBar = event.currentTarget as HTMLElement;
  const clickPosition =
    (event.clientX - progressBar.getBoundingClientRect().left) / progressBar.offsetWidth;
  audioPlayer.currentTime = clickPosition * audioPlayer.duration;
}

// 音质切换功能
export function toggleQuality(): void {
  currentQualityIndex = (currentQualityIndex + 1) % QUALITY_OPTIONS.length;
  const quality = QUALITY_OPTIONS[currentQualityIndex];

  // 更新按钮文本
  const qualityText = document.getElementById('qualityText');
  if (qualityText) {
    qualityText.textContent = QUALITY_LABELS[quality];
  }

  ui.showNotification(`音质已切换到 ${QUALITY_LABELS[quality]}`, 'success');

  // 修复BUG-P2-02: 如果正在播放，询问是否立即应用新音质
  if (currentIndex >= 0 && currentPlaylist.length > 0 && !audioPlayer.paused) {
    setTimeout(() => {
      const shouldReload = confirm(
        `音质已切换到 ${QUALITY_LABELS[quality]}\n\n是否立即应用到当前播放的歌曲？\n（点击"取消"将在下一首歌曲生效）`
      );
      if (shouldReload) {
        const currentTime = audioPlayer.currentTime;
        playSong(currentIndex, currentPlaylist, lastActiveContainer).then(() => {
          // 恢复播放进度
          audioPlayer.currentTime = currentTime;
        });
      }
    }, 500);
  }
}

// 获取当前音质
export function getCurrentQuality(): string {
  return QUALITY_OPTIONS[currentQualityIndex];
}

export function togglePlayMode(): void {
  const modes: ('loop' | 'random' | 'single')[] = ['loop', 'random', 'single'];
  const modeIcons = { loop: 'fas fa-repeat', random: 'fas fa-random', single: 'fas fa-redo' };
  const modeTitles = { loop: '列表循环', random: '随机播放', single: '单曲循环' };

  const currentModeIndex = modes.indexOf(playMode);
  playMode = modes[(currentModeIndex + 1) % modes.length];

  const btn = document.getElementById('playModeBtn')!;
  btn.querySelector('i')!.className = modeIcons[playMode];
  btn.title = modeTitles[playMode];
  ui.showNotification(`切换到${modeTitles[playMode]}`, 'info');
}

export function downloadSongByData(song: Song | null): void {
  if (!song) return;

  // 使用下载进度管理器
  startDownloadWithProgress(song, async () => {
    const urlData = await api.getSongUrl(song, '999');
    if (urlData && urlData.url) {
      const res = await fetch(urlData.url);
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = generateSongFileName(song);
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(a.href);
    } else {
      throw new Error('无法获取下载链接');
    }
  });
}

export function downloadLyricByData(song: Song | null): void {
  if (!song) return;
  ui.showNotification(`开始下载歌词: ${song.name}`, 'info');
  api
    .getLyrics(song)
    .then((lyricData) => {
      if (lyricData && lyricData.lyric) {
        const blob = new Blob([lyricData.lyric], { type: 'text/plain;charset=utf-8' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = generateSongFileName(song, '.lrc');
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(a.href);
        ui.showNotification(`歌词下载完成: ${song.name}`, 'success');
      } else {
        ui.showNotification(`该歌曲暂无歌词: ${song.name}`, 'warning');
      }
    })
    .catch(() => {
      ui.showNotification(`歌词下载失败: ${song.name}`, 'error');
    });
}

export async function loadSavedPlaylists(): Promise<void> {
  try {
    // BUG-004修复: 使用安全的localStorage读取歌单数据（保持兼容）
    const data = safeGetItem(STORAGE_CONFIG.KEY_PLAYLISTS, { playlists: [], counter: 0 });
    playlistStorage = new Map(data.playlists || []);
    playlistCounter = data.counter || 0;

    initializeFavoritesPlaylist();

    // 新增: 从IndexedDB加载播放历史
    playHistorySongs = await indexedDB.getHistory(PLAYER_CONFIG.MAX_HISTORY_SIZE);

    // 新增: 从IndexedDB加载收藏列表
    await loadFavoritesFromIndexedDB();
  } catch {
    // 降级：使用空数据
    playlistStorage = new Map();
    playlistCounter = 0;
    playHistorySongs = [];
    initializeFavoritesPlaylist();
  }
}

// 从IndexedDB加载收藏列表到localStorage（保持兼容）
async function loadFavoritesFromIndexedDB(): Promise<void> {
  try {
    const favorites = await indexedDB.getFavorites();
    const key = getFavoritesPlaylistKey();
    if (key && favorites.length > 0) {
      const favPlaylist = playlistStorage.get(key);
      if (favPlaylist) {
        favPlaylist.songs = favorites;
        savePlaylistsToStorage();
      }
    }
  } catch {
    // 静默处理错误
  }
}

// 添加歌曲到播放历史（使用IndexedDB）
async function addToPlayHistory(song: Song): Promise<void> {
  // 标准化艺术家信息为 string[]，防止存储对象导致显示 [object Object]
  const normalizedSong = {
    ...song,
    artist: Array.isArray(song.artist)
      ? song.artist.map((a: any) => (typeof a === 'string' ? a : a?.name || '未知歌手'))
      : typeof song.artist === 'string'
        ? [song.artist]
        : ['未知歌手'],
  };

  // 先从IndexedDB删除重复项
  await indexedDB.removeFromHistory(normalizedSong.id, normalizedSong.source);

  // 添加到IndexedDB
  const saved = await indexedDB.addToHistory(normalizedSong);

  if (saved) {
    // 更新内存中的播放历史
    playHistorySongs = playHistorySongs.filter(
      (s) => !(s.id === normalizedSong.id && s.source === normalizedSong.source)
    );
    playHistorySongs.unshift(normalizedSong);

    // 限制内存中的历史记录数量
    if (playHistorySongs.length > PLAYER_CONFIG.MAX_HISTORY_SIZE) {
      playHistorySongs = playHistorySongs.slice(0, PLAYER_CONFIG.MAX_HISTORY_SIZE);
    }
  }
}

// BUG-005修复: 导出播放历史备份函数
function _exportPlayHistoryBackup(): void {
  try {
    const data = JSON.stringify(playHistorySongs, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    a.download = `music888-play-history-${timestamp}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    ui.showNotification('播放历史备份已导出', 'success');
  } catch {
    ui.showNotification('导出备份失败', 'error');
  }
}

// BUG-005修复: 导出收藏列表备份函数（异步版本）
export async function exportFavoritesBackup(): Promise<void> {
  try {
    const favorites = await indexedDB.getFavorites();
    const data = JSON.stringify(favorites, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    a.download = `music888-favorites-${timestamp}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    ui.showNotification('收藏列表备份已导出', 'success');
  } catch {
    ui.showNotification('导出备份失败', 'error');
  }
}

// 获取播放历史
export function getPlayHistory(): Song[] {
  return playHistorySongs;
}

// 清空播放历史（使用IndexedDB）
export async function clearPlayHistory(): Promise<void> {
  playHistorySongs = [];
  await indexedDB.clearHistory();
  ui.showNotification('播放历史已清空', 'success');
}

// 获取收藏歌曲列表（从IndexedDB）
export async function getFavoriteSongs(): Promise<Song[]> {
  return await indexedDB.getFavorites();
}

// 同步版本，用于兼容旧代码
export function getFavoriteSongsSync(): Song[] {
  const key = getFavoritesPlaylistKey();
  if (!key) return [];
  const favorites = playlistStorage.get(key);
  return favorites?.songs || [];
}

// 清空收藏列表（使用IndexedDB）
export async function clearFavorites(): Promise<void> {
  await indexedDB.clearFavorites();

  // 同时清空localStorage中的收藏（保持兼容）
  const key = getFavoritesPlaylistKey();
  if (key) {
    const favorites = playlistStorage.get(key);
    if (favorites) {
      favorites.songs = [];
      savePlaylistsToStorage();
    }
  }

  ui.showNotification('收藏列表已清空', 'success');
}

function initializeFavoritesPlaylist(): void {
  if (!getFavoritesPlaylistKey()) {
    playlistCounter++;
    const newKey = `playlist_${playlistCounter}`;
    playlistStorage.set(newKey, {
      name: '我的喜欢',
      songs: [],
      id: 'favorites',
      createTime: new Date().toISOString(),
      isFavorites: true,
    });
    savePlaylistsToStorage();
  }
}

function getFavoritesPlaylistKey(): string | null {
  for (const [key, playlist] of playlistStorage.entries()) {
    if (playlist.isFavorites) return key;
  }
  return null;
}

// 检查歌曲是否在收藏中（异步版本）
export async function isSongInFavorites(song: Song): Promise<boolean> {
  return await indexedDB.isInFavorites(song.id, song.source);
}

// 同步版本，用于兼容旧代码
export function isSongInFavoritesSync(song: Song): boolean {
  const key = getFavoritesPlaylistKey();
  if (!key) return false;
  const favorites = playlistStorage.get(key);
  return favorites.songs.some(
    (favSong: Song) => favSong.id === song.id && favSong.source === song.source
  );
}

// 切换收藏状态（使用IndexedDB）
export async function toggleFavoriteButton(song: Song): Promise<void> {
  // 标准化艺术家信息为 string[]，防止存储对象导致显示 [object Object]
  const normalizedSong = {
    ...song,
    artist: Array.isArray(song.artist)
      ? song.artist.map((a: any) => (typeof a === 'string' ? a : a?.name || '未知歌手'))
      : typeof song.artist === 'string'
        ? [song.artist]
        : ['未知歌手'],
  };

  // 检查是否已在收藏中
  const isInFavorites = await indexedDB.isInFavorites(normalizedSong.id, normalizedSong.source);

  if (isInFavorites) {
    // 从IndexedDB移除
    await indexedDB.removeFromFavorites(normalizedSong.id, normalizedSong.source);
    ui.showNotification(`已从"我的喜欢"中移除`, 'success');
  } else {
    // 添加到IndexedDB
    await indexedDB.addToFavorites(normalizedSong);
    ui.showNotification(`已添加到"我的喜欢"`, 'success');
  }

  // 同时更新localStorage中的收藏（保持兼容）
  const key = getFavoritesPlaylistKey();
  if (key) {
    const favorites = playlistStorage.get(key);
    const songIndex = favorites.songs.findIndex(
      (favSong: Song) =>
        favSong.id === normalizedSong.id && favSong.source === normalizedSong.source
    );
    if (isInFavorites && songIndex > -1) {
      favorites.songs.splice(songIndex, 1);
    } else if (!isInFavorites) {
      favorites.songs.unshift(normalizedSong);
    }
    savePlaylistsToStorage();
  }

  await updatePlayerFavoriteButton();

  // 触发全局事件,通知main.ts更新显示
  window.dispatchEvent(new CustomEvent('favoritesUpdated'));
}

// 更新播放器收藏按钮状态（异步版本）- 已删除播放器收藏按钮
async function updatePlayerFavoriteButton(): Promise<void> {
  // 按钮已从UI中移除，保留函数以避免其他代码出错
  return;
}

// 获取同一首歌的其他音乐源版本
function getAlternativeSources(originalSong: Song): Song[] {
  const alternativeSources: Song[] = [];

  // 排除当前源和已知的坏源（kuwo源暂不支持）
  const sourcesToTry = (AVAILABLE_SOURCES as readonly string[]).filter(
    (source) => source !== originalSong.source
  ) as string[];

  for (const source of sourcesToTry) {
    // 在实际应用中，这里应该调用相应的API搜索相同的歌曲
    // 由于我们没有跨源搜索功能，这里只是示例框架
    // 可以考虑在用户同意时用相似的歌曲名和艺术家搜索

    // 创建一个替代歌曲对象（实际使用时需要通过API搜索获取）
    const alternativeSong: Song = {
      ...originalSong,
      source: source,
    };

    alternativeSources.push(alternativeSong);
  }

  return alternativeSources;
}

// BUG-004修复: 保存歌单到本地存储（使用安全函数）
function savePlaylistsToStorage(): void {
  const playlistsData = {
    playlists: Array.from(playlistStorage.entries()),
    counter: playlistCounter,
  };

  const saved = safeSetItem(STORAGE_CONFIG.KEY_PLAYLISTS, playlistsData, {
    onQuotaExceeded: () => {
      ui.showNotification('存储空间不足，歌单保存失败', 'error');

      // 通知用户导出备份
      const shouldExport = confirm('存储空间不足！\n\n' + '是否导出收藏列表备份？');

      if (shouldExport) {
        exportFavoritesBackup();
      }

      // 触发全局事件
      if (typeof window !== 'undefined' && window.dispatchEvent) {
        window.dispatchEvent(
          new CustomEvent('storageQuotaExceeded', {
            detail: { type: 'playlists' },
          })
        );
      }
    },
    maxRetries: 2,
  });

  if (!saved) {
    // 静默处理
  }
}

// 老王修复：移除重复的事件监听器，已在initAudioPlayer()中绑定

// 导出 LyricLine 接口供其他模块使用
export type { LyricLine } from './types.js';

function _parseLyrics(lrc: string): LyricLine[] {
  try {
    if (!lrc || !lrc.trim()) {
      return [{ time: 0, text: '暂无歌词' }];
    }

    const lines = lrc.split('\n');
    const result: LyricLine[] = [];

    // 支持多种歌词时间格式:
    // [mm:ss.xx] [mm:ss.xxx] [hh:mm:ss.xx] [mm:ss]
    const timeRegex = /\[(?:(\d{1,2}):)?(\d{1,2}):(\d{2})(?:\.(\d{2,3}))?\]/g;

    for (const line of lines) {
      try {
        let match;
        const matches: { time: number; text: string }[] = [];

        // 一行可能有多个时间标签
        while ((match = timeRegex.exec(line)) !== null) {
          const hours = match[1] ? parseInt(match[1]) : 0;
          const minutes = parseInt(match[2]);
          const seconds = parseInt(match[3]);
          const milliseconds = match[4] ? parseInt(match[4].padEnd(3, '0')) : 0;

          const time = hours * 3600 + minutes * 60 + seconds + milliseconds / 1000;
          matches.push({ time, text: '' });
        }

        // 提取歌词文本
        const text = line.replace(timeRegex, '').trim();

        // 为每个时间标签添加相同的歌词文本
        if (text && matches.length > 0) {
          matches.forEach((m) => {
            result.push({ time: m.time, text });
          });
        }
      } catch {
        continue;
      }
    }

    // 按时间排序
    result.sort((a, b) => a.time - b.time);

    // 如果解析后没有有效歌词，返回默认
    if (result.length === 0) {
      return [{ time: 0, text: '纯音乐，请欣赏' }];
    }

    return result;
  } catch {
    return [{ time: 0, text: '歌词加载失败' }];
  }
}

// ========== 播放列表管理增强 ==========

// 获取当前播放列表
export function getCurrentPlaylist(): Song[] {
  return currentPlaylist;
}

// 获取当前播放索引
export function getCurrentIndex(): number {
  return currentIndex;
}

// 从播放列表播放指定索引的歌曲
export function playSongFromPlaylist(index: number): void {
  if (index >= 0 && index < currentPlaylist.length) {
    playSong(index, currentPlaylist, lastActiveContainer);
  }
}

// 从播放列表移除歌曲
export function removeFromPlaylist(index: number): void {
  if (index < 0 || index >= currentPlaylist.length) return;

  currentPlaylist.splice(index, 1);

  // 调整当前播放索引
  if (currentIndex > index) {
    currentIndex--;
  } else if (currentIndex === index) {
    // 如果删除的是当前播放的歌曲
    if (currentIndex >= currentPlaylist.length) {
      currentIndex = currentPlaylist.length - 1;
    }
    // 可以选择自动播放下一首或停止
    if (currentPlaylist.length > 0 && currentIndex >= 0) {
      playSong(currentIndex, currentPlaylist, lastActiveContainer);
    } else {
      // 播放列表为空，停止播放
      audioPlayer.pause();
    }
  }

  ui.showNotification('已从播放列表移除', 'info');
}

// 清空播放列表
export function clearPlaylist(): void {
  currentPlaylist = [];
  currentIndex = -1;
  audioPlayer.pause();
  audioPlayer.src = '';
  ui.showNotification('播放列表已清空', 'info');
}

// 添加歌曲到当前播放列表
export function addToCurrentPlaylist(songs: Song[]): void {
  currentPlaylist.push(...songs);
  ui.showNotification(`已添加 ${songs.length} 首歌曲到播放列表`, 'success');
}

// 保存当前播放列表为歌单
export function saveCurrentPlaylistAs(playlistName: string): void {
  if (currentPlaylist.length === 0) {
    ui.showNotification('播放列表为空', 'warning');
    return;
  }

  const savedPlaylists = JSON.parse(localStorage.getItem('savedPlaylists') || '[]');
  const newPlaylist = {
    name: playlistName,
    songs: currentPlaylist,
    createdAt: Date.now(),
  };

  savedPlaylists.push(newPlaylist);
  localStorage.setItem('savedPlaylists', JSON.stringify(savedPlaylists));

  ui.showNotification(`歌单"${playlistName}"保存成功`, 'success');

  // 触发歌单更新事件
  window.dispatchEvent(new Event('playlistsUpdated'));
}

// ========== 批量操作功能 ==========

// 批量添加到收藏
export function addMultipleToFavorites(songs: Song[]): void {
  const key = getFavoritesPlaylistKey();
  if (!key) {
    ui.showNotification('收藏列表初始化失败', 'error');
    return;
  }

  const favorites = playlistStorage.get(key);
  let addedCount = 0;

  songs.forEach((song) => {
    // 标准化艺术家信息
    const normalizedSong = {
      ...song,
      artist: Array.isArray(song.artist)
        ? song.artist.map((a: any) => (typeof a === 'string' ? a : a?.name || '未知歌手'))
        : typeof song.artist === 'string'
          ? [song.artist]
          : ['未知歌手'],
    };

    const exists = favorites.songs.some(
      (fav: Song) => fav.id === normalizedSong.id && fav.source === normalizedSong.source
    );
    if (!exists) {
      favorites.songs.push(normalizedSong);
      addedCount++;
    }
  });

  if (addedCount > 0) {
    savePlaylistsToStorage();
    ui.showNotification(`成功添加 ${addedCount} 首歌曲到收藏`, 'success');
    window.dispatchEvent(new Event('favoritesUpdated'));
  } else {
    ui.showNotification('所选歌曲已在收藏中', 'info');
  }
}

// 批量下载歌曲
export async function downloadMultipleSongs(songs: Song[]): Promise<void> {
  // 限制批量下载数量，防止浏览器崩溃
  const MAX_BATCH_DOWNLOAD = 50;
  if (songs.length > MAX_BATCH_DOWNLOAD) {
    const confirmed = confirm(
      `批量下载最多支持${MAX_BATCH_DOWNLOAD}首歌曲，当前选择了${songs.length}首。是否只下载前${MAX_BATCH_DOWNLOAD}首？`
    );
    if (!confirmed) {
      ui.showNotification('已取消批量下载', 'info');
      return;
    }
    songs = songs.slice(0, MAX_BATCH_DOWNLOAD);
  }

  // 二次确认，避免误操作
  if (songs.length > 10) {
    const confirmed = confirm(`确定要下载 ${songs.length} 首歌曲吗？这可能需要较长时间。`);
    if (!confirmed) {
      ui.showNotification('已取消批量下载', 'info');
      return;
    }
  }

  const quality = getCurrentQuality();

  ui.showNotification(`开始下载 ${songs.length} 首歌曲...`, 'info');

  for (let i = 0; i < songs.length; i += DOWNLOAD_CONFIG.BATCH_SIZE) {
    const batch = songs.slice(i, i + DOWNLOAD_CONFIG.BATCH_SIZE);

    await Promise.all(
      batch.map(async (song) => {
        try {
          const urlData = await api.getSongUrl(song, quality);
          if (urlData && urlData.url) {
            const response = await fetch(urlData.url);
            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = generateSongFileName(song);
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            window.URL.revokeObjectURL(url);
          }
        } catch {
          // 忽略单个歌曲下载失败
        }
      })
    );

    // 显示进度
    const downloaded = Math.min(i + DOWNLOAD_CONFIG.BATCH_SIZE, songs.length);
    ui.showNotification(`下载进度: ${downloaded}/${songs.length}`, 'info');

    // 批次间延迟，避免请求过快
    if (i + DOWNLOAD_CONFIG.BATCH_SIZE < songs.length) {
      await new Promise((resolve) => setTimeout(resolve, DOWNLOAD_CONFIG.BATCH_DELAY));
    }
  }

  ui.showNotification('所有歌曲下载完成', 'success');
}

// 记录播放统计
function recordPlayStats(): void {
  if (!lastRecordedSong || playStartTime === 0) return;

  const playDuration = (Date.now() - playStartTime) / 1000; // 转换为秒

  // 只记录播放超过3秒的歌曲
  if (playDuration >= 3) {
    recordPlay(lastRecordedSong, playDuration);
  }

  // 重置
  playStartTime = 0;
}

// 初始化时保存歌单到本地存储并初始化audio播放器
// 老王修复：导出init函数供main.ts调用
export function init(): void {
  initAudioPlayer();
  loadSavedPlaylists();
  // 初始化歌词 Worker
  lyricsWorkerManager.init();

  // 执行数据迁移（从localStorage到IndexedDB）
  migrateDataToIndexedDB();
}

// 添加数据迁移函数
async function migrateDataToIndexedDB(): Promise<void> {
  try {
    const result = await indexedDB.migratePlayDataFromLocalStorage();

    if (result.historyMigrated > 0 || result.favoritesMigrated > 0) {
      ui.showNotification(
        `数据已迁移: ${result.historyMigrated}条历史, ${result.favoritesMigrated}首收藏`,
        'success'
      );
      await loadSavedPlaylists();
    }
  } catch {
    // 静默处理迁移错误
  }
}

// 老王修复：移除自动调用，避免重复初始化
// 现在由main.ts中的initializeApp()统一调用player.init()
