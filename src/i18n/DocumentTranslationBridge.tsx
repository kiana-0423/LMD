import { useLayoutEffect } from "react";
import { useLanguage } from "./LanguageContext";
import { translateBusinessText } from "./businessTranslations";

const originalText = new WeakMap<Text, string>();
const lastAppliedText = new WeakMap<Text, string>();
const originalAttributes = new WeakMap<Element, Map<string, string>>();
const lastAppliedAttributes = new WeakMap<Element, Map<string, string>>();
const translatedAttributes = ["placeholder", "title", "aria-label"];

export default function DocumentTranslationBridge() {
  const { language } = useLanguage();

  useLayoutEffect(() => {
    let applying = false;

    const translateNode = (root: Node) => {
      if (root instanceof Text) {
        const parent = root.parentElement;
        if (!parent || ["SCRIPT", "STYLE", "CODE", "PRE"].includes(parent.tagName)) return;
        const current = root.nodeValue ?? "";
        if (!originalText.has(root) || (lastAppliedText.has(root) && current !== lastAppliedText.get(root))) {
          originalText.set(root, current);
        }
        const source = originalText.get(root) ?? "";
        const translated = translateBusinessText(source, language);
        if (root.nodeValue !== translated) root.nodeValue = translated;
        lastAppliedText.set(root, translated);
        return;
      }

      if (!(root instanceof Element || root instanceof DocumentFragment || root instanceof Document)) return;
      if (root instanceof Element) {
        let saved = originalAttributes.get(root);
        if (!saved) {
          saved = new Map();
          originalAttributes.set(root, saved);
        }
        let lastApplied = lastAppliedAttributes.get(root);
        if (!lastApplied) {
          lastApplied = new Map();
          lastAppliedAttributes.set(root, lastApplied);
        }
        for (const attribute of translatedAttributes) {
          const current = root.getAttribute(attribute);
          if (
            current !== null &&
            (!saved.has(attribute) || (lastApplied.has(attribute) && current !== lastApplied.get(attribute)))
          ) {
            saved.set(attribute, current);
          }
          const source = saved.get(attribute);
          if (source !== undefined) {
            const translated = translateBusinessText(source, language);
            if (root.getAttribute(attribute) !== translated) root.setAttribute(attribute, translated);
            lastApplied.set(attribute, translated);
          }
        }
      }

      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
      let child = walker.nextNode();
      while (child) {
        if (child instanceof Text) {
          const parent = child.parentElement;
          if (parent && !["SCRIPT", "STYLE", "CODE", "PRE"].includes(parent.tagName)) {
            const current = child.nodeValue ?? "";
            if (!originalText.has(child) || (lastAppliedText.has(child) && current !== lastAppliedText.get(child))) {
              originalText.set(child, current);
            }
            const source = originalText.get(child) ?? "";
            const translated = translateBusinessText(source, language);
            if (child.nodeValue !== translated) child.nodeValue = translated;
            lastAppliedText.set(child, translated);
          }
        } else if (child instanceof Element) {
          let saved = originalAttributes.get(child);
          if (!saved) {
            saved = new Map();
            originalAttributes.set(child, saved);
          }
          let lastApplied = lastAppliedAttributes.get(child);
          if (!lastApplied) {
            lastApplied = new Map();
            lastAppliedAttributes.set(child, lastApplied);
          }
          for (const attribute of translatedAttributes) {
            const current = child.getAttribute(attribute);
            if (
              current !== null &&
              (!saved.has(attribute) || (lastApplied.has(attribute) && current !== lastApplied.get(attribute)))
            ) {
              saved.set(attribute, current);
            }
            const source = saved.get(attribute);
            if (source !== undefined) {
              const translated = translateBusinessText(source, language);
              if (child.getAttribute(attribute) !== translated) child.setAttribute(attribute, translated);
              lastApplied.set(attribute, translated);
            }
          }
        }
        child = walker.nextNode();
      }
    };

    applying = true;
    translateNode(document.body);
    applying = false;

    const observer = new MutationObserver((mutations) => {
      if (applying) return;
      applying = true;
      for (const mutation of mutations) {
        if (mutation.type === "characterData" || mutation.type === "attributes") translateNode(mutation.target);
        for (const node of mutation.addedNodes) translateNode(node);
      }
      applying = false;
    });
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: translatedAttributes
    });
    return () => observer.disconnect();
  }, [language]);

  return null;
}
