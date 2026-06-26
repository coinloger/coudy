/**
 * Hook-engine — WordPress-style actions та filters.
 * Ізоморфний модуль: працює однаково в Node.js та browser.
 */

// Типи для callbacks
type ActionCallback = (...args: unknown[]) => void | Promise<void>;
type FilterCallback<T = unknown> = (value: T, ...args: unknown[]) => T | Promise<T>;

// Елемент у реєстрі хуків
interface HookEntry {
  callback: ActionCallback | FilterCallback;
  priority: number;
  id: string; // Унікальний ID для видалення
}

// Реєстр хуків
type HooksRegistry = Record<string, HookEntry[]>;

/**
 * Головний клас для управління хуками.
 * Екземпляр створюється для кожного контексту (backend/frontend).
 */
export class HookEngine {
  private hooks: HooksRegistry = {};
  private nextId = 0;

  /**
   * Підписатись на action (побічний ефект).
   * @param name - Назва хука
   * @param callback - Функція-обробник
   * @param priority - Пріоритет (менше = раніше, дефолт 10)
   * @returns ID для відписки
   */
  addAction(name: string, callback: ActionCallback, priority: number = 10): string {
    return this.add(name, callback, priority);
  }

  /**
   * Виконати всі callbacks для action.
   * @param name - Назва хука
   * @param args - Аргументи, що передаються в callback
   */
  async doAction(name: string, ...args: unknown[]): Promise<void> {
    const entries = this.getSortedEntries(name);
    for (const entry of entries) {
      await (entry.callback as ActionCallback)(...args);
    }
  }

  /**
   * Підписатись на filter (трансформація значення).
   * @param name - Назва хука
   * @param callback - Функція, що повертає нове значення
   * @param priority - Пріоритет (менше = раніше, дефолт 10)
   * @returns ID для відписки
   */
  addFilter<T = unknown>(name: string, callback: FilterCallback<T>, priority: number = 10): string {
    return this.add(name, callback as unknown as ActionCallback, priority);
  }

  /**
   * Пропустити значення через ланцюжок filter callbacks.
   * @param name - Назва хука
   * @param value - Значення для трансформації
   * @param args - Додаткові аргументи для callback
   * @returns Трансформоване значення
   */
  async applyFilters<T = unknown>(name: string, value: T, ...args: unknown[]): Promise<T> {
    const entries = this.getSortedEntries(name);
    let result: T = value;
    for (const entry of entries) {
      result = await (entry.callback as FilterCallback<T>)(result, ...args);
    }
    return result;
  }

  /**
   * Відписатись від action або filter.
   * @param name - Назва хука
   * @param id - ID, повернутий addAction/addFilter
   */
  removeAction(name: string, id: string): void {
    this.remove(name, id);
  }

  removeFilter(name: string, id: string): void {
    this.remove(name, id);
  }

  /**
   * Перевірити, чи є підписники на хук.
   */
  has(name: string): boolean {
    return Array.isArray(this.hooks[name]) && this.hooks[name].length > 0;
  }

  /**
   * Отримати кількість підписників на хук.
   */
  count(name: string): number {
    return this.hooks[name]?.length ?? 0;
  }

  /**
   * Очистити всі хуки (для тестів/перезавантаження).
   */
  clear(): void {
    this.hooks = {};
  }

  /**
   * Видалити всі callbacks для конкретного хука.
   */
  removeAll(name: string): void {
    delete this.hooks[name];
  }

  // --- Приватні методи ---

  private add(name: string, callback: ActionCallback | FilterCallback, priority: number): string {
    if (!this.hooks[name]) {
      this.hooks[name] = [];
    }
    const id = `hook_${name}_${this.nextId++}`;
    this.hooks[name].push({ callback, priority, id });
    return id;
  }

  private remove(name: string, id: string): void {
    const entries = this.hooks[name];
    if (!entries) return;
    const index = entries.findIndex(e => e.id === id);
    if (index !== -1) {
      entries.splice(index, 1);
    }
  }

  private getSortedEntries(name: string): HookEntry[] {
    const entries = this.hooks[name] ?? [];
    return [...entries].sort((a, b) => a.priority - b.priority);
  }
}

/**
 * Глобальний екземпляр для простого доступу (опціонально).
 * Більш надійно — створювати власний екземпляр для кожного контексту.
 */
export const hooks = new HookEngine();
