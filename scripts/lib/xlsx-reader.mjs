// 依存なしの最小限の xlsx 読み取り(成分表の公式 Excel を読むためのもの)。
// xlsx は ZIP の中の XML なので、ZIP の中央ディレクトリを読み、zlib で展開し、
// workbook / sharedStrings / worksheet の XML から値を取り出す。
// ふりがな(<rPh>)は値に含めない。数式セルはキャッシュされた値を使う。
import { readFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';

/** ZIP を読み、ファイル名 → 中身(Buffer)を返す関数を作る */
function openZip(buf) {
  const EOCD = 0x06054b50;
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('ZIP の終端が見つかりません(xlsx ではない可能性)');
  const count = buf.readUInt16LE(eocd + 10);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  if (cdOffset === 0xffffffff) throw new Error('ZIP64 には対応していません');
  const entries = new Map();
  let p = cdOffset;
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('ZIP の中央ディレクトリが壊れています');
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    entries.set(name, { method, compSize, localOffset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return (name) => {
    const e = entries.get(name);
    if (!e) return null;
    const lp = e.localOffset;
    if (buf.readUInt32LE(lp) !== 0x04034b50) throw new Error(`ZIP のローカルヘッダが壊れています: ${name}`);
    const start = lp + 30 + buf.readUInt16LE(lp + 26) + buf.readUInt16LE(lp + 28);
    const data = buf.subarray(start, start + e.compSize);
    if (e.method === 0) return Buffer.from(data);
    if (e.method === 8) return inflateRawSync(data);
    throw new Error(`未対応の圧縮方式 ${e.method}: ${name}`);
  };
}

function decodeXml(s) {
  return s
    .replace(/&(#x[0-9a-fA-F]+|#[0-9]+|amp|lt|gt|quot|apos);/g, (_, e) => {
      if (e === 'amp') return '&';
      if (e === 'lt') return '<';
      if (e === 'gt') return '>';
      if (e === 'quot') return '"';
      if (e === 'apos') return "'";
      return String.fromCodePoint(e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    })
    .replace(/_x([0-9a-fA-F]{4})_/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

function attrs(tag) {
  const out = {};
  for (const m of tag.matchAll(/([\w:]+)\s*=\s*"([^"]*)"/g)) out[m[1]] = decodeXml(m[2]);
  return out;
}

/** <si> や <is> の中の文字列(ふりがなを除く) */
function richText(xml) {
  const noRuby = xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '').replace(/<phoneticPr\b[^>]*\/>/g, '');
  let s = '';
  for (const m of noRuby.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>|<t(?:\s[^>]*)?\/>/g)) s += m[1] ? decodeXml(m[1]) : '';
  return s;
}

function colIndex(ref) {
  const letters = /^[A-Z]+/.exec(ref)?.[0] ?? '';
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/**
 * xlsx の1シートを、行の配列として返す。各行は「列番号(0始まり)→ セル」の配列(空セルは undefined)。
 * セルは { kind: 'number', value: number } または { kind: 'string', value: string }。
 */
export function readSheet(path, sheetName) {
  const get = openZip(readFileSync(path));
  const text = (name) => {
    const b = get(name);
    return b === null ? null : b.toString('utf8');
  };

  const wb = text('xl/workbook.xml');
  if (wb === null) throw new Error('xl/workbook.xml がありません');
  const sheets = [...wb.matchAll(/<sheet\b[^>]*\/?>/g)].map((m) => attrs(m[0]));
  const sheet = sheets.find((s) => s.name === sheetName);
  if (!sheet) throw new Error(`シート「${sheetName}」がありません(あるのは: ${sheets.map((s) => s.name).join(', ')})`);

  const rels = text('xl/_rels/workbook.xml.rels') ?? '';
  const rel = [...rels.matchAll(/<Relationship\b[^>]*\/?>/g)].map((m) => attrs(m[0])).find((r) => r.Id === sheet['r:id']);
  if (!rel) throw new Error(`シート「${sheetName}」の参照先がありません`);
  const target = rel.Target.startsWith('/') ? rel.Target.slice(1) : `xl/${rel.Target}`;

  const sstXml = text('xl/sharedStrings.xml') ?? '';
  const sst = [...sstXml.matchAll(/<si>([\s\S]*?)<\/si>|<si\/>/g)].map((m) => (m[1] ? richText(m[1]) : ''));

  const sheetXml = text(target);
  if (sheetXml === null) throw new Error(`${target} がありません`);

  const rows = [];
  for (const rm of sheetXml.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const rowNum = Number(attrs(rm[1]).r);
    const cells = [];
    for (const cm of (rm[2] ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const a = attrs(cm[1]);
      const inner = cm[2] ?? '';
      const v = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1];
      let cell;
      if (a.t === 's') cell = v === undefined ? undefined : { kind: 'string', value: sst[Number(v)] ?? '' };
      else if (a.t === 'inlineStr') cell = { kind: 'string', value: richText(/<is>([\s\S]*?)<\/is>/.exec(inner)?.[1] ?? '') };
      else if (a.t === 'str' || a.t === 'e') cell = v === undefined ? undefined : { kind: 'string', value: decodeXml(v) };
      else if (a.t === 'b') cell = v === undefined ? undefined : { kind: 'number', value: Number(v) };
      else cell = v === undefined ? undefined : { kind: 'number', value: Number(v) };
      if (cell !== undefined) cells[colIndex(a.r)] = cell;
    }
    rows.push({ rowNum, cells });
  }
  return rows;
}
