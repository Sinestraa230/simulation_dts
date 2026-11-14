/* selftests.js — chạy 5 kịch bản tự kiểm của trang web trong Node.  Chạy: node test/selftests.js */
global.CIRCUIT=require(__dirname + '/../js/circuit.js');global.LogicEngine=require(__dirname + '/../js/engine.js');
const T=require(__dirname + '/../js/tests.js');
for(const id of [1,2,3,4,5]){const r=T.selfCheck(id);console.log(r.title);r.checks.forEach(c=>console.log(' ',c.ok?'✓':'✗',c.text));}
