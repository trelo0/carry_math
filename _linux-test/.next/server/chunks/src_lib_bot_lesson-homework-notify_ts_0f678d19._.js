module.exports=[217212,e=>{"use strict";var t=e.i(927837),a=e.i(235617);async function n(e,t){let{data:a,error:n}=await e.from("bot_members").select("chat_id").eq("telegram_id",t).maybeSingle();if(n)throw n;let i=a?.chat_id;return"number"==typeof i?i:null}async function i(e,i,s){let l=await n(e,i);if(!l)return;let r=(0,a.formatLessonDateTimeRu)(s.startsAt);await (0,t.telegramSend)("sendMessage",{chat_id:l,text:`📝 Преподаватель добавил домашнее задание

Занятие: ${s.topic}
Дата: ${r}`,reply_markup:{inline_keyboard:[[{text:"Открыть задание",callback_data:`cl:hw:open:${s.lessonId}`}],[{text:"Перейти к занятию",callback_data:`cl:less:v:${s.lessonId}:menu`}]]}})}async function s(e,i,s){let{data:l,error:r}=await e.from("scheduled_lessons").select("topic, starts_at, teacher_telegram_id").eq("id",i).maybeSingle();if(r)throw r;if(!l?.teacher_telegram_id)return;let o=await n(e,l.teacher_telegram_id);if(!o)return;let{data:m}=await e.from("bot_members").select("full_name, phone").eq("telegram_id",s).maybeSingle(),c=m?.full_name?.trim()||m?.phone?.trim()||`ID ${s}`;await (0,t.telegramSend)("sendMessage",{chat_id:o,text:`📝 Домашняя работа на проверке

👤 ${c}
📚 ${l.topic}
🕐 ${(0,a.formatLessonDateTimeRu)(l.starts_at)}

Откройте занятие в кабинете преподавателя.`})}async function l(a,i,s){let l=await n(a,i);if(!l)return;let r=[s.approved?"✅ Домашнее задание принято":"🔄 Нужна доработка","",s.topic];s.comment&&r.push("",s.comment),r.push("","Откройте карточку занятия для деталей.");let{studentNotifyKeyboard:o}=await e.A(337386);await (0,t.telegramSend)("sendMessage",{chat_id:l,text:r.join("\n"),reply_markup:o([[{text:"Открыть задание",callback_data:`cl:hw:open:${s.lessonId}`}]])})}e.s(["notifyStudentLessonHomeworkAssigned",()=>i,"notifyStudentLessonHomeworkReviewed",()=>l,"notifyTeacherLessonHomeworkSubmitted",()=>s])}];

//# sourceMappingURL=src_lib_bot_lesson-homework-notify_ts_0f678d19._.js.map