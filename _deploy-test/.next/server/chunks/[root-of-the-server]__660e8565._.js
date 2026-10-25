module.exports=[254799,(e,t,r)=>{t.exports=e.x("crypto",()=>require("crypto"))},450841,e=>{"use strict";function t(e){return"object"==typeof e&&null!==e&&!Array.isArray(e)}var r={0:8203,1:8204,2:8205,3:8290,4:8291,5:8288,6:65279,7:8289,8:119155,9:119156,a:119157,b:119158,c:119159,d:119160,e:119161,f:119162},i={0:8203,1:8204,2:8205,3:65279},l={0:String.fromCodePoint(i[0]),1:String.fromCodePoint(i[1]),2:String.fromCodePoint(i[2]),3:String.fromCodePoint(i[3])},n=[,,,,].fill(String.fromCodePoint(i[0])).join("");function s(e,t,r="auto"){return!0===r||"auto"===r&&(!(!Number.isNaN(Number(e))||/[a-z]/i.test(e)&&!/\d+(?:[-:\/]\d+){2}(?:T\d+(?:[-:\/]\d+){1,2}(\.\d+)?Z?)?/.test(e))&&Date.parse(e)||function(e){try{new URL(e,e.startsWith("/")?"https://acme.com":void 0)}catch{return!1}return!0}(e))?e:`${e}${function(e){let t=JSON.stringify(e),r=new TextEncoder().encode(t),i="";for(let e=0;e<r.length;e++){let t=r[e];i+=l[t>>6&3]+l[t>>4&3]+l[t>>2&3]+l[3&t]}return n+i}(t)}`}Object.fromEntries(Object.entries(l).map(e=>[e[1],+e[0]])),Object.fromEntries(Object.entries(r).map(e=>e.reverse()));var o=`${Object.values(r).map(e=>`\\u{${e.toString(16)}}`).join("")}`,a=RegExp(`[${o}]{4,}`,"gu");function u(e){var t,r;return e&&JSON.parse({cleaned:(t=JSON.stringify(e)).replace(a,""),encoded:(null==(r=t.match(a))?void 0:r[0])||""}.cleaned)}e.s(["isRecord",()=>t,"stegaClean",()=>u,"y",()=>s])},883760,667066,e=>{"use strict";function t(e,...r){let i=e.length-1;return e.slice(0,i).reduce((e,t,i)=>e+t+r[i],"")+e[i]}e.s(["groq",()=>t],883760);var r=e.i(561886);function i({preview:e,includeDrafts:t}={}){let l=!!e,n=process.env.SANITY_API_READ_TOKEN??process.env.SANITY_API_WRITE_TOKEN,s=!!(l||t),o=process.env.NEXT_PUBLIC_SANITY_API_VERSION??"2023-03-17",a=n&&1?n:void 0;return(0,r.createClient)({projectId:"2hngrocd",dataset:"production",apiVersion:o,useCdn:!s&&!a,token:a,perspective:l?"previewDrafts":s?"raw":"published"})}e.s(["getSanityClient",()=>i],667066)},551913,e=>{"use strict";var t=e.i(347540),r=e.i(883760),i=e.i(667066);let l=process.env.DISTRICT_COURSE_SLUG?.trim()||"district-course",n=`districtCourse.${l}`;function s(e){if(!Array.isArray(e))return[];let t=[];for(let r of e){if("string"==typeof r){let e=r.trim();e&&t.push({title:e,description:null});continue}if(!r||"object"!=typeof r)continue;let e="string"==typeof r.title&&r.title.trim()||"string"==typeof r.text&&r.text.trim()||"";if(!e)continue;let i="string"==typeof r.description&&r.description.trim()?r.description.trim():null;t.push({title:e,description:i})}return t}function o({preview:e,includeDrafts:t}={}){return(0,i.getSanityClient)({preview:e,includeDrafts:t??!!e})}function a({preview:e}){return e?{cache:"no-store"}:{next:{revalidate:120,tags:["sanity:course-content"]}}}let u=r.groq`{
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
}`,f=r.groq`*[_type == "districtCourse" && defined(slug.current)] | order(title asc) {
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
}`,m=r.groq`*[_type == "districtCourse" && defined(slug.current) && coalesce(courseClosed, false) == false && coalesce(showInCatalog, true) == true && (
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
}`;function p(e){let t=e.pricing;return{priceByn:"number"==typeof t?.priceByn&&Number.isFinite(t.priceByn)?t.priceByn:"number"==typeof e.priceByn&&Number.isFinite(e.priceByn)?e.priceByn:null,grantedLessons:"number"==typeof t?.grantedLessons&&Number.isFinite(t.grantedLessons)&&t.grantedLessons>0?Math.floor(t.grantedLessons):"number"==typeof e.grantedLessons&&Number.isFinite(e.grantedLessons)&&e.grantedLessons>0?Math.floor(e.grantedLessons):null,cardText:t?.cardText?.trim()||null}}function g(e){if(!e?.sanityId||!e.title)return null;let t=e.homework;return{sanityId:e.sanityId,title:e.title,description:e.description??null,lessonNumber:e.lessonNumber??e.sortOrder??0,lessonDate:e.lessonDate??null,curriculumBlock:e.curriculumBlock??null,moduleOrder:e.moduleOrder??0,lessonType:e.lessonType??"webinar",publicationStatus:e.publicationStatus??"draft",sortOrder:e.sortOrder??e.lessonNumber??0,isTrialFree:!!e.isTrialFree,scheduledAt:e.scheduledAt??(e.lessonDate?`${e.lessonDate}T18:00:00+03:00`:null),liveUrl:e.liveUrl??null,recordingUrl:e.recordingUrl??null,mandatoryHomework:!!(e.mandatoryHomework??t?.mandatory??!0),contentChips:(e.contentChips??[]).filter(Boolean),materials:function(e){if(null!=e.lessonMaterials)return h(e.lessonMaterials);if(null!=e.lessonFiles)return h(e.lessonFiles);let t=e.materialsFileUrl;if(t){let r=e.materialsFileName??"Материалы";return[{title:r,materialType:"file",url:t,fileName:r,fileSize:null}]}return(e.materials??[]).map(e=>({title:e.title,materialType:e.materialType??"file",url:e.url??null,fileName:e.fileName??null,fileSize:e.fileSize??null}))}(e),homeworkFiles:I(e),homework:function(e){let t=I(e);if(t.length>0){let e=t[0];return{title:e.fileName??e.title,description:null,fileName:e.fileName,fileSize:e.fileSize,url:e.url,mandatory:!0}}let r=e.homework;return r?.title||r?.url?{title:r.title??"Домашнее задание",description:r.description??null,fileName:r.fileName??null,fileSize:r.fileSize??null,url:r.url??null,mandatory:!!(r.mandatory??!0)}:null}(e)}}function y(e,t){return(e??[]).filter(e=>e?.fileUrl&&(!t||e.published)).map(e=>({fileName:e.fileName??"Файл",fileUrl:e.fileUrl??null,published:!!e.published}))}function h(e){return y(e,!0).map(e=>({title:e.fileName??"Файл",materialType:"file",url:e.fileUrl,fileName:e.fileName,fileSize:null}))}function I(e){if(null!=e.lessonHomeworkFiles)return h(e.lessonHomeworkFiles);let t=e.homeworkFileUrl;if(t){let r=e.homeworkFileName??"Домашнее задание";return[{title:r,materialType:"file",url:t,fileName:r,fileSize:null}]}let r=e.homework;if(r?.url){let e=r.fileName??r.title??"Домашнее задание";return[{title:e,materialType:"file",url:r.url,fileName:e,fileSize:r.fileSize??null}]}return[]}function w(e){return e?.title&&e.description?{title:e.title,description:e.description,benefits:(e.benefits??[]).filter(Boolean),buttonLabel:e.buttonLabel??"Выбрать",subtitle:e.subtitle??void 0}:null}function b(e){if(!e)return null;let t=w(e.startFromBeginning),r=w(e.joinCurrent);return t&&r?{startFromBeginning:t,joinCurrent:r}:null}let v=r.groq`*[_type == "districtCourseLesson" && _id in $ids]{
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
}`;async function S(e){let t=new Map;if(0===e.length)return t;let r=o({includeDrafts:!0,preview:!1});for(let i of await r.fetch(v,{ids:e},{cache:"no-store"})??[])t.set(i.sanityId,{materials:y(i.lessonMaterials,!1),homeworkFiles:y(i.lessonHomeworkFiles,!1)});return t}let C=(0,t.cache)(async function(e=l,t={}){let r=o(t),i=e===l?n:`districtCourse.${e}`;return function(e){if(!e?.sanityId||!e.title||!e.slug)return null;let t=e.modulesFromCourse??[],r=e.modulesFromRefs??[],i=new Map;for(let e of r)e?.sanityId&&i.set(e.sanityId,e);for(let e of t)e?.sanityId&&i.set(e.sanityId,e);let l=[...i.values()].filter(Boolean).map((e,t)=>{let r=(e.lessons??[]).map(g).filter(e=>null!==e).sort((e,t)=>e.moduleOrder-t.moduleOrder||e.lessonNumber-t.lessonNumber||e.sortOrder-t.sortOrder);return{sanityId:e.sanityId,title:e.title,description:e.description??null,color:e.color??"#4f7cff",sortOrder:e.sortOrder??t,lessons:r}}).sort((e,t)=>e.sortOrder-t.sortOrder),n=p(e);return{sanityId:e.sanityId,title:e.title,slug:e.slug,description:e.description??null,cabinetEyebrow:e.cabinetEyebrow??null,deliveryFormat:e.deliveryFormat??null,homeworkIntro:e.homeworkIntro??null,coverImageUrl:e.coverImageUrl??null,previewImageUrl:e.previewImageUrl??null,previewInsideItems:s(e.cabinetPreviewInside),previewAfterEnrollment:e.cabinetPreviewAfterEnrollment??null,previewAudience:e.cabinetPreviewAudience??null,publicationStatus:e.publicationStatus??"draft",showInCatalog:!1!==e.showInCatalog,courseClosed:!0===e.courseClosed,curatorName:e.curatorName??null,curatorTelegramId:"number"==typeof e.curatorTelegramId&&Number.isFinite(e.curatorTelegramId)?e.curatorTelegramId:null,checkTelegramId:"number"==typeof e.checkTelegramId&&Number.isFinite(e.checkTelegramId)?e.checkTelegramId:null,priceByn:n.priceByn,grantedLessons:n.grantedLessons,pricingCardText:n.cardText,purchaseScenarios:b(e.purchaseScenarios),activeModuleOverride:e.activeModuleOverride??null,modules:l}}(await r.fetch(d,{slug:e,docId:i},a(t)))});function N(e){return e.slug===l||e.sanityId===n||e.sanityId===`districtCourse.${e.slug}`&&e.slug===l}async function _(e,t={}){return Promise.all(e.map(async e=>{let r=await C(e.slug,t),i=r?.purchaseScenarios??null;return i?{...e,purchaseScenarios:i}:e}))}function T(e){return!0===e}function F(e){return!1!==e}function U(e){return!T(e.courseClosed)&&F(e.showInCatalog)}function L(e,t,r){return e.filter(e=>{if(T(e.courseClosed))return!1;if(F(e.showInCatalog))return!0;let i=t.get(e.slug);return null!=i&&r.has(i)})}let O=(0,t.cache)(async function(e={}){let t=o(e),r=await t.fetch(f,{},a(e)),i=[];for(let e of r??[])e?.sanityId&&e.title&&e.slug&&i.push({sanityId:e.sanityId,title:e.title,slug:e.slug,description:e.description??null,cabinetEyebrow:e.cabinetEyebrow??null,deliveryFormat:e.deliveryFormat??null,homeworkIntro:e.homeworkIntro??null,publicationStatus:e.publicationStatus??"draft",showInCatalog:!1!==e.showInCatalog,courseClosed:!0===e.courseClosed,coverImageUrl:e.coverImageUrl??null,previewImageUrl:e.previewImageUrl??null,previewInsideItems:s(e.cabinetPreviewInside),previewAfterEnrollment:e.cabinetPreviewAfterEnrollment??null,previewAudience:e.cabinetPreviewAudience??null,curatorName:e.curatorName??null,curatorTelegramId:"number"==typeof e.curatorTelegramId&&Number.isFinite(e.curatorTelegramId)?e.curatorTelegramId:null,moduleCount:"number"==typeof e.moduleCount&&Number.isFinite(e.moduleCount)?Math.max(0,Math.floor(e.moduleCount)):0,totalLessons:"number"==typeof e.totalLessons&&Number.isFinite(e.totalLessons)?Math.max(0,Math.floor(e.totalLessons)):0,modulePreviews:[]});return i}),k=(0,t.cache)(async function(e={}){let t=o(e),r=await t.fetch(m,{},a(e)),i=[];for(let e of r??[]){if(!e?.sanityId||!e.slug||!e.title)continue;let t=p(e);null!=t.priceByn&&!(t.priceByn<0)&&(null==t.grantedLessons||t.grantedLessons<1||i.push({sanityId:e.sanityId,slug:e.slug,title:e.title,description:e.description??null,cardText:t.cardText,priceByn:t.priceByn,grantedLessons:t.grantedLessons,purchaseScenarios:b(e.purchaseScenarios??null)}))}return i});async function A(e,t={}){return(await k(t)).find(t=>t.slug===e)??null}function P(e){let t=[];for(let r of e.modules)t.push(...r.lessons);return t}function B(e){return P(e).filter(e=>"published"===e.publicationStatus).length}function E(e){return P(e).filter(e=>"archived"!==e.publicationStatus).length}function D(e,t){return!!("published"===e.publicationStatus||"archived"===e.publicationStatus&&t.has(e.sanityId))}function M(e){return"assignment"===e?"milestone":"test"===e?"practice":e}function z(e){if(e.recordingUrl)return"completed";if(!e.scheduledAt)return null;let t=new Date(e.scheduledAt).getTime();return Number.isNaN(t)?null:t>Date.now()?"scheduled":e.liveUrl?"live":"completed"}function R(e){return e.recordingUrl?e.recordingUrl:e.liveUrl?e.liveUrl:e.homework?.url?e.homework.url:e.materials.find(e=>e.url)?.url??null}function x(e){return e.recordingUrl?"Смотреть запись":"webinar"===e.lessonType&&e.liveUrl?"Смотреть трансляцию":"Открыть занятие"}e.s(["DEFAULT_LESSON_CONTENT_CHIPS",0,["Теория","Разбор задач","Практика","Домашнее задание"],"DISTRICT_COURSE_DOC_ID",0,n,"DISTRICT_COURSE_SLUG",0,l,"attachPurchaseScenariosToOffers",()=>_,"countCourseLessons",()=>E,"countPublishedLessons",()=>B,"deriveWebinarSessionStatus",()=>z,"fetchCuratorLessonFilesMap",()=>S,"filterCourseSummariesForCabinetAccess",()=>L,"flattenCourseLessons",()=>P,"getCoursePaymentOfferBySlug",()=>A,"getDistrictCourseContent",0,C,"isDistrictCourseFullyClosed",()=>T,"isDistrictCoursePublicInCatalog",()=>F,"isDistrictCoursePurchaseOffer",()=>N,"isDistrictCourseVisibleInCabinet",()=>U,"isLessonVisible",()=>D,"listCoursePaymentOffers",0,k,"listDistrictCourseSummaries",0,O,"mapLessonKind",()=>M,"resolveLessonActionLabel",()=>x,"resolveLessonActionUrl",()=>R])},411723,e=>{"use strict";var t=e.i(551913);async function r(r,i){let l=i?.slug??t.DISTRICT_COURSE_SLUG,n=i?.title??"Курс District",s=i?.description??"Полная подготовка к ЦТ по математике: от диагностики до пробного экзамена.",o=i?.sanityId??null,a=new Date().toISOString(),{data:u}=o?await r.from("courses").select("id").eq("sanity_id",o).maybeSingle():{data:null},{data:c}=await r.from("courses").select("id, sanity_id").eq("slug",l).maybeSingle(),d=u?.id??c?.id;if(d){let{error:t}=await r.from("courses").update({title:n,slug:l,description:s,sanity_id:o??c?.sanity_id??null,is_active:i?.publicationStatus!=="archived",updated_at:a}).eq("id",d);if(t)throw t;if(i){let{syncCourseStaffFromContent:t}=await e.A(497085);await t(r,d,i,{courseSlug:l}).catch(e=>console.warn("[course-record] staff sync failed:",e))}return d}let{data:f,error:m}=await r.from("courses").insert({title:n,slug:l,description:s,sanity_id:o,is_active:i?.publicationStatus!=="archived",updated_at:a}).select("id").single();if(m)throw m;let p=f.id;if(i){let{syncCourseStaffFromContent:t}=await e.A(497085);await t(r,p,i,{courseSlug:l}).catch(e=>console.warn("[course-record] staff sync failed:",e))}return p}async function i(e,i){try{return await r(e,i)}catch{let{data:r}=await e.from("courses").select("id").eq("slug",t.DISTRICT_COURSE_SLUG).maybeSingle();return r?.id??null}}async function l(e,t){let r=[...new Set(t.filter(Boolean))],i=new Map;if(0===r.length)return i;let{data:l,error:n}=await e.from("courses").select("id, slug").in("slug",r);if(n)throw n;for(let e of l??[])e.slug&&null!=e.id&&i.set(e.slug,e.id);return i}async function n(t){let{listDistrictCourseSummaries:r}=await e.A(493226),i=await r().catch(()=>[]);if(0===i.length)return[];let n=i.map(e=>e.slug),s=[...(await l(t,n)).values()];if(0===s.length)return[];let{data:o,error:a}=await t.from("courses").select("id, title, slug, description, is_active, created_at, updated_at").in("id",s).order("title",{ascending:!0});if(a)throw a;return o??[]}e.s(["ensureDistrictCourseRecord",()=>r,"listCoursesPresentInSanity",()=>n,"lookupCourseIdsBySlugs",()=>l,"resolveCourseIdForContent",()=>i])}];

//# sourceMappingURL=%5Broot-of-the-server%5D__660e8565._.js.map