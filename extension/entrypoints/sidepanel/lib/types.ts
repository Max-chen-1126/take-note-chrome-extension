export type Category = "youtube" | "article" | "coursera";
export type Mode = "concise" | "detailed";
export type Provider = "gemini" | "openai" | "claude";

export interface ExtractContent { title:string; url:string; text:string; metadata:Record<string,unknown>|null; }
export interface ExtractResult { ok:boolean; category:Category; content:ExtractContent; error:{code:string;message:string}|null; }

export interface NoteRequest {
  category:Category; methodology_id:string; mode:Mode; direction:string;
  extra_requirements?:string|null; provider:Provider; model?:string|null;
  web_search:boolean; content:ExtractContent;
}

export type StepName = "structure"|"draft"|"augment"|"verify"|"format";
export const STEP_LABELS:Record<StepName,string> =
  { structure:"整理", draft:"草稿", augment:"補充", verify:"查證", format:"成稿" };

export type SseEvent =
  | { event:"step"; data:{ step:StepName; status:"start"|"done"; summary:string|null } }
  | { event:"delta"; data:{ text:string } }
  | { event:"citations"; data:{ items:{title:string;url:string}[] } }
  | { event:"done"; data:{ markdown:string } }
  | { event:"error"; data:{ code:string; message:string } };

export type Msg =
  | { type:"EXTRACT" }
  | { type:"EXTRACT_RESULT"; payload:ExtractResult }
  | { type:"PROCESS"; payload:NoteRequest }
  | { type:"SSE"; payload:SseEvent };
