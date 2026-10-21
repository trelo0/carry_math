module.exports=[927837,e=>{"use strict";async function t(e,t){let a=await fetch(`https://api.telegram.org/bot${function(){let e=process.env.TELEGRAM_BOT_TOKEN;if(!e)throw Error("TELEGRAM_BOT_TOKEN не настроен");return e}()}/${e}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(t)});return await a.json()}function a(e,a){return t("sendMessage",{chat_id:e,text:`🔑 Ваш код для входа: *${a}*

Действует 5 минут. Никому не сообщайте этот код.`,parse_mode:"Markdown"})}e.s(["sendOtpMessage",()=>a,"telegramSend",()=>t])},217212,e=>{"use strict";var t=e.i(927837),a=e.i(235617);async function n(e,t){let{data:a,error:n}=await e.from("bot_members").select("chat_id").eq("telegram_id",t).maybeSingle();if(n)throw n;let s=a?.chat_id;return"number"==typeof s?s:null}async function s(e,s,r){let i=await n(e,s);if(!i)return;let o=(0,a.formatLessonDateTimeRu)(r.startsAt);await (0,t.telegramSend)("sendMessage",{chat_id:i,text:`📝 Преподаватель добавил домашнее задание

Занятие: ${r.topic}
Дата: ${o}`,reply_markup:{inline_keyboard:[[{text:"Открыть задание",callback_data:`cl:hw:open:${r.lessonId}`}],[{text:"Перейти к занятию",callback_data:`cl:less:v:${r.lessonId}:menu`}]]}})}async function r(e,s,r){let{data:i,error:o}=await e.from("scheduled_lessons").select("topic, starts_at, teacher_telegram_id").eq("id",s).maybeSingle();if(o)throw o;if(!i?.teacher_telegram_id)return;let l=await n(e,i.teacher_telegram_id);if(!l)return;let{data:c}=await e.from("bot_members").select("full_name, phone").eq("telegram_id",r).maybeSingle(),d=c?.full_name?.trim()||c?.phone?.trim()||`ID ${r}`;await (0,t.telegramSend)("sendMessage",{chat_id:l,text:`📝 Домашняя работа на проверке

👤 ${d}
📚 ${i.topic}
🕐 ${(0,a.formatLessonDateTimeRu)(i.starts_at)}

Откройте занятие в кабинете преподавателя.`})}async function i(a,s,r){let i=await n(a,s);if(!i)return;let o=[r.approved?"✅ Домашнее задание принято":"🔄 Нужна доработка","",r.topic];r.comment&&o.push("",r.comment),o.push("","Откройте карточку занятия для деталей.");let{studentNotifyKeyboard:l}=await e.A(337386);await (0,t.telegramSend)("sendMessage",{chat_id:i,text:o.join("\n"),reply_markup:l([[{text:"Открыть задание",callback_data:`cl:hw:open:${r.lessonId}`}]])})}e.s(["notifyStudentLessonHomeworkAssigned",()=>s,"notifyStudentLessonHomeworkReviewed",()=>i,"notifyTeacherLessonHomeworkSubmitted",()=>r])},337386,e=>{e.v(t=>Promise.all(["server/chunks/src_lib_d3f22c9f._.js"].map(t=>e.l(t))).then(()=>t(829368)))}];

//# sourceMappingURL=src_lib_9a0fcbcf._.js.map