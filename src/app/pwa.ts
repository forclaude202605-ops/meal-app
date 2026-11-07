// PWA まわり: Service Worker の登録と更新、ホーム画面で起動しているかの判定、保存の永続化、バックアップの書き出し。
import { todayLocal } from '../core/dates.ts';
import { backupFileName, buildBackup } from '../data/backup.ts';
import type { Store } from './store.ts';

export function isStandalone(): boolean {
  return window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

/**
 * Service Worker を登録する。新しい版が待機状態になったら onUpdate を呼ぶ(画面に「更新」を出す)。
 * 「更新」を押したときだけ切り替える(勝手に再読み込みしない)。IndexedDB は消えない。
 */
export function registerServiceWorker(onUpdate: (apply: () => void) => void): void {
  if (!('serviceWorker' in navigator) || !import.meta.env.PROD) return;
  // 「更新」を押したときだけ再読み込みする(初回のインストールでは再読み込みしない)
  let applying = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!applying) return;
    applying = false;
    location.reload();
  });
  void navigator.serviceWorker.register('./sw.js').then((reg) => {
    const notify = (w: ServiceWorker | null) => {
      if (w && navigator.serviceWorker.controller)
        onUpdate(() => {
          applying = true;
          w.postMessage('skipWaiting');
        });
    };
    if (reg.waiting) notify(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      w?.addEventListener('statechange', () => {
        if (w.state === 'installed') notify(w);
      });
    });
    // アプリに戻ってきたときに、新しい版があるか確かめる
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') void reg.update().catch(() => undefined);
    });
  });
}

export type PersistState = 'persisted' | 'not-persisted' | 'unsupported';

export async function persistState(): Promise<PersistState> {
  if (!navigator.storage?.persisted) return 'unsupported';
  return (await navigator.storage.persisted()) ? 'persisted' : 'not-persisted';
}

export async function requestPersist(): Promise<PersistState> {
  if (!navigator.storage?.persist) return 'unsupported';
  return (await navigator.storage.persist()) ? 'persisted' : 'not-persisted';
}

/**
 * 全データを1つの JSON にして、共有シート(iCloud Drive や「ファイル」に保存できる)に渡す。
 * 共有シートが使えなければダウンロードする。キャンセルされたら 'cancelled'。
 */
export async function exportBackup(store: Store): Promise<'shared' | 'downloaded' | 'cancelled'> {
  const b = buildBackup(store.get().data, store.foods.versionInfo, new Date());
  const name = backupFileName(todayLocal());
  const file = new File([JSON.stringify(b)], name, { type: 'application/json' });
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (nav.canShare?.({ files: [file] }) && navigator.share) {
    try {
      await navigator.share({ files: [file], title: name });
      return 'shared';
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return 'cancelled';
    }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return 'downloaded';
}

export function toast(message: string): void {
  window.dispatchEvent(new CustomEvent('app-toast', { detail: message }));
}
