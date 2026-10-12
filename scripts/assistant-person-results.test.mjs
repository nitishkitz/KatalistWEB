import assert from 'node:assert/strict';
import { test } from 'node:test';
import { personThingAnswer } from '../server/lib/assistant-person-results.ts';
const t = (id,actor,name,status='not_started') => ({id,title:id,assignee_actor_id:actor,assignee_name:name,status,updated_at:'2026-10-01T00:00:00Z',citation_label:id});
const facts = {people:[{actor_id:'n',display_name:'Narayana Kammari'},{actor_id:'a',display_name:'Ajjju'}],things:[t('n1','n','Narayana Kammari'),t('n2','n','Narayana Kammari'),t('done','n','Narayana Kammari','sorted'),t('a1','a','Ajjju')],freshness:{is_partial:false},generated_at:'2026-10-12T12:00:00Z'};
test('partial and close names require confirmation and show no Things before selection', () => {
 for(const name of ["narayana's",'narayanas','narayna']){
  const a=personThingAnswer(facts,`show me ${name} things show me those`);
  assert.equal(a.intent,'person_selection_required');
  assert.deepEqual(a.groups,[]);
  assert.deepEqual(a.person_candidates,[{actor_id:'n',display_name:'Narayana Kammari'}]);
 }
});
test('confirmed and exact people return only their active clickable Things', () => {
 for(const [q,id] of [["show me narayana's things",'n'],['show me Narayana Kammari things',undefined]]){
  const a=personThingAnswer(facts,q,id);
  assert.equal(a.intent,'person_items');
  assert.deepEqual(a.groups[0].thing_ids,['n1','n2']);
  assert.match(a.answer_markdown,/Narayana Kammari.*2 active Things/);
 }
});
test('unknown names or unavailable confirmed actor never broaden to everyone', () => {
 assert.equal(personThingAnswer(facts,'show me zzzzz things').intent,'person_not_found');
 assert.deepEqual(personThingAnswer(facts,'show me narayana things','not-visible').groups,[]);
 assert.equal(personThingAnswer(facts,'who is stale other than me'),null);
});
test('shared first names offer both actual contacts for selection',()=>{
 const a=personThingAnswer({...facts,people:[{actor_id:'r1',display_name:'Rahul Mehta'},{actor_id:'r2',display_name:'Rahul Sharma'}]},"show me rahul's things");
 assert.deepEqual(a.person_candidates.map(p=>p.actor_id),['r1','r2']);
});
