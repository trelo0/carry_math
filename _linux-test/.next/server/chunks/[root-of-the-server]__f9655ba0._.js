module.exports=[860926,e=>{"use strict";let t=["guest","student","staff","curator","check","teacher","mentor","admin","test"],r={guest:"гость",student:"ученик",staff:"сотрудник",curator:"куратор",check:"проверяющий ДЗ",teacher:"преподаватель",mentor:"куратор",admin:"админ",test:"тестер"};function i(e){return r["mentor"===e?"curator":d(e)?e:"guest"]}function l(e){return(process.env.ADMIN_TELEGRAM_IDS??"").split(",").map(e=>e.trim()).filter(Boolean).includes(String(e))}function n(e){return l(e)}function o(e,t){return l(e)||"admin"===t}function s(e,t){return l(e)||"admin"===t||"test"===t}function a(e,t){return s(e,t)}function u(e,t){return s(t,e.role)&&e.viewRole&&"test"!==e.viewRole?e.viewRole:e.role}function c(e,t){let i=u(e,t),l=s(t,e.role)&&e.viewRole&&"test"!==e.viewRole&&e.viewRole!==e.role?e.viewRole:null;return{role:i,testFooter:l?`

🧪 Тест-маска: ${r[l]}. Сброс — /as reset.`:""}}function d(e){return t.includes(e)}function m(e){return"mentor"===e?"curator":d(e)?e:"guest"}function f(e,t){let r=new Set;for(let i of(r.add(m(e)),t??[]))i&&r.add(m(i));return[...r]}function g(e,t){let r="mentor"===t?"curator":t;return e.some(e=>("mentor"===e?"curator":e)===r)}function p(e){return g(e,"curator")&&!g(e,"teacher")&&!g(e,"student")}function b(e){return(g(e,"staff")||g(e,"curator")||g(e,"check")||g(e,"teacher")||g(e,"admin"))&&!g(e,"student")}function y(e,t){return l(t)||g(e,"admin")||g(e,"teacher")||g(e,"staff")}function h(e,t){return l(t)||g(e,"admin")}function w(e,t){return g(e,"teacher")||h(e,t)}async function _(e,t){let{data:r,error:i}=await e.from("bot_members").select("role, extra_roles").eq("telegram_id",t).maybeSingle();if(i)throw i;if(!r)return["guest"];let l=Array.isArray(r.extra_roles)?r.extra_roles:[];return f(String(r.role??"guest"),l)}function I(e){let t=new Set,r=[];for(let i of e){let e=m(i);"mentor"===e||t.has(e)||(t.add(e),r.push(e))}return r}async function v(e,t,r){let{data:i,error:l}=await e.from("bot_members").update({extra_roles:I(r),updated_at:new Date().toISOString()}).eq("telegram_id",t).select("telegram_id");if(l)throw l;return(i??[]).length>0}async function S(e,t,r){let{data:i,error:l}=await e.from("bot_members").select("role, extra_roles").eq("telegram_id",t).maybeSingle();if(l)throw l;if(!i)return!1;let n=m(String(i.role??"guest")),o=m(r);return o===n||v(e,t,I([...f(n,Array.isArray(i.extra_roles)?i.extra_roles:[]),o].filter(e=>e!==n)))}async function C(e,t,r){let{data:i,error:l}=await e.from("bot_members").select("role, extra_roles").eq("telegram_id",t).maybeSingle();if(l)throw l;if(!i)return!1;let n=m(r),o=m(String(i.role??"guest"));return v(e,t,I(f(o,Array.isArray(i.extra_roles)?i.extra_roles:[]).filter(e=>e!==n&&e!==o)))}async function F(e,t,r,i="guest"){let{data:n,error:o}=await e.from("bot_members").select("role, view_role").eq("telegram_id",t).maybeSingle();if(o)throw o;let s=r?Object.fromEntries(Object.entries(r).filter(([,e])=>null!=e&&""!==e)):{};if(n){if(Object.keys(s).length>0){let{error:r}=await e.from("bot_members").update({...s,updated_at:new Date().toISOString()}).eq("telegram_id",t);if(r)throw r}return{role:d(n.role)?n.role:"guest",viewRole:d(n.view_role)?n.view_role:null}}let a=l(t)?"admin":i,{error:u}=await e.from("bot_members").insert({telegram_id:t,role:a,...s});if(u)throw u;return{role:a,viewRole:null}}async function N(e,t,r){let{error:i}=await e.from("bot_members").update({view_role:r,updated_at:new Date().toISOString()}).eq("telegram_id",t);if(i)throw i}async function T(e,t,r){let{data:i,error:l}=await e.from("bot_members").update({role:r,updated_at:new Date().toISOString()}).eq("telegram_id",t).select();if(l)throw l;return(i??[]).length>0}async function k(e){let{data:t}=await e.from("bot_members").select("telegram_id, role, phone, full_name").order("created_at",{ascending:!0}).limit(100);return t??[]}let O="telegram_id, role, phone, full_name, chat_id";async function L(e,t){let{data:r,error:i}=await e.from("bot_members").select(O).eq("telegram_id",t).maybeSingle();if(i)throw i;return r||null}async function U(e,t,r=20){let i=t.trim().replace(/[,()]/g,"");if(!i)return[];let l=i.replace(/\D/g,""),n=i.replace(/^#/,""),o=[`full_name.ilike.%${i}%`,`phone.ilike.%${l||i}%`];/^\d+$/.test(n)&&o.push(`telegram_id.eq.${n}`),/^@/.test(i)&&o.push(`full_name.ilike.%${i.slice(1)}%`);let{data:s,error:a}=await e.from("bot_members").select(O).or(o.join(",")).order("created_at",{ascending:!1}).limit(r);if(a)throw a;return s??[]}async function M(e,t,r,i){let l=r*i,{data:n,error:o,count:s}=await e.from("bot_members").select(O,{count:"exact"}).in("role",t).order("created_at",{ascending:!1}).range(l,l+i-1);if(o)throw o;return{members:n??[],total:s??0}}async function x(e,t){let r=t.replace(/\D/g,"");if(r.length<5)return 0;let{data:i,error:l}=await e.from("leads").select("id").ilike("contact",`%${r}%`);if(l)throw l;return(i??[]).length}async function R(e,t){let{data:r,error:i}=await e.from("bot_members").select("role, moderation_status").eq("telegram_id",t).maybeSingle();if(i)throw i;if(!r)return null;let l="blocked"===r.moderation_status||"restricted"===r.moderation_status?r.moderation_status:"active";return{role:r.role,moderationStatus:l}}async function A(e,t,r,i){let l=new Date().toISOString(),n={moderation_status:r,updated_at:l};"blocked"===r?(n.blocked_at=l,n.blocked_by=i):"restricted"===r?(n.restricted_at=l,n.restricted_by=i):(n.blocked_at=null,n.blocked_by=null,n.restricted_at=null,n.restricted_by=null);let{data:o,error:s}=await e.from("bot_members").update(n).eq("telegram_id",t).select("telegram_id");if(s)throw s;return(o??[]).length>0}async function B(e,t,r,i){let l=r*i,{data:n,error:o,count:s}=await e.from("bot_members").select(`${O}, moderation_status, blocked_at, restricted_at`,{count:"exact"}).eq("moderation_status",t).order("updated_at",{ascending:!1}).range(l,l+i-1);if(o)throw o;return{members:n??[],total:s??0}}e.s(["BOT_ROLES",0,t,"ROLE_LABELS",0,r,"addMemberExtraRole",()=>S,"canManageBotRoles",()=>s,"canManageTeacherCabinet",()=>w,"canUseTesterTools",()=>a,"combineMemberRoles",()=>f,"countLeadsByPhone",()=>x,"ensureMember",()=>F,"getMember",()=>L,"getModerationInfo",()=>R,"hasCreatorPowers",()=>o,"hasFullStaffPreview",()=>h,"isAdminEnv",()=>l,"isBotRole",()=>d,"isCreatorTelegramId",()=>n,"isCuratorOnlyMember",()=>p,"isStaffOnlyMember",()=>b,"listMembers",()=>k,"listMembersByModeration",()=>B,"listMembersInRoles",()=>M,"loadMemberRoles",()=>_,"memberCanAccessStaffCabinet",()=>y,"memberHasRole",()=>g,"normalizeMemberRole",()=>m,"removeMemberExtraRole",()=>C,"resolveEffectiveRole",()=>u,"resolveEffectiveRoleWithFooter",()=>c,"roleLabel",()=>i,"searchMembers",()=>U,"setMemberExtraRoles",()=>v,"setModerationStatus",()=>A,"setRole",()=>T,"setViewRole",()=>N])},918622,(e,t,r)=>{t.exports=e.x("next/dist/compiled/next-server/app-page-turbo.runtime.prod.js",()=>require("next/dist/compiled/next-server/app-page-turbo.runtime.prod.js"))},254799,(e,t,r)=>{t.exports=e.x("crypto",()=>require("crypto"))},442315,(e,t,r)=>{"use strict";t.exports=e.r(918622)},347540,(e,t,r)=>{"use strict";t.exports=e.r(442315).vendored["react-rsc"].React},450841,e=>{"use strict";function t(e){return"object"==typeof e&&null!==e&&!Array.isArray(e)}var r={0:8203,1:8204,2:8205,3:8290,4:8291,5:8288,6:65279,7:8289,8:119155,9:119156,a:119157,b:119158,c:119159,d:119160,e:119161,f:119162},i={0:8203,1:8204,2:8205,3:65279},l={0:String.fromCodePoint(i[0]),1:String.fromCodePoint(i[1]),2:String.fromCodePoint(i[2]),3:String.fromCodePoint(i[3])},n=[,,,,].fill(String.fromCodePoint(i[0])).join("");function o(e,t,r="auto"){return!0===r||"auto"===r&&(!(!Number.isNaN(Number(e))||/[a-z]/i.test(e)&&!/\d+(?:[-:\/]\d+){2}(?:T\d+(?:[-:\/]\d+){1,2}(\.\d+)?Z?)?/.test(e))&&Date.parse(e)||function(e){try{new URL(e,e.startsWith("/")?"https://acme.com":void 0)}catch{return!1}return!0}(e))?e:`${e}${function(e){let t=JSON.stringify(e),r=new TextEncoder().encode(t),i="";for(let e=0;e<r.length;e++){let t=r[e];i+=l[t>>6&3]+l[t>>4&3]+l[t>>2&3]+l[3&t]}return n+i}(t)}`}Object.fromEntries(Object.entries(l).map(e=>[e[1],+e[0]])),Object.fromEntries(Object.entries(r).map(e=>e.reverse()));var s=`${Object.values(r).map(e=>`\\u{${e.toString(16)}}`).join("")}`,a=RegExp(`[${s}]{4,}`,"gu");function u(e){var t,r;return e&&JSON.parse({cleaned:(t=JSON.stringify(e)).replace(a,""),encoded:(null==(r=t.match(a))?void 0:r[0])||""}.cleaned)}e.s(["isRecord",()=>t,"stegaClean",()=>u,"y",()=>o])},551913,e=>{"use strict";var t=e.i(347540),r=e.i(883760),i=e.i(667066);let l=process.env.DISTRICT_COURSE_SLUG?.trim()||"district-course",n=`districtCourse.${l}`;function o(e){if(!Array.isArray(e))return[];let t=[];for(let r of e){if("string"==typeof r){let e=r.trim();e&&t.push({title:e,description:null});continue}if(!r||"object"!=typeof r)continue;let e="string"==typeof r.title&&r.title.trim()||"string"==typeof r.text&&r.text.trim()||"";if(!e)continue;let i="string"==typeof r.description&&r.description.trim()?r.description.trim():null;t.push({title:e,description:i})}return t}function s({preview:e,includeDrafts:t}={}){return(0,i.getSanityClient)({preview:e,includeDrafts:t??!!e})}function a({preview:e}){return e?{cache:"no-store"}:{next:{revalidate:120,tags:["sanity:course-content"]}}}let u=r.groq`{
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
}`;function g(e){let t=e.pricing;return{priceByn:"number"==typeof t?.priceByn&&Number.isFinite(t.priceByn)?t.priceByn:"number"==typeof e.priceByn&&Number.isFinite(e.priceByn)?e.priceByn:null,grantedLessons:"number"==typeof t?.grantedLessons&&Number.isFinite(t.grantedLessons)&&t.grantedLessons>0?Math.floor(t.grantedLessons):"number"==typeof e.grantedLessons&&Number.isFinite(e.grantedLessons)&&e.grantedLessons>0?Math.floor(e.grantedLessons):null,cardText:t?.cardText?.trim()||null}}function p(e){if(!e?.sanityId||!e.title)return null;let t=e.homework;return{sanityId:e.sanityId,title:e.title,description:e.description??null,lessonNumber:e.lessonNumber??e.sortOrder??0,lessonDate:e.lessonDate??null,curriculumBlock:e.curriculumBlock??null,moduleOrder:e.moduleOrder??0,lessonType:e.lessonType??"webinar",publicationStatus:e.publicationStatus??"draft",sortOrder:e.sortOrder??e.lessonNumber??0,isTrialFree:!!e.isTrialFree,scheduledAt:e.scheduledAt??(e.lessonDate?`${e.lessonDate}T18:00:00+03:00`:null),liveUrl:e.liveUrl??null,recordingUrl:e.recordingUrl??null,mandatoryHomework:!!(e.mandatoryHomework??t?.mandatory??!0),contentChips:(e.contentChips??[]).filter(Boolean),materials:function(e){if(null!=e.lessonMaterials)return y(e.lessonMaterials);if(null!=e.lessonFiles)return y(e.lessonFiles);let t=e.materialsFileUrl;if(t){let r=e.materialsFileName??"Материалы";return[{title:r,materialType:"file",url:t,fileName:r,fileSize:null}]}return(e.materials??[]).map(e=>({title:e.title,materialType:e.materialType??"file",url:e.url??null,fileName:e.fileName??null,fileSize:e.fileSize??null}))}(e),homeworkFiles:h(e),homework:function(e){let t=h(e);if(t.length>0){let e=t[0];return{title:e.fileName??e.title,description:null,fileName:e.fileName,fileSize:e.fileSize,url:e.url,mandatory:!0}}let r=e.homework;return r?.title||r?.url?{title:r.title??"Домашнее задание",description:r.description??null,fileName:r.fileName??null,fileSize:r.fileSize??null,url:r.url??null,mandatory:!!(r.mandatory??!0)}:null}(e)}}function b(e,t){return(e??[]).filter(e=>e?.fileUrl&&(!t||e.published)).map(e=>({fileName:e.fileName??"Файл",fileUrl:e.fileUrl??null,published:!!e.published}))}function y(e){return b(e,!0).map(e=>({title:e.fileName??"Файл",materialType:"file",url:e.fileUrl,fileName:e.fileName,fileSize:null}))}function h(e){if(null!=e.lessonHomeworkFiles)return y(e.lessonHomeworkFiles);let t=e.homeworkFileUrl;if(t){let r=e.homeworkFileName??"Домашнее задание";return[{title:r,materialType:"file",url:t,fileName:r,fileSize:null}]}let r=e.homework;if(r?.url){let e=r.fileName??r.title??"Домашнее задание";return[{title:e,materialType:"file",url:r.url,fileName:e,fileSize:r.fileSize??null}]}return[]}function w(e){return e?.title&&e.description?{title:e.title,description:e.description,benefits:(e.benefits??[]).filter(Boolean),buttonLabel:e.buttonLabel??"Выбрать",subtitle:e.subtitle??void 0}:null}function _(e){if(!e)return null;let t=w(e.startFromBeginning),r=w(e.joinCurrent);return t&&r?{startFromBeginning:t,joinCurrent:r}:null}let I=r.groq`*[_type == "districtCourseLesson" && _id in $ids]{
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
}`;async function v(e){let t=new Map;if(0===e.length)return t;let r=s({includeDrafts:!0,preview:!1});for(let i of await r.fetch(I,{ids:e},{cache:"no-store"})??[])t.set(i.sanityId,{materials:b(i.lessonMaterials,!1),homeworkFiles:b(i.lessonHomeworkFiles,!1)});return t}let S=(0,t.cache)(async function(e=l,t={}){let r=s(t),i=e===l?n:`districtCourse.${e}`;return function(e){if(!e?.sanityId||!e.title||!e.slug)return null;let t=e.modulesFromCourse??[],r=e.modulesFromRefs??[],i=new Map;for(let e of r)e?.sanityId&&i.set(e.sanityId,e);for(let e of t)e?.sanityId&&i.set(e.sanityId,e);let l=[...i.values()].filter(Boolean).map((e,t)=>{let r=(e.lessons??[]).map(p).filter(e=>null!==e).sort((e,t)=>e.moduleOrder-t.moduleOrder||e.lessonNumber-t.lessonNumber||e.sortOrder-t.sortOrder);return{sanityId:e.sanityId,title:e.title,description:e.description??null,color:e.color??"#4f7cff",sortOrder:e.sortOrder??t,lessons:r}}).sort((e,t)=>e.sortOrder-t.sortOrder),n=g(e);return{sanityId:e.sanityId,title:e.title,slug:e.slug,description:e.description??null,cabinetEyebrow:e.cabinetEyebrow??null,deliveryFormat:e.deliveryFormat??null,homeworkIntro:e.homeworkIntro??null,coverImageUrl:e.coverImageUrl??null,previewImageUrl:e.previewImageUrl??null,previewInsideItems:o(e.cabinetPreviewInside),previewAfterEnrollment:e.cabinetPreviewAfterEnrollment??null,previewAudience:e.cabinetPreviewAudience??null,publicationStatus:e.publicationStatus??"draft",showInCatalog:!1!==e.showInCatalog,courseClosed:!0===e.courseClosed,curatorName:e.curatorName??null,curatorTelegramId:"number"==typeof e.curatorTelegramId&&Number.isFinite(e.curatorTelegramId)?e.curatorTelegramId:null,checkTelegramId:"number"==typeof e.checkTelegramId&&Number.isFinite(e.checkTelegramId)?e.checkTelegramId:null,priceByn:n.priceByn,grantedLessons:n.grantedLessons,pricingCardText:n.cardText,purchaseScenarios:_(e.purchaseScenarios),activeModuleOverride:e.activeModuleOverride??null,modules:l}}(await r.fetch(d,{slug:e,docId:i},a(t)))});function C(e){return e.slug===l||e.sanityId===n||e.sanityId===`districtCourse.${e.slug}`&&e.slug===l}async function F(e,t={}){return Promise.all(e.map(async e=>{let r=await S(e.slug,t),i=r?.purchaseScenarios??null;return i?{...e,purchaseScenarios:i}:e}))}function N(e){return!0===e}function T(e){return!1!==e}function k(e){return!N(e.courseClosed)&&T(e.showInCatalog)}function O(e,t,r){return e.filter(e=>{if(N(e.courseClosed))return!1;if(T(e.showInCatalog))return!0;let i=t.get(e.slug);return null!=i&&r.has(i)})}let L=(0,t.cache)(async function(e={}){let t=s(e),r=await t.fetch(m,{},a(e)),i=[];for(let e of r??[])e?.sanityId&&e.title&&e.slug&&i.push({sanityId:e.sanityId,title:e.title,slug:e.slug,description:e.description??null,cabinetEyebrow:e.cabinetEyebrow??null,deliveryFormat:e.deliveryFormat??null,homeworkIntro:e.homeworkIntro??null,publicationStatus:e.publicationStatus??"draft",showInCatalog:!1!==e.showInCatalog,courseClosed:!0===e.courseClosed,coverImageUrl:e.coverImageUrl??null,previewImageUrl:e.previewImageUrl??null,previewInsideItems:o(e.cabinetPreviewInside),previewAfterEnrollment:e.cabinetPreviewAfterEnrollment??null,previewAudience:e.cabinetPreviewAudience??null,curatorName:e.curatorName??null,curatorTelegramId:"number"==typeof e.curatorTelegramId&&Number.isFinite(e.curatorTelegramId)?e.curatorTelegramId:null,moduleCount:"number"==typeof e.moduleCount&&Number.isFinite(e.moduleCount)?Math.max(0,Math.floor(e.moduleCount)):0,totalLessons:"number"==typeof e.totalLessons&&Number.isFinite(e.totalLessons)?Math.max(0,Math.floor(e.totalLessons)):0,modulePreviews:[]});return i}),U=(0,t.cache)(async function(e={}){let t=s(e),r=await t.fetch(f,{},a(e)),i=[];for(let e of r??[]){if(!e?.sanityId||!e.slug||!e.title)continue;let t=g(e);null!=t.priceByn&&!(t.priceByn<0)&&(null==t.grantedLessons||t.grantedLessons<1||i.push({sanityId:e.sanityId,slug:e.slug,title:e.title,description:e.description??null,cardText:t.cardText,priceByn:t.priceByn,grantedLessons:t.grantedLessons,purchaseScenarios:_(e.purchaseScenarios??null)}))}return i});async function M(e,t={}){return(await U(t)).find(t=>t.slug===e)??null}function x(e){let t=[];for(let r of e.modules)t.push(...r.lessons);return t}function R(e){return x(e).filter(e=>"published"===e.publicationStatus).length}function A(e){return x(e).filter(e=>"archived"!==e.publicationStatus).length}function B(e,t){return!!("published"===e.publicationStatus||"archived"===e.publicationStatus&&t.has(e.sanityId))}function E(e){return"assignment"===e?"milestone":"test"===e?"practice":e}function D(e){if(e.recordingUrl)return"completed";if(!e.scheduledAt)return null;let t=new Date(e.scheduledAt).getTime();return Number.isNaN(t)?null:t>Date.now()?"scheduled":e.liveUrl?"live":"completed"}function P(e){return e.recordingUrl?e.recordingUrl:e.liveUrl?e.liveUrl:e.homework?.url?e.homework.url:e.materials.find(e=>e.url)?.url??null}function $(e){return e.recordingUrl?"Смотреть запись":"webinar"===e.lessonType&&e.liveUrl?"Смотреть трансляцию":"Открыть занятие"}e.s(["DEFAULT_LESSON_CONTENT_CHIPS",0,["Теория","Разбор задач","Практика","Домашнее задание"],"DISTRICT_COURSE_DOC_ID",0,n,"DISTRICT_COURSE_SLUG",0,l,"attachPurchaseScenariosToOffers",()=>F,"countCourseLessons",()=>A,"countPublishedLessons",()=>R,"deriveWebinarSessionStatus",()=>D,"fetchCuratorLessonFilesMap",()=>v,"filterCourseSummariesForCabinetAccess",()=>O,"flattenCourseLessons",()=>x,"getCoursePaymentOfferBySlug",()=>M,"getDistrictCourseContent",0,S,"isDistrictCourseFullyClosed",()=>N,"isDistrictCoursePublicInCatalog",()=>T,"isDistrictCoursePurchaseOffer",()=>C,"isDistrictCourseVisibleInCabinet",()=>k,"isLessonVisible",()=>B,"listCoursePaymentOffers",0,U,"listDistrictCourseSummaries",0,L,"mapLessonKind",()=>E,"resolveLessonActionLabel",()=>$,"resolveLessonActionUrl",()=>P])}];

//# sourceMappingURL=%5Broot-of-the-server%5D__f9655ba0._.js.map