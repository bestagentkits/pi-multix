/**
 * `multix_audio` — speech synthesis, transcription, music, sound effects, and
 * voice cloning.
 *
 * Every action/provider pair is a row in `VARIANTS`, so supporting another
 * provider is a data change rather than a new code path. Each row mirrors one
 * multix subcommand exactly.
 */

import { StringEnum } from "@earendil-works/pi-ai";
import { Type, type Static } from "typebox";
import { buildVariantArgs, CommonFields, defineMultixTool, type CommandVariant } from "./shared.js";

type Provider = "openai" | "gemini" | "minimax" | "elevenlabs" | "cloudflare";
type Action = "tts" | "transcribe" | "music" | "sfx" | "clone";

const parameters = Type.Object({
  action: StringEnum(["tts", "transcribe", "music", "sfx", "clone"] as const, {
    description:
      "tts speaks text. transcribe converts audio or video to text. music composes music from lyrics or a prompt. sfx generates a sound effect. clone creates a reusable voice from audio samples.",
  }),
  provider: StringEnum(["openai", "gemini", "minimax", "elevenlabs", "cloudflare"] as const, {
    description:
      "Which provider to call. Not every provider supports every action: clone and sfx are elevenlabs-only, music is minimax or elevenlabs, and cloudflare only does tts.",
  }),
  text: Type.Optional(Type.String({ description: "Text to speak for tts, or the sound description for sfx." })),
  input: Type.Optional(
    Type.String({ description: "Audio or video file to transcribe (openai and elevenlabs). Local path or URL." }),
  ),
  files: Type.Optional(
    Type.Array(Type.String(), {
      description:
        "Audio or video file paths for gemini transcribe, or voice sample files for elevenlabs clone. One array element per file.",
    }),
  ),
  prompt: Type.Optional(
    Type.String({
      description:
        "Music description. For elevenlabs music this is the composition prompt, for minimax music the style, and for gemini transcribe it overrides the default transcription instruction.",
    }),
  ),
  lyrics: Type.Optional(Type.String({ description: "minimax generate-music: song lyrics." })),
  plan: Type.Optional(
    Type.String({
      description: "elevenlabs music: path to a composition plan JSON file, mutually exclusive with prompt.",
    }),
  ),
  name: Type.Optional(Type.String({ description: "elevenlabs clone: display name for the new voice." })),
  voice: Type.Optional(
    Type.String({
      description:
        "Voice id or name. Provider-specific; omit for the provider default. Gemini 3.8 tts and " +
        "flash-lite-tts accept the 30 prebuilt names (Zephyr, Puck, Kore, ...) plus custom voice_... " +
        "and voicekey_... ids.",
    }),
  ),
  model: Type.Optional(
    Type.String({
      description:
        "Provider model id, for example eleven_multilingual_v2 or music_v1. Gemini tts defaults to " +
        "gemini-3.8-flash-lite-tts; pass gemini-3.8-flash-tts for higher fidelity.",
    }),
  ),
  emotion: Type.Optional(
    Type.String({
      description: "minimax speech emotion: neutral, happy, sad, angry, fearful, disgusted, or surprised.",
    }),
  ),
  rate: Type.Optional(Type.Number({ description: "minimax speech rate, 0.5 to 2.0." })),
  instructions: Type.Optional(Type.String({ description: "openai tts: voice and style instructions." })),
  speaker: Type.Optional(
    Type.Array(Type.String(), {
      description:
        "gemini tts multi-speaker mapping in name:voice form. Repeat up to twice; using it switches to multi-speaker mode.",
    }),
  ),
  outputFormat: Type.Optional(
    Type.String({ description: "Container or codec for generated audio, for example mp3, wav, opus, or flac." }),
  ),
  format: Type.Optional(
    Type.String({
      description:
        "Output format. elevenlabs tts uses its own format ids; transcribe uses text, json, srt, or vtt; openai transcribe uses json, text, or diarized_json.",
    }),
  ),
  lang: Type.Optional(Type.String({ description: "cloudflare generate-speech: MeloTTS language code." })),
  language: Type.Optional(Type.String({ description: "ISO language code for transcription." })),
  languageCode: Type.Optional(
    Type.String({ description: "elevenlabs tts: ISO language code, for Flash, Turbo, and v3 models." }),
  ),
  diarize: Type.Optional(Type.Boolean({ description: "elevenlabs transcribe: label who spoke when." })),
  numSpeakers: Type.Optional(Type.Number({ description: "elevenlabs transcribe: hint for the speaker count." })),
  tagAudioEvents: Type.Optional(
    Type.Boolean({ description: "elevenlabs transcribe: tag laughter, applause, and similar events." }),
  ),
  timestampsGranularity: Type.Optional(
    Type.String({ description: "elevenlabs transcribe: none, word, or character." }),
  ),
  chunkingStrategy: Type.Optional(
    Type.String({ description: "openai transcribe: chunking strategy, for example auto." }),
  ),
  knownSpeakerName: Type.Optional(
    Type.Array(Type.String(), {
      description: "openai transcribe: known speaker name, one array element per speaker.",
    }),
  ),
  knownSpeakerReference: Type.Optional(
    Type.Array(Type.String(), {
      description: "openai transcribe: 2 to 10 second reference audio files, one array element per speaker.",
    }),
  ),
  stability: Type.Optional(Type.Number({ description: "elevenlabs tts: voice stability 0..1." })),
  similarityBoost: Type.Optional(Type.Number({ description: "elevenlabs tts: voice similarity boost 0..1." })),
  style: Type.Optional(
    Type.Union([Type.Number(), Type.String()], {
      description:
        "elevenlabs tts: style exaggeration 0..1. gemini tts (3.8 models): a short performance " +
        'direction such as "cheerful and friendly", applied as speech_metadata; gemini reads text ' +
        "verbatim, so put delivery direction here, not in text.",
    }),
  ),
  seed: Type.Optional(Type.Number({ description: "elevenlabs tts: determinism seed." })),
  durationSeconds: Type.Optional(
    Type.Number({ description: "elevenlabs sfx: target duration, 0.5 to 30 seconds." }),
  ),
  promptInfluence: Type.Optional(Type.Number({ description: "elevenlabs sfx: prompt influence 0..1." })),
  loop: Type.Optional(Type.Boolean({ description: "elevenlabs sfx: produce a loop-friendly result." })),
  musicLengthMs: Type.Optional(
    Type.Number({ description: "elevenlabs music: total length in milliseconds, default 30000." }),
  ),
  audio: Type.Optional(
    Type.String({ description: "elevenlabs clone: a single sample file, as an alternative to files." }),
  ),
  description: Type.Optional(Type.String({ description: "elevenlabs clone: description of the new voice." })),
  labels: Type.Optional(
    Type.String({ description: 'elevenlabs clone: JSON object of labels, for example {"accent":"american"}.' }),
  ),
  removeBackgroundNoise: Type.Optional(
    Type.Boolean({ description: "elevenlabs clone: server-side noise removal on the samples." }),
  ),
  output: Type.Optional(Type.String({ description: "Copy the primary output to this path." })),
  ...CommonFields,
});

type AudioParams = Static<typeof parameters>;

/** action → provider → the multix subcommand it maps to. */
const VARIANTS: Record<Action, Partial<Record<Provider, CommandVariant>>> = {
  tts: {
    openai: {
      command: ["generate-speech"],
      flags: {
        text: "--text",
        model: "--model",
        voice: "--voice",
        instructions: "--instructions",
        outputFormat: "--output-format",
        output: "--output",
      },
      requireAny: ["text"],
    },
    gemini: {
      command: ["generate-speech"],
      flags: {
        text: "--text",
        model: "--model",
        voice: "--voice",
        speaker: "--speaker",
        style: "--style",
        outputFormat: "--output-format",
        output: "--output",
      },
      requireAny: ["text"],
    },
    minimax: {
      command: ["generate-speech"],
      flags: {
        text: "--text",
        model: "--model",
        voice: "--voice",
        emotion: "--emotion",
        outputFormat: "--output-format",
        rate: "--rate",
        output: "--output",
      },
      requireAny: ["text"],
    },
    elevenlabs: {
      command: ["tts"],
      flags: {
        text: "--text",
        voice: "--voice",
        model: "--model",
        format: "--format",
        stability: "--stability",
        similarityBoost: "--similarity-boost",
        style: "--style",
        languageCode: "--language-code",
        seed: "--seed",
        output: "--output",
      },
      requireAny: ["text"],
    },
    cloudflare: {
      command: ["generate-speech"],
      flags: {
        text: "--text",
        lang: "--lang",
        model: "--model",
        output: "--output",
      },
      requireAny: ["text"],
    },
  },
  transcribe: {
    openai: {
      command: ["transcribe"],
      flags: {
        input: "--input",
        model: "--model",
        format: "--format",
        language: "--language",
        chunkingStrategy: "--chunking-strategy",
        knownSpeakerName: "--known-speaker-name",
        knownSpeakerReference: "--known-speaker-reference",
        output: "--output",
      },
      requireAny: ["input"],
    },
    elevenlabs: {
      command: ["transcribe"],
      flags: {
        input: "--input",
        model: "--model",
        language: "--language",
        diarize: "--diarize",
        numSpeakers: "--num-speakers",
        tagAudioEvents: "--tag-audio-events",
        timestampsGranularity: "--timestamps-granularity",
        format: "--format",
        output: "--output",
      },
      requireAny: ["input"],
    },
    gemini: {
      command: ["transcribe"],
      flags: {
        files: "--files",
        prompt: "--prompt",
        model: "--model",
        format: "--format",
        output: "--output",
      },
      variadic: ["files"],
      requireAny: ["files"],
      note: "gemini transcription reads files, not input.",
    },
  },
  music: {
    minimax: {
      command: ["generate-music"],
      flags: {
        lyrics: "--lyrics",
        prompt: "--prompt",
        model: "--model",
        outputFormat: "--output-format",
        output: "--output",
      },
      requireAny: ["lyrics", "prompt"],
    },
    elevenlabs: {
      command: ["music"],
      flags: {
        prompt: "--prompt",
        plan: "--plan",
        musicLengthMs: "--music-length-ms",
        model: "--model",
        format: "--format",
        output: "--output",
      },
      requireAny: ["prompt", "plan"],
    },
  },
  sfx: {
    elevenlabs: {
      command: ["sfx"],
      flags: {
        text: "--text",
        durationSeconds: "--duration-seconds",
        promptInfluence: "--prompt-influence",
        loop: "--loop",
        format: "--format",
        output: "--output",
      },
      requireAny: ["text"],
    },
  },
  clone: {
    elevenlabs: {
      command: ["clone"],
      flags: {
        name: "--name",
        files: "--files",
        audio: "--audio",
        description: "--description",
        labels: "--labels",
        removeBackgroundNoise: "--remove-background-noise",
      },
      variadic: ["files"],
      requireAll: ["name"],
      note: "Provide one to three minutes of clean sample audio in files or audio.",
    },
  },
};

export function buildAudioArgs(params: AudioParams): string[] {
  const variant = VARIANTS[params.action][params.provider];

  if (variant === undefined) {
    const available = Object.keys(VARIANTS[params.action]).join(", ");
    throw new Error(
      `multix_audio: action=${params.action} is not available for ${params.provider}. ` +
        `Providers supporting ${params.action}: ${available === "" ? "none" : available}.`,
    );
  }

  return buildVariantArgs({
    toolName: "multix_audio",
    variantLabel: `${params.provider} ${variant.command.join(" ")}`,
    variant,
    params,
    prefix: [params.provider],
    extraKeys: ["action", "provider"],
  });
}

export const audioTool = defineMultixTool({
  name: "multix_audio",
  label: "Multix Audio",
  description:
    "Speak text, transcribe audio or video, compose music, generate sound effects, or clone a voice using the multix CLI. Transcription prints to stdout unless output is set; generated audio is written under ./multix-output/. Requires the selected provider's API key.",
  promptSnippet: "Text-to-speech, transcription, music, sound effects, and voice cloning",
  promptGuidelines: [
    "Use multix_audio with action tts when the user wants text spoken aloud, and action transcribe when they want a transcript or subtitles for an audio or video file.",
    "Use multix_audio with action music or action sfx to generate audio that is not speech, and action clone to create a reusable voice from samples.",
    "For subtitles, use multix_audio with provider elevenlabs and format srt or vtt, because the default transcription output is plain text.",
  ],
  parameters,
  timeoutMs: 600_000,
  build: buildAudioArgs,
});
