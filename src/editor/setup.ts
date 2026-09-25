import { basicSetup } from "codemirror";
import { Compartment, EditorState, Facet, type Extension } from "@codemirror/state";
import { keymap } from "@codemirror/view";
import { indentWithTab } from "@codemirror/commands";
import { LanguageDescription, type LanguageSupport } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { blame } from "./blame";
import { conflicts } from "./conflicts";
import { quickDiff } from "./quickDiff";
import { themeExtension } from "./theme";

/** 每个 EditorState 记住自己属于哪个标签页（用 id 而不是路径，重命名文件时不用重建状态） */
export const tabId = Facet.define<number, number>({
  combine: (values) => values[0] ?? -1,
});

/** 与 Git 版本对比时放入行内差异视图，平时为空 */
export const diffCompartment = new Compartment();

/**
 * 语言包按需加载：language-data 里的每种语言都是独立的动态 import，
 * 只有打开对应类型的文件时才会下载并解析。
 */
export async function loadLanguage(fileName: string) {
  const desc = LanguageDescription.matchFilename(languages, fileName);
  if (!desc) return { name: "Plain Text", support: null };
  try {
    return { name: desc.name, support: await desc.load() };
  } catch {
    return { name: desc.name, support: null };
  }
}

/** 按代码块标注的语言名（比如 ts、rust）加载语言包，找不到时返回 null */
export async function loadLanguageByName(name: string) {
  const desc = LanguageDescription.matchLanguageName(languages, name, true);
  try {
    return desc ? await desc.load() : null;
  } catch {
    return null;
  }
}

export function createEditorState(
  id: number,
  doc: string,
  language: LanguageSupport | null,
  listener: Extension,
  extra: Extension = [],
): EditorState {
  return EditorState.create({
    doc,
    extensions: [
      tabId.of(id),
      basicSetup,
      keymap.of([indentWithTab]),
      themeExtension,
      language ?? [],
      quickDiff,
      conflicts,
      blame,
      diffCompartment.of([]),
      extra,
      listener,
    ],
  });
}
