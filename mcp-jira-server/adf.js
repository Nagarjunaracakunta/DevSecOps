// Minimal Atlassian Document Format (ADF) -> plain text converter. Jira
// Cloud's REST API v3 returns descriptions/comments as an ADF node tree
// rather than a plain string; this handles the common node types well
// enough for display purposes (not a full ADF renderer).
function nodeToText(node) {
  if (!node) return "";
  if (node.type === "text") return node.text || "";
  if (node.type === "hardBreak") return "\n";
  const children = (node.content || []).map(nodeToText).join("");
  if (node.type === "paragraph") return `${children}\n`;
  if (node.type === "listItem") return `- ${children}`;
  if (node.type === "codeBlock") return `\`\`\`\n${children}\n\`\`\`\n`;
  return children;
}

export function adfToText(doc) {
  if (!doc) return "";
  if (typeof doc === "string") return doc;
  if (!doc.content) return "";
  return doc.content
    .map(nodeToText)
    .join("\n")
    .trim();
}
