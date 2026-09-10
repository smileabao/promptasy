/**
 * Promptasy — 今日三事那一塊（v1.2 · P23）
 *
 * 規則住在 `src/progression/daily.js`；這裡只負責把三個提議寫成字。
 *
 * **這一塊的用字有紀律**（同 WORLD §1.6 對濁靈的那一套）：
 * 它是提議，所以句子裡不准出現任何在催人的東西 —— 沒有「還剩幾天」、
 * 沒有「今天結束前」、沒有「連著幾天」、沒有「錯過」、沒有「任務」。
 * 三件事沒做完，畫面上不會有一個字提起這件事。
 * `test:rubric` 拿一份禁字表掃這一支的原始碼與**畫出來的字串**兩面。
 *
 * 這支檔案沒有任何 DOM 操作，全部是純函式（吃資料、回字串），
 * 所以測試可以直接把畫出來的 HTML 拿去掃。
 */
import { esc } from './dom.js';

/** 這一塊的標題（世界的說法）。 */
export const DAILY_TITLE = '今日三事';

/** 標題底下那一行 —— 這一塊唯一一次解釋自己是什麼。 */
export const DAILY_LEAD = '三個提議，不是任務。做不做都可以，明天會換一批。';

/** 一件都提不出來時說的話（不是空白，也不是催人）。 */
export const DAILY_EMPTY = '今天沒有特別想提的事 —— 你想去哪裡就去哪裡。';

/** 做過了的那一行。 */
export const DAILY_DONE = '已經做過了';

/** 三種線索在畫面上的說法。 */
export const CLUE_SAY = Object.freeze({
  secret: '走進的祕境',
  letter: '撿起的殘頁',
  ins: '讀到的刻文',
});

/**
 * 三種線索各自的副句（QA #4：三條一模一樣的「那一片土地上還有東西沒被你看見」
 * 看起來像複製貼上）。每一句說的是**那一種東西在哪裡找**，不是催。
 */
export const FIND_SAY = Object.freeze({
  secret: '藏起來的地方，要繞到看不見的那一側才找得到。',
  letter: '有人把話留在紙上，就放在路邊。',
  ins: '角落的刻文，每一則都教一件小事。',
});

/**
 * 一個提議要怎麼說。
 *
 * @param {object} offer `daily.js` 的 `parseOffer()` 加上 `done`
 * @param {object} names
 * @param {(id:string)=>string} [names.regionName]
 * @param {(id:string)=>string} [names.challengeTitle]
 * @param {(id:string)=>string} [names.challengeRegion]
 * @returns {{what:string, say:string}|null}
 */
export function offerSay(offer, { regionName = (id) => id, challengeTitle = (id) => id, challengeRegion = () => '' } = {}) {
  if (!offer || !offer.kind) return null;
  if (offer.kind === 'polish') {
    const where = challengeRegion(offer.challengeId);
    return {
      what: `回頭把「${challengeTitle(offer.challengeId)}」重寫成 S`,
      say: where ? `${regionName(where)} · 這一關已經過了，還可以寫得更好。` : '這一關已經過了，還可以寫得更好。',
    };
  }
  if (offer.kind === 'find') {
    return {
      what: `到${regionName(offer.clueRegion || '')}找一處還沒${CLUE_SAY[offer.clueKind] || '找到的東西'}`,
      say: FIND_SAY[offer.clueKind] || '那一片土地上還有東西沒被你看見。',
    };
  }
  if (offer.kind === 'visit') {
    return {
      what: `到${regionName(offer.regionId)}走一趟`,
      say: '那片土地上還有事情可以做。',
    };
  }
  return null;
}

/** 一件。做過了就在前面畫一個記號 —— 沒做過的那幾件不會被說一句話。 */
function offerHtml(offer, names) {
  const say = offerSay(offer, names);
  if (!say) return '';
  return `<li class="daily__item${offer.done ? ' is-done' : ''}" data-daily-offer="${esc(offer.id)}" data-daily-done="${
    offer.done ? '1' : '0'
  }">
    <i aria-hidden="true">${offer.done ? '✓' : '✦'}</i>
    <b>${esc(say.what)}</b>
    <span>${esc(offer.done ? DAILY_DONE : say.say)}</span>
  </li>`;
}

/**
 * 今日三事那一整塊。
 *
 * @param {Array|null} offers `progression.dailyReport()`；`null` ＝ 設定裡關掉了
 * @param {object} [names] 見 `offerSay()`
 * @returns {string} HTML（關掉時是空字串 —— 那一區整塊不出現）
 */
export function dailyBlock(offers, names = {}) {
  if (!Array.isArray(offers)) return '';
  const rows = offers.map((o) => offerHtml(o, names)).join('');
  /*
   * 只掛自己的 class（`.daily` / `.daily__list`），不再借 `.seals .finds .finds__list`：
   * QA #3 把這一塊搬到圖鑑最上面之後，借來的 class 會讓「找 `.seals`」「找 `.finds__list li` 裡的刻文」
   * 那些既有讀法先撞到今日三事（e2e 實測撞了三條 ＋ 一次中斷）。樣式在 styles.css 與 `.finds__list` 同一組規則。
   */
  return `<div class="daily" data-daily>
    <div class="meta-rule"><h4><span class="zh">${esc(DAILY_TITLE)}</span><span class="en">Today</span></h4></div>
    <p class="muted daily__lead">${esc(DAILY_LEAD)}</p>
    ${rows ? `<ul class="daily__list">${rows}</ul>` : `<p class="daily__empty" data-daily-empty>${esc(DAILY_EMPTY)}</p>`}
  </div>`;
}

export default dailyBlock;
