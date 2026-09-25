import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import { tags as t } from "@lezer/highlight";

// 所有颜色都引用 CSS 变量（定义在 src/theme/themes.ts），切换主题时编辑器自动跟着变

const editorTheme = EditorView.theme(
  {
    "&": {
      height: "100%",
      fontSize: "14px",
      color: "var(--ed-fg)",
      backgroundColor: "var(--bg-editor)",
    },
    "&.cm-focused": { outline: "none" },
    ".cm-scroller": {
      fontFamily: "'Cascadia Code', Consolas, 'Courier New', monospace",
      lineHeight: "1.55",
    },
    ".cm-content": { caretColor: "var(--ed-cursor)" },
    ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--ed-cursor)", borderLeftWidth: "2px" },
    "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection":
      { backgroundColor: "var(--ed-selection)" },
    ".cm-activeLine": { backgroundColor: "var(--ed-line)" },
    ".cm-selectionMatch": { backgroundColor: "var(--ed-match)" },
    ".cm-searchMatch": { backgroundColor: "var(--ed-find)" },
    ".cm-searchMatch.cm-searchMatch-selected": { backgroundColor: "var(--ed-find-active)" },
    "&.cm-focused .cm-matchingBracket, &.cm-focused .cm-nonmatchingBracket": {
      backgroundColor: "var(--ed-bracket)",
    },
    ".cm-gutters": {
      backgroundColor: "var(--bg-editor)",
      color: "var(--ed-gutter)",
      border: "none",
    },
    ".cm-activeLineGutter": { backgroundColor: "transparent", color: "var(--ed-gutter-active)" },
    ".cm-foldPlaceholder": {
      backgroundColor: "var(--hover)",
      border: "none",
      color: "var(--fg-muted)",
    },
    ".cm-panels": { backgroundColor: "var(--bg-widget)", color: "var(--fg)" },
    ".cm-panels.cm-panels-top": { borderBottom: "1px solid var(--border)" },
    ".cm-panels.cm-panels-bottom": { borderTop: "1px solid var(--border)" },
    ".cm-panel input, .cm-panel button": {
      borderRadius: "var(--radius)",
    },
    ".cm-textfield": {
      backgroundColor: "var(--bg-input)",
      border: "1px solid var(--border-input)",
      color: "var(--fg-strong)",
    },
    ".cm-button": {
      backgroundImage: "none",
      backgroundColor: "var(--bg-input)",
      border: "1px solid var(--border-input)",
      color: "var(--fg)",
    },
    ".cm-tooltip": {
      border: "1px solid var(--widget-border)",
      borderRadius: "var(--radius)",
      backgroundColor: "var(--bg-widget)",
      color: "var(--fg)",
    },
    ".cm-tooltip-autocomplete > ul > li[aria-selected]": {
      backgroundColor: "var(--menu-hover-bg)",
      color: "var(--menu-hover-fg)",
    },
    ".cm-completionMatchedText": { textDecoration: "none", color: "var(--hl)", fontWeight: "600" },

    // 与 Git 版本对比时的行内差异（@codemirror/merge），选择器和它的基础主题保持一致以便覆盖
    "&.cm-merge-b .cm-changedLine": { backgroundColor: "var(--diff-inserted-line)" },
    "&.cm-merge-b .cm-changedText": { background: "var(--diff-inserted-text)" },
    ".cm-deletedChunk": { backgroundColor: "var(--diff-removed-line)" },
    "& .cm-deletedChunk .cm-deletedText, &.cm-merge-b .cm-deletedText": {
      background: "var(--diff-removed-text)",
    },
    "&.cm-merge-b .cm-changedLineGutter": { background: "var(--git-added)" },
    "& .cm-deletedLineGutter": { background: "var(--git-deleted)" },
    ".cm-deletedChunk .cm-chunkButtons button[name=reject]": {
      padding: "0 8px",
      border: "1px solid var(--border-input)",
      borderRadius: "var(--radius)",
      background: "var(--bg-input)",
      color: "var(--fg)",
      font: "12px var(--font-ui)",
      lineHeight: "18px",
    },
    ".cm-deletedChunk .cm-chunkButtons button[name=reject]:hover": {
      background: "var(--hover)",
      color: "var(--fg-strong)",
    },
    "& .cm-collapsedLines": {
      color: "var(--fg-muted)",
      background: "var(--hover)",
    },
  },
  { dark: true },
);

const highlightStyle = HighlightStyle.define([
  { tag: [t.keyword, t.modifier, t.definitionKeyword, t.operatorKeyword], color: "var(--syn-keyword)" },
  { tag: [t.controlKeyword, t.moduleKeyword], color: "var(--syn-control)" },
  { tag: [t.name, t.deleted, t.character, t.macroName], color: "var(--syn-variable)" },
  { tag: [t.propertyName], color: "var(--syn-property)" },
  {
    tag: [t.function(t.variableName), t.function(t.propertyName), t.labelName],
    color: "var(--syn-function)",
  },
  { tag: [t.color, t.constant(t.name), t.standard(t.name)], color: "var(--syn-constant)" },
  { tag: [t.definition(t.name), t.separator], color: "var(--syn-variable)" },
  {
    tag: [t.typeName, t.className, t.namespace, t.changed, t.annotation, t.self],
    color: "var(--syn-type)",
  },
  { tag: [t.number, t.bool, t.atom], color: "var(--syn-number)" },
  { tag: [t.operator, t.punctuation], color: "var(--syn-operator)" },
  { tag: [t.url, t.escape, t.regexp, t.special(t.string)], color: "var(--syn-regexp)" },
  { tag: [t.meta, t.comment], color: "var(--syn-comment)", fontStyle: "var(--syn-comment-style)" },
  { tag: [t.string, t.inserted], color: "var(--syn-string)" },
  { tag: t.tagName, color: "var(--syn-tag)" },
  { tag: t.attributeName, color: "var(--syn-attribute)" },
  { tag: t.heading, color: "var(--syn-heading)", fontWeight: "bold" },
  { tag: t.strong, fontWeight: "bold" },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: t.strikethrough, textDecoration: "line-through" },
  { tag: t.link, color: "var(--syn-regexp)", textDecoration: "underline" },
  { tag: t.invalid, color: "var(--syn-invalid)" },
]);

export const themeExtension = [editorTheme, syntaxHighlighting(highlightStyle)];
