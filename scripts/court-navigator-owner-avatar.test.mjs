import './dom-test-setup.mjs';
import assert from 'node:assert/strict';
import {test,mock} from 'node:test';
import {createElement as h} from 'react';
import {render,cleanup,fireEvent} from '@testing-library/react';
mock.module('@/components/katalist/PersonAvatar',{namedExports:{PersonAvatar:({name})=>h('span',{'data-testid':'row-avatar'},name)}});
mock.module('@/features/people/directory',{namedExports:{useProfileDirectory:()=>[],matchProfile:()=>null}});
const {ThingNavigator}=await import('@/features/court/ThingNavigator');
test('a received Thing shows its owner while keeping its actual assignee and selection behavior',()=>{
 const thing={id:'received',title:'Submit all the findings',owner:{id:'s',name:'Sudheer',initials:'S'},assignee:{id:'n',name:'Nithesh',initials:'N'},acknowledgement:'caught',workStatus:'under_progress',dueAt:null,files:[]};
 const selected=[];const ui=render(h(ThingNavigator,{lane:'now',things:[thing],selectedThingId:thing.id,onSelect:id=>selected.push(id)}));
 try {
  assert.equal(ui.getByTestId('row-avatar').textContent,'Sudheer');
  fireEvent.click(ui.getByRole('button'));
  assert.deepEqual(selected,['received']);
  assert.equal(thing.assignee.name,'Nithesh');
 } finally {cleanup();}
});
