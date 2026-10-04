const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function api() {
  const context = vm.createContext({URL});
  vm.runInContext(fs.readFileSync('quest-api.js', 'utf8'), context);
  return context;
}
const now = new Date('2026-10-04T12:00:00Z');
const date = '10/04/2026';
const card = (key, extra = {}) => ({offerId:key, title:key, complete:false,
  pointProgressMax:10, pointProgress:0, destinationUrl:`https://www.bing.com/search?q=${key}`, ...extra});
const raw = (key, extra = {}) => ({name:key, attributes:{offerid:key, type:'urlreward',
  title:key, max:'10', progress:'0', complete:'false', destination:`https://www.bing.com/search?q=${key}`, ...extra}});
function model(daily, promotions = []) {
  return {isRewardsUser:true, userInfo:{isRewardsUser:true,activities:null,promotions},
    flyoutResult:{dailySetPromotions:{[date]:daily},morePromotions:[]}};
}

test('rendered dated Daily Set supplies a missing third offer even with raw userInfo present', () => {
  const parser = api();
  const payload = model([card('first'),card('second'),card('third')], [raw('first'),raw('second')]);
  const items = parser.extractQuestActivities(payload, now, true);
  assert.deepEqual(Array.from(items, item=>item.key), ['first','second','third']);
  const {automatic,manual} = parser.partitionQuestActivities(items);
  assert.deepEqual(Array.from(automatic,item=>item.key), ['first','second','third']);
  assert.equal(manual.length,0);
  assert.equal(items.find(item=>item.key==='third').source,'dashboard');
});

test('final Daily Set quiz is activated like other point-bearing cards, not preemptively handed off', () => {
  const parser = api();
  const ordinary = card('url-offer',{destinationUrl:'https://www.bing.com/search?q=Sport+events+near+me&filters=BTEPOKey%3A%22REWARDSQUIZ_DailySet_UrlOffer%22'});
  const quiz = card('last-quiz',{destinationUrl:'https://www.bing.com/search?q=Hummus+quiz&form=dsetqu&filters=WQOskey%3A%22Hummus_quiz%22+BingQA_QuizLanding'});
  const {automatic,manual} = parser.partitionQuestActivities(parser.extractQuestActivities(model([ordinary,quiz]),now,true));
  assert.deepEqual(Array.from(automatic,item=>item.key),['url-offer','last-quiz']);
  assert.equal(manual.length,0);
});

test('Earn cards without a date are activated; stale dated Daily Set offers are excluded', () => {
  const parser=api();
  const payload=model([], [raw('today',{daily_set_date:date,title:'Bản tin hôm nay'}),
    raw('undated',{title:'Daily activity',isRecurring:'true'}),raw('old',{daily_set_date:'10/03/2026'})]);
  const {automatic,manual}=parser.partitionQuestActivities(parser.extractQuestActivities(payload,now,true));
  assert.deepEqual(Array.from(automatic,item=>item.key),['today','undated']);
  assert.equal(manual.length,0);
});

test('quiz/poll/puzzle or multi-step metadata does not prevent a single official card activation', () => {
  const parser=api();
  const payload=model([card('poll',{promotionType:'poll'}),card('puzzle',{destinationUrl:'https://www.bing.com/spotlight/imagepuzzle'}),
    card('steps',{activityProgressMax:3}),card('simple',{activityProgressMax:1})]);
  const {automatic,manual}=parser.partitionQuestActivities(parser.extractQuestActivities(payload,now,true));
  assert.deepEqual(Array.from(automatic,item=>item.key),['poll','puzzle','steps','simple']);
  assert.equal(manual.length,0);
});

test('completed and zero-point daily cards are excluded rather than handed off', () => {
  const parser=api();
  const payload=model([card('done',{complete:true}),card('credited',{pointProgress:10}),card('zero',{pointProgressMax:0}),card('pending')]);
  assert.deepEqual(Array.from(parser.extractQuestActivities(payload,now,true),item=>item.key),['pending']);
});

test('fallback parser normalizes completed and hidden flags including attributes before planning any action', () => {
  const parser=api();
  for (const extra of [
    {complete:'true',isEnabled:false}, {complete:1}, {attributes:{complete:'True'}},
    {isHidden:'true'}, {hidden:true}, {attributes:{isHidden:'true'}}, {attributes:{isTestOnly:'true'}},
    {pointProgress:undefined,attributes:{pointProgress:10}}
  ]) {
    const payload={isRewardsUser:true,flyoutResult:{dailySetPromotions:{},morePromotions:[card('skip',extra)]}};
    assert.equal(parser.extractQuestActivities(payload,now,true).length,0,JSON.stringify(extra));
  }
});

test('fallback Earn parser excludes archived/future daily dates like the combined flyout parser', () => {
  const parser=api();
  const offers=[card('past',{dailySetDate:'10/03/2026'}),card('future',{attributes:{daily_set_date:'10/05/2026'}}),card('current')];
  for (const payload of [
    {isRewardsUser:true,flyoutResult:{dailySetPromotions:{},morePromotions:offers}},
    model([],offers)
  ]) {
    assert.deepEqual(Array.from(parser.extractQuestActivities(payload,now,true),item=>item.key),['current']);
  }
});

test('structured flyoutResult-only responses support parsing and credit verification', () => {
  const parser=api();
  const payload={isRewardsUser:true,flyoutResult:{dailySetPromotions:{[date]:[card('only')]},morePromotions:[]}};
  assert.equal(parser.classifyQuestDashboard(payload),null);
  const item=parser.extractQuestActivities(payload,now,true)[0];
  assert.equal(item.daily,true);
  assert.equal(parser.questActivityServerState(payload,'only',now),'pending');
  payload.flyoutResult.dailySetPromotions[date][0]={offerId:'only',complete:true};
  assert.equal(parser.questActivityServerState(payload,'only',now),'complete');
  payload.isRewardsUser=false;
  assert.equal(parser.classifyQuestDashboard(payload),'QUEST_SIGN_IN_REQUIRED');
});

test('verification merges both sources and refuses contradictory pending evidence', () => {
  const parser=api();
  const payload=model([card('shared',{complete:true})],[raw('shared')]);
  assert.equal(parser.questActivityServerState(payload,'shared',now),'pending');
  payload.userInfo.promotions[0].attributes.complete='true';
  assert.equal(parser.questActivityServerState(payload,'shared',now),'complete');
});

test('unsafe credentialed destinations never enter automatic or manual lists', () => {
  const parser=api();
  const payload=model([card('credentials',{destinationUrl:'https://secret:password@www.bing.com/search?q=bad'}),
    card('port',{destinationUrl:'https://www.bing.com:444/search?q=bad'}),card('foreign',{destinationUrl:'https://example.com/search?q=bad'})],
    [raw('raw-credentials',{destination:'https://secret:password@www.bing.com/search?q=bad'})]);
  assert.equal(parser.extractQuestActivities(payload,now,true).length,0);
});

test('unavailable or in-progress cards cannot be automatically activated', () => {
  const parser=api();
  const payload=model([card('disabled',{isEnabled:false}),card('locked',{exclusiveLockedFeatureStatus:'locked'}),
    card('inprogress',{inProgress:'True'}),card('notrewardable',{isRewardable:false})]);
  const {automatic,manual}=parser.partitionQuestActivities(parser.extractQuestActivities(payload,now,true));
  assert.equal(automatic.length,0);
  assert.equal(manual.length,4);
});

test('duplicate source quiz metadata still permits one activation, not duplicate actions', () => {
  const parser=api();
  const payload=model([card('same')],[raw('same',{type:'quiz',daily_set_date:date})]);
  const items=parser.extractQuestActivities(payload,now,true);
  assert.equal(items.length,1);
  assert.equal(items[0].daily,true);
  assert.equal(items[0].autoEligible,true);
  assert.equal(parser.partitionQuestActivities(items).automatic.length,1);
});

test('Earn titles and non-search Bing destinations do not imply that cards need manual interaction', () => {
  const parser=api();
  const payload={isRewardsUser:true,flyoutResult:{dailySetPromotions:{[date]:[]},morePromotions:[
    card('earn-task',{title:'Discover daily tasks',description:'Offer expires in 1 day',destinationUrl:'https://www.bing.com/spotlight/imagepuzzle'}),
    card('earn-quiz',{promotionType:'quiz'})
  ]}};
  const {automatic,manual}=parser.partitionQuestActivities(parser.extractQuestActivities(payload,now,true));
  assert.deepEqual(Array.from(automatic,item=>item.key),['earn-task','earn-quiz']);
  assert.equal(manual.length,0);
});

test('raw attribute disabled/locked states remain manual even if a duplicate rendered card looks available', () => {
  const parser=api();
  const payload=model([card('disabled')],[raw('disabled',{isEnabled:'false',daily_set_date:date})]);
  const {automatic,manual}=parser.partitionQuestActivities(parser.extractQuestActivities(payload,now,true));
  assert.equal(automatic.length,0);
  assert.deepEqual(Array.from(manual,item=>item.key),['disabled']);
});

test('unannotated caller data defaults to manual and legacy parser output remains unchanged', () => {
  const parser=api();
  const payload={dashboard:{dailySetPromotions:{[date]:[card('legacy')]},morePromotions:[]}};
  const items=parser.extractQuestActivities(payload,now,false);
  assert.equal(JSON.stringify(items),JSON.stringify([{key:'legacy',url:'https://www.bing.com/search?q=legacy',points:10,section:'Dashboard'}]));
  assert.equal(parser.partitionQuestActivities(items).automatic.length,0);
  assert.equal(parser.partitionQuestActivities(items).manual.length,1);
});
