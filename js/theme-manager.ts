/**
 * 主题管理器
 * 支持亮色、暗色和自动主题切换
 */

export type Theme = 'light' | 'dark' | 'auto';
type ThemeChangeCallback = (theme: Theme) => void;

export class ThemeManager {
  private currentTheme: Theme;
  private readonly STORAGE_KEY = 'app-theme';
  private mediaQuery: MediaQueryList;
  private listeners: Map<string, ThemeChangeCallback[]> = new Map();

  constructor() {
    // 检测系统主题偏好
    this.mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

    // 从localStorage加载保存的主题，默认为dark
    this.currentTheme = this.loadTheme();

    // 应用主题
    this.applyTheme(this.currentTheme);

    // 监听系统主题变化
    this.mediaQuery.addEventListener('change', this.handleSystemThemeChange.bind(this));

  }

  /**
   * 从localStorage加载主题设置
   */
  private loadTheme(): Theme {
    try {
      const saved = localStorage.getItem(this.STORAGE_KEY);
      if (saved && ['light', 'dark', 'auto'].includes(saved)) {
        return saved as Theme;
      }
    } catch (error) {
      console.error('加载主题设置失败:', error);
    }
    return 'dark'; // 默认暗色主题
  }

  /**
   * 保存主题设置到localStorage
   */
  private saveTheme(theme: Theme): void {
    try {
      localStorage.setItem(this.STORAGE_KEY, theme);
    } catch (error) {
      console.error('保存主题设置失败:', error);
    }
  }

  /**
   * 应用主题
   */
  private applyTheme(theme: Theme): void {
    const effectiveTheme = this.getEffectiveTheme(theme);

    // 设置data-theme属性
    document.documentElement.setAttribute('data-theme', effectiveTheme);

    // 更新meta theme-color
    this.updateMetaThemeColor(effectiveTheme);

  }

  /**
   * 获取有效主题（处理auto模式）
   */
  private getEffectiveTheme(theme: Theme): 'light' | 'dark' {
    if (theme === 'auto') {
      return this.mediaQuery.matches ? 'dark' : 'light';
    }
    return theme;
  }

  /**
   * 更新meta theme-color标签
   */
  private updateMetaThemeColor(theme: 'light' | 'dark'): void {
    const metaThemeColor = document.querySelector('meta[name="theme-color"]');
    if (metaThemeColor) {
      metaThemeColor.setAttribute('content', theme === 'dark' ? '#0c0c0c' : '#f5f5f5');
    }
  }

  /**
   * 处理系统主题变化
   */
  private handleSystemThemeChange(): void {
    if (this.currentTheme === 'auto') {
      this.applyTheme('auto');
      this.emit('themeChanged', this.currentTheme);
    }
  }

  /**
   * 切换主题
   */
  public toggleTheme(): void {
    // 循环切换: dark -> light -> dark (简化版，不包含auto)
    const nextTheme: Theme = this.currentTheme === 'dark' ? 'light' : 'dark';
    this.setTheme(nextTheme);
  }

  /**
   * 设置指定主题
   */
  public setTheme(theme: Theme): void {
    if (!['light', 'dark', 'auto'].includes(theme)) {
      console.error('无效的主题:', theme);
      return;
    }

    this.currentTheme = theme;
    this.saveTheme(theme);
    this.applyTheme(theme);

    // 触发主题变化事件
    this.emit('themeChanged', theme);

    // 显示提示
    const themeNames = {
      light: '亮色模式',
      dark: '暗色模式',
      auto: '自动模式',
    };

  }

  /**
   * 获取当前主题
   */
  public getCurrentTheme(): Theme {
    return this.currentTheme;
  }

  /**
   * 获取有效的当前主题（解析auto）
   */
  public getEffectiveCurrentTheme(): 'light' | 'dark' {
    return this.getEffectiveTheme(this.currentTheme);
  }

  /**
   * 监听主题变化事件
   */
  public on(event: string, callback: ThemeChangeCallback): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event)!.push(callback);
  }

  /**
   * 移除事件监听器
   */
  public off(event: string, callback: ThemeChangeCallback): void {
    const callbacks = this.listeners.get(event);
    if (callbacks) {
      const index = callbacks.indexOf(callback);
      if (index > -1) {
        callbacks.splice(index, 1);
      }
    }
  }

  /**
   * 触发事件
   */
  private emit(event: string, theme: Theme): void {
    const callbacks = this.listeners.get(event);
    if (callbacks) {
      callbacks.forEach((callback) => callback(theme));
    }
  }

  /**
   * 销毁主题管理器
   */
  public destroy(): void {
    this.mediaQuery.removeEventListener('change', this.handleSystemThemeChange.bind(this));
    this.listeners.clear();
  }
}
