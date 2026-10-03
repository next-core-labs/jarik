import { useEffect, useState } from "react";

export type Locale = "ar" | "en";

const STORAGE_KEY = "jarak-locale";

/**
 * قاموس عناصر الواجهة الثابتة فقط (أزرار، عناوين، تسميات فلاتر) لصفحتي السوق العام الأعلى زيارة —
 * وليس مكتبة i18n كاملة (لا توجد بالمشروع أصلًا). النص اللي يكتبه المكتب/المالك بنفسه (وصف الوحدة،
 * نبذة المكتب، المزايا) يبقى عربيًا كما أُدخل — ترجمته آليًا خارج نطاق هذي الميزة.
 */
const DICT = {
  ar: {
    nav_market: "سوق العروض",
    nav_requests: "سوق الطلبات",
    nav_offices: "مكاتب الحي",
    nav_dashboard: "لوحتي",
    nav_signin: "دخول / تسجيل",
    hero_title: "كل العروض تحت سقفٍ واحد",
    hero_subtitle:
      "شقق وفلل وأراضٍ وقصور ومحلات — للإيجار وللبيع من مكاتب ومُلّاك موثوقين، بصور حقيقية وأسعار واضحة.",
    tab_all: "الكل",
    tab_rent: "للإيجار",
    tab_sale: "للبيع",
    search_placeholder: "أدخل الحي أو المدينة أو اسم المكتب",
    search_aria: "الموقع أو اسم المكتب",
    search_button: "بحث",
    filter_type: "نوع العقار",
    filter_type_all: "كل الأنواع",
    filter_rooms: "عدد الغرف",
    filter_rooms_any: "أي عدد غرف",
    filter_furnished: "الأثاث",
    filter_furnished_all: "مؤثثة وغير مؤثثة",
    filter_furnished_yes: "مؤثثة",
    filter_furnished_no: "غير مؤثثة",
    filter_price_rent: "أعلى إيجار سنوي",
    filter_price_sale: "أعلى سعر بيع",
    filter_price_any: "أي سعر",
    filter_sort: "الترتيب",
    sort_newest: "الأحدث",
    sort_price_asc: "الأقل سعرًا",
    sort_price_desc: "الأعلى سعرًا",
    sort_area_desc: "الأكبر مساحة",
    results_heading: "العروض المتاحة",
    results_clear: "مسح التصفية",
    results_error_title: "تعذّر تحميل العروض",
    results_error_body: "تحقّق من الاتصال ثم حاول مجددًا.",
    results_retry: "إعادة المحاولة",
    results_empty_filtered: "لا توجد عروض مطابقة للبحث",
    results_empty_all: "لا توجد عروض منشورة حاليًا",
    results_empty_filtered_hint: "جرّب توسيع البحث أو مسح التصفية.",
    results_empty_all_hint: "تظهر هنا الوحدات الشاغرة التي تنشرها المكاتب.",
    footer_tagline: "جارك — منصة إدارة الأملاك وسوق العروض",
    unit_breadcrumb: "سوق العروض",
    unit_share: "مشاركة",
    unit_yearly: "سنويًا",
    unit_about: "عن العقار",
    unit_info: "معلومات العقار",
    unit_amenities: "المزايا والخدمات",
    unit_nearby: "الخدمات القريبة",
    unit_mortgage: "حاسبة التمويل العقاري",
    unit_similar: "عروض مشابهة",
    info_type: "نوع العقار",
    info_unit_no: "رقم الوحدة",
    info_floor: "الدور",
    info_rooms: "غرف النوم",
    info_halls: "الصالات",
    info_bathrooms: "الحمامات",
    info_area: "المساحة",
    info_furnished: "الأثاث",
    info_added: "تاريخ الإضافة",
  },
  en: {
    nav_market: "Market",
    nav_requests: "Requests",
    nav_offices: "Offices",
    nav_dashboard: "Dashboard",
    nav_signin: "Sign in",
    hero_title: "Every listing, one place",
    hero_subtitle:
      "Apartments, villas, land, and shops — for rent or sale from verified offices and owners, with real photos and clear prices.",
    tab_all: "All",
    tab_rent: "For rent",
    tab_sale: "For sale",
    search_placeholder: "Enter a district, city, or office name",
    search_aria: "Location or office name",
    search_button: "Search",
    filter_type: "Property type",
    filter_type_all: "All types",
    filter_rooms: "Bedrooms",
    filter_rooms_any: "Any bedrooms",
    filter_furnished: "Furnishing",
    filter_furnished_all: "Furnished & unfurnished",
    filter_furnished_yes: "Furnished",
    filter_furnished_no: "Unfurnished",
    filter_price_rent: "Max annual rent",
    filter_price_sale: "Max sale price",
    filter_price_any: "Any price",
    filter_sort: "Sort",
    sort_newest: "Newest",
    sort_price_asc: "Price: low to high",
    sort_price_desc: "Price: high to low",
    sort_area_desc: "Largest area",
    results_heading: "Available listings",
    results_clear: "Clear filters",
    results_error_title: "Couldn't load listings",
    results_error_body: "Check your connection and try again.",
    results_retry: "Retry",
    results_empty_filtered: "No listings match your search",
    results_empty_all: "No listings published yet",
    results_empty_filtered_hint: "Try widening your search or clearing filters.",
    results_empty_all_hint: "Vacant units published by offices will appear here.",
    footer_tagline: "Jarak — property management and marketplace platform",
    unit_breadcrumb: "Market",
    unit_share: "Share",
    unit_yearly: "/ year",
    unit_about: "About this property",
    unit_info: "Property details",
    unit_amenities: "Amenities",
    unit_nearby: "Nearby places",
    unit_mortgage: "Mortgage calculator",
    unit_similar: "Similar listings",
    info_type: "Property type",
    info_unit_no: "Unit number",
    info_floor: "Floor",
    info_rooms: "Bedrooms",
    info_halls: "Living rooms",
    info_bathrooms: "Bathrooms",
    info_area: "Area",
    info_furnished: "Furnishing",
    info_added: "Listed on",
  },
} as const;

export type TranslationKey = keyof (typeof DICT)["ar"];

function readInitialLocale(): Locale {
  if (typeof window === "undefined") return "ar";
  const fromUrl = new URLSearchParams(window.location.search).get("lang");
  if (fromUrl === "en" || fromUrl === "ar") return fromUrl;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "en" || stored === "ar") return stored;
  } catch {
    // localStorage معطّل (متصفح خاص) — العربية افتراضيًا
  }
  return "ar";
}

/**
 * لغة صفحات السوق العام فقط — لا تلمس dir/lang على <html> إطلاقًا (تبقى لوحة التحكم الداخلية
 * RTL بالكامل بلا أي أثر)، الصفحة نفسها تضبط dir محليًا على عنصرها الجذر.
 */
export function useLocale(): [Locale, (l: Locale) => void] {
  const [locale, setLocaleState] = useState<Locale>(readInitialLocale);

  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get("lang");
    if (fromUrl === "en" || fromUrl === "ar") setLocaleState(fromUrl);
  }, []);

  const setLocale = (l: Locale) => {
    setLocaleState(l);
    try {
      localStorage.setItem(STORAGE_KEY, l);
    } catch {
      // تجاهل
    }
    const url = new URL(window.location.href);
    if (l === "en") url.searchParams.set("lang", "en");
    else url.searchParams.delete("lang");
    window.history.replaceState(null, "", url.toString());
  };

  return [locale, setLocale];
}

export function translate(locale: Locale, key: TranslationKey): string {
  return DICT[locale][key];
}
