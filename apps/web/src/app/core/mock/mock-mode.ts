const KEY = 'qorgan.mock';

/**
 * Демо-режим без бэкенда: `?mock=1` включает, `?mock=0` выключает, выбор запоминается.
 * Нужен для разработки UI без настроенного GitHub App и для публичного демо.
 */
export function isMockMode(search = globalThis.location?.search ?? ''): boolean {
  const flag = new URLSearchParams(search).get('mock');
  try {
    if (flag === '1') localStorage.setItem(KEY, '1');
    if (flag === '0') localStorage.removeItem(KEY);
    return localStorage.getItem(KEY) === '1';
  } catch {
    return flag === '1';
  }
}
