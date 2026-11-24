import { createElement, useMemo, type ReactNode } from "react";
import type { GlossaryItem, GlossaryNode } from "./yomitan";

const ALLOWED_TAGS = new Set(["div", "p", "span", "br", "ol", "ul", "li", "table", "thead", "tbody",
  "tfoot", "tr", "td", "th", "ruby", "rt", "rp", "b", "i", "u", "strong", "em", "s", "sub", "sup",
  "dl", "dt", "dd"]);
const CSS_VALUE = /^[a-zA-Z0-9 #%.,'"~/-]*$/;

// 词典 style 对象转成唯一类名，规则注入同级 <style>；规避内联样式。
function styleClassName(style: Record<string, unknown>, registry: Map<string, string>): string {
  const rules: string[] = [];
  for (const [key, value] of Object.entries(style)) {
    const prop = key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
    if (!/^-?[a-z][a-z0-9-]*$/.test(prop)) continue;
    const text = (Array.isArray(value) ? value.join(" ") : String(value)).trim();
    if (!text || !CSS_VALUE.test(text)) continue;
    rules.push(`${prop}:${text}`);
  }
  const css = rules.join(";");
  if (!css) return "";
  const name = `mn-s${[...css].reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) >>> 0, 7).toString(36)}`;
  registry.set(name, `.${name}{${css}}`);
  return name;
}

function renderNode(node: GlossaryItem, key: string, registry: Map<string, string>): ReactNode {
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map((child, index) => renderNode(child, `${key}-${index}`, registry));
  if (!node || typeof node !== "object") return null;
  const item = node as GlossaryNode;
  if (item.type === "image") return item.alt ? createElement("span", { key, className: "mn-alt" }, item.alt) : null;
  if (typeof item.text === "string" && (item.type === "text" || !item.tag)) return item.text;
  const tag = typeof item.tag === "string" && ALLOWED_TAGS.has(item.tag) ? item.tag : "span";
  const props: Record<string, unknown> = { key };
  const classes: string[] = [];
  for (const [name, value] of Object.entries(item.data ?? {})) {
    if (name === "class" || name === "className") classes.push(String(value));
    else if (name === "lang" || name === "title") props[name] = String(value);
    else if (/^[a-z][a-z0-9-]*$/.test(name)) props[`data-${name}`] = String(value);
  }
  if (item.lang) props.lang = item.lang;
  if (tag === "td" || tag === "th") {
    if (Number.isInteger(item.colSpan)) props.colSpan = item.colSpan;
    if (Number.isInteger(item.rowSpan)) props.rowSpan = item.rowSpan;
  }
  if (item.style && typeof item.style === "object") {
    const styleClass = styleClassName(item.style, registry);
    if (styleClass) classes.push(styleClass);
  }
  if (classes.length) props["className"] = classes.join(" ");
  return createElement(tag, props, item.content !== undefined ? renderNode(item.content, `${key}-c`, registry) : null);
}

export function Glossary({ items }: { items: GlossaryItem[] }) {
  const { nodes, css } = useMemo(() => {
    const registry = new Map<string, string>();
    const rendered = items.map((item, index) =>
      typeof item === "string"
        ? createElement("p", { key: `g${index}`, className: "mn-def" }, item)
        : renderNode(item, `g${index}`, registry));
    return { nodes: rendered, css: [...registry.values()].join("\n") };
  }, [items]);
  return <div className="glossary">{css ? <style>{css}</style> : null}{nodes}</div>;
}
