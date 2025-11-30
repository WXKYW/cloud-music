// js/artist.ts - 歌手模块（纯API动态版）
import * as api from './api.js';
import * as ui from './ui.js';
import * as player from './player.js';

// 状态管理
interface ArtistState {
  currentArea: number; // -1, 7, 96, 8, 16
  currentType: number; // -1, 1, 2, 3
  currentInitial: string; // -1, a-z
  artists: any[];
  isLoading: boolean;
}

const state: ArtistState = {
  currentArea: -1,
  currentType: -1,
  currentInitial: '-1',
  artists: [],
  isLoading: false,
};

export function initArtist(): void {
  renderFilters();
  loadArtists(); // 初始加载

  // 绑定返回按钮
  const backBtn = document.getElementById('artistBackBtn');
  if (backBtn) {
    backBtn.addEventListener('click', closeArtistDetail);
  }
}

function renderFilters(): void {
  const container = document.getElementById('artistFilters');
  if (!container) return;

  const areas = [
    { id: -1, name: '全部', icon: '🌐' },
    { id: 7, name: '华语', icon: '🇨🇳' },
    { id: 96, name: '欧美', icon: '🇺🇸' },
    { id: 8, name: '日本', icon: '🇯🇵' },
    { id: 16, name: '韩国', icon: '🇰🇷' },
    { id: 0, name: '其他', icon: '🌍' },
  ];

  const types = [
    { id: -1, name: '全部', icon: '👥' },
    { id: 1, name: '男歌手', icon: '👨' },
    { id: 2, name: '女歌手', icon: '👩' },
    { id: 3, name: '乐队/组合', icon: '🎸' },
  ];

  const initials = [
    { id: '-1', name: '热门', icon: '🔥' },
    ...Array.from({ length: 26 }, (_, i) => {
      const char = String.fromCharCode(65 + i).toLowerCase();
      return { id: char, name: char.toUpperCase(), icon: '' };
    }),
    { id: '0', name: '#', icon: '' },
  ];

  container.innerHTML = `
    <div class="filter-row">
      <span class="filter-label">语种：</span>
      <div class="filter-options" id="areaOptions">
        ${areas.map((a) => `<span class="filter-tag ${state.currentArea === a.id ? 'active' : ''}" data-type="area" data-val="${a.id}">${a.icon} ${a.name}</span>`).join('')}
      </div>
    </div>
    <div class="filter-row">
      <span class="filter-label">分类：</span>
      <div class="filter-options" id="typeOptions">
        ${types.map((t) => `<span class="filter-tag ${state.currentType === t.id ? 'active' : ''}" data-type="type" data-val="${t.id}">${t.icon} ${t.name}</span>`).join('')}
      </div>
    </div>
    <div class="filter-row">
      <span class="filter-label">筛选：</span>
      <div class="filter-options" id="initialOptions">
        ${initials.map((i) => `<span class="filter-tag ${state.currentInitial === i.id ? 'active' : ''}" data-type="initial" data-val="${i.id}">${i.icon ? i.icon + ' ' : ''}${i.name}</span>`).join('')}
      </div>
    </div>
  `;

  // 绑定事件
  container.querySelectorAll('.filter-tag').forEach((tag) => {
    tag.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      const type = target.dataset.type;
      const val = target.dataset.val;

      if (type === 'area') state.currentArea = parseInt(val || '-1');
      if (type === 'type') state.currentType = parseInt(val || '-1');
      if (type === 'initial') state.currentInitial = val || '-1';

      // 更新 UI
      const parent = target.parentElement;
      parent?.querySelectorAll('.filter-tag').forEach((t) => t.classList.remove('active'));
      target.classList.add('active');

      loadArtists();
    });
  });
}

async function loadArtists(): Promise<void> {
  if (state.isLoading) return;
  state.isLoading = true;

  const grid = document.getElementById('artistGrid');
  if (grid) {
    grid.innerHTML =
      '<div class="loading"><i class="fas fa-spinner fa-spin"></i><div>加载歌手中...</div></div>';
  }

  try {
    let artists = [];

    // 如果筛选条件全是默认，且是初始加载，可以使用 getTopArtists (可能更快)
    if (state.currentArea === -1 && state.currentType === -1 && state.currentInitial === '-1') {
      artists = await api.getTopArtists(100);
    } else {
      const result = await api.getArtistList(
        state.currentType,
        state.currentArea,
        state.currentInitial,
        100
      );
      artists = result.artists;
    }

    state.artists = artists;
    renderArtistList(artists);
  } catch (error) {
    console.error('加载歌手列表失败:', error);
    if (grid)
      grid.innerHTML =
        '<div class="error"><i class="fas fa-exclamation-triangle"></i><div>加载失败，请重试</div></div>';
  } finally {
    state.isLoading = false;
  }
}

// 辅助函数：提取纯粹的艺术家姓名（去除括号及内容）
function extractPureArtistName(name: string): string {
  // 匹配末尾的 (xxx) 或 （xxx）并移除
  return name.replace(/\\s*[（(][^）)]*[）)]\\s*$/, '').trim();
}

function renderArtistList(artists: any[]): void {
  const grid = document.getElementById('artistGrid');
  if (!grid) return;

  if (artists.length === 0) {
    grid.innerHTML = '<div class="empty-state">没有找到相关歌手</div>';
    return;
  }

  grid.innerHTML = artists
    .map(
      (artist) => `
    <div class="artist-card" data-id="${artist.id}" data-name="${artist.name}">
      <div class="artist-img-container">
        <img src="${artist.picUrl}?param=200y200" loading="lazy" class="artist-cover" onerror="this.src='data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAwIiBoZWlnaHQ9IjIwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSIjMzMzIi8+PHRleHQgeD0iNTAlIiB5PSI1MCUiIGR5PSIuM2VtIiBmaWxsPSIjNjY2IiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBmb250LXNpemU9IjI0Ij7imas8L3RleHQ+PC9zdmc+'">
      </div>
      <div class="artist-name">${extractPureArtistName(artist.name)}</div>
    </div>
  `
    )
    .join('');

  // 使用图片懒加载
  // 注意：如果项目中使用了统一的 ImageLazyLoader，这里可能需要手动触发一下
  // 但原有的 img[loading="lazy"] 属性在现代浏览器也够用了

  grid.querySelectorAll('.artist-card').forEach((card) => {
    card.addEventListener('click', () => {
      const id = (card as HTMLElement).dataset.id!;
      const name = (card as HTMLElement).dataset.name!;
      loadArtistDetail(id, name);
    });
  });
}

// 加载歌手详情 (保持原有逻辑，添加 MV 支持)
async function loadArtistDetail(id: string, name: string): Promise<void> {
  // 切换视图
  const listParams = document.getElementById('artistListContainer');
  const detailParams = document.getElementById('artistDetailContainer');
  if (listParams) listParams.style.display = 'none';
  if (detailParams) detailParams.style.display = 'block';

  // 设置基本信息
  const nameEl = document.getElementById('artistDetailName');
  if (nameEl) nameEl.textContent = name;

  // 重置 Tab
  switchArtistTab('songs');

  // 获取数据
  ui.showLoading('artistSongsList');

  try {
    // 并行获取信息
    const [info, desc, albums, mvs] = await Promise.all([
      api.getArtistInfo(id), // 获取热门歌曲
      api.getArtistDesc(id),
      api.getArtistAlbums(id),
      api.getArtistMVs(id),
    ]);

    // 渲染歌曲
    ui.displaySearchResults(info.songs, 'artistSongsList', info.songs);

    // 渲染简介
    const descEl = document.getElementById('artistDescText');
    if (descEl) descEl.innerText = desc || info.description || '暂无简介';

    // 渲染专辑
    renderAlbums(albums);

    // 渲染MV
    renderMVs(mvs);
  } catch (error) {
    console.error('加载歌手详情失败:', error);
    ui.showNotification('获取歌手信息失败', 'error');
  }
}

function renderAlbums(albums: any[]): void {
  const container = document.getElementById('artistAlbumsList');
  if (!container) return;

  if (albums.length === 0) {
    container.innerHTML = '<div class="empty-state">暂无专辑数据</div>';
    return;
  }

  container.innerHTML = `<div class="album-grid">
    ${albums
      .map(
        (album) => `
      <div class="album-card" data-id="${album.id}">
        <img src="${album.picUrl}?param=200y200" loading="lazy" class="album-cover" onerror="this.src='data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAwIiBoZWlnaHQ9IjIwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSIjMzMzIi8+PHRleHQgeD0iNTAlIiB5PSI1MCUiIGR5PSIuM2VtIiBmaWxsPSIjNjY2IiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBmb250LXNpemU9IjI0Ij7kuJPovkdePC90ZXh0Pjwvc3ZnPg=='">
        <div class="album-info">
          <div class="album-name">${album.name}</div>
          <div class="album-date">${new Date(album.publishTime).toLocaleDateString()}</div>
        </div>
      </div>
    `
      )
      .join('')}
  </div>`;

  // 绑定专辑点击
  container.querySelectorAll('.album-card').forEach((card) => {
    card.addEventListener('click', async () => {
      const albumId = (card as HTMLElement).dataset.id!;
      // 加载专辑歌曲并播放
      ui.showNotification('正在加载专辑...', 'info');
      const songs = await api.getAlbumSongs(albumId);
      if (songs.length > 0) {
        player.playSong(0, songs, 'artistAlbumsList'); // 这是一个逻辑容器ID，实际不会在列表中高亮，但能播放
        ui.showNotification(`开始播放专辑`, 'success');
      }
    });
  });
}

function renderMVs(mvs: any[]): void {
  const container = document.getElementById('artistMVsList');
  if (!container) return;

  if (mvs.length === 0) {
    container.innerHTML = '<div class="empty-state">暂无MV数据</div>';
    return;
  }

  container.innerHTML = `<div class="mv-grid">
    ${mvs
      .map(
        (mv) => `
      <div class="mv-card" data-id="${mv.id}">
        <div class="mv-cover-container">
          <img src="${mv.imgurl16v9 || mv.imgurl}?param=320y180" loading="lazy" class="mv-cover">
          <div class="mv-duration">${formatDuration(mv.duration)}</div>
          <div class="mv-play-icon"><i class="fas fa-play"></i></div>
        </div>
        <div class="mv-info">
          <div class="mv-name">${mv.name}</div>
          <div class="mv-play-count"><i class="fas fa-play"></i> ${formatPlayCount(mv.playCount)}</div>
        </div>
      </div>
    `
      )
      .join('')}
  </div>`;

  container.querySelectorAll('.mv-card').forEach((card) => {
    card.addEventListener('click', () => {
      ui.showNotification('视频播放功能开发中', 'info');
    });
  });
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function formatPlayCount(count: number): string {
  if (count > 100000000) return (count / 100000000).toFixed(1) + '亿';
  if (count > 10000) return (count / 10000).toFixed(1) + '万';
  return count.toString();
}

function closeArtistDetail(): void {
  const listParams = document.getElementById('artistListContainer');
  const detailParams = document.getElementById('artistDetailContainer');
  if (listParams) listParams.style.display = 'block';
  if (detailParams) detailParams.style.display = 'none';
}

function switchArtistTab(tab: string): void {
  const contents = document.querySelectorAll('.artist-tab-content');
  contents.forEach((c) => ((c as HTMLElement).style.display = 'none'));

  const target = document.getElementById(`artist${tab.charAt(0).toUpperCase() + tab.slice(1)}Tab`);
  if (target) target.style.display = 'block';

  const btns = document.querySelectorAll('.artist-tab-btn');
  btns.forEach((b) => b.classList.remove('active'));
  document.querySelector(`.artist-tab-btn[data-tab="${tab}"]`)?.classList.add('active');
}

document.querySelectorAll('.artist-tab-btn').forEach((btn) => {
  btn.addEventListener('click', (e) => {
    const tab = (e.target as HTMLElement).dataset.tab!;
    switchArtistTab(tab);
  });
});

export function cleanup(): void {
  // cleanup
}
