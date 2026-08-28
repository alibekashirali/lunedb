import { createContext, useContext } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

// Tells <code> whether it's inside a <pre> block
const InPreContext = createContext(false);

// Strip outer ```markdown ... ``` or ``` ... ``` that some models add around the whole response
function unwrap(raw: string): string {
  const s = raw.trim();
  const m = s.match(/^```(?:markdown|md)?\n([\s\S]*?)\n?```\s*$/i);
  return m ? m[1] : s;
}

export function MarkdownRenderer({ content }: { content: string }) {
  if (!content) return null;
  const cleaned = unwrap(content);

  return (
    <div className="markdown-body">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{

          h1: ({ children }) => (
            <h1 className="text-base font-bold text-foreground mb-2 mt-5 first:mt-0 pb-1 border-b border-border/40">
              {children}
            </h1>
          ),
          h2: ({ children }) => (
            <h2 className="text-sm font-semibold text-foreground mb-1.5 mt-4 first:mt-0">
              {children}
            </h2>
          ),
          h3: ({ children }) => (
            <h3 className="text-sm font-medium text-foreground/90 mb-1 mt-3">
              {children}
            </h3>
          ),
          p: ({ children }) => (
            <p className="text-sm text-foreground/85 mb-2.5 leading-relaxed">
              {children}
            </p>
          ),
          ul: ({ children }) => (
            <ul className="text-sm text-foreground/85 mb-2.5 ml-4 space-y-1 list-disc marker:text-muted-foreground/50">
              {children}
            </ul>
          ),
          ol: ({ children }) => (
            <ol className="text-sm text-foreground/85 mb-2.5 ml-4 space-y-1 list-decimal marker:text-muted-foreground/50">
              {children}
            </ol>
          ),
          li: ({ children }) => (
            <li className="leading-relaxed pl-0.5">{children}</li>
          ),
          // pre wraps all fenced code blocks — provide the outer container
          pre: ({ children }) => (
            <InPreContext.Provider value={true}>
              <pre className="my-2.5 bg-muted/40 border border-border/50 rounded-lg overflow-hidden">
                {children}
              </pre>
            </InPreContext.Provider>
          ),
          // code is used for both inline (`code`) and fenced blocks (inside pre)
          code: ({ className, children }) => {
            // eslint-disable-next-line react-hooks/rules-of-hooks
            const insidePre = useContext(InPreContext);
            if (insidePre) {
              const lang = className?.replace(/^language-/, "");
              return (
                <>
                  {lang && (
                    <div className="px-3 py-1 bg-muted/60 border-b border-border/40 text-[10px] font-mono text-muted-foreground uppercase tracking-wider">
                      {lang}
                    </div>
                  )}
                  <code className="block p-3 overflow-x-auto text-xs font-mono text-foreground/90 whitespace-pre leading-relaxed">
                    {children}
                  </code>
                </>
              );
            }
            // Inline code
            return (
              <code className="bg-muted/70 border border-border/40 px-1.5 py-0.5 rounded text-[12px] font-mono text-primary/90">
                {children}
              </code>
            );
          },
          blockquote: ({ children }) => (
            <blockquote className="border-l-2 border-primary/40 pl-3 my-2 text-sm text-muted-foreground/80 italic">
              {children}
            </blockquote>
          ),
          strong: ({ children }) => (
            <strong className="font-semibold text-foreground">{children}</strong>
          ),
          em: ({ children }) => (
            <em className="italic text-foreground/80">{children}</em>
          ),
          hr: () => <hr className="my-3 border-border/40" />,
          a: ({ href, children }) => (
            <a
              href={href}
              className="text-primary underline underline-offset-2 hover:text-primary/80 transition-colors"
              target="_blank"
              rel="noopener noreferrer"
            >
              {children}
            </a>
          ),
          table: ({ children }) => (
            <div className="my-2.5 overflow-x-auto rounded-lg border border-border/50">
              <table className="w-full text-xs border-collapse">{children}</table>
            </div>
          ),
          thead: ({ children }) => (
            <thead className="bg-muted/50">{children}</thead>
          ),
          th: ({ children }) => (
            <th className="px-3 py-2 text-left text-muted-foreground font-medium border-b border-border/50 whitespace-nowrap">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="px-3 py-2 text-foreground/85 border-b border-border/30 last:border-0">
              {children}
            </td>
          ),
        }}
      >
        {cleaned}
      </ReactMarkdown>
    </div>
  );
}
