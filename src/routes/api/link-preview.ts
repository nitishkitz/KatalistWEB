import {createFileRoute} from '@tanstack/react-router';
import {requireAssistantUser,assistantJson} from '@/lib/assistant-route.server';
import {getWebsitePreview} from '../../../server/lib/website-preview';
import {checkRateLimit} from '../../../server/lib/assistant-limits';
export const Route=createFileRoute('/api/link-preview')({server:{handlers:{GET:async({request})=>{
 try {
  const {userId}=await requireAssistantUser(request);
  if(!checkRateLimit(`link-preview:${userId}`,{limit:60,windowMs:60000}).ok)return assistantJson({message:'Try again shortly.'},429);
  const result=await getWebsitePreview(new URL(request.url).searchParams.get('url')??'');
  return new Response(JSON.stringify(result),{headers:{'content-type':'application/json','cache-control':result.preview ? 'private, max-age=3600' : 'no-store'}});
 }catch(error){if(error instanceof Response)return error;return assistantJson({preview:null},400);}
}}}});
