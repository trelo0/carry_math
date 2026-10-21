module.exports=[254799,(e,t,r)=>{t.exports=e.x("crypto",()=>require("crypto"))},450841,e=>{"use strict";function t(e){return"object"==typeof e&&null!==e&&!Array.isArray(e)}var r={0:8203,1:8204,2:8205,3:8290,4:8291,5:8288,6:65279,7:8289,8:119155,9:119156,a:119157,b:119158,c:119159,d:119160,e:119161,f:119162},i={0:8203,1:8204,2:8205,3:65279},l={0:String.fromCodePoint(i[0]),1:String.fromCodePoint(i[1]),2:String.fromCodePoint(i[2]),3:String.fromCodePoint(i[3])},n=[,,,,].fill(String.fromCodePoint(i[0])).join("");function s(e,t,r="auto"){return!0===r||"auto"===r&&(!(!Number.isNaN(Number(e))||/[a-z]/i.test(e)&&!/\d+(?:[-:\/]\d+){2}(?:T\d+(?:[-:\/]\d+){1,2}(\.\d+)?Z?)?/.test(e))&&Date.parse(e)||function(e){try{new URL(e,e.startsWith("/")?"https://acme.com":void 0)}catch{return!1}return!0}(e))?e:`${e}${function(e){let t=JSON.stringify(e),r=new TextEncoder().encode(t),i="";for(let e=0;e<r.length;e++){let t=r[e];i+=l[t>>6&3]+l[t>>4&3]+l[t>>2&3]+l[3&t]}return n+i}(t)}`}Object.fromEntries(Object.entries(l).map(e=>[e[1],+e[0]])),Object.fromEntries(Object.entries(r).map(e=>e.reverse()));var a=`${Object.values(r).map(e=>`\\u{${e.toString(16)}}`).join("")}`,o=RegExp(`[${a}]{4,}`,"gu");function u(e){var t,r;return e&&JSON.parse({cleaned:(t=JSON.stringify(e)).replace(o,""),encoded:(null==(r=t.match(o))?void 0:r[0])||""}.cleaned)}e.s(["isRecord",()=>t,"stegaClean",()=>u,"y",()=>s])},551913,e=>{"use strict";var t=e.i(347540),r=e.i(883760),i=e.i(667066);let l=process.env.DISTRICT_COURSE_SLUG?.trim()||"district-course",n=`districtCourse.${l}`;function s(e){if(!Array.isArray(e))return[];let t=[];for(let r of e){if("string"==typeof r){let e=r.trim();e&&t.push({title:e,description:null});continue}if(!r||"object"!=typeof r)continue;let e="string"==typeof r.title&&r.title.trim()||"string"==typeof r.text&&r.text.trim()||"";if(!e)continue;let i="string"==typeof r.description&&r.description.trim()?r.description.trim():null;t.push({title:e,description:i})}return t}function a({preview:e,includeDrafts:t}={}){return(0,i.getSanityClient)({preview:e,includeDrafts:t??!!e})}function o({preview:e}){return e?{cache:"no-store"}:{next:{revalidate:120,tags:["sanity:course-content"]}}}let u=r.groq`{
  "sanityId": _id,
  title,
  description,
  lessonNumber,
  lessonDate,
  curriculumBlock,
  moduleOrder,
  lessonType,
  publicationStatus,
  sortOrder,
  isTrialFree,
  scheduledAt,
  liveUrl,
  recordingUrl,
  mandatoryHomework,
  contentChips,
  lessonMaterials[]{
    published,
    "fileUrl": file.asset->url,
    "fileName": file.asset->originalFilename,
    "fileSize": file.asset->size
  },
  lessonHomeworkFiles[]{
    published,
    "fileUrl": file.asset->url,
    "fileName": file.asset->originalFilename,
    "fileSize": file.asset->size
  },
  lessonFiles[]{
    published,
    "fileUrl": file.asset->url,
    "fileName": file.asset->originalFilename,
    "fileSize": file.asset->size
  },
  "materialsFileUrl": materialsFile.asset->url,
  "materialsFileName": materialsFile.asset->originalFilename,
  "homeworkFileUrl": homeworkFile.asset->url,
  "homeworkFileName": homeworkFile.asset->originalFilename,
  materials[]{
    title,
    materialType,
    url,
    fileName,
    fileSize
  },
  homework{
    title,
    description,
    fileName,
    fileSize,
    url,
    mandatory
  }
}`,c=r.groq`{
  "sanityId": _id,
  title,
  description,
  color,
  sortOrder,
  "lessons": *[_type == "districtCourseLesson" && module._ref == ^._id] | order(moduleOrder asc) ${u}
}`,d=r.groq`*[_type == "districtCourse" && (slug.current == $slug || _id == $docId)][0]{
  "sanityId": _id,
  title,
  "slug": slug.current,
  description,
  cabinetEyebrow,
  deliveryFormat,
  homeworkIntro,
  publicationStatus,
  showInCatalog,
  courseClosed,
  priceByn,
  grantedLessons,
  pricing,
  purchaseScenarios,
  "activeModuleOverride": activeModuleOverride._id,
  "coverImageUrl": coverImage.asset->url,
  "previewImageUrl": coalesce(cabinetPreviewImage.asset->url, coverImage.asset->url),
  cabinetPreviewInside,
  cabinetPreviewAfterEnrollment,
  cabinetPreviewAudience,
  "curatorName": curator->name,
  curatorTelegramId,
  checkTelegramId,
  "modulesFromCourse": modules[]->${c},
  "modulesFromRefs": *[_type == "districtModule" && course._ref == ^._id] | order(sortOrder asc) ${c}
}`,m=r.groq`*[_type == "districtCourse" && defined(slug.current)] | order(title asc) {
  "sanityId": _id,
  title,
  "slug": slug.current,
  description,
  cabinetEyebrow,
  deliveryFormat,
  homeworkIntro,
  publicationStatus,
  showInCatalog,
  courseClosed,
  "coverImageUrl": coverImage.asset->url,
  "previewImageUrl": coalesce(cabinetPreviewImage.asset->url, coverImage.asset->url),
  cabinetPreviewInside,
  cabinetPreviewAfterEnrollment,
  cabinetPreviewAudience,
  "curatorName": curator->name,
  curatorTelegramId,
  checkTelegramId,
  "moduleCount": count(*[_type == "districtModule" && course._ref == ^._id]),
  "totalLessons": count(*[
    _type == "districtCourseLesson" &&
    publicationStatus == "published" &&
    defined(module._ref) &&
    module->course._ref == ^._id
  ])
}`,f=r.groq`*[_type == "districtCourse" && defined(slug.current) && coalesce(courseClosed, false) == false && coalesce(showInCatalog, true) == true && (
  (defined(pricing.priceByn) && pricing.priceByn >= 0 && defined(pricing.grantedLessons) && pricing.grantedLessons > 0) ||
  (defined(priceByn) && priceByn >= 0 && defined(grantedLessons) && grantedLessons > 0)
)] | order(title asc) {
  "sanityId": _id,
  title,
  "slug": slug.current,
  description,
  pricing,
  priceByn,
  grantedLessons,
  purchaseScenarios
}`;function p(e){let t=e.pricing;return{priceByn:"number"==typeof t?.priceByn&&Number.isFinite(t.priceByn)?t.priceByn:"number"==typeof e.priceByn&&Number.isFinite(e.priceByn)?e.priceByn:null,grantedLessons:"number"==typeof t?.grantedLessons&&Number.isFinite(t.grantedLessons)&&t.grantedLessons>0?Math.floor(t.grantedLessons):"number"==typeof e.grantedLessons&&Number.isFinite(e.grantedLessons)&&e.grantedLessons>0?Math.floor(e.grantedLessons):null,cardText:t?.cardText?.trim()||null}}function g(e){if(!e?.sanityId||!e.title)return null;let t=e.homework;return{sanityId:e.sanityId,title:e.title,description:e.description??null,lessonNumber:e.lessonNumber??e.sortOrder??0,lessonDate:e.lessonDate??null,curriculumBlock:e.curriculumBlock??null,moduleOrder:e.moduleOrder??0,lessonType:e.lessonType??"webinar",publicationStatus:e.publicationStatus??"draft",sortOrder:e.sortOrder??e.lessonNumber??0,isTrialFree:!!e.isTrialFree,scheduledAt:e.scheduledAt??(e.lessonDate?`${e.lessonDate}T18:00:00+03:00`:null),liveUrl:e.liveUrl??null,recordingUrl:e.recordingUrl??null,mandatoryHomework:!!(e.mandatoryHomework??t?.mandatory??!0),contentChips:(e.contentChips??[]).filter(Boolean),materials:function(e){if(null!=e.lessonMaterials)return y(e.lessonMaterials);if(null!=e.lessonFiles)return y(e.lessonFiles);let t=e.materialsFileUrl;if(t){let r=e.materialsFileName??"Материалы";return[{title:r,materialType:"file",url:t,fileName:r,fileSize:null}]}return(e.materials??[]).map(e=>({title:e.title,materialType:e.materialType??"file",url:e.url??null,fileName:e.fileName??null,fileSize:e.fileSize??null}))}(e),homeworkFiles:b(e),homework:function(e){let t=b(e);if(t.length>0){let e=t[0];return{title:e.fileName??e.title,description:null,fileName:e.fileName,fileSize:e.fileSize,url:e.url,mandatory:!0}}let r=e.homework;return r?.title||r?.url?{title:r.title??"Домашнее задание",description:r.description??null,fileName:r.fileName??null,fileSize:r.fileSize??null,url:r.url??null,mandatory:!!(r.mandatory??!0)}:null}(e)}}function h(e,t){return(e??[]).filter(e=>e?.fileUrl&&(!t||e.published)).map(e=>({fileName:e.fileName??"Файл",fileUrl:e.fileUrl??null,published:!!e.published}))}function y(e){return h(e,!0).map(e=>({title:e.fileName??"Файл",materialType:"file",url:e.fileUrl,fileName:e.fileName,fileSize:null}))}function b(e){if(null!=e.lessonHomeworkFiles)return y(e.lessonHomeworkFiles);let t=e.homeworkFileUrl;if(t){let r=e.homeworkFileName??"Домашнее задание";return[{title:r,materialType:"file",url:t,fileName:r,fileSize:null}]}let r=e.homework;if(r?.url){let e=r.fileName??r.title??"Домашнее задание";return[{title:e,materialType:"file",url:r.url,fileName:e,fileSize:r.fileSize??null}]}return[]}function I(e){return e?.title&&e.description?{title:e.title,description:e.description,benefits:(e.benefits??[]).filter(Boolean),buttonLabel:e.buttonLabel??"Выбрать",subtitle:e.subtitle??void 0}:null}function v(e){if(!e)return null;let t=I(e.startFromBeginning),r=I(e.joinCurrent);return t&&r?{startFromBeginning:t,joinCurrent:r}:null}let _=r.groq`*[_type == "districtCourseLesson" && _id in $ids]{
  "sanityId": _id,
  lessonMaterials[]{
    published,
    "fileUrl": file.asset->url,
    "fileName": file.asset->originalFilename
  },
  lessonHomeworkFiles[]{
    published,
    "fileUrl": file.asset->url,
    "fileName": file.asset->originalFilename
  }
}`;async function w(e){let t=new Map;if(0===e.length)return t;let r=a({includeDrafts:!0,preview:!1});for(let i of await r.fetch(_,{ids:e},{cache:"no-store"})??[])t.set(i.sanityId,{materials:h(i.lessonMaterials,!1),homeworkFiles:h(i.lessonHomeworkFiles,!1)});return t}let C=(0,t.cache)(async function(e=l,t={}){let r=a(t),i=e===l?n:`districtCourse.${e}`;return function(e){if(!e?.sanityId||!e.title||!e.slug)return null;let t=e.modulesFromCourse??[],r=e.modulesFromRefs??[],i=new Map;for(let e of r)e?.sanityId&&i.set(e.sanityId,e);for(let e of t)e?.sanityId&&i.set(e.sanityId,e);let l=[...i.values()].filter(Boolean).map((e,t)=>{let r=(e.lessons??[]).map(g).filter(e=>null!==e).sort((e,t)=>e.moduleOrder-t.moduleOrder||e.lessonNumber-t.lessonNumber||e.sortOrder-t.sortOrder);return{sanityId:e.sanityId,title:e.title,description:e.description??null,color:e.color??"#4f7cff",sortOrder:e.sortOrder??t,lessons:r}}).sort((e,t)=>e.sortOrder-t.sortOrder),n=p(e);return{sanityId:e.sanityId,title:e.title,slug:e.slug,description:e.description??null,cabinetEyebrow:e.cabinetEyebrow??null,deliveryFormat:e.deliveryFormat??null,homeworkIntro:e.homeworkIntro??null,coverImageUrl:e.coverImageUrl??null,previewImageUrl:e.previewImageUrl??null,previewInsideItems:s(e.cabinetPreviewInside),previewAfterEnrollment:e.cabinetPreviewAfterEnrollment??null,previewAudience:e.cabinetPreviewAudience??null,publicationStatus:e.publicationStatus??"draft",showInCatalog:!1!==e.showInCatalog,courseClosed:!0===e.courseClosed,curatorName:e.curatorName??null,curatorTelegramId:"number"==typeof e.curatorTelegramId&&Number.isFinite(e.curatorTelegramId)?e.curatorTelegramId:null,checkTelegramId:"number"==typeof e.checkTelegramId&&Number.isFinite(e.checkTelegramId)?e.checkTelegramId:null,priceByn:n.priceByn,grantedLessons:n.grantedLessons,pricingCardText:n.cardText,purchaseScenarios:v(e.purchaseScenarios),activeModuleOverride:e.activeModuleOverride??null,modules:l}}(await r.fetch(d,{slug:e,docId:i},o(t)))});function S(e){return e.slug===l||e.sanityId===n||e.sanityId===`districtCourse.${e.slug}`&&e.slug===l}async function N(e,t={}){return Promise.all(e.map(async e=>{let r=await C(e.slug,t),i=r?.purchaseScenarios??null;return i?{...e,purchaseScenarios:i}:e}))}function F(e){return!0===e}function T(e){return!1!==e}function k(e){return!F(e.courseClosed)&&T(e.showInCatalog)}function L(e,t,r){return e.filter(e=>{if(F(e.courseClosed))return!1;if(T(e.showInCatalog))return!0;let i=t.get(e.slug);return null!=i&&r.has(i)})}let x=(0,t.cache)(async function(e={}){let t=a(e),r=await t.fetch(m,{},o(e)),i=[];for(let e of r??[])e?.sanityId&&e.title&&e.slug&&i.push({sanityId:e.sanityId,title:e.title,slug:e.slug,description:e.description??null,cabinetEyebrow:e.cabinetEyebrow??null,deliveryFormat:e.deliveryFormat??null,homeworkIntro:e.homeworkIntro??null,publicationStatus:e.publicationStatus??"draft",showInCatalog:!1!==e.showInCatalog,courseClosed:!0===e.courseClosed,coverImageUrl:e.coverImageUrl??null,previewImageUrl:e.previewImageUrl??null,previewInsideItems:s(e.cabinetPreviewInside),previewAfterEnrollment:e.cabinetPreviewAfterEnrollment??null,previewAudience:e.cabinetPreviewAudience??null,curatorName:e.curatorName??null,curatorTelegramId:"number"==typeof e.curatorTelegramId&&Number.isFinite(e.curatorTelegramId)?e.curatorTelegramId:null,moduleCount:"number"==typeof e.moduleCount&&Number.isFinite(e.moduleCount)?Math.max(0,Math.floor(e.moduleCount)):0,totalLessons:"number"==typeof e.totalLessons&&Number.isFinite(e.totalLessons)?Math.max(0,Math.floor(e.totalLessons)):0,modulePreviews:[]});return i}),D=(0,t.cache)(async function(e={}){let t=a(e),r=await t.fetch(f,{},o(e)),i=[];for(let e of r??[]){if(!e?.sanityId||!e.slug||!e.title)continue;let t=p(e);null!=t.priceByn&&!(t.priceByn<0)&&(null==t.grantedLessons||t.grantedLessons<1||i.push({sanityId:e.sanityId,slug:e.slug,title:e.title,description:e.description??null,cardText:t.cardText,priceByn:t.priceByn,grantedLessons:t.grantedLessons,purchaseScenarios:v(e.purchaseScenarios??null)}))}return i});async function O(e,t={}){return(await D(t)).find(t=>t.slug===e)??null}function U(e){let t=[];for(let r of e.modules)t.push(...r.lessons);return t}function B(e){return U(e).filter(e=>"published"===e.publicationStatus).length}function P(e){return U(e).filter(e=>"archived"!==e.publicationStatus).length}function A(e,t){return!!("published"===e.publicationStatus||"archived"===e.publicationStatus&&t.has(e.sanityId))}function K(e){return"assignment"===e?"milestone":"test"===e?"practice":e}function E(e){if(e.recordingUrl)return"completed";if(!e.scheduledAt)return null;let t=new Date(e.scheduledAt).getTime();return Number.isNaN(t)?null:t>Date.now()?"scheduled":e.liveUrl?"live":"completed"}function z(e){return e.recordingUrl?e.recordingUrl:e.liveUrl?e.liveUrl:e.homework?.url?e.homework.url:e.materials.find(e=>e.url)?.url??null}function M(e){return e.recordingUrl?"Смотреть запись":"webinar"===e.lessonType&&e.liveUrl?"Смотреть трансляцию":"Открыть занятие"}e.s(["DEFAULT_LESSON_CONTENT_CHIPS",0,["Теория","Разбор задач","Практика","Домашнее задание"],"DISTRICT_COURSE_DOC_ID",0,n,"DISTRICT_COURSE_SLUG",0,l,"attachPurchaseScenariosToOffers",()=>N,"countCourseLessons",()=>P,"countPublishedLessons",()=>B,"deriveWebinarSessionStatus",()=>E,"fetchCuratorLessonFilesMap",()=>w,"filterCourseSummariesForCabinetAccess",()=>L,"flattenCourseLessons",()=>U,"getCoursePaymentOfferBySlug",()=>O,"getDistrictCourseContent",0,C,"isDistrictCourseFullyClosed",()=>F,"isDistrictCoursePublicInCatalog",()=>T,"isDistrictCoursePurchaseOffer",()=>S,"isDistrictCourseVisibleInCabinet",()=>k,"isLessonVisible",()=>A,"listCoursePaymentOffers",0,D,"listDistrictCourseSummaries",0,x,"mapLessonKind",()=>K,"resolveLessonActionLabel",()=>M,"resolveLessonActionUrl",()=>z])},809617,e=>{"use strict";var t=e.i(883760);let r=new Set(["course_package_purchased","course_enrolled","course_map_viewed","lesson_complete_1","lesson_complete_5","lesson_complete_10","webinar_complete_1","webinar_complete_3","hw_submitted_1","hw_approved_1","hw_approved_5","webinar_live_1","recording_watched_1","curator_message_1","profile_complete","score_100","individual_package_purchased","group_lesson_scheduled","payment_success_1","lesson_1","webinar_3"]);var i=e.i(667066);let l=[{text:"Главное — не идеальность, а регулярность.",author:"District"},{text:"Каждая решённая задача — шаг к уверенности на экзамене.",author:"District"},{text:"Ошибки — не провал, а карта того, что стоит подтянуть.",author:"District"},{text:"Лучше 30 минут каждый день, чем 5 часов раз в неделю.",author:"District"},{text:"Формулы запоминаются, когда ими пользуешься.",author:"District"},{text:"Сложное становится простым, когда разбираешь его по шагам.",author:"District"},{text:"Прогресс заметнее, если смотреть на путь, а не только на результат.",author:"District"},{text:"Домашка — тренировка перед матчем, а не наказание.",author:"District"},{text:"Спроси, когда непонятно: так учатся быстрее.",author:"District"},{text:"Сегодняшняя практика — завтрашние баллы.",author:"District"},{text:"Не сравнивай себя с другими — сравнивай с собой вчерашним.",author:"District"},{text:"План без действий — мечта. Действия без плана — хаос.",author:"District"},{text:"Математика любит тех, кто возвращается к задачам снова.",author:"District"},{text:"Один понятый приём экономит часы на экзамене.",author:"District"},{text:"Дисциплина сегодня — спокойствие в день ЦТ.",author:"District"}],n=[{title:"Старт курса",subtitle:"Купи первый пакет занятий",ruleKey:"course_package_purchased"},{title:"На борту",subtitle:"Запишись на программу",ruleKey:"course_enrolled"},{title:"Картограф",subtitle:"Открой карту курса",ruleKey:"course_map_viewed"},{title:"Первый шаг",subtitle:"Пройди первый урок",ruleKey:"lesson_complete_1"},{title:"Ритм",subtitle:"Пройди 5 уроков",ruleKey:"lesson_complete_5"},{title:"Марафонец",subtitle:"Пройди 10 уроков",ruleKey:"lesson_complete_10"},{title:"В эфире",subtitle:"Посмотри первый вебинар",ruleKey:"webinar_complete_1"},{title:"Три вебинара",subtitle:"Посмотри 3 вебинара",ruleKey:"webinar_complete_3"},{title:"ДЗ отправлено",subtitle:"Сдай первое домашнее",ruleKey:"hw_submitted_1"},{title:"Зачёт",subtitle:"Получи первое принятое ДЗ",ruleKey:"hw_approved_1"},{title:"Пять зачётов",subtitle:"Пять принятых домашек",ruleKey:"hw_approved_5"},{title:"Live",subtitle:"Попади на прямой эфир",ruleKey:"webinar_live_1"},{title:"Запись",subtitle:"Посмотри запись урока",ruleKey:"recording_watched_1"},{title:"На связи",subtitle:"Напиши куратору в боте",ruleKey:"curator_message_1"},{title:"Профиль",subtitle:"Заполни класс и цель",ruleKey:"profile_complete"},{title:"100+ РТ",subtitle:"Укажи 100+ баллов в профиле",ruleKey:"score_100"},{title:"С репетитором",subtitle:"Купи пакет индив/группы",ruleKey:"individual_package_purchased"},{title:"В расписании",subtitle:"Запишись на занятие",ruleKey:"group_lesson_scheduled"},{title:"Оплата",subtitle:"Первая успешная оплата",ruleKey:"payment_success_1"}],s={teachers:[{teacherId:"kristina",name:"Кристина Денисовна",telegramId:null},{teacherId:"anna",name:"Анна Сергеевна",telegramId:null}],course:{label:"Курс District",offer:{description:"Полный доступ к программе подготовки к ЦТ",priceByn:120}},individual:{label:"Индивидуальные",offerDescription:"Занятия 1-на-1 с преподавателем под твою цель и график. 60 минут, запись и конспект остаются у тебя.",options:[{name:"1 занятие",prices:{kristina:25,anna:22}},{name:"4 занятия",prices:{kristina:90,anna:80},savingsChip:"Экономия 10 BYN"},{name:"10 занятий",prices:{kristina:200,anna:180},savingsChip:"Экономия 50 BYN"}]},group:{label:"Групповые",offerDescription:"Мини-группы: живое общение, разбор задач и мотивация. Преподаватель, материалы и домашки с проверкой.",options:[{name:"1 занятие",prices:{kristina:15,anna:13}},{name:"4 занятия",prices:{kristina:45,anna:40},savingsChip:"Экономия 15 BYN"},{name:"8 занятий",prices:{kristina:80,anna:70},savingsChip:"Экономия 40 BYN"}]},exam:{label:"До ЦТ по математике",date:"2027-05-27"},defaultCuratorTelegramId:null,achievements:n,quotes:l},a=t.groq`*[_type == "cabinetSettings" && _id == "cabinetSettings"][0]{
  teachers[]{ teacherId, name, telegramId },
  defaultCuratorTelegramId,
  courseOffer{ description, priceByn },
  coursePackages[]{ name, subtitle, isTrial, priceByn, lessonCount },
  individualPackages[]{ name, savingsChip, prices[]{ teacherId, priceByn } },
  groupPackages[]{ name, savingsChip, prices[]{ teacherId, priceByn } },
  individualOffer{ description },
  groupOffer{ description }
}`,o=t.groq`*[_type == "cabinetAsideSettings" && _id == "cabinetAsideSettings"][0]{
  cabinetQuotes[]{ text, author },
  achievements[]{ title, subtitle, ruleKey },
  examDate,
  examLabel
}`;function u(e,t){return(e??[]).filter(e=>e?.name).map(e=>{let t={};for(let r of e.prices??[])r?.teacherId&&"number"==typeof r.priceByn&&(t[r.teacherId]=r.priceByn);return{name:e.name,prices:t,savingsChip:e.savingsChip?.trim()?e.savingsChip.trim():null}}).filter(e=>Object.keys(e.prices).length>0)}async function c(){let e,t,c,d,m,f,p=(0,i.getSanityClient)(),[g,h]=await Promise.all([p.fetch(a,{},{cache:"no-store"}),p.fetch(o,{},{cache:"no-store"})]);return{...function(e){if(!e){let{quotes:e,achievements:t,exam:r,...i}=s;return i}let t=(e.teachers??[]).filter(e=>e?.teacherId&&e?.name).map(e=>({teacherId:e.teacherId,name:e.name,telegramId:"number"==typeof e.telegramId&&Number.isFinite(e.telegramId)?e.telegramId:null})),r=t.length>0?t:s.teachers,i=u(e.individualPackages,r),l=u(e.groupPackages,r),n=e.individualOffer,a=e.groupOffer;return{teachers:r,course:{label:s.course.label,offer:function(e){let t=e?.courseOffer;if(t&&"number"==typeof t.priceByn)return{description:t.description??null,priceByn:t.priceByn};let r=e?.coursePackages??[],i=r.find(e=>!e.isTrial)??r[0];return i&&"number"==typeof i.priceByn?{description:i.subtitle??i.name??s.course.offer.description,priceByn:i.priceByn}:s.course.offer}(e)},individual:{label:s.individual.label,offerDescription:n?.description?.trim()||s.individual.offerDescription,options:i.length>0?i:s.individual.options},group:{label:s.group.label,offerDescription:a?.description?.trim()||s.group.offerDescription,options:l.length>0?l:s.group.options},defaultCuratorTelegramId:"number"==typeof e.defaultCuratorTelegramId&&Number.isFinite(e.defaultCuratorTelegramId)?e.defaultCuratorTelegramId:null}}(g),quotes:(e=(h?.cabinetQuotes??null??[]).filter(e=>"string"==typeof e?.text&&e.text.trim()).map(e=>({text:e.text.trim(),author:e.author?.trim()||"District"}))).length>0?e:l,achievements:(t=(h?.achievements??null??[]).filter(e=>{var t;return e?.title&&e?.subtitle&&e?.ruleKey&&(t=e.ruleKey,r.has(t))}).map(e=>({title:e.title,subtitle:e.subtitle,ruleKey:e.ruleKey})),c=new Set,(d=t.filter(e=>!c.has(e.ruleKey)&&(c.add(e.ruleKey),!0))).length>0?d:n),exam:(m="string"==typeof h?.examDate?h.examDate:null,f="string"==typeof h?.examLabel&&h.examLabel.trim()?h.examLabel.trim():s.exam?.label??"До ЦТ по математике",m?{label:f,date:m}:s.exam)}}function d(e,t,r){if(null!=e.prices[t])return e.prices[t];for(let t of r)if(null!=e.prices[t.teacherId])return e.prices[t.teacherId];return Object.values(e.prices)[0]??null}e.s(["getCabinetPricing",()=>c,"priceForTeacher",()=>d],809617)}];

//# sourceMappingURL=%5Broot-of-the-server%5D__07b071b9._.js.map