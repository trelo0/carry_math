module.exports=[829368,e=>{"use strict";var t=e.i(927837);let a="cl:ntf:close";function n(e){return{inline_keyboard:[...e??[],[{text:"Закрыть",callback_data:a}]]}}function i(e){return n([[{text:"Посмотреть результат",callback_data:`cl:chw:rev:${e}`}]])}async function l(e,t){let{data:a}=await e.from("bot_members").select("chat_id").eq("telegram_id",t).maybeSingle();return a?.chat_id}async function s(e,a,i,s){let r=await l(e,a);r&&await (0,t.telegramSend)("sendMessage",{chat_id:r,text:i,reply_markup:n(s)})}async function r(e,t,a){let n=a.sanityLessonId?[[{text:"Проверить статус",callback_data:`cl:chw:stat:${a.sanityLessonId}`}]]:void 0;await s(e,t,`✅ ДЗ №${a.lessonNumber} \xab${a.title}\xbb отправлено на проверку.

Ответ придёт в Telegram.`,n)}async function c(e,a,i){let s=await l(e,a);if(!s)return;let r=null!=i.livesMax?` из ${i.livesMax}`:"",c=i.courseTitle?.trim()?`
🎓 ${i.courseTitle.trim()}`:"";await (0,t.telegramSend)("sendMessage",{chat_id:s,text:`❤️ Снята 1 жизнь за просрочку или невыполнение ДЗ.${c}

Осталось жизней: ${i.livesLeft}${r}.`,reply_markup:n()})}e.s(["STUDENT_NTF_CLOSE",0,a,"homeworkReviewNotifyKeyboard",()=>i,"notifyStudentHomeworkSubmitted",()=>r,"notifyStudentLifeDeducted",()=>c,"sendStudentInfoPush",()=>s,"studentNotifyKeyboard",()=>n])}];

//# sourceMappingURL=src_lib_bot_student-push-notify_ts_cd8839bd._.js.map