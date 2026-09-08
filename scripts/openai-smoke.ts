import { extractProcess, transcribeAudio } from "../ai/openai.server";

if (process.env.REAL_OPENAI_SMOKE !== "1")
  throw new Error(
    "Refusing real provider traffic. Set REAL_OPENAI_SMOKE=1 explicitly.",
  );
const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey)
  throw new Error("OPENAI_API_KEY is required for the opt-in smoke check.");

const sampleRate = 8000;
const samples = 800;
const wav = new ArrayBuffer(44 + samples * 2);
const view = new DataView(wav);
const write = (offset: number, value: string) =>
  [...value].forEach((character, index) =>
    view.setUint8(offset + index, character.charCodeAt(0)),
  );
write(0, "RIFF");
view.setUint32(4, 36 + samples * 2, true);
write(8, "WAVEfmt ");
view.setUint32(16, 16, true);
view.setUint16(20, 1, true);
view.setUint16(22, 1, true);
view.setUint32(24, sampleRate, true);
view.setUint32(28, sampleRate * 2, true);
view.setUint16(32, 2, true);
view.setUint16(34, 16, true);
write(36, "data");
view.setUint32(40, samples * 2, true);

const transcription = await transcribeAudio(
  apiKey,
  new Blob([wav], { type: "audio/wav" }),
  "synthetic-silence.wav",
);
const extraction = await extractProcess(
  apiKey,
  [
    {
      kind: "text",
      text: "A request is received, reviewed, processed, and completed.",
    },
  ],
  "en",
);
console.log(
  JSON.stringify({
    transport: "direct",
    transcription_model: "gpt-transcribe",
    extraction_model: "gpt-5.6-terra",
    reasoning: "high",
    store: false,
    transcription_request_id_present: Boolean(transcription.responseId),
    extraction_response_id_present: Boolean(extraction.metadata.responseId),
    returned_model: extraction.metadata.returnedModel,
  }),
);
