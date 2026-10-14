import {defineEventHandler,getQuery,setHeader} from 'h3';
import {requireUser} from '../lib/require-user';
import {getWebsitePreview} from '../lib/website-preview';
export default defineEventHandler(async event => {
 await requireUser(event);
 const result = await getWebsitePreview(String(getQuery(event).url ?? ''));
 setHeader(event,'cache-control',result.preview ? 'private, max-age=3600' : 'no-store');
 return result;
});
