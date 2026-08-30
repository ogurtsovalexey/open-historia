/*! Open Historia — static-pack UI translator © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */

// Translates the game into the player's language using the checked-in
// language pack (public/lang/<code>.json), never a model call. Two locales
// ship: English (the authored language, needs no translation) and Russian.
// A string with no pack entry stays in English — the gap is visible and
// fixed by adding the string to the pack, not papered over at runtime.
// See docs/canon/07-ai-boundary.md.
//
// 1. On boot, the server's language pack (which mirrors public/lang/) is
//    fetched once into a cache.
// 2. The DOM is scanned and every text node/attribute with a cache entry is
//    replaced. A MutationObserver keeps applying the cache to new DOM as it
//    appears, so panels open already translated with no English flash.

import {
  DEFAULT_LANGUAGE,
  getStoredLanguage,
  isRtlLanguage,
  syncLanguageFromServer,
} from "./i18n.js";
import { shouldTranslateUiText } from "./translationFilter.js";

const CACHE_PREFIX = "i18n_cache_";
const CACHE_LIMIT = 8000;
const SCAN_DEBOUNCE_MS = 350;
const TRANSLATED_ATTRIBUTES = ["placeholder", "title", "aria-label"];

// Elements whose text is user-authored, machine-formatted, or must stay
// verbatim. [data-no-translate] lets any component opt out explicitly.
// (<select> is NOT skipped — dropdown options are UI text too; the language
// picker itself opts out via data-no-translate.)
const SKIP_SELECTOR = "script, style, noscript, input, textarea, [contenteditable], [data-no-translate]";

let language = DEFAULT_LANGUAGE;
let cache = new Map();
let translatedValues = new Set();
let stopped = false;
let observer = null;
let scanTimer = null;
let persistTimer = null;
let updatedEventTimer = null;
// node → the source (English) string we last saw there, so re-renders that
// restore English are re-translated and our own writes are recognized.
const nodeSources = new WeakMap();

const cacheKey = () => `${CACHE_PREFIX}${language}`;

// Lets map-label builders re-render once the pack has (newly) landed in the cache.
const announceUpdate = () => {
  clearTimeout(updatedEventTimer);
  updatedEventTimer = setTimeout(() => {
    window.dispatchEvent(new Event("i18n:updated"));
  }, 800);
};

const loadCache = () => {
  try {
    const raw = localStorage.getItem(cacheKey());
    cache = new Map(Object.entries(raw ? JSON.parse(raw) : {}));
    translatedValues = new Set(cache.values());
  } catch {
    cache = new Map();
    translatedValues = new Set();
  }
};

const persistCache = () => {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    try {
      const entries = Array.from(cache.entries()).slice(-CACHE_LIMIT);
      localStorage.setItem(cacheKey(), JSON.stringify(Object.fromEntries(entries)));
    } catch {
      // Storage full/blocked: translations still work for this session.
    }
  }, 1500);
};

// ---- string filters & application ----

// Only strings with real words need translating; glyphs, numbers, dates-only
// fragments and emoji stay as-is. The authored language is English, so
// requiring two Latin letters is a safe "has words" test.
const isTranslatable = (text) => {
  return shouldTranslateUiText(text, language, translatedValues);
};

const applyToTextNode = (node, translated) => {
  const leading = node.nodeValue.match(/^\s*/)[0];
  const trailing = node.nodeValue.match(/\s*$/)[0];
  node.nodeValue = leading + translated + trailing;
};

const visitTextNode = (node) => {
  const value = node.nodeValue ?? "";
  const trimmed = value.trim();
  if (!trimmed) {
    return;
  }

  const known = nodeSources.get(node);
  // Our own write, or a source we already saw — nothing new to do
  // (translated values usually fail isTranslatable's English test anyway,
  // but Latin-script languages need the exact-match check).
  if (known && (trimmed === (cache.get(known.source) ?? "").trim() || trimmed === known.source)) {
    if (trimmed === known.source) {
      const translated = cache.get(known.source);
      if (translated && translated !== known.source) {
        applyToTextNode(node, translated);
      }
    }
    return;
  }

  if (!isTranslatable(trimmed)) {
    return;
  }

  nodeSources.set(node, { source: trimmed });
  const translated = cache.get(trimmed);
  if (translated && translated !== trimmed) {
    applyToTextNode(node, translated);
  }
};

const visitElementAttributes = (element) => {
  for (const attr of TRANSLATED_ATTRIBUTES) {
    const value = element.getAttribute(attr);
    if (!value || !isTranslatable(value)) {
      continue;
    }

    const translated = cache.get(value.trim());
    if (translated && translated !== value.trim()) {
      element.setAttribute(attr, translated);
    }
  }
};

const skippedByAncestors = (element) =>
  Boolean(element && element.closest(SKIP_SELECTOR) && !element.matches("input, textarea"));

const walkSubtree = (root) => {
  if (!root) return;
  if (root.nodeType === Node.TEXT_NODE) {
    if (root.parentElement && !root.parentElement.closest(SKIP_SELECTOR)) {
      visitTextNode(root);
    }
    return;
  }
  if (root.nodeType !== Node.ELEMENT_NODE) return;

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) =>
      node.parentElement && !node.parentElement.closest(SKIP_SELECTOR)
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_REJECT,
  });
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    visitTextNode(node);
  }

  const attrSelector = TRANSLATED_ATTRIBUTES.map((attr) => `[${attr}]`).join(",");
  const withAttrs = root.matches?.(attrSelector) ? [root] : [];
  for (const element of [...withAttrs, ...(root.querySelectorAll?.(attrSelector) ?? [])]) {
    if (!skippedByAncestors(element) || element.matches("input, textarea")) {
      if (!element.closest("[data-no-translate]")) {
        visitElementAttributes(element);
      }
    }
  }
};

const scan = () => {
  if (stopped || !document.body) {
    return;
  }

  walkSubtree(document.body);

  const title = document.title.trim();
  if (title && isTranslatable(title)) {
    const translatedTitle = cache.get(title);
    if (translatedTitle && translatedTitle !== title) {
      document.title = translatedTitle;
    }
  }
};

const scheduleScan = () => {
  if (stopped) {
    return;
  }

  clearTimeout(scanTimer);
  scanTimer = setTimeout(scan, SCAN_DEBOUNCE_MS);
};

// Mutations apply the cache SYNCHRONOUSLY so new panels open translated
// instead of flashing English.
const handleMutations = (mutations) => {
  if (stopped) return;
  for (const mutation of mutations) {
    if (mutation.type === "characterData") {
      const parent = mutation.target.parentElement;
      if (parent && !parent.closest(SKIP_SELECTOR)) {
        visitTextNode(mutation.target);
      }
    } else {
      for (const added of mutation.addedNodes) {
        walkSubtree(added);
      }
    }
  }
  scheduleScan();
};

// ---- public lookups (map labels, proactive callers) ----

let translatorActive = false;

// Synchronous best-effort translation for text drawn OUTSIDE the DOM (map
// country labels). Strings with no pack entry are returned unchanged.
export const translateLabel = (text) => {
  if (!translatorActive || typeof text !== "string") {
    return text;
  }
  const translated = cache.get(text.trim());
  return translated || text;
};

// Kept for callers that pre-warm strings that may not be rendered yet (e.g.
// freshly fetched Community-hub posts). Translations only ever come from the
// checked-in pack, already loaded into the cache, so there is nothing to
// fetch here — this is a no-op kept for API compatibility.
export const enqueueStrings = () => {};

// Kept for callers that pull human-readable fields out of written game
// content (player edits, freshly generated events/polities). Same as
// enqueueStrings: the pack is static and already cached, so no-op.
export const enqueueContentStrings = () => {};

// ---- lifecycle ----

// Merge the server's language pack (mirrors the checked-in public/lang pack)
// into the local cache.
const loadServerPack = async () => {
  try {
    const response = await fetch(`/api/lang/${language}`);
    if (!response.ok) return;
    const pack = await response.json();
    for (const [source, translated] of Object.entries(pack ?? {})) {
      if (typeof source === "string" && typeof translated === "string" && !cache.has(source)) {
        cache.set(source, translated);
        translatedValues.add(translated);
      }
    }
    persistCache();
  } catch {
    // Old server / offline: the localStorage cache still applies.
  }
};

// Translation must NEVER interfere with game startup: wait until the loading
// screen is gone (or a generous timeout) before touching the DOM at all.
const whenStartupScreenGone = () => new Promise((resolve) => {
  const startedAt = Date.now();
  const check = () => {
    if (!document.querySelector("[data-startup-screen]") || Date.now() - startedAt > 180000) {
      resolve();
    } else {
      setTimeout(check, 400);
    }
  };
  check();
});

export const startTranslator = () => {
  if (typeof document === "undefined") {
    return;
  }

  // The server's stored choice wins over this device's copy, so a language
  // picked on desktop applies in the Android app (and vice versa). Runs even
  // when this device thinks it's English — a fresh install has no local copy.
  void syncLanguageFromServer().then((changed) => {
    if (changed) {
      window.location.reload();
    }
  });

  language = getStoredLanguage();
  if (language === DEFAULT_LANGUAGE) {
    return;
  }

  document.documentElement.lang = language;
  if (isRtlLanguage(language)) {
    // Text direction only — flipping the whole HUD layout would fight the
    // fixed-position map UI, so panels stay put but text reads correctly.
    document.body.style.direction = "rtl";
  }

  loadCache();

  void (async () => {
    // Server pack first (cheap, instant), then wait out the loading screen.
    await loadServerPack();
    await whenStartupScreenGone();
    if (stopped) return;

    translatorActive = true;
    observer = new MutationObserver(handleMutations);
    observer.observe(document.body, {
      childList: true,
      characterData: true,
      subtree: true,
    });
    scan();
    announceUpdate();
  })();
};

export const stopTranslator = () => {
  stopped = true;
  observer?.disconnect();
  clearTimeout(scanTimer);
};
