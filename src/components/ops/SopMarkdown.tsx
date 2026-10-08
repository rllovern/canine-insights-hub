import ReactMarkdown from "react-markdown";
import { cn } from "@/lib/utils";

/** Renders SOP instructions. Links open in a new tab; raw HTML is not rendered. */
export function SopMarkdown({ source, className }: { source: string; className?: string }) {
  return (
    <div className={cn(
      "space-y-3 text-sm leading-relaxed text-foreground/90",
      "[&_h1]:text-lg [&_h1]:font-semibold [&_h2]:text-base [&_h2]:font-semibold [&_h3]:font-semibold",
      "[&_ol]:list-decimal [&_ol]:space-y-1.5 [&_ol]:pl-5 [&_ul]:list-disc [&_ul]:space-y-1.5 [&_ul]:pl-5",
      "[&_a]:font-medium [&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2",
      "[&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[12px]",
      "[&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-muted [&_pre]:p-3 [&_pre_code]:bg-transparent [&_pre_code]:p-0",
      "[&_blockquote]:border-l-2 [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground [&_img]:rounded-lg [&_img]:border",
      className,
    )}>
      <ReactMarkdown components={{ a: ({ node: _n, ...p }) => <a {...p} target="_blank" rel="noreferrer noopener" /> }}>{source}</ReactMarkdown>
    </div>
  );
}
