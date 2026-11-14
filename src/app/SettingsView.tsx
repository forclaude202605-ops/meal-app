// 設定の画面: プロフィール、週の開始、平均の分母、バックアップ、保存の永続化、全データ消去、デモを消す、出典、ホーム画面への追加の案内。
import { useEffect, useState } from 'preact/hooks';
import { todayLocal } from '../core/dates.ts';
import { DEMO_PREFIX } from '../data/demo.ts';
import type { Profile, Settings } from '../core/types.ts';
import { parseBackup, summarize, type BackupFile, type DataSummary } from '../data/backup.ts';
import type { Snapshot } from '../db/db.ts';
import { fmtDateTime } from './format.ts';
import { exportBackup, persistState, requestPersist, toast, type PersistState } from './pwa.ts';
import { useAppState, useStore } from './store.ts';
import { Button, Field, Segmented, Sheet } from './ui.tsx';

export const ATTRIBUTION =
  '食品の成分値は、文部科学省「日本食品標準成分表（八訂）増補2023年」および同「脂肪酸成分表編」から引用しています。本アプリの成分値は、同データを加工(記号の数値化、食品名の整形、容量換算の抽出など)して作成したもので、文部科学省が内容を保証するものではありません。';

function SummaryList(props: { s: DataSummary }) {
  const s = props.s;
  return (
    <dl class="kv">
      <dt>献立</dt>
      <dd>{s.mealDays} 日</dd>
      <dt>食材費</dt>
      <dd>{s.purchaseDays} 日</dd>
      <dt>テキスト</dt>
      <dd>{s.lines} 行(献立と食材費の合計。空行を除く)</dd>
      <dt>日付の範囲</dt>
      <dd>{s.firstDate ? `${s.firstDate} 〜 ${s.lastDate}` : 'なし'}</dd>
      <dt>補足(答え)</dt>
      <dd>{s.answers} 件</dd>
      <dt>食材</dt>
      <dd>{s.ingredients} 件</dd>
    </dl>
  );
}

export function SettingsView(props: { isStandalone: boolean }) {
  const store = useStore();
  const { data, meta, saveError } = useAppState();
  const settings = data.settings;
  const [persist, setPersist] = useState<PersistState | null>(null);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [importing, setImporting] = useState<{ backup: BackupFile; migratedFrom: number | null; dropped: { days: number; prices: number } | null } | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [clearing, setClearing] = useState(false);
  const [busy, setBusy] = useState(false);

  const reloadSnapshots = () => void store.db.listSnapshots().then(setSnapshots);
  useEffect(() => {
    void persistState().then(setPersist);
    reloadSnapshots();
  }, []);

  const setS = (patch: Partial<Settings>) => store.setSettings({ ...settings, ...patch });
  const profile = settings.profile;
  const setProfile = (patch: Partial<Profile>) => {
    // 選んだ項目だけを書き換える(ほかの項目に既定値を入れない)
    const p: Profile = { ...profile, ...patch };
    setS({ profile: p });
  };

  const doExport = async () => {
    const r = await exportBackup(store);
    if (r === 'cancelled') return;
    store.setMeta({ lastBackupAt: new Date().toISOString() });
    toast(r === 'shared' ? 'バックアップを共有シートに渡しました' : 'バックアップをダウンロードしました');
  };

  const current = summarize(data);

  return (
    <div>
      <div class="topbar" style={{ paddingTop: 'calc(env(safe-area-inset-top) + 12px)', paddingBottom: '12px' }}>
        <h1 style={{ fontSize: '1.1rem' }}>設定</h1>
      </div>
      {saveError ? <div class="banner bad">保存に失敗しました: {saveError}</div> : null}

      <section class="card">
        <h2>プロフィール</h2>
        <p class="small muted">食事摂取基準との比較に使います。この端末の中にだけ保存します。</p>
        <Field label="性別">
          <select class="input" value={profile?.sex ?? ''} onChange={(e) => setProfile({ sex: e.currentTarget.value as Profile['sex'] })}>
            <option value="" disabled>
              選んでください
            </option>
            <option value="male">男性</option>
            <option value="female">女性</option>
          </select>
        </Field>
        <Field label="年齢">
          <input
            class="input"
            type="text"
            inputMode="numeric"
            value={profile?.age ? String(profile.age) : ''}
            onChange={(e) => {
              const v = Number(e.currentTarget.value.normalize('NFKC'));
              if (Number.isInteger(v) && v > 0 && v < 130) setProfile({ age: v });
            }}
          />
        </Field>
        <Field label="身体活動レベル(既定)">
          <select class="input" value={String(profile?.activity ?? '')} onChange={(e) => setProfile({ activity: Number(e.currentTarget.value) as Profile['activity'] })}>
            <option value="" disabled>
              選んでください
            </option>
            <option value="1">Ⅰ(低い)</option>
            <option value="2">Ⅱ(ふつう)</option>
            <option value="3">Ⅲ(高い)</option>
          </select>
        </Field>
      </section>

      <section class="card">
        <h2>集計</h2>
        <Field label="週の開始">
          <Segmented
            label="週の開始"
            value={String(settings.weekStartsOn) as '0' | '1'}
            onChange={(v) => setS({ weekStartsOn: Number(v) as 0 | 1 })}
            options={[
              { value: '1', label: '月曜' },
              { value: '0', label: '日曜' },
            ]}
          />
        </Field>
        <Field label="平均の分母(既定)">
          <Segmented
            label="平均の分母"
            value={settings.averageMode}
            onChange={(v) => setS({ averageMode: v })}
            options={[
              { value: 'recordedDays', label: '記録のある日' },
              { value: 'calendarDays', label: '暦日数' },
            ]}
          />
        </Field>
      </section>

      <section class="card">
        <h2>バックアップ</h2>
        <p class="small">
          最後のバックアップ: <b>{meta.lastBackupAt ? fmtDateTime(meta.lastBackupAt) : 'まだありません'}</b>
        </p>
        <Field label="リマインドまでの日数">
          <input
            class="input"
            type="text"
            inputMode="numeric"
            value={String(settings.backupReminderDays)}
            onChange={(e) => {
              const v = Number(e.currentTarget.value.normalize('NFKC'));
              if (Number.isInteger(v) && v >= 1 && v <= 365) setS({ backupReminderDays: v });
            }}
          />
        </Field>
        <SummaryList s={current} />
        <div class="row-flex wrap" style={{ marginTop: '8px' }}>
          <Button kind="primary" onClick={() => void doExport()}>
            書き出す
          </Button>
          <label class="btn" style={{ display: 'inline-flex', alignItems: 'center' }}>
            読み込む
            <input
              type="file"
              accept="application/json,.json"
              class="sr-only"
              onChange={async (e) => {
                const f = e.currentTarget.files?.[0];
                e.currentTarget.value = '';
                if (!f) return;
                const r = parseBackup(await f.text());
                if (r.ok) {
                  setImportError(null);
                  setImporting({ backup: r.backup, migratedFrom: r.migratedFrom, dropped: r.dropped });
                } else setImportError(r.error);
              }}
            />
          </label>
        </div>
        <p class="small muted">「書き出す」で共有シートが開きます。「ファイルに保存」から iCloud Drive などに保存してください。</p>
        {importError ? <div class="banner bad">読み込めません: {importError}</div> : null}
        <h3 style={{ marginTop: '12px' }}>自動退避(直近3世代)</h3>
        <p class="small muted">読み込み・全データ消去・デモを消す前に、その時点の状態をこの端末に自動で残します。</p>
        <ul class="list">
          {snapshots.map((s) => (
            <li class="row-flex small">
              <span class="grow">
                {fmtDateTime(s.createdAt)} ・ {s.reason} ・ 献立 {s.summary.mealDays ?? 0}日分
              </span>
              <Button
                kind="ghost"
                class="small"
                onClick={async () => {
                  if (!confirm(`${fmtDateTime(s.createdAt)} の状態に戻します(今の状態も自動で退避します)。よろしいですか?`)) return;
                  await store.replaceAll(s.data, '退避から戻す前');
                  reloadSnapshots();
                  toast('退避した状態に戻しました');
                }}
              >
                この状態に戻す
              </Button>
            </li>
          ))}
          {snapshots.length === 0 ? <li class="small muted">まだありません</li> : null}
        </ul>
      </section>

      <section class="card">
        <h2>保存の永続化</h2>
        <p>
          状態:{' '}
          <b>{persist === 'persisted' ? '有効(ストレージの都合で消されにくい)' : persist === 'not-persisted' ? '無効' : persist === 'unsupported' ? 'この環境では使えません' : '確認中'}</b>
        </p>
        <p class="small muted">ホーム画面に追加したアプリで起動すると、有効になりやすくなります(Safari の判断による)。</p>
        <Button onClick={async () => setPersist(await requestPersist())}>永続化を要求する</Button>
      </section>

      <section class="card">
        <h2>ホーム画面に追加する</h2>
        {props.isStandalone ? <p class="small">いまはホーム画面のアプリとして開いています。</p> : <div class="banner info">いまは Safari のタブで開いています。データを入れる前に、ホーム画面に追加してください。</div>}
        <ol class="small">
          <li>iPhone の Safari で、このアプリのページを開く。</li>
          <li>画面下の共有ボタン(四角から上向きの矢印)を押す。</li>
          <li>「ホーム画面に追加」を選ぶ(見当たらなければ、一覧を下へスクロール)。</li>
          <li>「Webアプリとして開く」がある場合はオンのまま、「追加」を押す。</li>
          <li>ホーム画面にできたアイコンから開いて使う。</li>
        </ol>
        <p class="small muted">Safari のタブで入れたデータと、ホーム画面のアプリのデータは別々に保存されます。タブで入れたデータはアプリからは見えません。</p>
      </section>

      <section class="card">
        <h2>デモと全データ消去</h2>
        <p class="small muted">デモは 2025年1月の架空のテキストです(記録の画面の「デモを貼り付ける」)。動作を確かめたら「デモを消す」で消して、実データを貼ってください。</p>
        <div class="row-flex wrap">
          <Button
            disabled={busy || !(meta.demo || data.ingredients.some((i) => i.id.startsWith(DEMO_PREFIX)))}
            onClick={async () => {
              if (!confirm('デモ用の食材と、デモのテキストと同じ内容の日を消します(今の状態は自動で退避します)。よろしいですか?')) return;
              setBusy(true);
              const r = await store.removeDemo(todayLocal());
              reloadSnapshots();
              setBusy(false);
              toast(`デモを消しました(食材 ${r.ingredients} 件、テキスト ${r.texts} 日分)`);
            }}
          >
            デモを消す
          </Button>
          <Button kind="danger" disabled={busy} onClick={() => setClearing(true)}>
            全データ消去
          </Button>
        </div>
      </section>

      <section class="card">
        <h2>出典</h2>
        <p class="small">{ATTRIBUTION}</p>
        <dl class="kv small">
          <dt>成分表の版</dt>
          <dd>{store.foods.versionInfo.id}</dd>
          {store.foods.versionInfo.files.map((f) => (
            <>
              <dt>{f.role === 'main' ? '本表' : '脂肪酸'}</dt>
              <dd style={{ wordBreak: 'break-all' }}>
                {f.name}({f.date})
                <br />
                <span class="muted">SHA-256 {f.sha256}</span>
              </dd>
            </>
          ))}
          <dt>取得日</dt>
          <dd>{store.foods.versionInfo.retrieved}</dd>
        </dl>
        <p class="small muted">出典 URL: {store.foods.sourceUrl}</p>
      </section>

      {importing ? (
        <ImportSheet
          backup={importing.backup}
          migratedFrom={importing.migratedFrom}
          dropped={importing.dropped}
          currentFoodDb={store.foods.versionInfo.id}
          onClose={() => setImporting(null)}
          onDone={() => {
            setImporting(null);
            reloadSnapshots();
          }}
        />
      ) : null}
      {clearing ? (
        <ClearSheet
          lastBackupAt={meta.lastBackupAt}
          onExport={doExport}
          onClose={() => setClearing(false)}
          onCleared={() => {
            setClearing(false);
            reloadSnapshots();
            toast('全データを消去しました');
          }}
        />
      ) : null}
    </div>
  );
}

function ImportSheet(props: { backup: BackupFile; migratedFrom: number | null; dropped: { days: number; prices: number } | null; currentFoodDb: string; onClose: () => void; onDone: () => void }) {
  const store = useStore();
  const [mode, setMode] = useState<'replace' | 'merge'>('merge');
  const [busy, setBusy] = useState(false);
  const b = props.backup;
  const s = summarize(b);
  return (
    <Sheet
      title="バックアップを読み込む"
      onClose={props.onClose}
      footer={
        <Button
          kind="primary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            const incoming = { ingredients: b.ingredients, texts: b.texts, answers: b.answers, settings: b.settings };
            if (mode === 'replace') await store.replaceAll(incoming, 'バックアップの読み込み(全部置き換え)の前', { demo: false });
            else await store.mergeByDate(incoming, 'バックアップの読み込み(日付ごとにマージ)の前');
            toast('読み込みました');
            props.onDone();
          }}
        >
          {mode === 'replace' ? '全部置き換える' : '日付ごとにマージする'}
        </Button>
      }
    >
      <p class="small">書き出した日時: {b.exportedAt ? fmtDateTime(b.exportedAt) : '不明'}</p>
      <SummaryList s={s} />
      {props.migratedFrom !== null ? (
        <div class="banner warn">
          古い形式(schema {props.migratedFrom})のファイルです。食材マスタと設定だけを読み込みます
          {props.dropped ? `(旧形式の日 ${props.dropped.days} 日分・価格 ${props.dropped.prices} 件は読み込みません。旧形式の時期のデータはデモだけでした)` : ''}。
        </div>
      ) : null}
      {b.foodDbVersion.id && b.foodDbVersion.id !== props.currentFoodDb ? (
        <div class="banner warn">このファイルは、別の版の成分表({b.foodDbVersion.id})で作られました。いまの版({props.currentFoodDb})で計算し直します。</div>
      ) : null}
      <Segmented
        label="読み込み方"
        value={mode}
        onChange={setMode}
        options={[
          { value: 'merge', label: '日付ごとにマージ' },
          { value: 'replace', label: '全部置き換え' },
        ]}
      />
      <p class="small muted">
        {mode === 'merge'
          ? 'ファイルにある日(献立・食材費のそれぞれ)は、ファイルのテキストと補足で置き換えます。ファイルにない日は今のまま残します。食材は同じものを上書きし、新しいものを足します。設定は今のままです。'
          : '今のデータをすべて、ファイルの内容に置き換えます。'}
        読み込む前に、今の状態を自動で退避します(直近3世代)。
      </p>
    </Sheet>
  );
}

function ClearSheet(props: { lastBackupAt: string | undefined; onExport: () => Promise<void>; onClose: () => void; onCleared: () => void }) {
  const store = useStore();
  const [ok, setOk] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <Sheet
      title="全データ消去"
      onClose={props.onClose}
      footer={
        <Button
          kind="danger"
          disabled={!ok || busy}
          onClick={async () => {
            setBusy(true);
            await store.clearAll();
            props.onCleared();
          }}
        >
          消去する
        </Button>
      }
    >
      <p>日ごとのテキスト(献立・食材費)・補足・食材をすべて消します(調味料などの初期値は入れ直します。設定は残します)。</p>
      <p class="small">
        最後のバックアップ: <b>{props.lastBackupAt ? fmtDateTime(props.lastBackupAt) : 'まだありません'}</b>
      </p>
      <Button onClick={() => void props.onExport()}>先にバックアップを書き出す</Button>
      <label class="row-flex" style={{ marginTop: '12px' }}>
        <input type="checkbox" checked={ok} onChange={(e) => setOk(e.currentTarget.checked)} style={{ width: '24px', height: '24px' }} />
        <span>バックアップを書き出した(または不要である)ことを確認した</span>
      </label>
      <p class="small muted">消去の前の状態は、この端末の「自動退避」にも残ります(直近3世代)。</p>
    </Sheet>
  );
}
