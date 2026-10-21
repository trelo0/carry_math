module.exports=[254799,(a,b,c)=>{b.exports=a.x("crypto",()=>require("crypto"))},587127,a=>{"use strict";function b(a){return"object"==typeof a&&null!==a&&!Array.isArray(a)}var c={0:8203,1:8204,2:8205,3:8290,4:8291,5:8288,6:65279,7:8289,8:119155,9:119156,a:119157,b:119158,c:119159,d:119160,e:119161,f:119162},d={0:8203,1:8204,2:8205,3:65279},e={0:String.fromCodePoint(d[0]),1:String.fromCodePoint(d[1]),2:String.fromCodePoint(d[2]),3:String.fromCodePoint(d[3])},f=[,,,,].fill(String.fromCodePoint(d[0])).join("");function g(a,b,c="auto"){return!0===c||"auto"===c&&(!(!Number.isNaN(Number(a))||/[a-z]/i.test(a)&&!/\d+(?:[-:\/]\d+){2}(?:T\d+(?:[-:\/]\d+){1,2}(\.\d+)?Z?)?/.test(a))&&Date.parse(a)||function(a){try{new URL(a,a.startsWith("/")?"https://acme.com":void 0)}catch{return!1}return!0}(a))?a:`${a}${function(a){let b=JSON.stringify(a),c=new TextEncoder().encode(b),d="";for(let a=0;a<c.length;a++){let b=c[a];d+=e[b>>6&3]+e[b>>4&3]+e[b>>2&3]+e[3&b]}return f+d}(b)}`}Object.fromEntries(Object.entries(e).map(a=>[a[1],+a[0]])),Object.fromEntries(Object.entries(c).map(a=>a.reverse()));var h=`${Object.values(c).map(a=>`\\u{${a.toString(16)}}`).join("")}`,i=RegExp(`[${h}]{4,}`,"gu");function j(a){var b,c;return a&&JSON.parse({cleaned:(b=JSON.stringify(a)).replace(i,""),encoded:(null==(c=b.match(i))?void 0:c[0])||""}.cleaned)}a.s(["isRecord",()=>b,"stegaClean",()=>j,"y",()=>g])},464226,a=>{"use strict";var b=a.i(800717),c=a.i(217562),d=a.i(74582);function e({preview:a}={}){return(0,d.getSanityClient)({preview:a})}function f({preview:a},b){return a?{cache:"no-store"}:{next:{tags:b,revalidate:60}}}async function g(a,b,c,d,e){try{return await a.fetch(b,c,d)??e}catch(c){let a=c instanceof Error?c.message:String(c),b=a.includes("403")||a.includes("401")?" Проверьте SANITY_API_READ_TOKEN (или SANITY_API_WRITE_TOKEN) в .env.local — создайте новый токен в sanity.io/manage → API → Tokens.":"";return console.error(`[Sanity] fetch failed:${b}`,a.split("\n")[0]),e}}async function h({preview:a}={}){return i(!!a)}let i=(0,b.cache)(async a=>g(e({preview:a}),c.groq`*[_type == "siteSettings"] | order(_updatedAt desc)[0]{
      title,
      footerDescription,
      instagramUrl,
      headerButtonText,
      heroButtonText,
      teacherCardButtonText,
      modalTitle,
      modalSubmitButtonText
    }`,{},f({preview:a},["sanity:siteSettings"]),null));async function j({preview:a}={}){return k(!!a)}(0,b.cache)(async a=>g(e({preview:a}),c.groq`{
      "hero": *[_type == "individualHeroBlock"] | order(_updatedAt desc)[0]{
        kicker,
        title,
        description,
        panelTitle,
        slots[]{ _key, icon, title, sub, href }
      },
      "teachers": *[_type == "teachersBlock"] | order(_updatedAt desc)[0]{
        kicker,
        sectionTitle,
        badges
      },
      "principles": *[_type == "principlesBlock"] | order(_updatedAt desc)[0]{
        kicker,
        sectionTitle,
        sectionTitleGold,
        sectionSubtitle
      },
      "formats": *[_type == "formatsBlock"] | order(_updatedAt desc)[0]{
        kicker,
        sectionTitle,
        columns[]{ _key, icon, title, sub, description, perks, ctaText }
      },
      "process": *[_type == "processBlock"] | order(_updatedAt desc)[0]{
        kicker,
        sectionTitle,
        sectionSubtitle
      },
      "choosePath": *[_type == "choosePathBlock"] | order(_updatedAt desc)[0]{
        kicker,
        sectionTitle,
        sectionTitleGold,
        soloTabText,
        groupTabText,
        trialGuideTitle,
        trialGuideText,
        benefits[]{ _key, title, text }
      },
      "diagnostic": *[_id == "diagnosticBlock"][0]{
        eyebrow,
        title,
        text,
        buttonText,
        steps[]{ _key, title, text }
      }
    }`,{},f({preview:a},["sanity:individualHeroBlock","sanity:teachersBlock","sanity:principlesBlock","sanity:formatsBlock","sanity:processBlock","sanity:choosePathBlock","sanity:diagnosticBlock"]),null));let k=(0,b.cache)(async a=>g(e({preview:a}),c.groq`{
      "content": {
        "hero": *[_type == "individualHeroBlock"] | order(_updatedAt desc)[0]{
          kicker, title, description, panelTitle,
          slots[]{ _key, icon, title, sub, href }
        },
        "teachers": *[_type == "teachersBlock"] | order(_updatedAt desc)[0]{
          kicker, sectionTitle, badges
        },
        "principles": *[_type == "principlesBlock"] | order(_updatedAt desc)[0]{
          kicker, sectionTitle, sectionTitleGold, sectionSubtitle
        },
        "formats": *[_type == "formatsBlock"] | order(_updatedAt desc)[0]{
          kicker, sectionTitle,
          columns[]{ _key, icon, title, sub, description, perks, ctaText }
        },
        "process": *[_type == "processBlock"] | order(_updatedAt desc)[0]{
          kicker, sectionTitle, sectionSubtitle
        },
        "choosePath": *[_type == "choosePathBlock"] | order(_updatedAt desc)[0]{
          kicker, sectionTitle, sectionTitleGold,
          soloTabText, groupTabText, trialGuideTitle, trialGuideText,
          benefits[]{ _key, title, text }
        },
        "diagnostic": *[_id == "diagnosticBlock"][0]{
          eyebrow, title, text, buttonText,
          steps[]{ _key, title, text }
        }
      },
      "teachers": *[_type == "teacher"]{
        _id, name, subject, description, photo, badges,
        "hasSpots": hasSpots, services, trialLesson,
        reviews[]{ _key, image, caption }
      },
      "stats": *[_type == "stat"]{
        _id, value, label, order
      } | order(coalesce(order, 9999) asc, _createdAt asc),
      "principles": *[_type == "principle"]{
        _id, title, description, order
      } | order(coalesce(order, 9999) asc, _createdAt asc),
      "processSteps": *[_type == "processStep"]{
        _id, title, description
      } | order(coalesce(order, 9999) asc, _createdAt asc)
    }`,{},f({preview:a},["sanity:individualHeroBlock","sanity:teachersBlock","sanity:principle","sanity:principlesBlock","sanity:formatsBlock","sanity:processBlock","sanity:choosePathBlock","sanity:diagnosticBlock","sanity:teacher","sanity:stat","sanity:processStep"]),{content:null,teachers:[],stats:[],principles:[],processSteps:[]}));async function l({preview:a}={}){return m(!!a)}(0,b.cache)(async a=>g(e({preview:a}),c.groq`*[_type == "teacher"]{
    _id,
    name,
    subject,
    description,
    photo,
    badges,
    "hasSpots": hasSpots,
    services,
    trialLesson,
    reviews[] {
      _key,
      image,
      caption
    }
  }`,{},f({preview:a},["sanity:teacher"]),[])),(0,b.cache)(async a=>g(e({preview:a}),c.groq`*[_type == "stat"]{
      _id,
      value,
      label,
      order
    } | order(coalesce(order, 9999) asc, _createdAt asc)`,{},f({preview:a},["sanity:stat"]),[])),(0,b.cache)(async a=>g(e({preview:a}),c.groq`*[_type == "principle"]{
      _id,
      title,
      description,
      order
    } | order(coalesce(order, 9999) asc, _createdAt asc)`,{},f({preview:a},["sanity:principle"]),[])),(0,b.cache)(async a=>g(e({preview:a}),c.groq`*[_type == "review"]{
      _id,
      name,
      result,
      text
    } | order(coalesce(order, 9999) asc, _createdAt asc)`,{},f({preview:a},["sanity:review"]),[])),(0,b.cache)(async a=>g(e({preview:a}),c.groq`*[_type == "processStep"]{
      _id,
      title,
      description
    } | order(coalesce(order, 9999) asc, _createdAt asc)`,{},f({preview:a},["sanity:processStep"]),[]));let m=(0,b.cache)(async a=>g(e({preview:a}),c.groq`{
      "hero": *[_type == "courseHero"] | order(_updatedAt desc)[0]{
        eyebrow,
        headline,
        pills,
        questTitle,
        questNote,
        questPoints,
        buttonText
      },
      "mentor": *[_type == "mentorBlock"] | order(_updatedAt desc)[0]{
        sectionTitle,
        specs[]{ _key, label, value },
        journal[]{ _key, title, text },
        mentorName,
        mentorClass,
        mentorLevel,
        badges,
        quoteStatus,
        quoteText
      },
      "program": *[_type == "programBlock"] | order(_updatedAt desc)[0]{
        sectionTitle,
        missions[]{ _key, title, text }
      },
      "reviews": *[_type == "reviewsBlock"] | order(_updatedAt desc)[0]{
        sectionTitle
      },
      "init": *[_type == "initBlock"] | order(_updatedAt desc)[0]{
        sectionTitle,
        subtitle,
        steps[]{ _key, icon, title, lines },
        priceLabel,
        priceValue,
        pricePeriod,
        priceNote,
        buttonText
      },
      "faq": *[_type == "faqBlock"] | order(_updatedAt desc)[0]{
        sectionTitle
      },
      "faqItems": *[_type == "faqItem"] | order(coalesce(order, 9999) asc, _createdAt asc){
        question,
        answer
      },
      "paths": *[_type == "pathsBlock"] | order(_updatedAt desc)[0]{
        sectionTitle,
        columns[]{ _key, title, sub, description, perks },
        ctaText
      },
      "reviewItems": *[_type == "review"]{
        _id,
        name,
        result,
        text
      } | order(coalesce(order, 9999) asc, _createdAt asc)
    }`,{},f({preview:a},["sanity:courseHero","sanity:mentorBlock","sanity:programBlock","sanity:reviewsBlock","sanity:review","sanity:initBlock","sanity:faqBlock","sanity:faqItem","sanity:pathsBlock"]),null));a.s(["getIndividualPageBundle",()=>j,"getMainPageContent",()=>l,"getSiteSettings",()=>h])},397039,a=>{"use strict";let b="District";function c(a){let c=a?.trim();return c?"distrikt"===c.toLowerCase()?b:c:b}a.s(["normalizeBrandName",()=>c])},557298,963786,a=>{"use strict";var b=a.i(464226),c=a.i(397039);function d(){return"https://district-school.by/".replace(/\/$/,"")}function e(){return new URL(d())}async function f(){let a=await (0,b.getSiteSettings)(),d=(0,c.normalizeBrandName)(a?.title),e=a?.footerDescription?.trim()||"Онлайн-школа для тех, кто готов побеждать.",f=`${d} — онлайн-школа`;return{siteName:d,title:f,description:e}}async function g(){let{siteName:a,title:b,description:c}=await f();return{title:b,description:c,metadataBase:e(),alternates:{canonical:"/"},openGraph:{title:b,description:c,type:"website",locale:"ru_RU",url:"/",siteName:a},twitter:{card:"summary_large_image",title:b,description:c},icons:{icon:[{url:"/favicon.ico",sizes:"48x48"},{url:"/favicon-32x32.png",sizes:"32x32",type:"image/png"},{url:"/favicon-16x16.png",sizes:"16x16",type:"image/png"}],shortcut:"/favicon.ico",apple:"/apple-touch-icon.png"},manifest:"/manifest.json"}}a.s(["getBaseUrlString",()=>d,"getMetadataBaseUrl",()=>e],963786),a.s(["buildSiteMetadata",()=>g,"getSiteMetaContent",()=>f],557298)},929113,(a,b,c)=>{"use strict";Object.defineProperty(c,"__esModule",{value:!0}),Object.defineProperty(c,"ImageResponse",{enumerable:!0,get:function(){return d}});class d extends Response{static #a=this.displayName="ImageResponse";constructor(...b){const c=new ReadableStream({async start(c){let d=new(await a.A(791227)).ImageResponse(...b);if(!d.body)return c.close();let e=d.body.getReader();for(;;){let{done:a,value:b}=await e.read();if(a)return c.close();c.enqueue(b)}}}),d=b[1]||{},e=new Headers({"content-type":"image/png","cache-control":"public, max-age=0, must-revalidate"});d.headers&&new Headers(d.headers).forEach((a,b)=>e.set(b,a)),super(c,{headers:e,status:d.status,statusText:d.statusText})}}},599475,(a,b,c)=>{b.exports=a.r(929113)},889221,a=>{"use strict";a.i(907997),a.i(599475),a.i(557298);var b=a.i(352425);let c={alt:"District — онлайн-школа",contentType:"image/png",size:{width:1200,height:630}};async function d(a){let{__metadata_id__:d,...e}=await a.params,f=(0,b.fillMetadataSegment)("/",e,"opengraph-image");return[function(a,b){let c={alt:a.alt,type:a.contentType||"image/png",url:f+"?f4a61deb2c85ee0b"},{size:d}=a;return d&&(c.width=d.width,c.height=d.height),c}(c,0)]}a.s(["default",0,d],889221)},791227,a=>{a.v(b=>Promise.all(["server/chunks/ssr/[externals]_next_dist_compiled_@vercel_og_index_node_055f47ab.js"].map(b=>a.l(b))).then(()=>b(121425)))},609489,a=>{a.v(b=>Promise.all(["server/chunks/ssr/node_modules_@sanity_client_dist__chunks-es_stegaEncodeSourceMap_e91a1003.js"].map(b=>a.l(b))).then(()=>b(614025)))},276016,a=>{a.v(b=>Promise.all(["server/chunks/ssr/[root-of-the-server]__48ac7fed._.js"].map(b=>a.l(b))).then(()=>b(312374)))}];

//# sourceMappingURL=%5Broot-of-the-server%5D__5b6ec5da._.js.map