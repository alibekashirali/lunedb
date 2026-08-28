import { Bold, Italic, Code, List, Minus, Quote } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  value: string;
  onChange: (v: string) => void;
}

export function MarkdownToolbar({ textareaRef, value, onChange }: Props) {
  const insertWrap = (syntax: string) => {
    const el = textareaRef.current;
    if (!el) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const selected = value.slice(start, end);
    let newText: string;
    let cursor: number;
    if (selected) {
      newText = value.slice(0, start) + syntax + selected + syntax + value.slice(end);
      cursor = start + syntax.length + selected.length + syntax.length;
    } else {
      newText = value.slice(0, start) + syntax + syntax + value.slice(end);
      cursor = start + syntax.length;
    }
    onChange(newText);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(cursor, cursor);
    });
  };

  const insertPrefix = (prefix: string) => {
    const el = textareaRef.current;
    if (!el) return;
    const start = el.selectionStart;
    const lineStart = value.lastIndexOf("\n", start - 1) + 1;
    const newText = value.slice(0, lineStart) + prefix + value.slice(lineStart);
    const cursor = start + prefix.length;
    onChange(newText);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(cursor, cursor);
    });
  };

  const insertBlock = (text: string) => {
    const el = textareaRef.current;
    if (!el) return;
    const start = el.selectionStart;
    const newText = value.slice(0, start) + text + value.slice(start);
    const cursor = start + text.length;
    onChange(newText);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(cursor, cursor);
    });
  };

  return (
    <div className="flex items-center gap-0.5 px-2 py-1.5 border-b border-border bg-muted/30 flex-wrap">
      <Btn title="Heading 1" onClick={() => insertPrefix("# ")}>H1</Btn>
      <Btn title="Heading 2" onClick={() => insertPrefix("## ")}>H2</Btn>
      <Btn title="Heading 3" onClick={() => insertPrefix("### ")}>H3</Btn>
      <Sep />
      <Btn title="Bold" onClick={() => insertWrap("**")}><Bold className="h-3 w-3" /></Btn>
      <Btn title="Italic" onClick={() => insertWrap("_")}><Italic className="h-3 w-3" /></Btn>
      <Btn title="Inline code" onClick={() => insertWrap("`")}><Code className="h-3 w-3" /></Btn>
      <Sep />
      <Btn title="Bullet list" onClick={() => insertPrefix("- ")}><List className="h-3 w-3" /></Btn>
      <Btn title="Blockquote" onClick={() => insertPrefix("> ")}><Quote className="h-3 w-3" /></Btn>
      <Btn title="Divider" onClick={() => insertBlock("\n\n---\n\n")}><Minus className="h-3 w-3" /></Btn>
    </div>
  );
}

function Btn({ children, title, onClick }: { children: React.ReactNode; title: string; onClick: () => void }) {
  return (
    <button
      type="button"
      title={title}
      onMouseDown={(e) => { e.preventDefault(); onClick(); }}
      className={cn(
        "px-1.5 py-0.5 rounded text-[11px] font-medium text-muted-foreground",
        "hover:text-foreground hover:bg-accent transition-colors"
      )}
    >
      {children}
    </button>
  );
}

function Sep() {
  return <div className="w-px h-3.5 bg-border mx-1 shrink-0" />;
}
