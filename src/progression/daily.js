/**
 * Promptasy — 今日三事（v1.2 · P23）
 *
 * 每天三個**提議**。這一層最重要的事情是它**不做**什麼：
 *
 *   · 沒有倒數、沒有期限、沒有「還剩幾天」——換日只是換三個提議。
 *   · 沒有連著幾天的紀錄、沒有「斷了」這種狀態。
 *   · 沒做完不會有任何後果：世界不會少一樣東西，進度不會退一格。
 *   · 可以在設定裡關掉；關掉之後這一層一個字都不寫進存檔。
 *
 * 這與 v1.2 的鐵則同源（WORLD §1.6：安撫是把話說完，不是打贏它）——
 * 遊戲不催人。所以這裡連「今天要做的事」都不叫任務，叫**提議**。
 *
 * 換日看的是**玩家自己的今天**：`localDayKey()` 只讀本地時間
 * （`getFullYear` / `getMonth` / `getDate`），不碰 UTC —— 住在 UTC+8 的人
 * 半夜十二點換日，不是早上八點。
 *
 * 這支檔案是**純函式**：不碰 DOM、不讀存檔、不看時鐘（時間由呼叫端傳進來），
 * 所以 `npm run test:rubric` 可以直接餵它一天、一份候選，問它挑了什麼。
 */

/** 一天挑幾件。 */
export const DAILY_COUNT = 3;

/** 三種提議。順序就是「一種先挑一個」的預設順序（每天會依日期輪轉）。 */
export const OFFER_KINDS = Object.freeze(['polish', 'find', 'visit']);

/** 線索有三種（祕境／殘頁／刻文）——與 `rumors.js` 的說法同一組字。 */
export const CLUE_KINDS = Object.freeze(['secret', 'letter', 'ins']);

/**
 * 今天是哪一天（玩家自己的今天）。
 *
 * 只讀本地時間的年月日。**刻意不用 `toISOString()`**：那一支回的是 UTC 的日期，
 * 住在 UTC+8 的人會在早上八點換日 —— 那不是他的今天。
 *
 * @param {{getFullYear:Function, getMonth:Function, getDate:Function}} [date]
 * @returns {string} `YYYY-MM-DD`
 */
export function localDayKey(date = new Date()) {
  const d = date && typeof date.getFullYear === 'function' ? date : new Date();
  const p2 = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
}

/** 這個字串長得像一天嗎（存檔驗形用）。 */
export function isDayKey(v) {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
}

/**
 * 把一個字串變成一個數（FNV-1a 32 位）。
 *
 * 只用來「同一天挑到同一組」——同一天重開遊戲看到的三件事要一樣。
 * 不是亂數、不是安全雜湊，只是一個穩定的數。
 * @param {string} key
 * @returns {number}
 */
export function dayHash(key) {
  let h = 0x811c9dc5;
  const s = String(key || '');
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * 一個提議 id 拆成它的意思。形狀不對回 `null`（壞存檔不該讓圖鑑開不起來）。
 *
 *   `polish:<challengeId>`   重解一關拿 S
 *   `find:<clueKind>:<id>`   找一處還沒找到的線索
 *   `visit:<regionId>`       走一趟某一片土地
 *
 * @param {string} id
 */
export function parseOffer(id) {
  if (typeof id !== 'string' || !id) return null;
  const parts = id.split(':');
  if (parts[0] === 'polish' && parts.length === 2 && parts[1]) {
    return { kind: 'polish', id, challengeId: parts[1] };
  }
  if (parts[0] === 'find' && parts.length === 3 && parts[1] && parts[2] && CLUE_KINDS.includes(parts[1])) {
    return { kind: 'find', id, clueKind: parts[1], clueId: parts[2] };
  }
  if (parts[0] === 'visit' && parts.length === 2 && parts[1]) {
    return { kind: 'visit', id, regionId: parts[1] };
  }
  return null;
}

/**
 * 今天有哪些**做得到**的提議。
 *
 * 兩條硬規則寫在這裡（不是寫在畫面上）：
 *   1. **只從已經開了的土地挑**——提議一件走不到的事等於在騙人。
 *   2. **已經做完的不再提**——重解拿過 S 的、已經找到的線索、今天走過的土地都不會出現。
 *
 * @param {object} opts
 * @param {Array}  [opts.challenges]  全部關卡（要有 `id` 與 `region`）
 * @param {Array}  [opts.regions]     全部土地 id
 * @param {object} [opts.clues]       `{ secret: [], letter: [], ins: [] }`，每筆要有 `id` 與 `region`
 * @param {(regionId:string)=>boolean} [opts.isPlayable] 這片土地開了嗎
 * @param {(challengeId:string)=>(string|null)} [opts.bestGrade] 這一關最好的評價
 * @param {(kind:string, id:string)=>boolean} [opts.found] 這條線索找到了嗎
 * @param {string[]} [opts.visited]   今天已經走過的土地
 * @returns {{polish:string[], find:string[], visit:string[]}}
 */
export function buildPool({
  challenges = [],
  regions = [],
  clues = {},
  isPlayable = () => false,
  bestGrade = () => null,
  found = () => false,
  visited = [],
} = {}) {
  const polish = [];
  for (const c of challenges) {
    if (!c || typeof c.id !== 'string') continue;
    if (!isPlayable(c.region)) continue;
    const g = bestGrade(c.id);
    // 還沒過的不算「重解」——那是主線，不是今天的提議
    if (!g || g === 'S') continue;
    polish.push(`polish:${c.id}`);
  }

  const find = [];
  for (const kind of CLUE_KINDS) {
    for (const e of clues[kind] || []) {
      if (!e || typeof e.id !== 'string') continue;
      if (!isPlayable(e.region)) continue;
      if (found(kind, e.id)) continue;
      find.push(`find:${kind}:${e.id}`);
    }
  }

  const seen = new Set(Array.isArray(visited) ? visited : []);
  const visit = [];
  for (const r of regions) {
    if (typeof r !== 'string' || !r) continue;
    if (!isPlayable(r)) continue;
    if (seen.has(r)) continue;
    visit.push(`visit:${r}`);
  }

  return { polish, find, visit };
}

/**
 * 今天挑哪三件。
 *
 * 先一種挑一個（三件事看起來不一樣），不夠三件才從剩下的補 ——
 * 補得到就補，補不到就少於三件（**不會有假的提議來湊數**）。
 * 同一天、同一份候選一定挑到同一組。
 *
 * @param {string} dayKey `localDayKey()` 的結果
 * @param {{polish:string[], find:string[], visit:string[]}} pool
 * @param {number} [count]
 * @param {object} [opts]
 * @param {(id:string)=>string} [opts.sayKey] 這一件「說出來」是哪一句（同一句只提一次；預設 ＝ id）
 * @returns {string[]}
 */
export function pickOffers(dayKey, pool = {}, count = DAILY_COUNT, { sayKey = null } = {}) {
  const seed = dayHash(dayKey);
  const kinds = OFFER_KINDS.map((_, i) => OFFER_KINDS[(i + (seed % OFFER_KINDS.length)) % OFFER_KINDS.length]);
  const taken = new Set();
  /*
   * v1.2 發版後 QA #4：「不重複」看的是**畫出來會不會一樣**，不只是 id。
   * 「到撰寫基本功找一處還沒讀到的刻文」×2 —— id 不同（兩則刻文），字一模一樣，
   * 玩家看到的是複製貼上。所以除了 id 之外再記一把「說出來的鍵」（呼叫端給的
   * `sayKey`：找線索 ＝ 種類＋土地），同一把鍵只提一次。
   */
  const said = new Set();
  const keyOf = (id) => (typeof sayKey === 'function' ? String(sayKey(id) ?? id) : id);
  /** 同一種提議裡再分「線索的種類」——只開一片土地時，三件事才會是三種（祕境／殘頁／刻文）。 */
  const usedClue = new Set();
  const clueOf = (id) => {
    const o = parseOffer(id);
    return o && o.kind === 'find' ? o.clueKind : null;
  };
  const out = [];

  const takeFrom = (kind, round) => {
    const list = Array.isArray(pool[kind]) ? pool[kind] : [];
    if (!list.length) return false;
    const start = dayHash(`${dayKey}:${kind}:${round}`) % list.length;
    // 先挑「線索種類還沒提過」的；沒有了才退回任何一件沒說過的
    for (const preferFresh of [true, false]) {
      for (let i = 0; i < list.length; i += 1) {
        const pick = list[(start + i) % list.length];
        if (typeof pick !== 'string' || taken.has(pick)) continue;
        const key = keyOf(pick);
        if (said.has(key)) continue;
        const clue = clueOf(pick);
        if (preferFresh && clue && usedClue.has(clue)) continue;
        taken.add(pick);
        said.add(key);
        if (clue) usedClue.add(clue);
        out.push(pick);
        return true;
      }
    }
    return false;
  };

  for (const kind of kinds) {
    if (out.length >= count) break;
    takeFrom(kind, 0);
  }
  // 補位：某一種沒有候選（例如整片土地都走過了）時，讓別種多出一件
  for (let round = 1; out.length < count && round <= count; round += 1) {
    let grew = false;
    for (const kind of kinds) {
      if (out.length >= count) break;
      if (takeFrom(kind, round)) grew = true;
    }
    if (!grew) break;
  }
  return out;
}

/**
 * 這一件做完了嗎。
 *
 * 「做完」只有一個作用：在旁邊畫一個記號。**沒做完不會有任何事發生**。
 *
 * @param {string} id 提議 id
 * @param {object} probes
 * @param {(challengeId:string)=>(string|null)} [probes.bestGrade]
 * @param {(kind:string, id:string)=>boolean} [probes.found]
 * @param {string[]} [probes.visited]
 * @returns {boolean}
 */
export function offerDone(id, { bestGrade = () => null, found = () => false, visited = [] } = {}) {
  const o = parseOffer(id);
  if (!o) return false;
  if (o.kind === 'polish') return bestGrade(o.challengeId) === 'S';
  if (o.kind === 'find') return Boolean(found(o.clueKind, o.clueId));
  if (o.kind === 'visit') return Array.isArray(visited) && visited.includes(o.regionId);
  return false;
}

export default {
  DAILY_COUNT,
  OFFER_KINDS,
  CLUE_KINDS,
  localDayKey,
  isDayKey,
  dayHash,
  parseOffer,
  buildPool,
  pickOffers,
  offerDone,
};
