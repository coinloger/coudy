/**
 * Scoped HookEngine: делегує реєстрацію (addAction/addFilter) батьківському
 * (спільному) движку, але запамʼятовує повернуті ID. doAction/applyFilters
 * теж делегуються. removeAll() bulk-прибирає всі реєстрації — корисно для
 * плагінів: при deactivate фільтри (tools:register, ui:sidebar-items тощо)
 * зникають зі спільного движка.
 *
 * Ізоморфний — використовується і на бекенді (server/plugin-loader), і на
 * фронті (web/plugins) для реактивного enable/disable плагінів.
 */
import { HookEngine } from "./hooks";

export class ScopedHookEngine extends HookEngine {
  private readonly parent: HookEngine;
  private registrations: Array<{ name: string; id: string }> = [];

  constructor(parent: HookEngine) {
    super();
    this.parent = parent;
  }

  override addAction(name: string, callback: (...args: unknown[]) => void | Promise<void>, priority = 10): string {
    const id = this.parent.addAction(name, callback, priority);
    this.registrations.push({ name, id });
    return id;
  }

  override addFilter<T = unknown>(name: string, callback: (value: T, ...args: unknown[]) => T | Promise<T>, priority = 10): string {
    const id = this.parent.addFilter<T>(name, callback, priority);
    this.registrations.push({ name, id });
    return id;
  }

  override doAction(name: string, ...args: unknown[]): Promise<void> {
    return this.parent.doAction(name, ...args);
  }

  override applyFilters<T = unknown>(name: string, value: T, ...args: unknown[]): Promise<T> {
    return this.parent.applyFilters<T>(name, value, ...args);
  }

  override has(name: string): boolean {
    return this.parent.has(name);
  }

  override count(name: string): number {
    return this.parent.count(name);
  }

  override removeAction(name: string, id: string): void {
    this.parent.removeAction(name, id);
    this.registrations = this.registrations.filter((r) => r.id !== id);
  }

  override removeFilter(name: string, id: string): void {
    this.parent.removeFilter(name, id);
    this.registrations = this.registrations.filter((r) => r.id !== id);
  }

  /** Bulk-remove всіх реєстрацій цього плагіна (action + filter). */
  removeAll(): void {
    for (const { name, id } of this.registrations) {
      this.parent.removeAction(name, id);
    }
    this.registrations = [];
  }
}
