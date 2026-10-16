import { aiChatUrl, aiKey, aiModel } from "@/lib/ai.server";

// منطق التقييم السعري وكتابة الإعلانات بالذكاء الاصطناعي — يُستخدم من السيرفر فقط

export type MarketRow = {
  district: string | null;
  units_count: number;
  avg_rent: number | null;
};

export type RentSuggestion = {
  suggestedRent: number | null;
  reasoning: string;
  source: "ai" | "market_avg" | "unavailable";
};

async function gatewayJson(system: string, user: string): Promise<string | null> {
  const apiKey = aiKey();
  if (!apiKey) return null;
  const response = await fetch(aiChatUrl(), {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: aiModel(),
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });
  if (!response.ok) return null;
  const json = (await response.json()) as { choices?: { message?: { content?: string } }[] };
  const raw = json.choices?.[0]?.message?.content ?? "";
  const match = raw.match(/\{[\s\S]*\}/);
  return match ? match[0] : null;
}

const RENT_PROMPT = `أنت خبير تسعير عقاري في السوق السعودي. تصلك مواصفات وحدة وإحصاءات متوسط الإيجار لكل حي.
أعد JSON فقط بدون أي نص إضافي:
{"suggested_rent": رقم سنوي بالريال, "reasoning": "سطران بالعربية يبرّران السعر بالاعتماد على الحي والمواصفات ومتوسط السوق"}`;

export async function suggestRentAi(input: {
  unitType: string;
  district: string;
  rooms: number | null;
  halls: number | null;
  bathrooms: number | null;
  area: number | null;
  furnished: boolean;
  floorNo: string | null;
  market: MarketRow[];
}): Promise<RentSuggestion> {
  const districtAvg = (name: string) =>
    input.market.find((m) => (m.district ?? "") === name)?.avg_rent ?? null;

  const avg =
    districtAvg(input.district) ??
    (input.market.length
      ? Math.round(
          input.market.reduce((s, m) => s + Number(m.avg_rent ?? 0), 0) / input.market.length,
        )
      : null);

  const raw = await gatewayJson(
    RENT_PROMPT,
    JSON.stringify({ ...input, market: input.market.slice(0, 20) }),
  );

  if (raw) {
    try {
      const parsed = JSON.parse(raw) as { suggested_rent?: number; reasoning?: string };
      if (parsed.suggested_rent && Number(parsed.suggested_rent) > 0) {
        return {
          suggestedRent: Math.round(Number(parsed.suggested_rent)),
          reasoning: parsed.reasoning ?? "تسعير مقترح بناءً على الحي والمواصفات ومتوسط السوق.",
          source: "ai",
        };
      }
    } catch {
      // fallback below
    }
  }

  if (avg && avg > 0) {
    return {
      suggestedRent: Math.round(avg),
      reasoning: `تعذّر الاتصال بالتسعير الذكي — اعتمدنا متوسط إيجار الحي من تقرير السوق (${Math.round(avg).toLocaleString("ar-SA")} ريال سنويًا).`,
      source: "market_avg",
    };
  }

  return {
    suggestedRent: null,
    reasoning: "لا تتوفر بيانات كافية للتسعير — أدخل السعر يدويًا.",
    source: "unavailable",
  };
}

export async function generateAdAi(input: {
  unitNumber: string;
  unitName: string | null;
  unitType: string;
  district: string | null;
  street: string | null;
  floorNo: string | null;
  rooms: number | null;
  halls: number | null;
  bathrooms: number | null;
  area: number | null;
  annualRent: number;
  furnished: boolean;
  officeName: string | null;
  officePhone: string | null;
  city: string | null;
}): Promise<{ text: string; source: "ai" | "template" }> {
  const raw = await gatewayJson(
    `أنت كاتب إعلانات عقارية سعودية محترف. اكتب إعلانًا جاهزًا للنشر في واتساب لوحدة شاغرة.
أعد JSON فقط بدون أي نص إضافي:
{"text": "نص الإعلان بالعربية، 3-5 أسطر، مع رموز تعبيرية مناسبة، يذكر أهم المواصفات والسعر وطريقة التواصل"}`,
    JSON.stringify(input),
  );

  if (raw) {
    try {
      const parsed = JSON.parse(raw) as { text?: string };
      if (parsed.text && parsed.text.trim()) {
        return { text: parsed.text.trim(), source: "ai" };
      }
    } catch {
      // fallback below
    }
  }

  const lines = [
    `📢 ${input.unitType}${input.unitName ? ` «${input.unitName}»` : ` رقم ${input.unitNumber}`} للإيجار${input.district ? ` — حي ${input.district}` : ""}${input.city ? `، ${input.city}` : ""}`,
    [
      input.rooms ? `${input.rooms} غرف` : null,
      input.halls ? `${input.halls} صالة` : null,
      input.bathrooms ? `${input.bathrooms} حمام` : null,
      input.area ? `${input.area} م²` : null,
      input.furnished ? "مؤثثة" : "غير مؤثثة",
      input.floorNo ? `الدور ${input.floorNo}` : null,
    ]
      .filter(Boolean)
      .join(" · "),
    `💰 الإيجار السنوي: ${input.annualRent.toLocaleString("ar-SA")} ريال`,
    input.officeName ? `للتواصل: ${input.officeName}` : null,
    input.officePhone ? `📞 ${input.officePhone}` : null,
  ].filter(Boolean);
  return { text: lines.join("\n"), source: "template" };
}
