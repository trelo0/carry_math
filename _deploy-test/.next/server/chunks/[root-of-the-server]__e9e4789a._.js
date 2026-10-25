module.exports=[254799,(e,r,t)=>{r.exports=e.x("crypto",()=>require("crypto"))},450841,e=>{"use strict";function r(e){return"object"==typeof e&&null!==e&&!Array.isArray(e)}var t={0:8203,1:8204,2:8205,3:8290,4:8291,5:8288,6:65279,7:8289,8:119155,9:119156,a:119157,b:119158,c:119159,d:119160,e:119161,f:119162},i={0:8203,1:8204,2:8205,3:65279},l={0:String.fromCodePoint(i[0]),1:String.fromCodePoint(i[1]),2:String.fromCodePoint(i[2]),3:String.fromCodePoint(i[3])},n=[,,,,].fill(String.fromCodePoint(i[0])).join("");function s(e,r,t="auto"){return!0===t||"auto"===t&&(!(!Number.isNaN(Number(e))||/[a-z]/i.test(e)&&!/\d+(?:[-:\/]\d+){2}(?:T\d+(?:[-:\/]\d+){1,2}(\.\d+)?Z?)?/.test(e))&&Date.parse(e)||function(e){try{new URL(e,e.startsWith("/")?"https://acme.com":void 0)}catch{return!1}return!0}(e))?e:`${e}${function(e){let r=JSON.stringify(e),t=new TextEncoder().encode(r),i="";for(let e=0;e<t.length;e++){let r=t[e];i+=l[r>>6&3]+l[r>>4&3]+l[r>>2&3]+l[3&r]}return n+i}(r)}`}Object.fromEntries(Object.entries(l).map(e=>[e[1],+e[0]])),Object.fromEntries(Object.entries(t).map(e=>e.reverse()));var o=`${Object.values(t).map(e=>`\\u{${e.toString(16)}}`).join("")}`,a=RegExp(`[${o}]{4,}`,"gu");function u(e){var r,t;return e&&JSON.parse({cleaned:(r=JSON.stringify(e)).replace(a,""),encoded:(null==(t=r.match(a))?void 0:t[0])||""}.cleaned)}e.s(["isRecord",()=>r,"stegaClean",()=>u,"y",()=>s])},883760,667066,e=>{"use strict";function r(e,...t){let i=e.length-1;return e.slice(0,i).reduce((e,r,i)=>e+r+t[i],"")+e[i]}e.s(["groq",()=>r],883760);var t=e.i(561886);function i({preview:e,includeDrafts:r}={}){let l=!!e,n=process.env.SANITY_API_READ_TOKEN??process.env.SANITY_API_WRITE_TOKEN,s=!!(l||r),o=process.env.NEXT_PUBLIC_SANITY_API_VERSION??"2023-03-17",a=n&&1?n:void 0;return(0,t.createClient)({projectId:"2hngrocd",dataset:"production",apiVersion:o,useCdn:!s&&!a,token:a,perspective:l?"previewDrafts":s?"raw":"published"})}e.s(["getSanityClient",()=>i],667066)},551913,e=>{"use strict";var r=e.i(347540),t=e.i(883760),i=e.i(667066);let l=process.env.DISTRICT_COURSE_SLUG?.trim()||"district-course",n=`districtCourse.${l}`;function s(e){if(!Array.isArray(e))return[];let r=[];for(let t of e){if("string"==typeof t){let e=t.trim();e&&r.push({title:e,description:null});continue}if(!t||"object"!=typeof t)continue;let e="string"==typeof t.title&&t.title.trim()||"string"==typeof t.text&&t.text.trim()||"";if(!e)continue;let i="string"==typeof t.description&&t.description.trim()?t.description.trim():null;r.push({title:e,description:i})}return r}function o({preview:e,includeDrafts:r}={}){return(0,i.getSanityClient)({preview:e,includeDrafts:r??!!e})}function a({preview:e}){return e?{cache:"no-store"}:{next:{revalidate:120,tags:["sanity:course-content"]}}}let u=t.groq`{
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
}`,c=t.groq`{
  "sanityId": _id,
  title,
  description,
  color,
  sortOrder,
  "lessons": *[_type == "districtCourseLesson" && module._ref == ^._id] | order(moduleOrder asc) ${u}
}`,d=t.groq`*[_type == "districtCourse" && (slug.current == $slug || _id == $docId)][0]{
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
}`,m=t.groq`*[_type == "districtCourse" && defined(slug.current)] | order(title asc) {
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
}`,f=t.groq`*[_type == "districtCourse" && defined(slug.current) && coalesce(courseClosed, false) == false && coalesce(showInCatalog, true) == true && (
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
}`;function p(e){let r=e.pricing;return{priceByn:"number"==typeof r?.priceByn&&Number.isFinite(r.priceByn)?r.priceByn:"number"==typeof e.priceByn&&Number.isFinite(e.priceByn)?e.priceByn:null,grantedLessons:"number"==typeof r?.grantedLessons&&Number.isFinite(r.grantedLessons)&&r.grantedLessons>0?Math.floor(r.grantedLessons):"number"==typeof e.grantedLessons&&Number.isFinite(e.grantedLessons)&&e.grantedLessons>0?Math.floor(e.grantedLessons):null,cardText:r?.cardText?.trim()||null}}function g(e){if(!e?.sanityId||!e.title)return null;let r=e.homework;return{sanityId:e.sanityId,title:e.title,description:e.description??null,lessonNumber:e.lessonNumber??e.sortOrder??0,lessonDate:e.lessonDate??null,curriculumBlock:e.curriculumBlock??null,moduleOrder:e.moduleOrder??0,lessonType:e.lessonType??"webinar",publicationStatus:e.publicationStatus??"draft",sortOrder:e.sortOrder??e.lessonNumber??0,isTrialFree:!!e.isTrialFree,scheduledAt:e.scheduledAt??(e.lessonDate?`${e.lessonDate}T18:00:00+03:00`:null),liveUrl:e.liveUrl??null,recordingUrl:e.recordingUrl??null,mandatoryHomework:!!(e.mandatoryHomework??r?.mandatory??!0),contentChips:(e.contentChips??[]).filter(Boolean),materials:function(e){if(null!=e.lessonMaterials)return h(e.lessonMaterials);if(null!=e.lessonFiles)return h(e.lessonFiles);let r=e.materialsFileUrl;if(r){let t=e.materialsFileName??"Материалы";return[{title:t,materialType:"file",url:r,fileName:t,fileSize:null}]}return(e.materials??[]).map(e=>({title:e.title,materialType:e.materialType??"file",url:e.url??null,fileName:e.fileName??null,fileSize:e.fileSize??null}))}(e),homeworkFiles:b(e),homework:function(e){let r=b(e);if(r.length>0){let e=r[0];return{title:e.fileName??e.title,description:null,fileName:e.fileName,fileSize:e.fileSize,url:e.url,mandatory:!0}}let t=e.homework;return t?.title||t?.url?{title:t.title??"Домашнее задание",description:t.description??null,fileName:t.fileName??null,fileSize:t.fileSize??null,url:t.url??null,mandatory:!!(t.mandatory??!0)}:null}(e)}}function y(e,r){return(e??[]).filter(e=>e?.fileUrl&&(!r||e.published)).map(e=>({fileName:e.fileName??"Файл",fileUrl:e.fileUrl??null,published:!!e.published}))}function h(e){return y(e,!0).map(e=>({title:e.fileName??"Файл",materialType:"file",url:e.fileUrl,fileName:e.fileName,fileSize:null}))}function b(e){if(null!=e.lessonHomeworkFiles)return h(e.lessonHomeworkFiles);let r=e.homeworkFileUrl;if(r){let t=e.homeworkFileName??"Домашнее задание";return[{title:t,materialType:"file",url:r,fileName:t,fileSize:null}]}let t=e.homework;if(t?.url){let e=t.fileName??t.title??"Домашнее задание";return[{title:e,materialType:"file",url:t.url,fileName:e,fileSize:t.fileSize??null}]}return[]}function I(e){return e?.title&&e.description?{title:e.title,description:e.description,benefits:(e.benefits??[]).filter(Boolean),buttonLabel:e.buttonLabel??"Выбрать",subtitle:e.subtitle??void 0}:null}function v(e){if(!e)return null;let r=I(e.startFromBeginning),t=I(e.joinCurrent);return r&&t?{startFromBeginning:r,joinCurrent:t}:null}let w=t.groq`*[_type == "districtCourseLesson" && _id in $ids]{
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
}`;async function C(e){let r=new Map;if(0===e.length)return r;let t=o({includeDrafts:!0,preview:!1});for(let i of await t.fetch(w,{ids:e},{cache:"no-store"})??[])r.set(i.sanityId,{materials:y(i.lessonMaterials,!1),homeworkFiles:y(i.lessonHomeworkFiles,!1)});return r}let S=(0,r.cache)(async function(e=l,r={}){let t=o(r),i=e===l?n:`districtCourse.${e}`;return function(e){if(!e?.sanityId||!e.title||!e.slug)return null;let r=e.modulesFromCourse??[],t=e.modulesFromRefs??[],i=new Map;for(let e of t)e?.sanityId&&i.set(e.sanityId,e);for(let e of r)e?.sanityId&&i.set(e.sanityId,e);let l=[...i.values()].filter(Boolean).map((e,r)=>{let t=(e.lessons??[]).map(g).filter(e=>null!==e).sort((e,r)=>e.moduleOrder-r.moduleOrder||e.lessonNumber-r.lessonNumber||e.sortOrder-r.sortOrder);return{sanityId:e.sanityId,title:e.title,description:e.description??null,color:e.color??"#4f7cff",sortOrder:e.sortOrder??r,lessons:t}}).sort((e,r)=>e.sortOrder-r.sortOrder),n=p(e);return{sanityId:e.sanityId,title:e.title,slug:e.slug,description:e.description??null,cabinetEyebrow:e.cabinetEyebrow??null,deliveryFormat:e.deliveryFormat??null,homeworkIntro:e.homeworkIntro??null,coverImageUrl:e.coverImageUrl??null,previewImageUrl:e.previewImageUrl??null,previewInsideItems:s(e.cabinetPreviewInside),previewAfterEnrollment:e.cabinetPreviewAfterEnrollment??null,previewAudience:e.cabinetPreviewAudience??null,publicationStatus:e.publicationStatus??"draft",showInCatalog:!1!==e.showInCatalog,courseClosed:!0===e.courseClosed,curatorName:e.curatorName??null,curatorTelegramId:"number"==typeof e.curatorTelegramId&&Number.isFinite(e.curatorTelegramId)?e.curatorTelegramId:null,checkTelegramId:"number"==typeof e.checkTelegramId&&Number.isFinite(e.checkTelegramId)?e.checkTelegramId:null,priceByn:n.priceByn,grantedLessons:n.grantedLessons,pricingCardText:n.cardText,purchaseScenarios:v(e.purchaseScenarios),activeModuleOverride:e.activeModuleOverride??null,modules:l}}(await t.fetch(d,{slug:e,docId:i},a(r)))});function N(e){return e.slug===l||e.sanityId===n||e.sanityId===`districtCourse.${e.slug}`&&e.slug===l}async function T(e,r={}){return Promise.all(e.map(async e=>{let t=await S(e.slug,r),i=t?.purchaseScenarios??null;return i?{...e,purchaseScenarios:i}:e}))}function _(e){return!0===e}function F(e){return!1!==e}function U(e){return!_(e.courseClosed)&&F(e.showInCatalog)}function L(e,r,t){return e.filter(e=>{if(_(e.courseClosed))return!1;if(F(e.showInCatalog))return!0;let i=r.get(e.slug);return null!=i&&t.has(i)})}let O=(0,r.cache)(async function(e={}){let r=o(e),t=await r.fetch(m,{},a(e)),i=[];for(let e of t??[])e?.sanityId&&e.title&&e.slug&&i.push({sanityId:e.sanityId,title:e.title,slug:e.slug,description:e.description??null,cabinetEyebrow:e.cabinetEyebrow??null,deliveryFormat:e.deliveryFormat??null,homeworkIntro:e.homeworkIntro??null,publicationStatus:e.publicationStatus??"draft",showInCatalog:!1!==e.showInCatalog,courseClosed:!0===e.courseClosed,coverImageUrl:e.coverImageUrl??null,previewImageUrl:e.previewImageUrl??null,previewInsideItems:s(e.cabinetPreviewInside),previewAfterEnrollment:e.cabinetPreviewAfterEnrollment??null,previewAudience:e.cabinetPreviewAudience??null,curatorName:e.curatorName??null,curatorTelegramId:"number"==typeof e.curatorTelegramId&&Number.isFinite(e.curatorTelegramId)?e.curatorTelegramId:null,moduleCount:"number"==typeof e.moduleCount&&Number.isFinite(e.moduleCount)?Math.max(0,Math.floor(e.moduleCount)):0,totalLessons:"number"==typeof e.totalLessons&&Number.isFinite(e.totalLessons)?Math.max(0,Math.floor(e.totalLessons)):0,modulePreviews:[]});return i}),k=(0,r.cache)(async function(e={}){let r=o(e),t=await r.fetch(f,{},a(e)),i=[];for(let e of t??[]){if(!e?.sanityId||!e.slug||!e.title)continue;let r=p(e);null!=r.priceByn&&!(r.priceByn<0)&&(null==r.grantedLessons||r.grantedLessons<1||i.push({sanityId:e.sanityId,slug:e.slug,title:e.title,description:e.description??null,cardText:r.cardText,priceByn:r.priceByn,grantedLessons:r.grantedLessons,purchaseScenarios:v(e.purchaseScenarios??null)}))}return i});async function P(e,r={}){return(await k(r)).find(r=>r.slug===e)??null}function A(e){let r=[];for(let t of e.modules)r.push(...t.lessons);return r}function B(e){return A(e).filter(e=>"published"===e.publicationStatus).length}function E(e){return A(e).filter(e=>"archived"!==e.publicationStatus).length}function D(e,r){return!!("published"===e.publicationStatus||"archived"===e.publicationStatus&&r.has(e.sanityId))}function z(e){return"assignment"===e?"milestone":"test"===e?"practice":e}function M(e){if(e.recordingUrl)return"completed";if(!e.scheduledAt)return null;let r=new Date(e.scheduledAt).getTime();return Number.isNaN(r)?null:r>Date.now()?"scheduled":e.liveUrl?"live":"completed"}function x(e){return e.recordingUrl?e.recordingUrl:e.liveUrl?e.liveUrl:e.homework?.url?e.homework.url:e.materials.find(e=>e.url)?.url??null}function $(e){return e.recordingUrl?"Смотреть запись":"webinar"===e.lessonType&&e.liveUrl?"Смотреть трансляцию":"Открыть занятие"}e.s(["DEFAULT_LESSON_CONTENT_CHIPS",0,["Теория","Разбор задач","Практика","Домашнее задание"],"DISTRICT_COURSE_DOC_ID",0,n,"DISTRICT_COURSE_SLUG",0,l,"attachPurchaseScenariosToOffers",()=>T,"countCourseLessons",()=>E,"countPublishedLessons",()=>B,"deriveWebinarSessionStatus",()=>M,"fetchCuratorLessonFilesMap",()=>C,"filterCourseSummariesForCabinetAccess",()=>L,"flattenCourseLessons",()=>A,"getCoursePaymentOfferBySlug",()=>P,"getDistrictCourseContent",0,S,"isDistrictCourseFullyClosed",()=>_,"isDistrictCoursePublicInCatalog",()=>F,"isDistrictCoursePurchaseOffer",()=>N,"isDistrictCourseVisibleInCabinet",()=>U,"isLessonVisible",()=>D,"listCoursePaymentOffers",0,k,"listDistrictCourseSummaries",0,O,"mapLessonKind",()=>z,"resolveLessonActionLabel",()=>$,"resolveLessonActionUrl",()=>x])},11279,e=>{e.v(r=>Promise.all(["server/chunks/node_modules_@sanity_client_dist__chunks-es_ec6d2d9a._.js"].map(r=>e.l(r))).then(()=>r(720191)))},552815,e=>{e.v(r=>Promise.all(["server/chunks/[root-of-the-server]__1bd48b16._.js"].map(r=>e.l(r))).then(()=>r(264441)))}];

//# sourceMappingURL=%5Broot-of-the-server%5D__e9e4789a._.js.map