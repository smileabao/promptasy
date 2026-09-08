/**
 * Promptasy — 小景零件的貼地稽核（v1.2 · P25b0）
 *
 * 故事小景是**成組**擺的：一組一個 `holder`，落在「組中心那一點的地面」，
 * 組內每一件只給局部位移（`props.js` 的 `buildVignettes()`）。
 * 地會起伏，所以離組中心越遠的零件越容易浮起來或埋下去 ——
 * 這與 P11 對母題那一層修過的是同一類錯，只是小景這一層當時沒跟上。
 *
 * 判準乾淨得不必發明新資料：`parts` 的 `[dx, dy, dz]` 裡的 **`dy` 就是「刻意的垂直位移」**
 * （放在桌上的墨、懸在階梯上方的浮階都靠它）。兩種擺法各有一條斷言：
 *
 *   - `dy === 0`（**應該貼地**）→ 高度要等於**它自己腳下的地**。
 *   - `dy !== 0`（**擺的是相對關係**）→ 高度要等於**組中心的地 ＋ dy**，
 *     也就是**不准**被貼地 —— 桌上的墨一貼地就會從桌面掉下來。
 *
 * 量兩層，因為只量一層都有死角：
 *
 *   ① **原點**（`origin`）：零件節點自己的世界高度。判準最嚴（`ORIGIN_TOLERANCE`），
 *      因為兩邊是同一支高度場算出來的，對得上的時候誤差是浮點級。
 *   ② **腳**（`foot`）：那一件**真的畫出來的幾何**最低點。這才是眼睛看到的「貼不貼地」——
 *      道具的原點萬一哪天不在底面，只量原點會全部安靜地過。
 *      往下埋一點是有的（水池、火塘、石堆是刻意陷進地裡的），所以下沉與浮空
 *      分開給門檻。
 *
 * ①②量的都是 `buildVignettes()` 自己蓋出來的那棵樹（沒有合批），所以看得到幾何；
 * 另外把**真的出貨的那個世界**傳進來時（`scene`），再逐件比一次原點，
 * 確認世界端擺的就是這裡量的那一份。
 *
 * 用法：
 *   node scripts/vignette-fit.mjs          印超標的零件
 *   node scripts/vignette-fit.mjs --all    連沒超標的也逐件印
 *   node scripts/vignette-fit.mjs --world  順便蓋一次整個世界，比對出貨的擺位
 *
 * `npm run test:rubric` 把 `auditVignetteFit()` 當硬斷言跑（超標數必須是 0）。
 */
import * as THREE from 'three';
import { STORY_VIGNETTES, PROP_KINDS, buildVignettes, kitFor } from '../src/world/props.js';
import { terrainHeight as worldHeight } from '../src/world/world.js';
import { installCanvasStub } from './world-harness.mjs';

/**
 * 原點的容許誤差（公尺）—— 收得很緊：它要攔的是「又有人只貼組中心」那一類回歸，
 * 不是量測雜訊（兩邊是同一支高度場，對得上的時候誤差是浮點級）。
 */
export const ORIGIN_TOLERANCE = 0.05;

/** 幾何最低點准許往下埋多深（水池、火塘、石堆是刻意陷進地裡的）。 */
export const FOOT_SINK_MAX = 0.25;

/** 幾何最低點准許離地多高（本來就該踩在地上的東西，一寸都不該看得出來）。 */
export const FOOT_FLOAT_MAX = 0.15;

const _pos = new THREE.Vector3();
const _v = new THREE.Vector3();
const _m = new THREE.Matrix4();

/**
 * 一棵子樹**真的畫出來的**世界外接盒（含 InstancedMesh 的每一個實例）。
 * @param {object} root
 * @returns {THREE.Box3} 沒有任何網格時回一個空盒（`min.y === Infinity`）
 */
export function drawnBox(root) {
  const box = new THREE.Box3().makeEmpty();
  root.updateMatrixWorld(true);
  root.traverse((o) => {
    if (!o.isMesh || !o.geometry || !o.geometry.attributes || !o.geometry.attributes.position) return;
    const pos = o.geometry.attributes.position;
    const n = o.isInstancedMesh ? o.count : 1;
    for (let k = 0; k < n; k += 1) {
      if (o.isInstancedMesh) {
        o.getMatrixAt(k, _m);
        _m.premultiply(o.matrixWorld);
      } else {
        _m.copy(o.matrixWorld);
      }
      for (let i = 0; i < pos.count; i += 1) {
        _v.fromBufferAttribute(pos, i).applyMatrix4(_m);
        box.expandByPoint(_v);
      }
    }
  });
  return box;
}

/**
 * 把一組小景的零件與場景圖裡的節點對起來。
 *
 * `buildVignettes()` 會跳過沒有建構函式的種類，所以先照同一條規則濾一次，
 * 濾完的順序與 `holder.children` 一一對應。
 * @param {object} v 一組 `STORY_VIGNETTES`
 * @returns {Array} 有建構函式的零件
 */
export function buildableParts(v) {
  return v.parts.filter(([kind]) => PROP_KINDS.includes(kind));
}

/**
 * 逐件量小景零件的貼地。
 * @param {object} [opts]
 * @param {object} [opts.scene] 真的出貨的那個世界（有給就多比一次原點）
 * @param {(x:number,z:number)=>number} [opts.heightAt] 量的時候用的高度場（預設用世界那一支）
 * @param {(x:number,z:number)=>number} [opts.placeHeight] 擺的時候用的高度場（預設同上）——
 *   兩支給不一樣的就是**反例**：拿一支假的去擺、拿真的去量，這支稽核必須紅。
 * @returns {{rows:Array, bad:Array, mismatch:Array}}
 */
export function auditVignetteFit({ scene = null, heightAt = worldHeight, placeHeight = null } = {}) {
  const placeAt = placeHeight || heightAt;
  const restore = installCanvasStub();
  const rows = [];
  const mismatch = [];
  try {
    const regions = [...new Set(STORY_VIGNETTES.map((v) => v.region))];
    for (const region of regions) {
      const { group } = buildVignettes(region, kitFor(0x8899bb), placeAt, 'high');
      group.updateMatrixWorld(true);
      for (const v of STORY_VIGNETTES) {
        if (v.region !== region) continue;
        const holder = group.getObjectByName(`vignette:${v.id}`);
        const parts = buildableParts(v);
        if (!holder || holder.children.length !== parts.length) {
          mismatch.push(`${v.id}：場上 ${holder ? holder.children.length : 0} 件、資料 ${parts.length} 件`);
          continue;
        }
        const baseY = heightAt(v.at[0], v.at[1]);
        for (let i = 0; i < parts.length; i += 1) {
          const [kind, offset] = parts[i];
          const lift = offset[1] || 0;
          const node = holder.children[i];
          node.getWorldPosition(_pos);
          const x = _pos.x;
          const z = _pos.z;
          const y = _pos.y;
          const ground = heightAt(x, z);
          // 貼地的看自己腳下那一點；擺相對關係的看組中心那一點（＝不准被貼地）
          const want = lift === 0 ? ground : baseY + lift;
          const box = drawnBox(node);
          // 正 ＝ 比它該在的高度高（浮空）；負 ＝ 低（埋進地裡）
          const origin = y - want;
          const foot = Number.isFinite(box.min.y) ? box.min.y - ground : null;
          const badOrigin = Math.abs(origin) > ORIGIN_TOLERANCE;
          const badFoot =
            lift === 0 && foot !== null && (foot > FOOT_FLOAT_MAX || foot < -FOOT_SINK_MAX);
          rows.push({
            vignette: v.id,
            region,
            kind,
            index: i,
            lift,
            x,
            z,
            y,
            ground,
            want,
            origin,
            foot,
            badOrigin,
            badFoot,
            bad: badOrigin || badFoot,
            why: badOrigin ? (badFoot ? 'origin+foot' : 'origin') : badFoot ? 'foot' : '',
          });
          if (scene) {
            const shipped = scene.getObjectByName(`vignette:${v.id}`);
            if (!shipped || !shipped.children[i]) {
              mismatch.push(`${v.id}#${i}：出貨的世界裡找不到這一件`);
            } else {
              shipped.updateMatrixWorld(true);
              shipped.children[i].getWorldPosition(_pos);
              const d = Math.max(Math.abs(_pos.x - x), Math.abs(_pos.y - y), Math.abs(_pos.z - z));
              if (d > 1e-6) mismatch.push(`${v.id}/${kind}：出貨的擺位差 ${d.toFixed(4)}`);
            }
          }
        }
      }
    }
  } finally {
    restore();
  }
  return { rows, bad: rows.filter((r) => r.bad), mismatch };
}

const isMain = process.argv[1] && process.argv[1].endsWith('vignette-fit.mjs');
if (isMain) {
  const showAll = process.argv.includes('--all');
  let scene = null;
  if (process.argv.includes('--world')) {
    const { buildWorld } = await import('./world-harness.mjs');
    ({ scene } = await buildWorld({ quality: 'high' }));
  }
  const { rows, bad, mismatch } = auditVignetteFit({ scene });
  const lifted = rows.filter((r) => r.lift !== 0);
  console.log(`小景 ${STORY_VIGNETTES.length} 組、零件 ${rows.length} 件`);
  console.log(`  刻意抬高的 ${lifted.length} 件、應該貼地的 ${rows.length - lifted.length} 件`);
  console.log(`  超標：${bad.length} 件、${new Set(bad.map((r) => r.vignette)).size} 組`);
  console.log(`  原點門檻 ±${ORIGIN_TOLERANCE}／腳 -${FOOT_SINK_MAX}～+${FOOT_FLOAT_MAX} 公尺`);
  if (mismatch.length) console.log(`  對不起來：${mismatch.join('、')}`);
  const list = showAll ? rows : bad;
  for (const r of list.slice().sort((a, b) => Math.abs(b.origin) - Math.abs(a.origin))) {
    const tag = r.origin >= 0 ? '浮' : '埋';
    console.log(
      `  ${tag} ${Math.abs(r.origin).toFixed(3)}  ${r.vignette}/${r.kind}` +
        `  y=${r.y.toFixed(2)} 該在=${r.want.toFixed(2)} 地=${r.ground.toFixed(2)}` +
        ` 抬高=${r.lift} 腳=${r.foot === null ? '無幾何' : r.foot.toFixed(2)}${r.why ? ` ← ${r.why}` : ''}`
    );
  }
  process.exit(bad.length || mismatch.length ? 1 : 0);
}

export default {
  auditVignetteFit,
  buildableParts,
  drawnBox,
  ORIGIN_TOLERANCE,
  FOOT_SINK_MAX,
  FOOT_FLOAT_MAX,
};
