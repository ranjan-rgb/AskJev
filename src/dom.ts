export type DomAction =
  | "CLICK"
  | "TYPE_TEXT"
  | "SELECT"
  | "SCROLL_DOWN"
  | "SCROLL_UP"
  | "WAIT"
  | "DONE"
  | "BLOCKED";

export interface DomElement {
  id: number;
  tag: string;
  role: string;
  name: string;
  value: string;
  href: string;
  type: string;
}

const INTERACTIVE =
  'a[href], button, input, select, textarea, [role="button"], [role="link"], [role="tab"], [role="menuitem"], [onclick]';

export function snapshotElements(limit = 80): DomElement[] {
  const nodes = Array.from(document.querySelectorAll(INTERACTIVE));
  const out: DomElement[] = [];
  let id = 1;
  for (const el of nodes) {
    if (!(el instanceof HTMLElement)) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) continue;
    if (rect.bottom < 0 || rect.top > window.innerHeight) continue;
    const style = window.getComputedStyle(el);
    if (style.visibility === "hidden" || style.display === "none") continue;

    const name = (
      el.getAttribute("aria-label") ||
      el.getAttribute("placeholder") ||
      el.getAttribute("title") ||
      (el instanceof HTMLInputElement ? el.value : "") ||
      el.innerText ||
      el.textContent ||
      ""
    )
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 120);

    out.push({
      id,
      tag: el.tagName.toLowerCase(),
      role: el.getAttribute("role") || "",
      name,
      value:
        el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement
          ? String(el.value || "").slice(0, 80)
          : "",
      href: el instanceof HTMLAnchorElement ? el.href.slice(0, 200) : "",
      type: el instanceof HTMLInputElement ? el.type : "",
    });
    el.dataset.askjevId = String(id);
    id += 1;
    if (out.length >= limit) break;
  }
  return out;
}

export function clearAskjevIds(): void {
  document.querySelectorAll("[data-askjev-id]").forEach((el) => {
    delete (el as HTMLElement).dataset.askjevId;
  });
}

export function findByAskjevId(id: number): HTMLElement | null {
  return document.querySelector(`[data-askjev-id="${id}"]`);
}

export async function executeAction(input: {
  action: DomAction;
  targetId?: number;
  text?: string;
}): Promise<{ ok: boolean; detail: string }> {
  const { action, targetId, text } = input;
  if (action === "DONE") return { ok: true, detail: "done" };
  if (action === "BLOCKED") return { ok: false, detail: "blocked by jev" };
  if (action === "WAIT") {
    await new Promise((r) => setTimeout(r, 800));
    return { ok: true, detail: "waited" };
  }
  if (action === "SCROLL_DOWN") {
    window.scrollBy(0, Math.floor(window.innerHeight * 0.8));
    return { ok: true, detail: "scrolled down" };
  }
  if (action === "SCROLL_UP") {
    window.scrollBy(0, -Math.floor(window.innerHeight * 0.8));
    return { ok: true, detail: "scrolled up" };
  }

  if (targetId == null) return { ok: false, detail: "missing target" };
  const el = findByAskjevId(targetId);
  if (!el) return { ok: false, detail: `element ${targetId} gone` };

  el.scrollIntoView({ block: "center", behavior: "smooth" });
  await new Promise((r) => setTimeout(r, 200));

  if (action === "CLICK") {
    el.click();
    return { ok: true, detail: `clicked #${targetId}` };
  }
  if (action === "TYPE_TEXT") {
    const value = text ?? "";
    if (
      el instanceof HTMLInputElement ||
      el instanceof HTMLTextAreaElement
    ) {
      el.focus();
      el.value = value;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return { ok: true, detail: `typed into #${targetId}` };
    }
    el.focus();
    return { ok: false, detail: "target not typable" };
  }
  if (action === "SELECT") {
    if (el instanceof HTMLSelectElement) {
      // pick first non-empty option matching text if provided
      if (text) {
        const opt = Array.from(el.options).find((o) =>
          o.text.toLowerCase().includes(text.toLowerCase()),
        );
        if (opt) el.value = opt.value;
      }
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return { ok: true, detail: `selected #${targetId}` };
    }
    return { ok: false, detail: "not a select" };
  }
  return { ok: false, detail: `unknown action ${action}` };
}

export function formatSnapshotForJev(
  goal: string,
  elements: DomElement[],
): string {
  const lines = elements.map(
    (e) =>
      `#${e.id} <${e.tag}${e.type ? ` type=${e.type}` : ""}${e.role ? ` role=${e.role}` : ""}> name="${e.name}" value="${e.value}" href="${e.href}"`,
  );
  return [
    `goal: ${goal}`,
    `url: ${location.href}`,
    `title: ${document.title}`,
    `visible_elements:`,
    ...lines,
  ].join("\n");
}
