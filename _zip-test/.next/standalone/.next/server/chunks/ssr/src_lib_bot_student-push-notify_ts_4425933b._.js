module.exports=[195787,a=>{"use strict";var b=a.i(725383);let c="cl:ntf:close";function d(a){return{inline_keyboard:[...a??[],[{text:"Закрыть",callback_data:c}]]}}function e(a){return d([[{text:"Посмотреть результат",callback_data:`cl:chw:rev:${a}`}]])}async function f(a,b){let{data:c}=await a.from("bot_members").select("chat_id").eq("telegram_id",b).maybeSingle();return c?.chat_id}async function g(a,c,e,g){let h=await f(a,c);h&&await (0,b.telegramSend)("sendMessage",{chat_id:h,text:e,reply_markup:d(g)})}async function h(a,b,c){let d=c.sanityLessonId?[[{text:"Проверить статус",callback_data:`cl:chw:stat:${c.sanityLessonId}`}]]:void 0;await g(a,b,`✅ ДЗ №${c.lessonNumber} \xab${c.title}\xbb отправлено на проверку.

Ответ придёт в Telegram.`,d)}async function i(a,c,e){let g=await f(a,c);if(!g)return;let h=null!=e.livesMax?` из ${e.livesMax}`:"",i=e.courseTitle?.trim()?`
🎓 ${e.courseTitle.trim()}`:"";await (0,b.telegramSend)("sendMessage",{chat_id:g,text:`❤️ Снята 1 жизнь за просрочку или невыполнение ДЗ.${i}

Осталось жизней: ${e.livesLeft}${h}.`,reply_markup:d()})}a.s(["STUDENT_NTF_CLOSE",0,c,"homeworkReviewNotifyKeyboard",()=>e,"notifyStudentHomeworkSubmitted",()=>h,"notifyStudentLifeDeducted",()=>i,"sendStudentInfoPush",()=>g,"studentNotifyKeyboard",()=>d])}];

//# sourceMappingURL=src_lib_bot_student-push-notify_ts_4425933b._.js.map