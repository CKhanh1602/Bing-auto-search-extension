const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const now = new Date('2026-10-05T12:00:00Z');
const date = '10/05/2026';
const card = (id, extra = {}) => ({offerId:id,title:id,complete:false,
  pointProgressMax:10,pointProgress:0,destinationUrl:`https://www.bing.com/search?q=${id}`,...extra});
const raw = (id, extra = {}) => ({name:id,attributes:{offerid:id,type:'urlreward',title:id,
  max:'10',progress:'0',complete:'false',destination:`https://www.bing.com/search?q=${id}`,...extra}});
function parser() {
  const context=vm.createContext({URL});
  vm.runInContext(fs.readFileSync('quest-api.js','utf8'),context);
  return context;
}

test('Daily Set and Keep earning remain tasks while multi-step Earn Quests are excluded', () => {
  const api=parser();
  const payload={isRewardsUser:true,userInfo:{activities:null,promotions:[
    raw('daily',{daily_set_date:date}), raw('keep'),
    {...raw('weekly'),activityProgress:0,activityProgressMax:8},
    {...raw('windows'),activityProgress:2,activityProgressMax:4},
    {...raw('shopping'),activityProgress:2,activityProgressMax:5}
  ]}};
  const items=api.extractQuestActivities(payload,now,true);
  assert.deepEqual(Array.from(items,item=>item.key),['daily','keep']);
  const plan=api.partitionQuestActivities(items);
  assert.equal(plan.automatic.length,2);
  assert.equal(plan.manual.length,0,'Excluded Quests must never block Auto All as manual tasks');
});

test('structured Quest parents and their nested steps never become Keep earning tasks', () => {
  const api=parser();
  const payload={isRewardsUser:true,userInfo:{activities:null,promotions:[raw('keep'),
    {name:'weekly',attributes:{offerid:'weekly',type:'punchcard',max:'50',progress:'0'},
      children:[raw('step-one'),raw('step-two')]},
    {name:'exclusive',promotionType:'quest',children:[raw('app-step')]}
  ]}};
  assert.deepEqual(Array.from(api.extractQuestActivities(payload,now,true),item=>item.key),['keep']);
});

test('fallback and combined rendered Earn collections exclude multi-step Quests', () => {
  const api=parser();
  const flyoutResult={dailySetPromotions:{[date]:[card('daily-quiz',{promotionType:'quiz',activityProgressMax:3})]},
    morePromotions:[card('keep'),card('quest',{activityProgress:2,activityProgressMax:'5'}),
      card('punch',{promotionType:'punch_card',activityProgressMax:0})]};
  for(const payload of [
    {isRewardsUser:true,flyoutResult},
    {isRewardsUser:true,userInfo:{activities:null,promotions:[]},flyoutResult}
  ]) {
    const items=api.extractQuestActivities(payload,now,true);
    assert.deepEqual(Array.from(items,item=>item.key),['daily-quiz','keep']);
    assert.equal(api.partitionQuestActivities(items).manual.length,0);
  }
});

test('single-step Keep earning quizzes and titles containing quest are not excluded by wording', () => {
  const api=parser();
  const payload={isRewardsUser:true,userInfo:{activities:null,promotions:[
    {...raw('single'),activityProgressMax:1},raw('wording',{title:'Quest for knowledge'}),
    raw('quiz',{type:'quiz'})
  ]}};
  assert.deepEqual(Array.from(api.extractQuestActivities(payload,now,true),item=>item.key),['single','wording','quiz']);
});

test('ongoing Earn goals such as a seven-day Daily Set streak are excluded, not handed off', () => {
  const api=parser();
  const payload={isRewardsUser:true,userInfo:{activities:null,promotions:[
    raw('daily',{daily_set_date:date}),raw('keep'),
    {...raw('seven-days',{title:'Complete the Daily Set for 7 days in a row'}),inProgress:'true'},
    raw('ongoing',{inProgress:true}),raw('available',{inProgress:'false'})
  ]}};
  const items=api.extractQuestActivities(payload,now,true);
  assert.deepEqual(Array.from(items,item=>item.key),['daily','keep','available']);
  assert.equal(api.partitionQuestActivities(items).manual.length,0);
});

test('a rendered alias cannot reintroduce a nested step from an excluded Quest group', () => {
  const api=parser();
  const payload={isRewardsUser:true,userInfo:{activities:null,promotions:[
    {name:'parent',promotionType:'quest',children:[raw('excluded-step')]}
  ]},flyoutResult:{dailySetPromotions:{},morePromotions:[card('excluded-step'),card('keep')]}};
  assert.deepEqual(Array.from(api.extractQuestActivities(payload,now,true),item=>item.key),['keep']);
});

test('a genuine Daily Set card referenced by an excluded goal remains an independent daily task', () => {
  const api=parser();
  const payload={isRewardsUser:true,userInfo:{activities:null,promotions:[
    {offerId:'goal',promotionType:'quest',children:[raw('daily')]}
  ]},flyoutResult:{dailySetPromotions:{[date]:[card('daily')]},morePromotions:[]}};
  const items=api.extractQuestActivities(payload,now,true);
  assert.deepEqual(Array.from(items,item=>item.key),['daily']);
  assert.equal(items[0].daily,true);
  payload.flyoutResult.dailySetPromotions[date][0].complete=true;
  assert.equal(api.questActivityServerState(payload,'daily',now),'pending',
    'Scope exclusions must not hide contradictory raw credit evidence');
  payload.userInfo.promotions[0].children[0].attributes.complete='true';
  assert.equal(api.questActivityServerState(payload,'daily',now),'complete');
});
