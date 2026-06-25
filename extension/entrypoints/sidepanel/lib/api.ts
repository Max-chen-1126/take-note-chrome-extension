import type { SseEvent, NoteRequest } from "./types";

export function parseSseChunk(buffer:string):{events:SseEvent[];rest:string}{
  // SSE frames may be delimited by LF or CRLF; tolerate both (\r\n proxies/Cloud Run).
  const events:SseEvent[]=[]; const blocks=buffer.split(/\r?\n\r?\n/);
  const rest=blocks.pop() ?? "";
  for(const b of blocks){
    let ev=""; let data="";
    for(const line of b.split(/\r?\n/)){
      if(line.startsWith("event:")) ev=line.slice(6).trim();
      else if(line.startsWith("data:")) data+=line.slice(5).trim();
    }
    if(ev && data){
      try{ events.push({ event:ev, data:JSON.parse(data) } as SseEvent); }
      catch{ /* malformed SSE frame: skip it, keep streaming subsequent frames */ }
    }
  }
  return { events, rest };
}

export async function* streamNotes(baseUrl:string, token:string|null, body:NoteRequest, signal?:AbortSignal):AsyncGenerator<SseEvent>{
  const res=await fetch(`${baseUrl}/notes/stream`,{ method:"POST",
    headers:{ "Content-Type":"application/json", ...(token?{Authorization:`Bearer ${token}`}:{}) },
    body:JSON.stringify(body), signal });
  if(!res.ok || !res.body){ yield { event:"error", data:{ code:`http_${res.status}`, message:await res.text() }}; return; }
  const reader=res.body.getReader(); const dec=new TextDecoder(); let buf="";
  for(;;){ const {done,value}=await reader.read(); if(done) break;
    buf+=dec.decode(value,{stream:true}); const { events, rest }=parseSseChunk(buf); buf=rest;
    for(const e of events) yield e; }
}

export async function getMethodologies(baseUrl:string, token:string|null){
  const res=await fetch(`${baseUrl}/methodologies`,{ headers: token?{Authorization:`Bearer ${token}`}:{} });
  if(!res.ok) return []; return res.json();
}
