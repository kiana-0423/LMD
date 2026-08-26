import type { Language } from "../../i18n/LanguageContext";

/**
 * Translations for Ketcher's own interface chrome.
 *
 * This exists because Ketcher renders its toolbar, menus and dialogs itself, outside React, from a
 * third-party bundle that carries no translation keys. Everything LMD renders goes through the key
 * catalogue and is checked by `npm run audit:i18n`; only this one third-party surface needs a DOM
 * bridge, and only these phrases need to be in it.
 *
 * The table it replaced held 638 phrases, of which 30 were Ketcher's. The other 608 were LMD's own
 * words, translated a second time by string matching after the catalogue had already translated
 * them properly — a second source of truth for the same sentences, and one that would silently
 * rewrite any *data* that happened to read like an interface label. The list below was extracted
 * from `ketcher-react`'s own bundle, so an entry here corresponds to something Ketcher actually
 * displays.
 *
 * A phrase with no entry is left in English. Third-party chrome in the wrong language is a
 * cosmetic problem; a phrase table that guesses is a correctness one.
 */

type TranslationPair = { zh: string; ja: string };

const phrases: Record<string, TranslationPair> = {
  // --- Toolbar: file and clipboard ---
  "Clear Canvas": { zh: "清空画布", ja: "キャンバスをクリア" },
  "Open...": { zh: "打开……", ja: "開く…" },
  "Open from File": { zh: "从文件打开", ja: "ファイルから開く" },
  "Open structure": { zh: "打开结构", ja: "構造を開く" },
  "Open as New Project": { zh: "作为新项目打开", ja: "新規プロジェクトとして開く" },
  "Open as new Project": { zh: "作为新项目打开", ja: "新規プロジェクトとして開く" },
  "Save as...": { zh: "另存为……", ja: "名前を付けて保存…" },
  "Save Structure": { zh: "保存结构", ja: "構造を保存" },
  "Save to File": { zh: "保存到文件", ja: "ファイルに保存" },
  "Paste from clipboard": { zh: "从剪贴板粘贴", ja: "クリップボードから貼り付け" },
  "Copy to clipboard": { zh: "复制到剪贴板", ja: "クリップボードにコピー" },
  Cut: { zh: "剪切", ja: "切り取り" },
  Paste: { zh: "粘贴", ja: "貼り付け" },
  Undo: { zh: "撤销", ja: "元に戻す" },
  Redo: { zh: "重做", ja: "やり直す" },

  // --- Toolbar: view ---
  "Zoom In": { zh: "放大", ja: "拡大" },
  "Zoom Out": { zh: "缩小", ja: "縮小" },
  "Zoom 100%": { zh: "缩放 100%", ja: "ズーム 100%" },
  "Fullscreen mode": { zh: "全屏模式", ja: "全画面モード" },
  Settings: { zh: "设置", ja: "設定" },
  Help: { zh: "帮助", ja: "ヘルプ" },
  About: { zh: "关于", ja: "バージョン情報" },

  // --- Structure tools ---
  "Atom Properties": { zh: "原子属性", ja: "原子プロパティ" },
  "Bond Properties": { zh: "键属性", ja: "結合プロパティ" },
  "Bond type": { zh: "键类型", ja: "結合の種類" },
  "Query bonds": { zh: "查询键", ja: "クエリ結合" },
  "Query properties": { zh: "查询属性", ja: "クエリプロパティ" },
  "Attachment Points": { zh: "连接点", ja: "接続点" },
  "Attachment points": { zh: "连接点", ja: "接続点" },
  "Enhanced Stereochemistry": { zh: "增强立体化学", ja: "拡張立体化学" },
  "Enhanced stereochemistry...": { zh: "增强立体化学……", ja: "拡張立体化学…" },
  "Calculated Values": { zh: "计算值", ja: "計算値" },
  "Structure Check": { zh: "结构检查", ja: "構造チェック" },
  "Periodic Table": { zh: "元素周期表", ja: "周期表" },
  "Extended Table": { zh: "扩展周期表", ja: "拡張周期表" },
  "Functional Groups": { zh: "官能团", ja: "官能基" },
  "Salts and Solvents": { zh: "盐与溶剂", ja: "塩と溶媒" },
  "Template Library": { zh: "模板库", ja: "テンプレートライブラリ" },
  "Structure Library": { zh: "结构库", ja: "構造ライブラリ" },
  "Text Editor": { zh: "文本编辑器", ja: "テキストエディター" },
  "R-Group": { zh: "R 基团", ja: "R グループ" },
  "R-Group Logic Condition": { zh: "R 基团逻辑条件", ja: "R グループ論理条件" },
  "S-Group Properties": { zh: "S 基团属性", ja: "S グループプロパティ" },
  "Attach S-Group...": { zh: "附加 S 基团……", ja: "S グループを付加…" },
  "Edit S-Group...": { zh: "编辑 S 基团……", ja: "S グループを編集…" },
  "Reaction Auto-Mapping": { zh: "反应自动映射", ja: "反応の自動マッピング" },
  "Contract Abbreviation": { zh: "折叠缩写", ja: "略号を折りたたむ" },
  "Expand Abbreviation": { zh: "展开缩写", ja: "略号を展開" },
  "Edit Abbreviation": { zh: "编辑缩写", ja: "略号を編集" },
  "Label Edit": { zh: "编辑标签", ja: "ラベルを編集" },
  "Edit selected atoms...": { zh: "编辑所选原子……", ja: "選択した原子を編集…" },
  "Edit selected bonds...": { zh: "编辑所选键……", ja: "選択した結合を編集…" },
  "Add to Canvas": { zh: "添加到画布", ja: "キャンバスに追加" },
  "Click to add to canvas": { zh: "点击以添加到画布", ja: "クリックしてキャンバスに追加" },
  Highlight: { zh: "高亮", ja: "ハイライト" },
  "No highlight": { zh: "无高亮", ja: "ハイライトなし" },
  "Import Structure from Image": { zh: "从图像导入结构", ja: "画像から構造をインポート" },

  // --- Dialogs ---
  Apply: { zh: "应用", ja: "適用" },
  Cancel: { zh: "取消", ja: "キャンセル" },
  Save: { zh: "保存", ja: "保存" },
  Delete: { zh: "删除", ja: "削除" },
  Discard: { zh: "放弃", ja: "破棄" },
  Reset: { zh: "重置", ja: "リセット" },
  Check: { zh: "检查", ja: "チェック" },
  Name: { zh: "名称", ja: "名前" },
  Type: { zh: "类型", ja: "種類" },
  Number: { zh: "数量", ja: "数" },
  Code: { zh: "代码", ja: "コード" },
  Aliases: { zh: "别名", ja: "別名" },
  Attributes: { zh: "属性", ja: "属性" },
  Modification: { zh: "修饰", ja: "修飾" },
  "Font Size": { zh: "字号", ja: "フォントサイズ" },
  "Decimal places": { zh: "小数位数", ja: "小数点以下の桁数" },
  "Enter name": { zh: "输入名称", ja: "名前を入力" },
  "Enter value": { zh: "输入数值", ja: "値を入力" },
  "Confirm type change": { zh: "确认更改类型", ja: "種類の変更を確認" },
  "Delete modification type": { zh: "删除修饰类型", ja: "修飾の種類を削除" },
  "Add modification type": { zh: "添加修饰类型", ja: "修飾の種類を追加" },
  "Natural analogue": { zh: "天然类似物", ja: "天然アナログ" },
  "Non-typical attachment points": { zh: "非典型连接点", ja: "非典型的な接続点" },
  "Please choose image": { zh: "请选择图像", ja: "画像を選択してください" },
  "Original image": { zh: "原始图像", ja: "元の画像" },
  "Change image": { zh: "更换图像", ja: "画像を変更" },
  "No errors detected": { zh: "未检测到错误", ja: "エラーは検出されませんでした" },
  "No embedded structures found in the file": {
    zh: "文件中未找到嵌入的结构",
    ja: "ファイルに埋め込み構造が見つかりません"
  },
  Molecules: { zh: "分子", ja: "分子" }
};

/**
 * Translates one phrase of Ketcher chrome, preserving the whitespace around it.
 *
 * The surrounding whitespace matters: Ketcher lays out some labels with leading or trailing
 * spaces, and replacing the trimmed text alone would collapse them.
 */
export function translateKetcherPhrase(source: string, language: Language): string {
  if (language === "en-US" || !source.trim()) return source;
  const target = language === "zh-CN" ? "zh" : "ja";
  const leading = source.match(/^\s*/)?.[0] ?? "";
  const trailing = source.match(/\s*$/)?.[0] ?? "";
  const content = source.slice(leading.length, source.length - trailing.length || undefined);
  const exact = phrases[content]?.[target];
  return exact ? `${leading}${exact}${trailing}` : source;
}

/** How many phrases the table carries. Used by the coverage test. */
export function ketcherPhraseCount() {
  return Object.keys(phrases).length;
}
