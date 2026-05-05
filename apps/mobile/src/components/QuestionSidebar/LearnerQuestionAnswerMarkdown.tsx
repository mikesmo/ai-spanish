import Markdown from "react-native-markdown-display";
import type { StyleProp, TextStyle } from "react-native";
import { StyleSheet, Text, View } from "react-native";

const markdownStyles = StyleSheet.create({
  body: {
    color: "#0D4433",
    fontSize: 13,
    lineHeight: 20,
  },
  heading1: {
    fontSize: 15,
    fontWeight: "600",
    color: "#0D4433",
    marginTop: 10,
    marginBottom: 6,
  },
  heading2: {
    fontSize: 14,
    fontWeight: "600",
    color: "#0D4433",
    marginTop: 8,
    marginBottom: 4,
  },
  heading3: {
    fontSize: 13,
    fontWeight: "600",
    color: "#0D4433",
    marginTop: 6,
    marginBottom: 4,
  },
  paragraph: {
    marginTop: 0,
    marginBottom: 8,
    color: "#0D4433",
    fontSize: 13,
    lineHeight: 20,
  },
  strong: {
    fontWeight: "700",
    color: "#0D4433",
  },
  em: {
    fontStyle: "italic",
  },
  bullet_list: {
    marginVertical: 6,
  },
  ordered_list: {
    marginVertical: 6,
  },
  list_item: {
    marginVertical: 2,
    flexDirection: "row",
  },
  code_inline: {
    backgroundColor: "#f3f4f6",
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 4,
    fontSize: 12,
    color: "#111827",
  },
  fence: {
    backgroundColor: "#f3f4f6",
    padding: 10,
    borderRadius: 8,
    fontSize: 12,
    marginVertical: 8,
    color: "#111827",
  },
});

export interface LearnerQuestionAnswerMarkdownProps {
  children: string;
  isStreaming: boolean;
  streamingCursorStyle: StyleProp<TextStyle>;
}

/** Sanitized Markdown rendering for learner-question assistant replies. */
export const LearnerQuestionAnswerMarkdown = ({
  children,
  isStreaming,
  streamingCursorStyle,
}: LearnerQuestionAnswerMarkdownProps): JSX.Element => (
  <View>
    <Markdown style={markdownStyles}>{children || "\u00a0"}</Markdown>
    {isStreaming ? <Text style={streamingCursorStyle}> ▌</Text> : null}
  </View>
);
