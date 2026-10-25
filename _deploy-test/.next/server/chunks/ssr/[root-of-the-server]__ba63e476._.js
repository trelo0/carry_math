module.exports=[224361,(a,b,c)=>{b.exports=a.x("util",()=>require("util"))},792509,(a,b,c)=>{b.exports=a.x("url",()=>require("url"))},921517,(a,b,c)=>{b.exports=a.x("http",()=>require("http"))},524836,(a,b,c)=>{b.exports=a.x("https",()=>require("https"))},427699,(a,b,c)=>{b.exports=a.x("events",()=>require("events"))},688947,(a,b,c)=>{b.exports=a.x("stream",()=>require("stream"))},544751,a=>{"use strict";function b(a){return"object"==typeof a&&null!==a&&!Array.isArray(a)}var c={0:8203,1:8204,2:8205,3:8290,4:8291,5:8288,6:65279,7:8289,8:119155,9:119156,a:119157,b:119158,c:119159,d:119160,e:119161,f:119162},d={0:8203,1:8204,2:8205,3:65279},e={0:String.fromCodePoint(d[0]),1:String.fromCodePoint(d[1]),2:String.fromCodePoint(d[2]),3:String.fromCodePoint(d[3])},f=[,,,,].fill(String.fromCodePoint(d[0])).join("");function g(a,b,c="auto"){return!0===c||"auto"===c&&(!(!Number.isNaN(Number(a))||/[a-z]/i.test(a)&&!/\d+(?:[-:\/]\d+){2}(?:T\d+(?:[-:\/]\d+){1,2}(\.\d+)?Z?)?/.test(a))&&Date.parse(a)||function(a){try{new URL(a,a.startsWith("/")?"https://acme.com":void 0)}catch{return!1}return!0}(a))?a:`${a}${function(a){let b=JSON.stringify(a),c=new TextEncoder().encode(b),d="";for(let a=0;a<c.length;a++){let b=c[a];d+=e[b>>6&3]+e[b>>4&3]+e[b>>2&3]+e[3&b]}return f+d}(b)}`}Object.fromEntries(Object.entries(e).map(a=>[a[1],+a[0]])),Object.fromEntries(Object.entries(c).map(a=>a.reverse()));var h=`${Object.values(c).map(a=>`\\u{${a.toString(16)}}`).join("")}`,i=RegExp(`[${h}]{4,}`,"gu");function j(a){var b,c;return a&&JSON.parse({cleaned:(b=JSON.stringify(a)).replace(i,""),encoded:(null==(c=b.match(i))?void 0:c[0])||""}.cleaned)}a.s(["isRecord",()=>b,"stegaClean",()=>j,"y",()=>g])},419719,516631,436865,a=>{"use strict";var b=a.i(572131);function c(a,...b){let d=a.length-1;return a.slice(0,d).reduce((a,c,d)=>a+c+b[d],"")+a[d]}a.s(["groq",()=>c],516631);var d=a.i(564416);function e({preview:a,includeDrafts:b}={}){let c=!!a,f=process.env.SANITY_API_READ_TOKEN??process.env.SANITY_API_WRITE_TOKEN,g=!!(c||b),h=process.env.NEXT_PUBLIC_SANITY_API_VERSION??"2023-03-17",i=f&&1?f:void 0;return(0,d.createClient)({projectId:"2hngrocd",dataset:"production",apiVersion:h,useCdn:!g&&!i,token:i,perspective:c?"previewDrafts":g?"raw":"published"})}a.s(["getSanityClient",()=>e],436865);let f=process.env.DISTRICT_COURSE_SLUG?.trim()||"district-course",g=`districtCourse.${f}`;function h(a){if(!Array.isArray(a))return[];let b=[];for(let c of a){if("string"==typeof c){let a=c.trim();a&&b.push({title:a,description:null});continue}if(!c||"object"!=typeof c)continue;let a="string"==typeof c.title&&c.title.trim()||"string"==typeof c.text&&c.text.trim()||"";if(!a)continue;let d="string"==typeof c.description&&c.description.trim()?c.description.trim():null;b.push({title:a,description:d})}return b}function i({preview:a,includeDrafts:b}={}){return e({preview:a,includeDrafts:b??!!a})}function j({preview:a}){return a?{cache:"no-store"}:{next:{revalidate:120,tags:["sanity:course-content"]}}}let k=c`{
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
}`,l=c`{
  "sanityId": _id,
  title,
  description,
  color,
  sortOrder,
  "lessons": *[_type == "districtCourseLesson" && module._ref == ^._id] | order(moduleOrder asc) ${k}
}`,m=c`*[_type == "districtCourse" && (slug.current == $slug || _id == $docId)][0]{
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
  "modulesFromCourse": modules[]->${l},
  "modulesFromRefs": *[_type == "districtModule" && course._ref == ^._id] | order(sortOrder asc) ${l}
}`,n=c`*[_type == "districtCourse" && defined(slug.current)] | order(title asc) {
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
}`,o=c`*[_type == "districtCourse" && defined(slug.current) && coalesce(courseClosed, false) == false && coalesce(showInCatalog, true) == true && (
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
}`;function p(a){let b=a.pricing;return{priceByn:"number"==typeof b?.priceByn&&Number.isFinite(b.priceByn)?b.priceByn:"number"==typeof a.priceByn&&Number.isFinite(a.priceByn)?a.priceByn:null,grantedLessons:"number"==typeof b?.grantedLessons&&Number.isFinite(b.grantedLessons)&&b.grantedLessons>0?Math.floor(b.grantedLessons):"number"==typeof a.grantedLessons&&Number.isFinite(a.grantedLessons)&&a.grantedLessons>0?Math.floor(a.grantedLessons):null,cardText:b?.cardText?.trim()||null}}function q(a){if(!a?.sanityId||!a.title)return null;let b=a.homework;return{sanityId:a.sanityId,title:a.title,description:a.description??null,lessonNumber:a.lessonNumber??a.sortOrder??0,lessonDate:a.lessonDate??null,curriculumBlock:a.curriculumBlock??null,moduleOrder:a.moduleOrder??0,lessonType:a.lessonType??"webinar",publicationStatus:a.publicationStatus??"draft",sortOrder:a.sortOrder??a.lessonNumber??0,isTrialFree:!!a.isTrialFree,scheduledAt:a.scheduledAt??(a.lessonDate?`${a.lessonDate}T18:00:00+03:00`:null),liveUrl:a.liveUrl??null,recordingUrl:a.recordingUrl??null,mandatoryHomework:!!(a.mandatoryHomework??b?.mandatory??!0),contentChips:(a.contentChips??[]).filter(Boolean),materials:function(a){if(null!=a.lessonMaterials)return s(a.lessonMaterials);if(null!=a.lessonFiles)return s(a.lessonFiles);let b=a.materialsFileUrl;if(b){let c=a.materialsFileName??"Материалы";return[{title:c,materialType:"file",url:b,fileName:c,fileSize:null}]}return(a.materials??[]).map(a=>({title:a.title,materialType:a.materialType??"file",url:a.url??null,fileName:a.fileName??null,fileSize:a.fileSize??null}))}(a),homeworkFiles:t(a),homework:function(a){let b=t(a);if(b.length>0){let a=b[0];return{title:a.fileName??a.title,description:null,fileName:a.fileName,fileSize:a.fileSize,url:a.url,mandatory:!0}}let c=a.homework;return c?.title||c?.url?{title:c.title??"Домашнее задание",description:c.description??null,fileName:c.fileName??null,fileSize:c.fileSize??null,url:c.url??null,mandatory:!!(c.mandatory??!0)}:null}(a)}}function r(a,b){return(a??[]).filter(a=>a?.fileUrl&&(!b||a.published)).map(a=>({fileName:a.fileName??"Файл",fileUrl:a.fileUrl??null,published:!!a.published}))}function s(a){return r(a,!0).map(a=>({title:a.fileName??"Файл",materialType:"file",url:a.fileUrl,fileName:a.fileName,fileSize:null}))}function t(a){if(null!=a.lessonHomeworkFiles)return s(a.lessonHomeworkFiles);let b=a.homeworkFileUrl;if(b){let c=a.homeworkFileName??"Домашнее задание";return[{title:c,materialType:"file",url:b,fileName:c,fileSize:null}]}let c=a.homework;if(c?.url){let a=c.fileName??c.title??"Домашнее задание";return[{title:a,materialType:"file",url:c.url,fileName:a,fileSize:c.fileSize??null}]}return[]}function u(a){return a?.title&&a.description?{title:a.title,description:a.description,benefits:(a.benefits??[]).filter(Boolean),buttonLabel:a.buttonLabel??"Выбрать",subtitle:a.subtitle??void 0}:null}function v(a){if(!a)return null;let b=u(a.startFromBeginning),c=u(a.joinCurrent);return b&&c?{startFromBeginning:b,joinCurrent:c}:null}let w=c`*[_type == "districtCourseLesson" && _id in $ids]{
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
}`;async function x(a){let b=new Map;if(0===a.length)return b;let c=i({includeDrafts:!0,preview:!1});for(let d of await c.fetch(w,{ids:a},{cache:"no-store"})??[])b.set(d.sanityId,{materials:r(d.lessonMaterials,!1),homeworkFiles:r(d.lessonHomeworkFiles,!1)});return b}let y=(0,b.cache)(async function(a=f,b={}){let c=i(b),d=a===f?g:`districtCourse.${a}`;return function(a){if(!a?.sanityId||!a.title||!a.slug)return null;let b=a.modulesFromCourse??[],c=a.modulesFromRefs??[],d=new Map;for(let a of c)a?.sanityId&&d.set(a.sanityId,a);for(let a of b)a?.sanityId&&d.set(a.sanityId,a);let e=[...d.values()].filter(Boolean).map((a,b)=>{let c=(a.lessons??[]).map(q).filter(a=>null!==a).sort((a,b)=>a.moduleOrder-b.moduleOrder||a.lessonNumber-b.lessonNumber||a.sortOrder-b.sortOrder);return{sanityId:a.sanityId,title:a.title,description:a.description??null,color:a.color??"#4f7cff",sortOrder:a.sortOrder??b,lessons:c}}).sort((a,b)=>a.sortOrder-b.sortOrder),f=p(a);return{sanityId:a.sanityId,title:a.title,slug:a.slug,description:a.description??null,cabinetEyebrow:a.cabinetEyebrow??null,deliveryFormat:a.deliveryFormat??null,homeworkIntro:a.homeworkIntro??null,coverImageUrl:a.coverImageUrl??null,previewImageUrl:a.previewImageUrl??null,previewInsideItems:h(a.cabinetPreviewInside),previewAfterEnrollment:a.cabinetPreviewAfterEnrollment??null,previewAudience:a.cabinetPreviewAudience??null,publicationStatus:a.publicationStatus??"draft",showInCatalog:!1!==a.showInCatalog,courseClosed:!0===a.courseClosed,curatorName:a.curatorName??null,curatorTelegramId:"number"==typeof a.curatorTelegramId&&Number.isFinite(a.curatorTelegramId)?a.curatorTelegramId:null,checkTelegramId:"number"==typeof a.checkTelegramId&&Number.isFinite(a.checkTelegramId)?a.checkTelegramId:null,priceByn:f.priceByn,grantedLessons:f.grantedLessons,pricingCardText:f.cardText,purchaseScenarios:v(a.purchaseScenarios),activeModuleOverride:a.activeModuleOverride??null,modules:e}}(await c.fetch(m,{slug:a,docId:d},j(b)))});function z(a){return a.slug===f||a.sanityId===g||a.sanityId===`districtCourse.${a.slug}`&&a.slug===f}async function A(a,b={}){return Promise.all(a.map(async a=>{let c=await y(a.slug,b),d=c?.purchaseScenarios??null;return d?{...a,purchaseScenarios:d}:a}))}function B(a){return!0===a}function C(a){return!1!==a}function D(a){return!B(a.courseClosed)&&C(a.showInCatalog)}function E(a,b,c){return a.filter(a=>{if(B(a.courseClosed))return!1;if(C(a.showInCatalog))return!0;let d=b.get(a.slug);return null!=d&&c.has(d)})}let F=(0,b.cache)(async function(a={}){let b=i(a),c=await b.fetch(n,{},j(a)),d=[];for(let a of c??[])a?.sanityId&&a.title&&a.slug&&d.push({sanityId:a.sanityId,title:a.title,slug:a.slug,description:a.description??null,cabinetEyebrow:a.cabinetEyebrow??null,deliveryFormat:a.deliveryFormat??null,homeworkIntro:a.homeworkIntro??null,publicationStatus:a.publicationStatus??"draft",showInCatalog:!1!==a.showInCatalog,courseClosed:!0===a.courseClosed,coverImageUrl:a.coverImageUrl??null,previewImageUrl:a.previewImageUrl??null,previewInsideItems:h(a.cabinetPreviewInside),previewAfterEnrollment:a.cabinetPreviewAfterEnrollment??null,previewAudience:a.cabinetPreviewAudience??null,curatorName:a.curatorName??null,curatorTelegramId:"number"==typeof a.curatorTelegramId&&Number.isFinite(a.curatorTelegramId)?a.curatorTelegramId:null,moduleCount:"number"==typeof a.moduleCount&&Number.isFinite(a.moduleCount)?Math.max(0,Math.floor(a.moduleCount)):0,totalLessons:"number"==typeof a.totalLessons&&Number.isFinite(a.totalLessons)?Math.max(0,Math.floor(a.totalLessons)):0,modulePreviews:[]});return d}),G=(0,b.cache)(async function(a={}){let b=i(a),c=await b.fetch(o,{},j(a)),d=[];for(let a of c??[]){if(!a?.sanityId||!a.slug||!a.title)continue;let b=p(a);null!=b.priceByn&&!(b.priceByn<0)&&(null==b.grantedLessons||b.grantedLessons<1||d.push({sanityId:a.sanityId,slug:a.slug,title:a.title,description:a.description??null,cardText:b.cardText,priceByn:b.priceByn,grantedLessons:b.grantedLessons,purchaseScenarios:v(a.purchaseScenarios??null)}))}return d});async function H(a,b={}){return(await G(b)).find(b=>b.slug===a)??null}function I(a){let b=[];for(let c of a.modules)b.push(...c.lessons);return b}function J(a){return I(a).filter(a=>"published"===a.publicationStatus).length}function K(a){return I(a).filter(a=>"archived"!==a.publicationStatus).length}function L(a,b){return!!("published"===a.publicationStatus||"archived"===a.publicationStatus&&b.has(a.sanityId))}function M(a){return"assignment"===a?"milestone":"test"===a?"practice":a}function N(a){if(a.recordingUrl)return"completed";if(!a.scheduledAt)return null;let b=new Date(a.scheduledAt).getTime();return Number.isNaN(b)?null:b>Date.now()?"scheduled":a.liveUrl?"live":"completed"}function O(a){return a.recordingUrl?a.recordingUrl:a.liveUrl?a.liveUrl:a.homework?.url?a.homework.url:a.materials.find(a=>a.url)?.url??null}function P(a){return a.recordingUrl?"Смотреть запись":"webinar"===a.lessonType&&a.liveUrl?"Смотреть трансляцию":"Открыть занятие"}a.s(["DEFAULT_LESSON_CONTENT_CHIPS",0,["Теория","Разбор задач","Практика","Домашнее задание"],"DISTRICT_COURSE_DOC_ID",0,g,"DISTRICT_COURSE_SLUG",0,f,"attachPurchaseScenariosToOffers",()=>A,"countCourseLessons",()=>K,"countPublishedLessons",()=>J,"deriveWebinarSessionStatus",()=>N,"fetchCuratorLessonFilesMap",()=>x,"filterCourseSummariesForCabinetAccess",()=>E,"flattenCourseLessons",()=>I,"getCoursePaymentOfferBySlug",()=>H,"getDistrictCourseContent",0,y,"isDistrictCourseFullyClosed",()=>B,"isDistrictCoursePublicInCatalog",()=>C,"isDistrictCoursePurchaseOffer",()=>z,"isDistrictCourseVisibleInCabinet",()=>D,"isLessonVisible",()=>L,"listCoursePaymentOffers",0,G,"listDistrictCourseSummaries",0,F,"mapLessonKind",()=>M,"resolveLessonActionLabel",()=>P,"resolveLessonActionUrl",()=>O],419719)},419615,a=>{"use strict";var b=a.i(820210),c=a.i(419719),d=a.i(896640);let e="checked_homework",f="id, telegram_id, sanity_lesson_id, homework_status, lesson_first_opened_at, homework_deadline_at, homework_remaining_ms, homework_overdue_at, hw_remind_12h_at, hw_remind_6h_at, hw_remind_2h_at, hw_overdue_student_at, hw_overdue_curator_at, updated_at";function g(a){let b=String(a?.message??a);return b.includes("lesson_first_opened_at")||b.includes("homework_deadline_at")||b.includes("homework_remaining_ms")||b.includes("Could not find")||b.includes("does not exist")}function h(a,b=new Date){if(!a)return"none";let c=a.homework_status;if("approved"===c)return"approved";if("submitted"===c)return"waiting_review";if("rejected"===c){if(a.homework_overdue_at)return"overdue";let c=a.homework_deadline_at?Date.parse(a.homework_deadline_at):NaN;if(Number.isFinite(c)){let a=c-b.getTime();if(a<=0)return"overdue";if(a<=432e5)return"soon"}return"revision"}if(!a.homework_deadline_at)return"none";if(a.homework_overdue_at)return"overdue";let d=Date.parse(a.homework_deadline_at);if(!Number.isFinite(d))return"none";let e=d-b.getTime();return e<=0?"overdue":e<=432e5?"soon":"ok"}async function i(a,b,c){let{data:d,error:e}=await a.from("course_lesson_student_progress").select(f).eq("telegram_id",b).eq("sanity_lesson_id",c).maybeSingle();if(e){if(g(e))return null;throw e}return d??null}async function j(b,d,e){let{resolveCourseForSanityLesson:f}=await a.A(76361),g=await f(b,d,e);if(g)return(0,c.flattenCourseLessons)(g.content).find(a=>a.sanityId===e)??null;let{listDistrictCourseSummaries:h}=await a.A(468312);for(let a of(await h().catch(()=>[]))){let b=await (0,c.getDistrictCourseContent)(a.slug).catch(()=>null);if(!b)continue;let d=(0,c.flattenCourseLessons)(b).find(a=>a.sanityId===e);if(d)return d}let i=await (0,c.getDistrictCourseContent)().catch(()=>null);return i?(0,c.flattenCourseLessons)(i).find(a=>a.sanityId===e)??null:null}async function k(a,c,h,k){if("self_paced_no_hw_check"===(k?.learningMode??e))return null;let l=await j(a,c,h);if(!l||!(0,d.lessonHasHomework)(l)||k?.hasAccess===!1||l.isTrialFree&&!(k?.courseId?await (0,b.studentHasCourseAccessForCourse)(a,c,k.courseId):await (0,b.studentHasCourseProductAccess)(a,c)))return null;let m=await i(a,c,h);if(m?.homework_deadline_at||m?.homework_status==="approved"||m?.homework_status==="submitted")return m;let n=new Date,o=n.toISOString(),p=new Date(n.getTime()+2592e5).toISOString();if(m){let{data:b,error:d}=await a.from("course_lesson_student_progress").update({lesson_first_opened_at:m.lesson_first_opened_at??o,homework_deadline_at:p,homework_remaining_ms:2592e5,homework_overdue_at:null,updated_at:o}).eq("telegram_id",c).eq("sanity_lesson_id",h).is("homework_deadline_at",null).select(f).maybeSingle();if(d){if(g(d))return m;throw d}return b||i(a,c,h)}let{data:q,error:r}=await a.from("course_lesson_student_progress").insert({telegram_id:c,sanity_lesson_id:h,homework_status:"pending",lesson_first_opened_at:o,homework_deadline_at:p,updated_at:o}).select(f).maybeSingle();if(r){if(g(r))return null;let b=await i(a,c,h);if(b?.homework_deadline_at)return b;if(b){let{data:d,error:e}=await a.from("course_lesson_student_progress").update({lesson_first_opened_at:b.lesson_first_opened_at??o,homework_deadline_at:p,homework_remaining_ms:2592e5,homework_overdue_at:null,updated_at:o}).eq("telegram_id",c).eq("sanity_lesson_id",h).is("homework_deadline_at",null).select(f).maybeSingle();if(e&&!g(e))throw e;return d||i(a,c,h)}throw r}return q??null}async function l(a,b,c,d=new Date){let e=await i(a,b,c),f=e?.homework_deadline_at?Date.parse(e.homework_deadline_at):NaN;if(!(Number.isFinite(f)||"number"==typeof e?.homework_remaining_ms))return{remainingMs:2592e5,wasOverdue:!1};let h=0;Number.isFinite(f)?h=Math.max(0,f-d.getTime()):"number"==typeof e?.homework_remaining_ms&&(h=Math.max(0,e.homework_remaining_ms));let j=h<=0||!!e?.homework_overdue_at,k={homework_remaining_ms:h,updated_at:d.toISOString()};j&&!e?.homework_overdue_at&&(k.homework_overdue_at=d.toISOString());let{error:m}=await a.from("course_lesson_student_progress").update(k).eq("telegram_id",b).eq("sanity_lesson_id",c);if(m&&!g(m))throw m;return{remainingMs:h,wasOverdue:j}}async function m(a,b,c,d=new Date){let e=await i(a,b,c),h=Math.max(0,Number(e?.homework_remaining_ms??0)),j=h<=0,k=d.toISOString(),l={homework_deadline_at:j?k:new Date(d.getTime()+h).toISOString(),homework_remaining_ms:h,updated_at:k};j&&!e?.homework_overdue_at&&(l.homework_overdue_at=k);let{data:n,error:o}=await a.from("course_lesson_student_progress").update(l).eq("telegram_id",b).eq("sanity_lesson_id",c).select(f).maybeSingle();if(o){if(g(o))return{progress:e,remainingMs:h,immediatelyOverdue:j};throw o}return{progress:n??e,remainingMs:h,immediatelyOverdue:j}}async function n(a,b,c){let d=new Date().toISOString(),{error:e}=await a.from("course_lesson_student_progress").update({homework_remaining_ms:0,updated_at:d}).eq("telegram_id",b).eq("sanity_lesson_id",c);if(e&&!g(e))throw e}function o(a,b,c=new Date){if(b)return b;if(!a)return null;let d=Date.parse(a);return!Number.isFinite(d)||d>c.getTime()?null:c.toISOString()}async function p(a,b=200,c){let d=a.from("course_lesson_student_progress").select(f).in("homework_status",["pending","rejected"]).not("homework_deadline_at","is",null).order("homework_deadline_at",{ascending:!0}).limit(b);c?.telegramIds?.length&&(d=d.in("telegram_id",c.telegramIds));let{data:e,error:h}=await d;if(h){if(g(h))return[];throw h}return e??[]}async function q(a,b,c,d){let e=new Date().toISOString(),{data:f,error:h}=await a.from("course_lesson_student_progress").update({[d]:e,updated_at:e}).eq("telegram_id",b).eq("sanity_lesson_id",c).is(d,null).select("id").maybeSingle();if(h){if(g(h))return!1;throw h}return!!f}async function r(a,b,c,d=new Date){let e=await i(a,b,c);if(!e?.homework_deadline_at)return!1;if(e.homework_overdue_at)return!0;let f=Date.parse(e.homework_deadline_at);if(!Number.isFinite(f)||f>d.getTime())return!1;let{data:h,error:j}=await a.from("course_lesson_student_progress").update({homework_overdue_at:d.toISOString(),updated_at:d.toISOString()}).eq("telegram_id",b).eq("sanity_lesson_id",c).is("homework_overdue_at",null).select("id").maybeSingle();if(j){if(g(j))return!1;throw j}return!!h||!!e.homework_overdue_at}async function s(b,d,e){let f=await (0,c.getDistrictCourseContent)(e||void 0).catch(()=>null);if(!f)return;let h=(0,c.flattenCourseLessons)(f).find(a=>a.isTrialFree);if(!h?.sanityId)return;let j=await i(b,d,h.sanityId);if(j?.homework_status==="approved"||j?.homework_status==="submitted")return;let{resolveCourseIdForContent:k}=await a.A(203928),l=await k(b,f);if(l){let{loadJoinCurrentGateContext:c,isJoinArchiveSanityId:e}=await a.A(673101);if(e(await c(b,d,l,f),h.sanityId)){if(j&&(j.homework_deadline_at||j.homework_overdue_at||null!=j.homework_remaining_ms)){let a=new Date().toISOString(),{error:c}=await b.from("course_lesson_student_progress").update({homework_deadline_at:null,homework_remaining_ms:null,homework_overdue_at:null,hw_remind_12h_at:null,hw_remind_6h_at:null,hw_remind_2h_at:null,hw_overdue_student_at:null,hw_overdue_curator_at:null,updated_at:a}).eq("telegram_id",d).eq("sanity_lesson_id",h.sanityId);if(c&&!g(c))throw c}return}let{data:i}=await b.from("course_enrollments").select("started_at").eq("telegram_id",d).eq("course_id",l).eq("status","active").maybeSingle(),k=i?.started_at?Date.parse(String(i.started_at)):NaN,m=j?.homework_deadline_at?Date.parse(String(j.homework_deadline_at)):NaN;if(Number.isFinite(k)&&Number.isFinite(m)&&m>=k-6e4)return}let m=new Date,n=m.toISOString(),o=new Date(m.getTime()+2592e5).toISOString(),p={lesson_first_opened_at:j?.lesson_first_opened_at??n,homework_deadline_at:o,homework_remaining_ms:2592e5,homework_overdue_at:null,hw_remind_12h_at:null,hw_remind_6h_at:null,hw_remind_2h_at:null,hw_overdue_student_at:null,hw_overdue_curator_at:null,updated_at:n};if(j){let{error:a}=await b.from("course_lesson_student_progress").update(p).eq("telegram_id",d).eq("sanity_lesson_id",h.sanityId);if(a&&!g(a))throw a;return}let{error:q}=await b.from("course_lesson_student_progress").insert({telegram_id:d,sanity_lesson_id:h.sanityId,homework_status:"pending",...p});if(q&&!g(q))throw q}async function t(e,f,h,j){let{resolveCourseIdForContent:l}=await a.A(203928),m=j??await l(e,h);if(!m||!await (0,b.studentHasCourseAccessForCourse)(e,f,m))return;let n=(0,c.flattenCourseLessons)(h).find(a=>a.isTrialFree);if(!n?.sanityId||!(0,d.lessonHasHomework)(n))return;if(m){let{loadJoinCurrentGateContext:b,isJoinArchiveSanityId:c}=await a.A(673101);if(c(await b(e,f,m,h),n.sanityId))return}let o=await i(e,f,n.sanityId);if(o?.homework_deadline_at||o?.homework_status==="approved"||o?.homework_status==="submitted")return;let{data:p,error:q}=await e.from("course_lesson_student_progress").select("recording_watched_at, live_attended_at").eq("telegram_id",f).eq("sanity_lesson_id",n.sanityId).maybeSingle();if(q&&!g(q))throw q;(p?.recording_watched_at||p?.live_attended_at)&&await k(e,f,n.sanityId,{hasAccess:!0,courseId:m})}a.s(["DEADLINE_SOON_MS",0,432e5,"DEFAULT_LEARNING_MODE",0,e,"HOMEWORK_DEADLINE_MS",0,2592e5,"claimDeadlineReminder",()=>q,"deadlineUiState",()=>h,"ensureHomeworkDeadlineStarted",()=>k,"ensureOverdueMarked",()=>r,"ensureTrialHomeworkDeadlineIfEligible",()=>t,"finalizeDeadlineOnApprove",()=>n,"listActiveHomeworkDeadlines",()=>p,"markOverdueIfNeeded",()=>o,"pauseDeadlineOnSubmit",()=>l,"resetTrialHomeworkDeadlineOnCoursePurchase",()=>s,"resumeDeadlineOnReject",()=>m])}];

//# sourceMappingURL=%5Broot-of-the-server%5D__ba63e476._.js.map