import type { SseEvent, NoteRequest } from "./types";

export function parseSseChunk(buffer:string):{events:SseEvent[];rest:string}{
  const events:SseEvent[]=[]; const blocks=buffer.split("\n\n");
  const rest=blocks.pop() ?? "";
  for(const b of blocks){
    let ev=""; let data="";
    for(const line of b.split("\n")){
      if(line.startsWith("event:")) ev=line.slice(6).trim();
      else if(line.startsWith("data:")) data+=line.slice(5).trim();
    }
    if(ev && data) events.push({ event:ev, data:JSON.parse(data) } as SseEvent);
  }
  return { events, rest };
}

export async function* streamNotes(baseUrl:string, token:string|null, body:NoteRequest):AsyncGenerator<SseEvent>{
  const res=await fetch(`${baseUrl}/notes/stream`,{ method:"POST",
    headers:{ "Content-Type":"application/json", ...(token?{Authorization:`Bearer ${token}`}:{}) },
    body:JSON.stringify(body) });
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
