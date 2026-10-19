import { z } from 'zod';
import { Proposal, type ModelProvider } from './ai.js';
/** Explicit local model only. No downloads, remote endpoint fallback or tools. */
export function ollamaProvider(model:string,endpoint='http://127.0.0.1:11434',transport:typeof fetch=fetch, schema:z.ZodType=Proposal):ModelProvider {
  if(!model.trim()||model.length>200||/cloud/i.test(model))throw new Error('Choose an explicit installed local model; cloud model names are not accepted');
  const base=new URL(endpoint);
  if(base.protocol!=='http:'||!['127.0.0.1','localhost','[::1]'].includes(base.hostname)||base.username||base.password||base.pathname!=='/'||base.search||base.hash)throw new Error('Ollama endpoint must be an HTTP loopback origin');
  return async request=>{
    if(Buffer.byteLength(request.prompt)>128000)throw new Error('AI context exceeds local prompt limit');
    const response=await transport(new URL('/api/generate',base),{method:'POST',redirect:'error',headers:{'content-type':'application/json'},signal:AbortSignal.timeout(120000),body:JSON.stringify({model,prompt:request.prompt,format:z.toJSONSchema(schema),stream:false,options:{temperature:0,num_predict:request.maxOutputTokens}})});
    if(!response.ok)throw new Error('Local Ollama request failed; verify daemon and installed model');
    const reader=response.body?.getReader();if(!reader)throw new Error('Missing model response');let bytes=0;const chunks:Uint8Array[]=[];
    try{while(true){const part=await reader.read();if(part.done)break;bytes+=part.value.byteLength;if(bytes>1000000){await reader.cancel();throw new Error('Model response exceeds size limit');}chunks.push(part.value);}}finally{reader.releaseLock();}
    const payload=z.object({done:z.literal(true),done_reason:z.string().optional(),response:z.string().max(100000)}).parse(JSON.parse(Buffer.concat(chunks).toString('utf8')));
    if(payload.done_reason==='length')throw new Error('Model output truncated; draft discarded');
    return {json:JSON.parse(payload.response),costUsd:0};
  };
}
