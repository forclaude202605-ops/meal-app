// 共通の部品。指で押せる大きさ(44px 以上)、入力欄の文字は 16px 以上(ズーム防止)。
import type { ComponentChildren, JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { parseQuantity } from '../core/quantity.ts';

export function Sheet(props: { title: string; onClose: () => void; children: ComponentChildren; footer?: ComponentChildren }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') props.onClose();
    };
    document.addEventListener('keydown', onKey);
    document.body.classList.add('sheet-open');
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.classList.remove('sheet-open');
      prev?.focus?.();
    };
  }, []);
  return (
    <div class="sheet-backdrop" onClick={(e) => e.target === e.currentTarget && props.onClose()}>
      <div class="sheet" role="dialog" aria-modal="true" aria-label={props.title} ref={ref}>
        <header class="sheet-head">
          <h2>{props.title}</h2>
          <button type="button" class="btn ghost" onClick={props.onClose} aria-label="閉じる">
            閉じる
          </button>
        </header>
        <div class="sheet-body">{props.children}</div>
        {props.footer ? <footer class="sheet-foot">{props.footer}</footer> : null}
      </div>
    </div>
  );
}

/**
 * 日本語 IME の変換中(composition)は検索を走らせない入力欄。
 * 変換が確定したとき(compositionend)と、変換中でない入力のときだけ onSearch を呼ぶ。
 */
export function SearchInput(props: { value: string; onSearch: (q: string) => void; placeholder?: string; label: string; autofocus?: boolean }) {
  const [text, setText] = useState(props.value);
  const composing = useRef(false);
  useEffect(() => setText(props.value), [props.value]);
  return (
    <input
      type="search"
      class="input"
      aria-label={props.label}
      placeholder={props.placeholder}
      value={text}
      enterKeyHint="search"
      autoComplete="off"
      autoCorrect="off"
      spellcheck={false}
      {...(props.autofocus ? { 'data-autofocus': true } : {})}
      onCompositionStart={() => (composing.current = true)}
      onCompositionEnd={(e) => {
        composing.current = false;
        const v = (e.currentTarget as HTMLInputElement).value;
        setText(v);
        props.onSearch(v);
      }}
      onInput={(e) => {
        const v = (e.currentTarget as HTMLInputElement).value;
        setText(v);
        if (!composing.current && !(e as unknown as InputEvent).isComposing) props.onSearch(v);
      }}
    />
  );
}

/** 数量の入力欄。"0.6" "2/3" のような小数・分数や全角数字も受け付ける。読めないときは赤枠 */
export function QtyInput(props: { value: string; onChange: (text: string, qty: number | null) => void; label: string; autofocus?: boolean; placeholder?: string }) {
  const ok = props.value.trim() === '' || parseQuantity(props.value) !== null;
  return (
    <input
      type="text"
      inputMode="decimal"
      class={`input qty${ok ? '' : ' invalid'}`}
      aria-label={props.label}
      aria-invalid={!ok}
      placeholder={props.placeholder ?? '数量'}
      value={props.value}
      autoComplete="off"
      {...(props.autofocus ? { 'data-autofocus': true } : {})}
      onInput={(e) => {
        const v = (e.currentTarget as HTMLInputElement).value;
        props.onChange(v, parseQuantity(v));
      }}
    />
  );
}

export function Field(props: { label: string; children: ComponentChildren; hint?: string }) {
  return (
    <label class="field">
      <span class="field-label">{props.label}</span>
      {props.children}
      {props.hint ? <span class="field-hint">{props.hint}</span> : null}
    </label>
  );
}

export function Segmented<T extends string>(props: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div class="segmented" role="radiogroup" aria-label={props.label}>
      {props.options.map((o) => (
        <button type="button" role="radio" aria-checked={o.value === props.value} class={o.value === props.value ? 'on' : ''} onClick={() => props.onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Badge(props: { tone: 'warn' | 'bad' | 'info'; children: ComponentChildren; title?: string }) {
  return (
    <span class={`badge ${props.tone}`} title={props.title}>
      {props.children}
    </span>
  );
}

export type ButtonProps = JSX.ButtonHTMLAttributes<HTMLButtonElement> & { kind?: 'primary' | 'ghost' | 'danger' | 'plain' };
export function Button({ kind = 'plain', class: cls, ...rest }: ButtonProps) {
  return <button type="button" class={`btn ${kind} ${cls ?? ''}`} {...rest} />;
}
