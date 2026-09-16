/**
 * `multix_doc` — document conversion and file understanding.
 *
 * `convert` turns a document into Markdown. `analyze` and `extract` send files
 * to Gemini for description or structured extraction (for example "summarize
 * this video" or "pull the totals out of this PDF"). All three require
 * GEMINI_API_KEY.
 */

import { StringEnum } from "@earendil-works/pi-ai";
import { Type, type Static } from "typebox";
import { buildVariantArgs, CommonFields, defineMultixTool, type CommandVariant } from "./shared.js";

type Action = "convert" | "analyze" | "extract";

const parameters = Type.Object({
  action: StringEnum(["convert", "analyze", "extract"] as const, {
    description:
      "convert turns documents into Markdown. analyze describes or answers questions about files. extract pulls out structured data and requires prompt.",
  }),
  input: Type.Optional(
    Type.Array(Type.String(), {
      description: "Input files for action=convert, for example a PDF, DOCX, PPTX, or image. One array element per file.",
    }),
  ),
  files: Type.Optional(
    Type.Array(Type.String(), {
      description: "Input files for action=analyze or action=extract. One array element per file.",
    }),
  ),
  prompt: Type.Optional(
    Type.String({
      description:
        "Instruction for analyze or extract, for example \"Summarize this video\" or \"Return the invoice total as JSON\". Required for extract and for convert when you want to customize the conversion.",
    }),
  ),
  output: Type.Optional(
    Type.String({ description: "Write the result to this path instead of printing it to stdout." }),
  ),
  autoName: Type.Optional(
    Type.Boolean({
      description: "convert: derive the output filename from the input basename. Only valid with a single input file.",
    }),
  ),
  model: Type.Optional(Type.String({ description: "Gemini model id. Omit for the CLI default." })),
  format: Type.Optional(
    Type.String({ description: "analyze and extract: output format, one of text, json, csv, or markdown." }),
  ),
  ...CommonFields,
});

type DocParams = Static<typeof parameters>;

const VARIANTS: Record<Action, CommandVariant> = {
  convert: {
    command: ["doc", "convert"],
    flags: {
      input: "--input",
      output: "--output",
      autoName: "--auto-name",
      model: "--model",
      prompt: "--prompt",
    },
    variadic: ["input"],
    requireAny: ["input"],
    note: "convert takes document files such as PDF, DOCX, PPTX, or images.",
  },
  analyze: {
    command: ["gemini", "analyze"],
    flags: {
      files: "--files",
      prompt: "--prompt",
      model: "--model",
      format: "--format",
      output: "--output",
    },
    variadic: ["files"],
    requireAny: ["files"],
    note: "analyze reads files, not input.",
  },
  extract: {
    command: ["gemini", "extract"],
    flags: {
      files: "--files",
      prompt: "--prompt",
      model: "--model",
      format: "--format",
      output: "--output",
    },
    variadic: ["files"],
    requireAll: ["files", "prompt"],
    note: "extract reads files, not input, and needs an explicit prompt.",
  },
};

export function buildDocArgs(params: DocParams): string[] {
  return buildVariantArgs({
    toolName: "multix_doc",
    variantLabel: `${params.action === "convert" ? "doc" : "gemini"} ${params.action}`,
    variant: VARIANTS[params.action],
    params,
    extraKeys: ["action"],
  });
}

export const docTool = defineMultixTool({
  name: "multix_doc",
  label: "Multix Documents",
  description:
    "Convert documents such as PDF, DOCX, PPTX, and images to Markdown, and analyze or extract structured data from those files and media using Gemini through the multix CLI. Requires GEMINI_API_KEY. Results print to stdout unless output is set.",
  promptSnippet: "Convert documents to Markdown, and analyze or extract data from files",
  promptGuidelines: [
    "Use multix_doc with action convert when the user wants a PDF, DOCX, PPTX, or document image turned into Markdown or plain text.",
    "Use multix_doc with action analyze to answer questions about a file or a video, for example to summarize its contents.",
    "Use multix_doc with action extract and format json when the user wants structured fields pulled out of a document.",
  ],
  parameters,
  timeoutMs: 600_000,
  build: buildDocArgs,
});
