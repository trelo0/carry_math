module.exports=[248541,a=>{"use strict";let b=["guest","student","staff","curator","check","teacher","mentor","admin","test"],c={guest:"гость",student:"ученик",staff:"сотрудник",curator:"куратор",check:"проверяющий ДЗ",teacher:"преподаватель",mentor:"куратор",admin:"админ",test:"тестер"};function d(a){return c["mentor"===a?"curator":l(a)?a:"guest"]}function e(a){return(process.env.ADMIN_TELEGRAM_IDS??"").split(",").map(a=>a.trim()).filter(Boolean).includes(String(a))}function f(a){return e(a)}function g(a,b){return e(a)||"admin"===b}function h(a,b){return e(a)||"admin"===b||"test"===b}function i(a,b){return h(a,b)}function j(a,b){return h(b,a.role)&&a.viewRole&&"test"!==a.viewRole?a.viewRole:a.role}function k(a,b){let d=j(a,b),e=h(b,a.role)&&a.viewRole&&"test"!==a.viewRole&&a.viewRole!==a.role?a.viewRole:null;return{role:d,testFooter:e?`

🧪 Тест-маска: ${c[e]}. Сброс — /as reset.`:""}}function l(a){return b.includes(a)}function m(a){return"mentor"===a?"curator":l(a)?a:"guest"}function n(a,b){let c=new Set;for(let d of(c.add(m(a)),b??[]))d&&c.add(m(d));return[...c]}function o(a,b){let c="mentor"===b?"curator":b;return a.some(a=>("mentor"===a?"curator":a)===c)}function p(a){return o(a,"curator")&&!o(a,"teacher")&&!o(a,"student")}function q(a){return(o(a,"staff")||o(a,"curator")||o(a,"check")||o(a,"teacher")||o(a,"admin"))&&!o(a,"student")}function r(a,b){return e(b)||o(a,"admin")||o(a,"teacher")||o(a,"staff")}function s(a,b){return e(b)||o(a,"admin")}function t(a,b){return o(a,"teacher")||s(a,b)}async function u(a,b){let{data:c,error:d}=await a.from("bot_members").select("role, extra_roles").eq("telegram_id",b).maybeSingle();if(d)throw d;if(!c)return["guest"];let e=Array.isArray(c.extra_roles)?c.extra_roles:[];return n(String(c.role??"guest"),e)}function v(a){let b=new Set,c=[];for(let d of a){let a=m(d);"mentor"===a||b.has(a)||(b.add(a),c.push(a))}return c}async function w(a,b,c){let{data:d,error:e}=await a.from("bot_members").update({extra_roles:v(c),updated_at:new Date().toISOString()}).eq("telegram_id",b).select("telegram_id");if(e)throw e;return(d??[]).length>0}async function x(a,b,c){let{data:d,error:e}=await a.from("bot_members").select("role, extra_roles").eq("telegram_id",b).maybeSingle();if(e)throw e;if(!d)return!1;let f=m(String(d.role??"guest")),g=m(c);return g===f||w(a,b,v([...n(f,Array.isArray(d.extra_roles)?d.extra_roles:[]),g].filter(a=>a!==f)))}async function y(a,b,c){let{data:d,error:e}=await a.from("bot_members").select("role, extra_roles").eq("telegram_id",b).maybeSingle();if(e)throw e;if(!d)return!1;let f=m(c),g=m(String(d.role??"guest"));return w(a,b,v(n(g,Array.isArray(d.extra_roles)?d.extra_roles:[]).filter(a=>a!==f&&a!==g)))}async function z(a,b,c,d="guest"){let{data:f,error:g}=await a.from("bot_members").select("role, view_role").eq("telegram_id",b).maybeSingle();if(g)throw g;let h=c?Object.fromEntries(Object.entries(c).filter(([,a])=>null!=a&&""!==a)):{};if(f){if(Object.keys(h).length>0){let{error:c}=await a.from("bot_members").update({...h,updated_at:new Date().toISOString()}).eq("telegram_id",b);if(c)throw c}return{role:l(f.role)?f.role:"guest",viewRole:l(f.view_role)?f.view_role:null}}let i=e(b)?"admin":d,{error:j}=await a.from("bot_members").insert({telegram_id:b,role:i,...h});if(j)throw j;return{role:i,viewRole:null}}async function A(a,b,c){let{error:d}=await a.from("bot_members").update({view_role:c,updated_at:new Date().toISOString()}).eq("telegram_id",b);if(d)throw d}async function B(a,b,c){let{data:d,error:e}=await a.from("bot_members").update({role:c,updated_at:new Date().toISOString()}).eq("telegram_id",b).select();if(e)throw e;return(d??[]).length>0}async function C(a){let{data:b}=await a.from("bot_members").select("telegram_id, role, phone, full_name").order("created_at",{ascending:!0}).limit(100);return b??[]}let D="telegram_id, role, phone, full_name, chat_id";async function E(a,b){let{data:c,error:d}=await a.from("bot_members").select(D).eq("telegram_id",b).maybeSingle();if(d)throw d;return c||null}async function F(a,b,c=20){let d=b.trim().replace(/[,()]/g,"");if(!d)return[];let e=d.replace(/\D/g,""),f=d.replace(/^#/,""),g=[`full_name.ilike.%${d}%`,`phone.ilike.%${e||d}%`];/^\d+$/.test(f)&&g.push(`telegram_id.eq.${f}`),/^@/.test(d)&&g.push(`full_name.ilike.%${d.slice(1)}%`);let{data:h,error:i}=await a.from("bot_members").select(D).or(g.join(",")).order("created_at",{ascending:!1}).limit(c);if(i)throw i;return h??[]}async function G(a,b,c,d){let e=c*d,{data:f,error:g,count:h}=await a.from("bot_members").select(D,{count:"exact"}).in("role",b).order("created_at",{ascending:!1}).range(e,e+d-1);if(g)throw g;return{members:f??[],total:h??0}}async function H(a,b){let c=b.replace(/\D/g,"");if(c.length<5)return 0;let{data:d,error:e}=await a.from("leads").select("id").ilike("contact",`%${c}%`);if(e)throw e;return(d??[]).length}async function I(a,b){let{data:c,error:d}=await a.from("bot_members").select("role, moderation_status").eq("telegram_id",b).maybeSingle();if(d)throw d;if(!c)return null;let e="blocked"===c.moderation_status||"restricted"===c.moderation_status?c.moderation_status:"active";return{role:c.role,moderationStatus:e}}async function J(a,b,c,d){let e=new Date().toISOString(),f={moderation_status:c,updated_at:e};"blocked"===c?(f.blocked_at=e,f.blocked_by=d):"restricted"===c?(f.restricted_at=e,f.restricted_by=d):(f.blocked_at=null,f.blocked_by=null,f.restricted_at=null,f.restricted_by=null);let{data:g,error:h}=await a.from("bot_members").update(f).eq("telegram_id",b).select("telegram_id");if(h)throw h;return(g??[]).length>0}async function K(a,b,c,d){let e=c*d,{data:f,error:g,count:h}=await a.from("bot_members").select(`${D}, moderation_status, blocked_at, restricted_at`,{count:"exact"}).eq("moderation_status",b).order("updated_at",{ascending:!1}).range(e,e+d-1);if(g)throw g;return{members:f??[],total:h??0}}a.s(["BOT_ROLES",0,b,"ROLE_LABELS",0,c,"addMemberExtraRole",()=>x,"canManageBotRoles",()=>h,"canManageTeacherCabinet",()=>t,"canUseTesterTools",()=>i,"combineMemberRoles",()=>n,"countLeadsByPhone",()=>H,"ensureMember",()=>z,"getMember",()=>E,"getModerationInfo",()=>I,"hasCreatorPowers",()=>g,"hasFullStaffPreview",()=>s,"isAdminEnv",()=>e,"isBotRole",()=>l,"isCreatorTelegramId",()=>f,"isCuratorOnlyMember",()=>p,"isStaffOnlyMember",()=>q,"listMembers",()=>C,"listMembersByModeration",()=>K,"listMembersInRoles",()=>G,"loadMemberRoles",()=>u,"memberCanAccessStaffCabinet",()=>r,"memberHasRole",()=>o,"normalizeMemberRole",()=>m,"removeMemberExtraRole",()=>y,"resolveEffectiveRole",()=>j,"resolveEffectiveRoleWithFooter",()=>k,"roleLabel",()=>d,"searchMembers",()=>F,"setMemberExtraRoles",()=>w,"setModerationStatus",()=>J,"setRole",()=>B,"setViewRole",()=>A])},607136,a=>{"use strict";var b=a.i(800717),c=a.i(217562),d=a.i(74582);let e=process.env.DISTRICT_COURSE_SLUG?.trim()||"district-course",f=`districtCourse.${e}`;function g(a){if(!Array.isArray(a))return[];let b=[];for(let c of a){if("string"==typeof c){let a=c.trim();a&&b.push({title:a,description:null});continue}if(!c||"object"!=typeof c)continue;let a="string"==typeof c.title&&c.title.trim()||"string"==typeof c.text&&c.text.trim()||"";if(!a)continue;let d="string"==typeof c.description&&c.description.trim()?c.description.trim():null;b.push({title:a,description:d})}return b}function h({preview:a,includeDrafts:b}={}){return(0,d.getSanityClient)({preview:a,includeDrafts:b??!!a})}function i({preview:a}){return a?{cache:"no-store"}:{next:{revalidate:120,tags:["sanity:course-content"]}}}let j=c.groq`{
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
}`,k=c.groq`{
  "sanityId": _id,
  title,
  description,
  color,
  sortOrder,
  "lessons": *[_type == "districtCourseLesson" && module._ref == ^._id] | order(moduleOrder asc) ${j}
}`,l=c.groq`*[_type == "districtCourse" && (slug.current == $slug || _id == $docId)][0]{
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
  "modulesFromCourse": modules[]->${k},
  "modulesFromRefs": *[_type == "districtModule" && course._ref == ^._id] | order(sortOrder asc) ${k}
}`,m=c.groq`*[_type == "districtCourse" && defined(slug.current)] | order(title asc) {
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
}`,n=c.groq`*[_type == "districtCourse" && defined(slug.current) && coalesce(courseClosed, false) == false && coalesce(showInCatalog, true) == true && (
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
}`;function o(a){let b=a.pricing;return{priceByn:"number"==typeof b?.priceByn&&Number.isFinite(b.priceByn)?b.priceByn:"number"==typeof a.priceByn&&Number.isFinite(a.priceByn)?a.priceByn:null,grantedLessons:"number"==typeof b?.grantedLessons&&Number.isFinite(b.grantedLessons)&&b.grantedLessons>0?Math.floor(b.grantedLessons):"number"==typeof a.grantedLessons&&Number.isFinite(a.grantedLessons)&&a.grantedLessons>0?Math.floor(a.grantedLessons):null,cardText:b?.cardText?.trim()||null}}function p(a){if(!a?.sanityId||!a.title)return null;let b=a.homework;return{sanityId:a.sanityId,title:a.title,description:a.description??null,lessonNumber:a.lessonNumber??a.sortOrder??0,lessonDate:a.lessonDate??null,curriculumBlock:a.curriculumBlock??null,moduleOrder:a.moduleOrder??0,lessonType:a.lessonType??"webinar",publicationStatus:a.publicationStatus??"draft",sortOrder:a.sortOrder??a.lessonNumber??0,isTrialFree:!!a.isTrialFree,scheduledAt:a.scheduledAt??(a.lessonDate?`${a.lessonDate}T18:00:00+03:00`:null),liveUrl:a.liveUrl??null,recordingUrl:a.recordingUrl??null,mandatoryHomework:!!(a.mandatoryHomework??b?.mandatory??!0),contentChips:(a.contentChips??[]).filter(Boolean),materials:function(a){if(null!=a.lessonMaterials)return r(a.lessonMaterials);if(null!=a.lessonFiles)return r(a.lessonFiles);let b=a.materialsFileUrl;if(b){let c=a.materialsFileName??"Материалы";return[{title:c,materialType:"file",url:b,fileName:c,fileSize:null}]}return(a.materials??[]).map(a=>({title:a.title,materialType:a.materialType??"file",url:a.url??null,fileName:a.fileName??null,fileSize:a.fileSize??null}))}(a),homeworkFiles:s(a),homework:function(a){let b=s(a);if(b.length>0){let a=b[0];return{title:a.fileName??a.title,description:null,fileName:a.fileName,fileSize:a.fileSize,url:a.url,mandatory:!0}}let c=a.homework;return c?.title||c?.url?{title:c.title??"Домашнее задание",description:c.description??null,fileName:c.fileName??null,fileSize:c.fileSize??null,url:c.url??null,mandatory:!!(c.mandatory??!0)}:null}(a)}}function q(a,b){return(a??[]).filter(a=>a?.fileUrl&&(!b||a.published)).map(a=>({fileName:a.fileName??"Файл",fileUrl:a.fileUrl??null,published:!!a.published}))}function r(a){return q(a,!0).map(a=>({title:a.fileName??"Файл",materialType:"file",url:a.fileUrl,fileName:a.fileName,fileSize:null}))}function s(a){if(null!=a.lessonHomeworkFiles)return r(a.lessonHomeworkFiles);let b=a.homeworkFileUrl;if(b){let c=a.homeworkFileName??"Домашнее задание";return[{title:c,materialType:"file",url:b,fileName:c,fileSize:null}]}let c=a.homework;if(c?.url){let a=c.fileName??c.title??"Домашнее задание";return[{title:a,materialType:"file",url:c.url,fileName:a,fileSize:c.fileSize??null}]}return[]}function t(a){return a?.title&&a.description?{title:a.title,description:a.description,benefits:(a.benefits??[]).filter(Boolean),buttonLabel:a.buttonLabel??"Выбрать",subtitle:a.subtitle??void 0}:null}function u(a){if(!a)return null;let b=t(a.startFromBeginning),c=t(a.joinCurrent);return b&&c?{startFromBeginning:b,joinCurrent:c}:null}let v=c.groq`*[_type == "districtCourseLesson" && _id in $ids]{
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
}`;async function w(a){let b=new Map;if(0===a.length)return b;let c=h({includeDrafts:!0,preview:!1});for(let d of await c.fetch(v,{ids:a},{cache:"no-store"})??[])b.set(d.sanityId,{materials:q(d.lessonMaterials,!1),homeworkFiles:q(d.lessonHomeworkFiles,!1)});return b}let x=(0,b.cache)(async function(a=e,b={}){let c=h(b),d=a===e?f:`districtCourse.${a}`;return function(a){if(!a?.sanityId||!a.title||!a.slug)return null;let b=a.modulesFromCourse??[],c=a.modulesFromRefs??[],d=new Map;for(let a of c)a?.sanityId&&d.set(a.sanityId,a);for(let a of b)a?.sanityId&&d.set(a.sanityId,a);let e=[...d.values()].filter(Boolean).map((a,b)=>{let c=(a.lessons??[]).map(p).filter(a=>null!==a).sort((a,b)=>a.moduleOrder-b.moduleOrder||a.lessonNumber-b.lessonNumber||a.sortOrder-b.sortOrder);return{sanityId:a.sanityId,title:a.title,description:a.description??null,color:a.color??"#4f7cff",sortOrder:a.sortOrder??b,lessons:c}}).sort((a,b)=>a.sortOrder-b.sortOrder),f=o(a);return{sanityId:a.sanityId,title:a.title,slug:a.slug,description:a.description??null,cabinetEyebrow:a.cabinetEyebrow??null,deliveryFormat:a.deliveryFormat??null,homeworkIntro:a.homeworkIntro??null,coverImageUrl:a.coverImageUrl??null,previewImageUrl:a.previewImageUrl??null,previewInsideItems:g(a.cabinetPreviewInside),previewAfterEnrollment:a.cabinetPreviewAfterEnrollment??null,previewAudience:a.cabinetPreviewAudience??null,publicationStatus:a.publicationStatus??"draft",showInCatalog:!1!==a.showInCatalog,courseClosed:!0===a.courseClosed,curatorName:a.curatorName??null,curatorTelegramId:"number"==typeof a.curatorTelegramId&&Number.isFinite(a.curatorTelegramId)?a.curatorTelegramId:null,checkTelegramId:"number"==typeof a.checkTelegramId&&Number.isFinite(a.checkTelegramId)?a.checkTelegramId:null,priceByn:f.priceByn,grantedLessons:f.grantedLessons,pricingCardText:f.cardText,purchaseScenarios:u(a.purchaseScenarios),activeModuleOverride:a.activeModuleOverride??null,modules:e}}(await c.fetch(l,{slug:a,docId:d},i(b)))});function y(a){return a.slug===e||a.sanityId===f||a.sanityId===`districtCourse.${a.slug}`&&a.slug===e}async function z(a,b={}){return Promise.all(a.map(async a=>{let c=await x(a.slug,b),d=c?.purchaseScenarios??null;return d?{...a,purchaseScenarios:d}:a}))}function A(a){return!0===a}function B(a){return!1!==a}function C(a){return!A(a.courseClosed)&&B(a.showInCatalog)}function D(a,b,c){return a.filter(a=>{if(A(a.courseClosed))return!1;if(B(a.showInCatalog))return!0;let d=b.get(a.slug);return null!=d&&c.has(d)})}let E=(0,b.cache)(async function(a={}){let b=h(a),c=await b.fetch(m,{},i(a)),d=[];for(let a of c??[])a?.sanityId&&a.title&&a.slug&&d.push({sanityId:a.sanityId,title:a.title,slug:a.slug,description:a.description??null,cabinetEyebrow:a.cabinetEyebrow??null,deliveryFormat:a.deliveryFormat??null,homeworkIntro:a.homeworkIntro??null,publicationStatus:a.publicationStatus??"draft",showInCatalog:!1!==a.showInCatalog,courseClosed:!0===a.courseClosed,coverImageUrl:a.coverImageUrl??null,previewImageUrl:a.previewImageUrl??null,previewInsideItems:g(a.cabinetPreviewInside),previewAfterEnrollment:a.cabinetPreviewAfterEnrollment??null,previewAudience:a.cabinetPreviewAudience??null,curatorName:a.curatorName??null,curatorTelegramId:"number"==typeof a.curatorTelegramId&&Number.isFinite(a.curatorTelegramId)?a.curatorTelegramId:null,moduleCount:"number"==typeof a.moduleCount&&Number.isFinite(a.moduleCount)?Math.max(0,Math.floor(a.moduleCount)):0,totalLessons:"number"==typeof a.totalLessons&&Number.isFinite(a.totalLessons)?Math.max(0,Math.floor(a.totalLessons)):0,modulePreviews:[]});return d}),F=(0,b.cache)(async function(a={}){let b=h(a),c=await b.fetch(n,{},i(a)),d=[];for(let a of c??[]){if(!a?.sanityId||!a.slug||!a.title)continue;let b=o(a);null!=b.priceByn&&!(b.priceByn<0)&&(null==b.grantedLessons||b.grantedLessons<1||d.push({sanityId:a.sanityId,slug:a.slug,title:a.title,description:a.description??null,cardText:b.cardText,priceByn:b.priceByn,grantedLessons:b.grantedLessons,purchaseScenarios:u(a.purchaseScenarios??null)}))}return d});async function G(a,b={}){return(await F(b)).find(b=>b.slug===a)??null}function H(a){let b=[];for(let c of a.modules)b.push(...c.lessons);return b}function I(a){return H(a).filter(a=>"published"===a.publicationStatus).length}function J(a){return H(a).filter(a=>"archived"!==a.publicationStatus).length}function K(a,b){return!!("published"===a.publicationStatus||"archived"===a.publicationStatus&&b.has(a.sanityId))}function L(a){return"assignment"===a?"milestone":"test"===a?"practice":a}function M(a){if(a.recordingUrl)return"completed";if(!a.scheduledAt)return null;let b=new Date(a.scheduledAt).getTime();return Number.isNaN(b)?null:b>Date.now()?"scheduled":a.liveUrl?"live":"completed"}function N(a){return a.recordingUrl?a.recordingUrl:a.liveUrl?a.liveUrl:a.homework?.url?a.homework.url:a.materials.find(a=>a.url)?.url??null}function O(a){return a.recordingUrl?"Смотреть запись":"webinar"===a.lessonType&&a.liveUrl?"Смотреть трансляцию":"Открыть занятие"}a.s(["DEFAULT_LESSON_CONTENT_CHIPS",0,["Теория","Разбор задач","Практика","Домашнее задание"],"DISTRICT_COURSE_DOC_ID",0,f,"DISTRICT_COURSE_SLUG",0,e,"attachPurchaseScenariosToOffers",()=>z,"countCourseLessons",()=>J,"countPublishedLessons",()=>I,"deriveWebinarSessionStatus",()=>M,"fetchCuratorLessonFilesMap",()=>w,"filterCourseSummariesForCabinetAccess",()=>D,"flattenCourseLessons",()=>H,"getCoursePaymentOfferBySlug",()=>G,"getDistrictCourseContent",0,x,"isDistrictCourseFullyClosed",()=>A,"isDistrictCoursePublicInCatalog",()=>B,"isDistrictCoursePurchaseOffer",()=>y,"isDistrictCourseVisibleInCabinet",()=>C,"isLessonVisible",()=>K,"listCoursePaymentOffers",0,F,"listDistrictCourseSummaries",0,E,"mapLessonKind",()=>L,"resolveLessonActionLabel",()=>O,"resolveLessonActionUrl",()=>N])}];

//# sourceMappingURL=src_lib_a83b24ad._.js.map