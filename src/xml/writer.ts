/**
 * Tiny XML writer. CII is order-sensitive, so the builder composes explicit
 * element trees instead of serialising objects (where key order is a hazard).
 */
export interface XmlNode {
  name: string;
  attrs?: Record<string, string>;
  children?: (XmlNode | undefined)[];
  text?: string;
}

export function el(
  name: string,
  attrsOrChildren?: Record<string, string> | (XmlNode | undefined)[] | string,
  childrenOrText?: (XmlNode | undefined)[] | string,
): XmlNode {
  const node: XmlNode = { name };
  if (typeof attrsOrChildren === 'string') node.text = attrsOrChildren;
  else if (Array.isArray(attrsOrChildren)) node.children = attrsOrChildren;
  else if (attrsOrChildren) node.attrs = attrsOrChildren;
  if (typeof childrenOrText === 'string') node.text = childrenOrText;
  else if (Array.isArray(childrenOrText)) node.children = childrenOrText;
  return node;
}

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function serialize(root: XmlNode): string {
  const out: string[] = ['<?xml version="1.0" encoding="UTF-8"?>'];
  writeNode(root, 0, out);
  return out.join('\n') + '\n';
}

function writeNode(node: XmlNode, depth: number, out: string[]): void {
  const pad = '  '.repeat(depth);
  const attrs = node.attrs
    ? Object.entries(node.attrs)
        .map(([k, v]) => ` ${k}="${escapeXml(v)}"`)
        .join('')
    : '';
  const children = node.children?.filter((c): c is XmlNode => c !== undefined) ?? [];
  if (children.length === 0 && node.text === undefined) {
    out.push(`${pad}<${node.name}${attrs}/>`);
    return;
  }
  if (children.length === 0) {
    out.push(`${pad}<${node.name}${attrs}>${escapeXml(node.text ?? '')}</${node.name}>`);
    return;
  }
  out.push(`${pad}<${node.name}${attrs}>`);
  for (const child of children) writeNode(child, depth + 1, out);
  out.push(`${pad}</${node.name}>`);
}
