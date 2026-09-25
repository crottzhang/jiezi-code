export interface FuzzyMatch {
  score: number;
  /** 命中字符在原文本中的下标，用于高亮 */
  positions: number[];
}

/** 单词开头加分：路径分隔符/下划线/连字符之后、camelCase 大写字母；扩展名开头只加一点 */
function boundaryBonus(text: string, i: number) {
  if (i === 0) return 3;
  const prev = text[i - 1];
  if ("/\\_- ".includes(prev)) return 3;
  if (prev === ".") return 1;
  return text[i] >= "A" && text[i] <= "Z" && prev >= "a" && prev <= "z" ? 3 : 0;
}

function scorePositions(text: string, positions: number[]) {
  let score = 0;
  for (let k = 0; k < positions.length; k++) {
    score += 1;
    if (k > 0 && positions[k] === positions[k - 1] + 1) score += 5;
    score += boundaryBonus(text, positions[k]);
  }
  return score - text.length * 0.01;
}

function greedy(q: string, lower: string, from: number) {
  const positions: number[] = [];
  let i = from;
  for (const ch of q) {
    const idx = lower.indexOf(ch, i);
    if (idx < 0) return null;
    positions.push(idx);
    i = idx + 1;
  }
  return positions;
}

/**
 * 子序列模糊匹配。候选：连续子串、只在文件名里匹配、在整个路径里匹配，取得分最高者。
 * 匹配落在文件名（最后一段路径）里会额外加分。
 */
export function fuzzyMatch(query: string, text: string): FuzzyMatch | null {
  const q = query.toLowerCase().replace(/\s+/g, "");
  if (!q) return { score: 0, positions: [] };
  const lower = text.toLowerCase();
  const base = Math.max(text.lastIndexOf("/"), text.lastIndexOf("\\")) + 1;

  const candidates: number[][] = [];
  const sub = lower.lastIndexOf(q);
  if (sub >= 0) candidates.push(Array.from(q, (_, k) => sub + k));
  const inBase = greedy(q, lower, base);
  if (inBase) candidates.push(inBase);
  const anywhere = greedy(q, lower, 0);
  if (anywhere) candidates.push(anywhere);
  if (candidates.length === 0) return null;

  let best: FuzzyMatch | null = null;
  for (const positions of candidates) {
    const score = scorePositions(text, positions) + (positions[0] >= base ? 20 : 0);
    if (!best || score > best.score) best = { score, positions };
  }
  return best;
}

/** 把文本按命中位置切成片段，方便模板里高亮 */
export function highlight(text: string, positions: number[], offset = 0) {
  const hits = new Set(positions.map((p) => p - offset));
  const parts: { text: string; hit: boolean }[] = [];
  for (let i = 0; i < text.length; i++) {
    const hit = hits.has(i);
    const last = parts[parts.length - 1];
    if (last && last.hit === hit) last.text += text[i];
    else parts.push({ text: text[i], hit });
  }
  return parts;
}
