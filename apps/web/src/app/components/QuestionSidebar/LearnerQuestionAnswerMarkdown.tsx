"use client";

import type { Components } from "react-markdown";
import ReactMarkdown from "react-markdown";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";

const markdownComponents: Components = {
  h1: ({ children }) => (
    <h3 className="text-[14px] font-semibold text-[#0D4433] mt-3 mb-1.5 first:mt-0">{children}</h3>
  ),
  h2: ({ children }) => (
    <h3 className="text-[14px] font-semibold text-[#0D4433] mt-3 mb-1.5 first:mt-0">{children}</h3>
  ),
  h3: ({ children }) => (
    <h4 className="text-[13px] font-semibold text-[#0D4433] mt-2.5 mb-1 first:mt-0">{children}</h4>
  ),
  p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
  strong: ({ children }) => <strong className="font-semibold text-[#0D4433]">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  ul: ({ children }) => <ul className="list-disc pl-5 my-2 space-y-1">{children}</ul>,
  ol: ({ children }) => <ol className="list-decimal pl-5 my-2 space-y-1">{children}</ol>,
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  pre: ({ children }) => (
    <pre className="rounded-lg bg-[#f3f4f6] p-3 text-[12px] text-gray-800 overflow-x-auto my-2 whitespace-pre-wrap break-words">
      {children}
    </pre>
  ),
  code: ({ className, children, ...props }) => {
    const isBlock = className != null && className.length > 0;
    if (isBlock) {
      return (
        <code className="font-mono text-[12px]" {...props}>
          {children}
        </code>
      );
    }
    return (
      <code className="rounded bg-[#f3f4f6] px-1 py-0.5 text-[12px]" {...props}>
        {children}
      </code>
    );
  },
};

export interface LearnerQuestionAnswerMarkdownProps {
  /** Model output; may be a partial chunk while streaming. */
  children: string;
}

/**
 * Renders learner-question assistant text as sanitized Markdown (bold, headings, lists).
 */
export const LearnerQuestionAnswerMarkdown = ({
  children,
}: LearnerQuestionAnswerMarkdownProps): JSX.Element => (
  <div className="learner-question-md text-[13px] text-[#0D4433] leading-relaxed">
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[rehypeSanitize]}
      components={markdownComponents}
    >
      {children || "\u00a0"}
    </ReactMarkdown>
  </div>
);
