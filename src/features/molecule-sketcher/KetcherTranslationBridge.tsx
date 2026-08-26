import { useLayoutEffect } from "react";
import { useLanguage } from "../../i18n/LanguageContext";
import { translateKetcherPhrase } from "./ketcherPhrases";

/**
 * Translates the one part of the interface LMD does not render.
 *
 * It lives here, beside the sketcher, rather than at the application root. Mounting it globally
 * meant every screen carried a `MutationObserver` and the whole phrase table, for a bridge that
 * only ever had one root to observe — and it put the table in the initial bundle, where it was
 * downloaded by users who never open the editor.
 */

const originalText = new WeakMap<Text, string>();
const lastAppliedText = new WeakMap<Text, string>();
const originalAttributes = new WeakMap<Element, Map<string, string>>();
const lastAppliedAttributes = new WeakMap<Element, Map<string, string>>();
const translatedAttributes = ["placeholder", "title", "aria-label"];
const skipSelector = '[data-i18n-skip], [translate="no"]';
const untranslatedTags = ["SCRIPT", "STYLE", "CODE", "PRE"];

export default function KetcherTranslationBridge() {
  const { language } = useLanguage();

  useLayoutEffect(() => {
    // The bridge exists for one thing only: Ketcher's own chrome, which is rendered outside React
    // by a third-party bundle and so cannot be given translation keys. Every string LMD itself
    // renders goes through the key catalogue in LanguageContext, and the audit in
    // scripts/audit-untranslated.mjs fails the build if a new one does not.
    const roots = Array.from(document.querySelectorAll<HTMLElement>("[data-i18n-ketcher]"));
    if (roots.length === 0) return undefined;

    const translateTextNode = (node: Text) => {
      const parent = node.parentElement;
      if (!parent || untranslatedTags.includes(parent.tagName)) return;
      const current = node.nodeValue ?? "";
      if (!originalText.has(node) || (lastAppliedText.has(node) && current !== lastAppliedText.get(node))) {
        originalText.set(node, current);
      }
      const translated = translateKetcherPhrase(originalText.get(node) ?? "", language);
      if (node.nodeValue !== translated) node.nodeValue = translated;
      lastAppliedText.set(node, translated);
    };

    const translateAttributes = (element: Element) => {
      let saved = originalAttributes.get(element);
      if (!saved) {
        saved = new Map();
        originalAttributes.set(element, saved);
      }
      let lastApplied = lastAppliedAttributes.get(element);
      if (!lastApplied) {
        lastApplied = new Map();
        lastAppliedAttributes.set(element, lastApplied);
      }
      for (const attribute of translatedAttributes) {
        const current = element.getAttribute(attribute);
        if (
          current !== null &&
          (!saved.has(attribute) || (lastApplied.has(attribute) && current !== lastApplied.get(attribute)))
        ) {
          saved.set(attribute, current);
        }
        const source = saved.get(attribute);
        if (source === undefined) continue;
        const translated = translateKetcherPhrase(source, language);
        if (element.getAttribute(attribute) !== translated) element.setAttribute(attribute, translated);
        lastApplied.set(attribute, translated);
      }
    };

    // Rejecting a marked element skips its whole subtree while the walk continues past it.
    // Advancing manually with nextSibling() instead would end the walk whenever a marked
    // element happens to be the last child of its parent.
    const skipMarkedSubtrees: NodeFilter = {
      acceptNode: (node) =>
        node instanceof Element && node.matches(skipSelector)
          ? NodeFilter.FILTER_REJECT
          : NodeFilter.FILTER_ACCEPT
    };

    const translateNode = (root: Node) => {
      const rootElement = root instanceof Element ? root : root.parentElement;
      if (rootElement?.closest(skipSelector)) return;
      if (root instanceof Text) {
        translateTextNode(root);
        return;
      }
      if (!(root instanceof Element || root instanceof DocumentFragment || root instanceof Document)) return;
      if (root instanceof Element) translateAttributes(root);

      const walker = document.createTreeWalker(
        root,
        NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT,
        skipMarkedSubtrees
      );
      for (let child = walker.nextNode(); child; child = walker.nextNode()) {
        if (child instanceof Text) translateTextNode(child);
        else if (child instanceof Element) translateAttributes(child);
      }
    };

    roots.forEach(translateNode);

    const observer = new MutationObserver((mutations) => {
      observer.disconnect();
      for (const mutation of mutations) {
        if (mutation.type === "characterData" || mutation.type === "attributes") translateNode(mutation.target);
        for (const node of mutation.addedNodes) translateNode(node);
      }
      observe();
    });
    const observe = () =>
      roots.forEach((root) =>
        observer.observe(root, {
          childList: true,
          subtree: true,
          characterData: true,
          attributes: true,
          attributeFilter: translatedAttributes
        })
      );
    observe();
    return () => observer.disconnect();
  }, [language]);

  return null;
}
