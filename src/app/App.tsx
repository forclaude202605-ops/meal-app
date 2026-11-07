// 画面の骨組み: 下部のタブ(記録 / 集計 / 食材 / 設定)、更新の案内、通知。
import { useEffect, useState } from 'preact/hooks';
import { todayLocal } from '../core/dates.ts';
import { IngredientsView } from './IngredientsView.tsx';
import { isStandalone } from './pwa.ts';
import { RecordView } from './RecordView.tsx';
import { SettingsView } from './SettingsView.tsx';
import { SummaryView } from './SummaryView.tsx';
import { Button } from './ui.tsx';

type Tab = 'record' | 'summary' | 'ingredients' | 'settings';

const ICONS: Record<Tab, string> = {
  record: 'M5 4h11l3 3v13H5z M8 10h8 M8 14h8 M8 18h5',
  summary: 'M4 20V10 M10 20V4 M16 20v-7 M21 20H3',
  ingredients: 'M4 12a8 8 0 0 0 16 0z M12 4v5 M8 6l2 3 M16 6l-2 3',
  settings: 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z M19 12l2-1-1-3-2 .5-1.5-1.5.5-2-3-1-1 2h-2l-1-2-3 1 .5 2L6 7.5 4 7 3 10l2 1v2l-2 1 1 3 2-.5 1.5 1.5-.5 2 3 1 1-2h2l1 2 3-1-.5-2 1.5-1.5 2 .5 1-3-2-1z',
};
const LABELS: Record<Tab, string> = { record: '記録', summary: '集計', ingredients: '食材', settings: '設定' };

export function App(props: { registerUpdate: (cb: (apply: () => void) => void) => void }) {
  const [tab, setTab] = useState<Tab>('record');
  const [date, setDate] = useState(todayLocal());
  const [update, setUpdate] = useState<(() => void) | null>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [standalone, setStandalone] = useState(isStandalone());

  useEffect(() => {
    props.registerUpdate((apply) => setUpdate(() => apply));
    const onToast = (e: Event) => {
      setToastMsg((e as CustomEvent<string>).detail);
      window.setTimeout(() => setToastMsg(null), 2500);
    };
    window.addEventListener('app-toast', onToast);
    const mq = window.matchMedia?.('(display-mode: standalone)');
    const onMq = () => setStandalone(isStandalone());
    mq?.addEventListener?.('change', onMq);
    return () => {
      window.removeEventListener('app-toast', onToast);
      mq?.removeEventListener?.('change', onMq);
    };
  }, []);

  return (
    <div class="app">
      <main class="main">
        {update ? (
          <div class="banner info row-flex" role="status">
            <span class="grow">新しい版があります。</span>
            <Button kind="primary" class="small" onClick={() => update()}>
              更新
            </Button>
          </div>
        ) : null}
        {tab === 'record' ? <RecordView date={date} setDate={setDate} goSettings={() => setTab('settings')} isStandalone={standalone} /> : null}
        {tab === 'summary' ? <SummaryView date={date} /> : null}
        {tab === 'ingredients' ? <IngredientsView /> : null}
        {tab === 'settings' ? <SettingsView isStandalone={standalone} /> : null}
      </main>
      <nav class="tabbar" aria-label="画面の切り替え">
        {(Object.keys(LABELS) as Tab[]).map((t) => (
          <button type="button" aria-current={tab === t ? 'page' : undefined} onClick={() => setTab(t)}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d={ICONS[t]} />
            </svg>
            {LABELS[t]}
          </button>
        ))}
      </nav>
      {toastMsg ? (
        <div class="toast" role="status">
          {toastMsg}
        </div>
      ) : null}
    </div>
  );
}
